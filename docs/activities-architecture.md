# ShortSwitch Activities: existing-system audit and target architecture

Status: design audit only  
Audit date: 2026-10-30  
Scope: Segment 00 — no runtime code, database schema, user data, or deployment configuration was changed.

## 1. Executive summary

ShortSwitch is currently a single-process Fastify application serving a Vue SPA and using one SQLite database. The existing **Live** module is a mature lightweight audience-response feature, but it is not an assessment engine:

- one activity has exactly one effective question;
- the four supported types are `open_answer`, `word_cloud`, `multiple_choice`, and `scale`;
- a browser-generated participant token provides best-effort per-activity identity;
- a response is submitted once as a complete payload;
- there are no attempts, autosaved answers, deadlines, points, answer keys, grading, drafts, or immutable published versions;
- SSE broadcasts result snapshots/deltas and does not control participant navigation.

The Pages editor has reusable interaction and rendering patterns: stable client-side block IDs, insertion popovers, pointer and keyboard reordering, drag placeholders/ghosts, editor-preview highlighting, themes, layouts, and responsive preview. Its persistence model must **not** be reused for Activities: saving a Page deletes and reinserts all top-level block rows, published Pages directly expose the current mutable state, and `PageBlockConfig` is a wide Page-specific structure.

The safest evolution is therefore a dual-mode design:

1. Keep all current `live_*` rows, `/api/live/*` behavior, public slugs, and historical responses intact as `legacy_v1`.
2. Add a versioned Activities domain beside it, anchored to the existing `live_activities.id` and the existing `public_slugs` row.
3. Add new `/api/activities/*` APIs and a new editor/public participant flow.
4. Reuse Pages UI primitives after extracting generic editor behavior, but use separate Activity repositories, validation, versioning, and attempt persistence.
5. Never expose private grading configuration through a shared DTO, a public SQL projection, SSE, or the client bundle.

This preserves every existing Live URL and response while allowing new Activities to use immutable published snapshots and server-authoritative attempts.

## 2. Current architecture map

```text
Browser
  ├─ /app/*
  │    Vue 3 SPA
  │      ├─ Links / Analytics / Settings
  │      ├─ Live admin list, one-question editor, results/moderation
  │      └─ Pages list, block editor, preview, analytics
  ├─ /:slug
  │    Fastify root resolver
  │      ├─ Live found → Vue public Live page
  │      ├─ Page found → Vue public Page
  │      └─ Link found → protected flow or redirect
  ├─ /present/:slug → Vue Live presentation page
  └─ /api/*
       Fastify route modules
         ├─ services: validation and business rules
         ├─ repositories: prepared SQL statements
         ├─ in-process Live SSE coordinator
         └─ node:sqlite DatabaseSync (WAL + foreign keys)

SQLite
  ├─ users / sessions
  ├─ links / analytics_events
  ├─ public_slugs (shared root namespace)
  ├─ live_activities / live_questions / options
  │    / participants / responses / views / moderation_rules
  └─ pages / page_blocks / page_views / page_block_clicks
```

There is no ORM, background worker, Redis, message broker, separate realtime process, migration framework, or separate media service. This is important for both the proposed transaction model and the limitations of in-memory SSE.

## 3. Existing Live implementation

### 3.1 Database model

The Live schema is initialized in `src/server/db.ts`.

| Table | Current purpose | Important constraints |
|---|---|---|
| `live_activities` | Owner, slug, title and activity-wide settings | status is `active/closed`; identity is `anonymous/named`; moderation is `off/filter_only/review_all`; optional expiration; public result revision |
| `live_questions` | Question definition | supports a numeric `position`, but current repository queries use `position = 0` |
| `live_question_options` | Multiple-choice options | ordered per question |
| `live_participants` | Per-activity browser identity | unique `(activity_id, participant_token)` |
| `live_responses` | Submitted response and moderation state | one row contains text, selected option IDs JSON, or scale value; original and published name/text are separate |
| `live_views` | Public view analytics | visitor HMAC and request metadata |
| `moderation_rules` | Owner-wide text/name filters | `whole_word` or `contains` |
| `public_slugs` | Shared root URL registry | resource type includes `live_activity`; slug and resource ID are unique |

Although `live_questions.position` makes multiple rows structurally possible, the runtime is single-question. `LiveRepository` joins the question with `q.position = 0`, update finds position zero, response submission resolves position zero, and public/admin DTOs expose a flat `question` and `type` rather than a list. Merely inserting more question rows would not make them reachable.

### 3.2 Current types and validation

`src/shared/types.ts` defines one flat `LiveActivityInput`. It combines activity settings and question settings:

- title, slug, status and identity mode;
- multiple-response policy and participant limit;
- moderation and public-result settings;
- one prompt and one of four types;
- choice options, scale limits, or text length.

`LiveService` performs manual runtime validation. Current notable limits are:

- responses per participant: 1–100;
- text length: 1–2000;
- multiple-choice options: 2–12, unique labels, maximum label length 120;
- scale: integer bounds from -10 through 100, no more than 21 displayed values.

There is no shared schema object that can validate both client and server payloads. TypeScript types alone do not validate untrusted JSON.

### 3.3 Create, update and persistence

Creation is a `BEGIN IMMEDIATE` transaction that inserts:

1. the shared `public_slugs` row;
2. the `live_activities` row;
3. the question at position zero;
4. applicable options.

Updates modify the same activity and question. Once responses exist, the service prevents changes that would invalidate stored responses, including question type, choice structure, and scale bounds. This is a useful protection for legacy Live, but it is not publication versioning.

Submission is also a `BEGIN IMMEDIATE` transaction. The repository rechecks active/expiration state, creates or updates the participant, counts prior responses, enforces the participant limit, inserts the response, and increments `public_revision` when an approved response changes the public result. This transaction is the strongest reusable domain pattern in current Live.

### 3.4 Participant identification

The public client stores:

- a `crypto.randomUUID()` token under a key scoped by Live slug;
- the most recently used display name under a global convenience key.

The token is sent in `x-live-participant` and in response bodies. Server uniqueness is scoped to an activity, so participation in one Live activity does not block another.

This is appropriate as best-effort, registration-free identity for a poll. It is **not attempt authorization**:

- the client creates the token;
- it is not a secret and is stored in localStorage;
- it can be deleted, copied, or replaced;
- there is no server-issued attempt credential.

New graded Activities need a server-issued, high-entropy attempt token whose hash is stored in SQLite. The existing participant token may remain a convenience identity hint, but must not authorize answer mutation or submission.

### 3.5 Moderation

Current moderation is server-side and supports:

- global rules owned by the admin;
- Unicode/case/spacing normalization;
- whole-word and substring matching;
- filtering both participant names and textual answers;
- `approved`, `pending`, and `rejected` states;
- retaining original text/name separately from moderator-published text/name;
- explicit confirmation when edited text still matches a ban rule.

Public result queries include approved data only. Pending and rejected rows are not sent through public result APIs or SSE.

For Activities, moderation and grading must remain separate concepts. A moderator edit may change the public display text, but must not silently change the participant's submitted answer or its authoritative score.

### 3.6 Analytics

Live views are independent rows in `live_views`. They feed per-activity and global analytics with device, browser, OS, referrer, language, and visitor identity. Retention cleanup covers these rows.

Current response statistics distinguish response count and unique participants. Multiple selected options in one response do not inflate the submission count. Public result aggregation is type-specific and bounded:

- Open Answer: most recent 100 in the initial snapshot, older approved answers by cursor pagination;
- Word Cloud: top 150 aggregates, remaining values through search/pagination;
- Multiple Choice and Scale: compact aggregates.

The new Activities implementation can continue to record public page views in `live_views`, preserving global analytics semantics. Attempt/answer statistics should use new tables and explicit adapters rather than pretending legacy responses are graded attempts.

### 3.7 Public and admin UI

Current client components include:

- `LivePage.vue`: searchable/sortable admin cards and activity actions;
- `LiveActivityModal.vue`: flat one-question create/edit modal;
- `LiveActivityPage.vue`: analytics, response history, and moderation;
- `PublicLivePage.vue`: one-question participant form and optional results;
- `LivePresentationPage.vue`: public presentation board;
- `LiveResultsBoard.vue`: result visualization for the four legacy types;
- `LiveActivityPicker.vue`: activity selection inside Pages.

`PublicLivePage.vue` submits a complete response once. It has no slide state, attempt state, answer autosave, optimistic concurrency, deadline recovery, or grading result model.

## 4. Current Live routes

### 4.1 Authenticated administration

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/live` | list/create |
| GET/PATCH/DELETE | `/api/live/:id` | detail/update/delete |
| POST | `/api/live/:id/status` | open/close |
| POST | `/api/live/:id/analytics/clear` | clear views, responses and participants |
| PATCH | `/api/live/:id/responses/:responseId` | moderate/edit response |
| GET | `/api/live/moderation/pending` | pending queue |
| CRUD | `/api/moderation/rules` | global ban filter |

All admin routes require the authenticated session; state-changing routes use the existing CSRF hook.

### 4.2 Public Live

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/live/public/:slug` | one-question participant payload |
| POST | `/api/live/public/:slug/responses` | one complete response |
| GET | `/api/live/public/:slug/results` | public result snapshot if enabled |
| GET | `/api/live/public/:slug/answers` | approved Open Answer history |
| GET | `/api/live/public/:slug/words` | approved Word Cloud aggregates |
| GET | `/api/live/public/:slug/events` | result SSE if preview is public |
| GET | `/api/live/public/:slug/presentation` | presentation snapshot |
| GET | `/api/live/public/:slug/presentation/events` | presentation SSE |

Public submission uses the global API limiter plus in-memory limits keyed by IP+slug and participant token+slug. No IP address is used as primary participant identity.

## 5. SSE audit

`LiveRealtimeService` has no external realtime dependency. It uses:

- Node `ServerResponse` objects;
- in-process `Map`/`Set` collections;
- a 500 ms coalescing timer per activity;
- a 25-second heartbeat;
- current snapshots and revision-based deltas;
- a 256 KiB writable-buffer limit and reconnect snapshot after drain.

Routes hijack the Fastify response, emit `text/event-stream`, disable proxy buffering, and register cleanup on raw request `close` and `error`. Vue pages close `EventSource` in `onBeforeUnmount`. Activity deletion closes its clients; Fastify `onClose` closes the realtime service and timers.

The implementation is suitable for lightweight result distribution in the current single-process deployment. It is intentionally process-local: multiple application replicas would not share clients, revisions, or broadcasts.

Activities should **not** use SSE for answer autosave or slide control:

- HTTP is a better fit for idempotent writes, authentication, conflicts, and status codes;
- the product explicitly excludes host-controlled synchronization;
- browser `EventSource` does not send a request body and has limited custom-header support.

SSE may be reused for result/presentation updates and admin attempt-status notifications. Participant correctness must not depend on receiving an SSE event; reconnect must always recover from an authenticated HTTP snapshot.

## 6. Pages editor audit

### 6.1 Editor behavior

`PageEditorPage.vue` already implements valuable editor mechanics:

- stable block IDs generated client-side;
- ordered blocks and position-specific insertion;
- compact add popover with search;
- custom pointer drag started only from the left handle;
- opaque drag ghost, fixed-size placeholder and edge autoscroll;
- keyboard reordering with focus restoration and live-region announcements;
- block edit modal and nested Double block editing;
- hover/activation links between the left editor list and preview;
- automatic scrolling to linked editor/preview elements;
- desktop/mobile preview modes;
- theme, layout and background-pattern preview.

No third-party drag-and-drop library is installed. The behavior is implemented directly with pointer events and DOM measurements.

### 6.2 Rendering and public publication

`PageRenderer.vue` and `PageBlockRenderer.vue` render the same block data in preview and public mode. Editor-only interaction is enabled explicitly with `editorInteractive`; public rendering does not expose those handlers. Vue interpolation is used for user text, and external image URLs are validated as HTTPS.

Page status is `draft`, `published`, or `disabled`, but a published Page is not an immutable snapshot. Public retrieval reads the current `pages` and `page_blocks` rows. Updating a Page changes what the existing slug serves immediately.

### 6.3 Persistence boundary

Page save validates the full document, starts `BEGIN IMMEDIATE`, updates the Page, deletes all its top-level `page_blocks`, and reinserts the submitted block list. Existing block IDs preserve their original creation timestamp, but database rows are still replaced as a set.

That model is acceptable for Pages because no participant attempts reference a specific Page block version. It is unsafe for assessments because an in-progress or submitted attempt must keep referring to the exact question and answer key it started with.

### 6.4 What can and cannot be shared

Safe to extract/reuse:

- editor panel layout and responsive preview shell;
- insertion popover and searchable type registry UI;
- drag ghost, placeholder, autoscroll and keyboard reorder behavior;
- stable-ID hover/selection bridge between list and preview;
- theme/layout controls and design tokens;
- generic content renderers for Heading, Text, Image and Divider;
- modal accessibility patterns, buttons, empty states, toasts and pickers.

Must remain separate:

- `PageBlockType`, the wide optional `PageBlockConfig`, and Page validation;
- Page whole-document replace repository;
- Page publication/status semantics;
- Page-specific Link, Live, Email, Spacer and Double behavior unless separately required;
- Page analytics and click recording.

Recommended refactoring boundary: extract headless editor interaction composables and presentational block shells, then give Pages and Activities separate registries, DTOs, services and repositories. Do not make Activities a special Page or store question keys inside Page block JSON.

## 7. Existing shared platform components

Reusable platform capabilities already present include:

- authenticated application shell and responsive sidebar;
- cookie session authentication and ownership checks;
- CSRF protection for admin mutations;
- shared API wrapper with credentials and CSRF token handling;
- global toast system;
- Light/System/Dark theme and EN/LV localization;
- public locale resolution from the browser/`Accept-Language`;
- QR popover, copy-link actions and public URL utilities;
- search/sort controls, stat cards and analytics breakdown components;
- chart color/tooltip utilities;
- shared Page Link and Live pickers;
- safe public error localization;
- common design tokens in `src/client/styles.css`.

There is no general-purpose modal library, form schema library, state store, upload component, or media repository. Existing modals and complex editors are component-local.

## 8. Authentication and public access

ShortSwitch is currently single-admin. Authentication uses SQLite-backed server sessions in an HttpOnly cookie. Session versioning supports global invalidation after password change. Admin mutations use CSRF protection and all ownership checks derive the user ID from the authenticated session rather than request input.

Public root access uses a global slug namespace. The current root resolver checks Live, then Pages, then Links; all three also register the slug in `public_slugs`. Public Live/Page API responses are `no-store`. Links add password, disabled and expiration states before redirect.

For new Activities:

- admin ownership must continue to come only from the session;
- attempts need a separate server-issued bearer capability, not the admin session and not a user-supplied participant ID;
- attempt endpoints must verify token hash, attempt ID, activity ID, pinned version, state and deadline on every write;
- public payloads must use an explicit allowlisted serializer and must never reuse admin DTOs;
- public error messages must not reveal answer keys or distinguish protected internal states unnecessarily.

## 9. SQLite migration audit

The current project has no migration version table or migration runner. `getDb()`:

1. creates the database directory;
2. opens one process-wide `DatabaseSync` connection;
3. enables WAL and foreign keys;
4. executes `CREATE TABLE/INDEX IF NOT EXISTS`;
5. inspects `sqlite_master` and `PRAGMA table_info`;
6. conditionally rebuilds constrained tables or runs `ALTER TABLE ADD COLUMN`.

Existing rebuilds use `BEGIN IMMEDIATE`, copy rows, drop the legacy table, recreate indexes, and commit/rollback. This works for small additive evolution but provides no ordered migration history, checksum, or explicit baseline.

Activities should introduce an additive `schema_migrations` table and ordered migration functions. The migration runner can coexist with the current bootstrap initially, but the Activities tables must be created through an idempotent, recorded migration. A deployment must take a database backup before the first Activities-enabled start. No startup migration should reinterpret or copy legacy responses automatically.

## 10. Tests and deployment audit

### 10.1 Automated tests

The repository currently contains 20 test files and 73 `test`/`it` cases. Coverage includes:

- production startup invariants, CORS, CSP, secure cookies, CSRF and unauthenticated access;
- ownership/IDOR, session lifecycle, bootstrap/reset behavior and rate limiting;
- Link validation, password flow, expiration, analytics and cleanup;
- Live shared slugs, participant limits, atomic concurrent limits, all four result types, moderation modes, bounded public history and revisions;
- Live realtime deltas, removals and slow-client disconnection;
- Pages CRUD, shared slugs, safe blocks, analytics and old-schema upgrades;
- localization catalogs and public error localization;
- preferences synchronization;
- Page renderer safety and editor-only stable block interaction;
- key Live/Page/analytics UI components.

Load/verification scripts exist for Links, Live and Pages at 50/200/500 clients, plus Word Cloud, Open Answer and long-history scenarios.

There is no configured coverage script, coverage dependency, lint script, or CI workflow in `package.json`. Coverage cannot be reported from the current scripts without adding/configuring a coverage provider. No test currently covers Activity versions, answer-key non-disclosure, attempt credentials, autosave conflicts, deadline races, grading plugins, or recovery of in-progress attempts; those features do not yet exist.

This audit did not execute the test suite because no runtime code was changed. The inventory above is based on the test sources and package scripts.

### 10.2 Build and Docker

The multi-stage Dockerfile:

- builds with `node:22-bookworm-slim` and `npm ci`;
- creates client and server production output;
- installs production dependencies in the runtime stage;
- runs as a non-root system user;
- normalizes CRLF on `docker-entrypoint.sh`;
- persists `/app/data`;
- exposes port 3000 and checks `/api/health`.

`docker-compose.yml` provides the application with a named SQLite volume and an opt-in test profile that runs typecheck and tests. The architecture is one container/one Fastify process/one SQLite writer. Any future horizontal scaling would require a different realtime coordination strategy and careful SQLite write ownership, but it is not necessary for this segment.

## 11. Reuse and refactoring matrix

| Area | Reuse as-is | Extract/adapt | Replace for Activities |
|---|---:|---:|---:|
| Shared slug registry and public URL | Yes | Resolver dispatch by model | No |
| Admin sessions/CSRF/ownership | Yes | Activity-specific authorization helpers | No |
| Live view analytics | Yes | Label/report legacy vs assessment where needed | No |
| Global moderation rules | Yes | Apply to textual public display and names | Do not use as grading |
| Live atomic response-limit transaction | Pattern | Attempt/deadline transaction | Current response tables |
| Live SSE coordinator | Results only | Generic topic/snapshot provider if useful | No slide synchronization |
| Pages editor shell | No | Extract generic interactions | Page persistence |
| Pages content renderers | Heading/Text/Image/Divider | Activity registry wrappers | Page-specific blocks |
| Pages themes/preview | Mostly | Activity theme tokens and slide viewport | Public Page publication model |
| `LiveActivityModal` | No | Visual conventions only | Slide builder |
| `PublicLivePage` | Legacy only | Public styling/localization | Attempt runner |
| `LiveResultsBoard` | Legacy results | Plugin result renderers where semantics match | Grading UI |
| Shared types file | Existing legacy DTOs | Add explicit public/admin/attempt contracts | One universal config type |

## 12. Compatibility risks

### 12.1 Data risks

1. **Silent conversion of legacy responses.** A `live_response` is a poll submission, not an assessment attempt. Converting it would invent start time, version, deadline and score. Keep it legacy.
2. **Mutable questions.** Pointing attempts at current `live_questions` would make later edits alter historical meaning. Attempts must pin an immutable version.
3. **Whole-document replacement.** Reusing Page save logic could delete IDs referenced by attempts. Published Activity rows must never be replaced.
4. **Answer keys in generic JSON.** A shared config object risks accidental inclusion in public DTOs or client bundles. Store and query private keys separately.
5. **Legacy participant token trust.** Treating it as authorization would allow answer takeover. Use a server-issued attempt secret.
6. **Deadline race.** A client timer or pre-check outside the write transaction allows late writes. Recheck and transition state in the same database transaction as every autosave/submit.
7. **Async analytics.** Current view analytics can remain best-effort; attempts and answers cannot use the asynchronous analytics queue because they are core data.

### 12.2 URL and API risks

1. Existing root Live URLs and `/present/:slug` must keep working.
2. Existing Pages `live_activity` blocks store an activity resource ID and link to its slug; preserving `live_activities.id` and `public_slugs` avoids broken Pages.
3. Changing `public_slugs.resource_type` from `live_activity` would require a constrained-table rebuild and create unnecessary risk. Keep it for both legacy Live and new Activities initially.
4. Reusing `/api/live/public/:slug` with an incompatible response shape would break cached/old frontend bundles. Use version-aware dispatch or new `/api/activities/*` endpoints.
5. Old browser tabs may still call legacy endpoints during deployment. Legacy handlers must remain available across at least the migration release.

### 12.3 Product/semantic risks

- Existing Live `active/closed` describes submission availability, not draft/published state.
- Existing expiration is a resource lifetime, not an attempt deadline.
- Existing `public_results` is result-board visibility, not permission to reveal correctness.
- Moderation status is not grading status.
- Word Cloud aggregation and Open Answer display do not imply an objectively correct answer.

These concepts must have distinct columns and DTOs.

## 13. Proposed Activities database schema

The following is a target design, not a migration executed by this audit. Names may be adjusted during implementation, but the boundaries and invariants should remain.

### 13.1 Legacy anchor and mode

Keep `live_activities` as the stable owned resource and slug anchor. Add a one-to-one extension rather than rewriting it:

```text
activity_models
  activity_id              PK, FK live_activities(id) ON DELETE CASCADE
  model                     CHECK legacy_v1 | slides_v1
  editor_revision           INTEGER NOT NULL
  created_at
  updated_at
```

Existing rows default logically to `legacy_v1`. New builder-created rows use `slides_v1`. An extension row can be inserted lazily or backfilled without touching questions/responses.

### 13.2 Draft and immutable versions

```text
activity_versions
  id                        PK
  activity_id               FK live_activities(id) ON DELETE CASCADE
  version_number            INTEGER NOT NULL
  state                     CHECK draft | published | archived
  source_draft_revision     INTEGER NOT NULL
  title                     TEXT NOT NULL
  description               TEXT
  theme_id                  TEXT NOT NULL
  layout_id                 TEXT NOT NULL
  settings_json             TEXT NOT NULL        -- validated public/non-secret settings
  content_hash              TEXT NOT NULL
  created_by                FK users(id) ON DELETE SET NULL
  created_at
  published_at
  UNIQUE(activity_id, version_number)
  UNIQUE(activity_id, id)   -- enables ownership-preserving composite FKs

activity_heads
  activity_id               PK, FK live_activities(id) ON DELETE CASCADE
  draft_version_id          NOT NULL
  published_version_id      NULL
  draft_revision            INTEGER NOT NULL
  updated_at
  FK(activity_id, draft_version_id) -> activity_versions(activity_id, id)
  FK(activity_id, published_version_id) -> activity_versions(activity_id, id)
```

The mutable draft is never served to participants. Publishing validates the complete draft, clones it into a new immutable published version, and atomically changes `published_version_id`. The draft remains editable. Older published versions are marked `archived` but never modified or deleted while referenced by attempts.

### 13.3 Slides and ordered blocks

```text
activity_slides
  id                        PK
  version_id                FK activity_versions(id) ON DELETE CASCADE
  stable_key                TEXT NOT NULL
  position                  INTEGER NOT NULL
  title                     TEXT
  settings_json             TEXT NOT NULL
  created_at
  updated_at
  UNIQUE(version_id, stable_key)
  UNIQUE(version_id, position)

activity_blocks
  id                        PK
  slide_id                  FK activity_slides(id) ON DELETE CASCADE
  stable_key                TEXT NOT NULL
  position                  INTEGER NOT NULL
  block_type                CHECK heading | text | image | divider | question
  config_json               TEXT NOT NULL        -- validated content/public config only
  visible                   INTEGER NOT NULL
  created_at
  updated_at
  UNIQUE(slide_id, stable_key)
  UNIQUE(slide_id, position)
```

Enforce at most one question block per slide with a partial unique index:

```sql
CREATE UNIQUE INDEX ... ON activity_blocks(slide_id)
WHERE block_type = 'question';
```

`stable_key` is copied across draft/publication clones for editor reconciliation, while each immutable version receives new row IDs. Attempts reference the published row IDs.

### 13.4 Question public configuration and private keys

```text
activity_questions
  block_id                  PK, FK activity_blocks(id) ON DELETE CASCADE
  question_type             CHECK single_choice | multiple_choice | open_answer |
                                  word_cloud | ordering | matching | image_labeling
  prompt                    TEXT NOT NULL
  points                    INTEGER NOT NULL
  required                  INTEGER NOT NULL
  grading_mode              CHECK automatic | manual | ungraded
  public_config_json        TEXT NOT NULL
  schema_version            INTEGER NOT NULL

activity_question_items
  id                        PK
  question_block_id         FK activity_questions(block_id) ON DELETE CASCADE
  stable_key                TEXT NOT NULL
  item_role                 TEXT NOT NULL
  position                  INTEGER NOT NULL
  public_json               TEXT NOT NULL
  UNIQUE(question_block_id, stable_key)
  UNIQUE(question_block_id, item_role, position)

activity_question_keys
  question_block_id         PK, FK activity_questions(block_id) ON DELETE CASCADE
  key_schema_version        INTEGER NOT NULL
  key_json                  TEXT NOT NULL
  updated_at
```

`activity_question_keys` must be accessed only by an admin-key repository and the server grader. Public queries must not join it. Encryption at rest is not currently available in ShortSwitch; the SQLite file is already a trusted server asset containing password hashes and sessions. The immediate security boundary is strict API/query separation and filesystem protection. Adding encryption would also require a stable external key, rotation and backup semantics, so it should not be implied without a separate design.

### 13.5 Attempts, progress and answers

```text
activity_attempts
  id                        PK
  activity_id               NOT NULL
  version_id                NOT NULL
  participant_id            NULL, FK live_participants(id) ON DELETE SET NULL
  participant_name          TEXT
  attempt_number            INTEGER NOT NULL
  access_token_hash         TEXT NOT NULL UNIQUE
  status                    CHECK in_progress | submitted | auto_submitted | expired
  started_at                TEXT NOT NULL
  deadline_at               TEXT
  submitted_at              TEXT
  last_saved_at             TEXT
  current_slide_id          TEXT
  revision                  INTEGER NOT NULL
  score                     REAL
  max_score                 REAL NOT NULL
  grading_revision          INTEGER NOT NULL
  created_at
  updated_at
  FK(activity_id, version_id) -> activity_versions(activity_id, id)

activity_attempt_answers
  attempt_id                FK activity_attempts(id) ON DELETE CASCADE
  question_block_id         FK activity_questions(block_id) ON DELETE RESTRICT
  answer_json               TEXT NOT NULL
  published_answer_json     TEXT
  moderation_status         CHECK approved | pending | rejected
  moderation_reason         TEXT
  client_revision           INTEGER NOT NULL
  server_revision           INTEGER NOT NULL
  saved_at                  TEXT NOT NULL
  finalized_at              TEXT
  grading_status            CHECK pending | graded | manual_review
  awarded_points            REAL
  grading_details_json      TEXT
  PRIMARY KEY(attempt_id, question_block_id)

activity_attempt_slide_progress
  attempt_id                FK activity_attempts(id) ON DELETE CASCADE
  slide_id                  FK activity_slides(id) ON DELETE RESTRICT
  status                    CHECK unseen | viewed | completed
  first_viewed_at
  completed_at
  PRIMARY KEY(attempt_id, slide_id)
```

Indexes are required for:

- attempts by activity/status/started time;
- attempts by participant/activity/attempt number;
- deadline scans by status/deadline;
- answers by question/moderation/grading status;
- version slides and slide blocks by position.

A separate deadline worker is not required in the current single-process design. Expiration can be applied lazily and authoritatively whenever an attempt is loaded, autosaved or submitted. An optional in-process timer may improve UI freshness, but cannot be the source of truth.

## 14. Publication, autosave and grading invariants

### 14.1 Publishing

Publish must be one `BEGIN IMMEDIATE` transaction:

1. verify admin ownership and expected draft revision;
2. validate every slide, block, question plugin config and private key;
3. ensure at most one question per slide and all referenced item IDs exist;
4. compute deterministic maximum points and content hash;
5. clone the draft into new immutable version rows;
6. mark the previous published version archived, without modifying its children;
7. atomically switch the publication pointer;
8. increment the editor revision and commit.

The public slug starts new attempts on the publication pointer visible at the beginning of the transaction. Existing attempts remain pinned to their original `version_id`.

### 14.2 Starting an attempt

The server must:

- verify activity status, expiration, publication and attempt limits;
- resolve identity/name rules;
- generate a cryptographically random attempt token;
- store only a hash/HMAC of that token;
- pin the current published version;
- calculate and persist `deadline_at` from server time;
- return `serverNow`, `deadlineAt`, the attempt ID/token and an allowlisted public snapshot.

For a duration timer, `deadline_at = started_at + duration`. For a fixed activity deadline, use that timestamp. If both are supported, persist the earlier deadline. The browser countdown is presentation only.

### 14.3 Autosave

Autosave uses authenticated HTTP `PUT`/`PATCH`, not SSE. Every write transaction must:

1. hash and verify the attempt token;
2. verify activity/version/question membership;
3. verify `in_progress` state;
4. compare database UTC time to persisted `deadline_at`;
5. if expired, atomically auto-submit before rejecting the late mutation;
6. validate and normalize the answer with the question plugin;
7. compare the supplied client/server revision;
8. upsert the answer and increment the attempt revision.

Stale writes return `409` with the current server revision and answer. Idempotent retry with the same revision/payload should return the current state rather than duplicate data.

### 14.4 Submission and grading

Manual and automatic submission use the same transaction and grader. The server loads the attempt's pinned version and private keys, validates completeness, grades automatic questions, flags manual questions, persists per-answer and total results, and seals the attempt.

Clients may display scores returned by the server but may never submit a score, correctness flag or deadline. Correct-answer disclosure is a separate post-submission policy and must never be inferred from `public_results`.

## 15. Proposed API structure

Keep `/api/live/*` operational for `legacy_v1`. Add explicit Activities routes so old clients do not receive incompatible shapes.

### 15.1 Admin APIs

```text
GET    /api/activities
POST   /api/activities
GET    /api/activities/:activityId
PATCH  /api/activities/:activityId                 metadata/status only
DELETE /api/activities/:activityId

GET    /api/activities/:activityId/draft
PUT    /api/activities/:activityId/draft            full validated draft + expected revision
POST   /api/activities/:activityId/publish
GET    /api/activities/:activityId/versions
POST   /api/activities/:activityId/versions/:versionId/restore-to-draft

POST   /api/activities/:activityId/status           open/close
GET    /api/activities/:activityId/attempts
GET    /api/activities/:activityId/results
GET    /api/activities/:activityId/analytics
POST   /api/activities/:activityId/analytics/clear
PATCH  /api/activities/:activityId/answers/:answerId/moderation
```

All state changes use the existing CSRF mechanism. Every service lookup scopes by the authenticated owner. Draft updates use an expected revision (`If-Match` or a required body field) to prevent two tabs from silently overwriting each other.

### 15.2 Public/attempt APIs

```text
GET    /api/activities/public/:slug                 minimal availability/metadata
POST   /api/activities/public/:slug/attempts        start or policy-controlled resume

GET    /api/activity-attempts/:attemptId            recover public snapshot/progress
PATCH  /api/activity-attempts/:attemptId/progress   autosave current/completed slide
PUT    /api/activity-attempts/:attemptId/answers/:questionId
POST   /api/activity-attempts/:attemptId/submit
GET    /api/activity-attempts/:attemptId/result     policy-filtered result
```

Attempt routes use the server-issued bearer capability. They do not use a request-provided user ID and do not trust client scores/deadlines. Rate limits should combine IP+slug for abuse resistance and attempt ID/token for mutation limits, while retaining the documented limitation that IP is not participant identity.

Optional SSE:

```text
GET /api/activities/public/:slug/results/events
GET /api/activities/:activityId/attempt-events      admin only, if needed
```

There is deliberately no host-slide endpoint or participant navigation broadcast.

### 15.3 Public root routing

Keep the root URL and `public_slugs.resource_type = 'live_activity'`. Resolve the resource ID, inspect `activity_models.model`, and dispatch:

- `legacy_v1` → current `PublicLivePage` and Live API;
- `slides_v1` → Activity runner and Activities API.

Keep `/present/:slug` for legacy presentation. A later Activity results/presentation route may be added without changing the participant root URL. `/app/live` may remain as an alias/redirect when the admin navigation label becomes Activities.

## 16. Question plugin architecture

Use a registry keyed by a discriminated `QuestionType`. A plugin is a domain contract, not only a Vue component.

```ts
interface QuestionDefinitionPlugin<PublicConfig, PrivateKey, Answer, Result> {
  type: QuestionType;
  schemaVersion: number;
  capabilities: {
    grading: 'automatic' | 'manual' | 'optional';
    textModeration: boolean;
    usesImage: boolean;
  };
  validateDraft(input: unknown): ValidatedQuestion<PublicConfig, PrivateKey>;
  toPublicConfig(config: PublicConfig): PublicConfig;
  validateAnswer(input: unknown, publicConfig: PublicConfig): Answer;
}
```

Server-only extension:

```ts
interface ServerQuestionPlugin<PublicConfig, PrivateKey, Answer, Result>
  extends QuestionDefinitionPlugin<PublicConfig, PrivateKey, Answer, Result> {
  grade(answer: Answer, key: PrivateKey, policy: GradingPolicy): Result;
}
```

The server registry imports graders and private-key schemas. The client registry imports editor and participant renderer components through lazy imports and knows only public config. Do not place a `correctAnswer` field in a shared public union and rely on deletion later.

### 16.1 Type-specific contracts

| Type | Public data | Private key / grading decision |
|---|---|---|
| Single Choice | option IDs and labels | one correct option ID |
| Multiple Choice | option IDs/labels and selection limits | correct ID set; explicit all-or-nothing or partial-credit policy |
| Open Answer | prompt, length, input hints | manual, ungraded, or explicit normalized accepted-answer policy |
| Word Cloud | prompt and length | normally ungraded; optional explicit accepted-value policy only if product requires it |
| Ordering | shuffled item IDs and labels | canonical item ID order |
| Matching | independently shuffled left/right public items | private left-ID → right-ID mapping |
| Image Labeling | image reference, normalized marker coordinates, public labels | private marker-ID → label-ID mapping |

Use normalized marker coordinates in `[0, 1]`, require alt text, and validate item IDs against the pinned version. Existing ShortSwitch supports only validated external HTTPS image URLs; it has no upload/media-control subsystem. The first safe implementation should either use that existing URL model or implement media storage as a separately audited segment. It must not claim secure uploads by adding a file input alone.

## 17. Safe implementation and migration sequence

Each step should be independently deployable and tested.

### Phase 0 — safety baseline

1. Back up a representative SQLite database and verify restore outside production.
2. Add regression fixtures for an old Links/Live/Pages database.
3. Capture current public Live API and root URL behavior.
4. Add a `schema_migrations` runner with one no-op/baseline migration test.

### Phase 1 — additive domain foundation

1. Add Activities tables only; do not alter or copy legacy responses.
2. Add `activity_models` rows as `legacy_v1` lazily or in an idempotent backfill.
3. Add repository ownership and transaction tests.
4. Verify old database startup, rollback-from-backup procedure and Docker volume behavior.

### Phase 2 — question contracts and publication

1. Add discriminated draft/public/private types.
2. Implement plugin validation and server-only grading registry.
3. Implement draft revision and atomic publication clone.
4. Add tests proving published rows are immutable and public serializers contain no key fields.

Start with Single Choice and Multiple Choice as the smallest complete automatic-grading vertical slice. Add other plugins only after the same invariants pass.

### Phase 3 — editor UI

1. Extract Pages editor interaction primitives without changing Pages behavior.
2. Build Activity slide list, ordered block list and responsive preview with an Activity-specific registry.
3. Keep Activity persistence and DTOs separate from Pages.
4. Add editor keyboard, mobile and revision-conflict tests.

### Phase 4 — attempt engine

1. Add server-issued attempt tokens and token hashing.
2. Add start/recovery, progress and answer autosave.
3. Add transactional deadline enforcement and idempotent submit.
4. Add concurrency tests for duplicate starts, stale autosaves, simultaneous saves, and submit-at-deadline races.

### Phase 5 — legacy/public dispatch

1. Add model-aware root dispatch without changing slug rows.
2. Keep current Live UI/API for `legacy_v1`.
3. Serve the new runner only for `slides_v1`.
4. Verify existing Pages Live blocks, QR codes, `/present/:slug`, old tabs, and analytics.

### Phase 6 — remaining plugins, moderation and results

1. Add Open Answer/Word Cloud with explicit grading modes.
2. Add Ordering, Matching, and Image Labeling.
3. Apply moderation to names and public textual display without altering graded originals.
4. Extend result/presentation SSE with key-free plugin result DTOs.

### Optional later conversion

Offer an explicit admin action to clone a legacy Live definition into a new one-slide Activity draft. It may map the current question and options, but should not convert existing responses into attempts. The original legacy activity and URL should remain untouched until the owner explicitly publishes/repoints a conversion with a documented history policy.

## 18. Required new tests

At minimum, implementation segments need tests for:

- migration from a pre-Activities database without row/count/slug changes;
- legacy Live URL/API/UI compatibility;
- one question maximum per slide at database and service levels;
- publication validation and atomic pointer change;
- immutable old versions after republish;
- attempts pinned to the version active at start;
- answer keys absent from every public response, error, SSE payload and built client asset contract;
- cross-owner admin access denial;
- random server-issued token storage as hash only;
- stale/replayed autosave handling and idempotent retry;
- autosave vs submit concurrency;
- server deadline at before/equal/after boundary and auto-submit race;
- all plugin answer schema validators and graders;
- option/item ID membership validation;
- moderation not changing original answer or score;
- participant recovery after reload/reconnect;
- Pages editor and public rendering unchanged after extracting shared UI;
- Docker startup against both old and new temporary SQLite volumes.

## 19. Explicit decisions and trade-offs

1. **Dual mode instead of in-place rewrite.** Costs temporary parallel code, but is the only low-risk way to preserve Live rows, URLs, Pages references and old clients.
2. **Keep `live_activity` in `public_slugs`.** The name becomes historical, but avoiding a constrained-table rebuild is safer and URLs are product-facing, not schema naming exercises.
3. **Immutable published copies.** Uses more SQLite rows, but makes grading reproducible and permits editing while attempts are active.
4. **Separate private-key table and server module.** Adds joins in admin/grading paths, but creates a clear non-disclosure boundary.
5. **Whole-draft admin save with optimistic revision.** Simpler and compatible with the current editor scale; unlike Page save, publication clones immutable rows and attempts never reference draft IDs.
6. **Granular participant autosave.** More endpoints than whole-attempt replacement, but minimizes data transfer and makes conflicts/question validation precise.
7. **Server-issued bearer attempt capability.** Registration remains unnecessary while answer mutation becomes authorized. It still cannot prove a physical person's identity, which is an accepted product limitation.
8. **Server-authoritative deadlines with lazy and periodic enforcement.** Every attempt read/write applies the persisted deadline transactionally. A small in-process worker improves prompt finalization after closed browsers and startup recovery, but correctness never depends on the worker or client countdown.
9. **SSE only for observation.** Retains the lightweight result experience without creating forbidden host synchronization or making core writes depend on a connection.
10. **Reuse Pages interactions, not Pages storage.** Some extraction work is required, but it prevents assessment invariants from leaking into a generic public-page model.
11. **No upload claim in the first schema segment.** Existing HTTPS image references are understood and CSP-compatible. Controlled uploads require separate storage, validation, limits and cleanup design.
12. **No automatic legacy response grading.** Historical polls lack the information required for honest attempts or scores.

## 20. Known unknowns requiring product decisions before implementation

The repository cannot determine these product policies; they must be fixed before their implementation segment:

- whether one participant may create multiple assessment attempts;
- whether an anonymous attempt may resume on another device;
- partial-credit policy for Ordering, Matching and Image Labeling;
- whether Open Answer and Word Cloud are manual, ungraded, or optionally exact-match graded;
- behavior when the fixed deadline precedes an existing duration deadline;
- whether an admin may manually grade or override points after submission;
- retention/clear semantics for attempts versus view analytics;
- whether legacy presentation remains available only for legacy polls or receives a separate assessment-results view.

These are not blockers for the additive migration foundation, but encoding defaults before deciding them would create difficult data compatibility obligations.

## 21. Implemented choice grading policy

Single Choice uses exact option-ID matching. Multiple Choice defaults to exact-set, all-or-nothing grading: the selected set must equal the private correct set, regardless of order.

When an administrator explicitly enables partial credit for a Multiple Choice block, the server uses:

```text
fraction = clamp(
  selectedCorrect / totalCorrect
  - selectedIncorrect / totalIncorrect,
  0,
  1
)
awardedPoints = maximumPoints * fraction
```

The score is rounded to six decimal places and clamped to the question's `0..maximumPoints` range. Selecting every option yields zero whenever the question has at least one distractor, so the policy does not reward indiscriminate selection. A question whose every configured option is correct legitimately awards full credit for selecting all options.

Choice feedback remains in the immutable private-key row. It is absent from landing, in-progress attempt, slide and autosave DTOs. It is projected without the answer key only after finalization and only when the published version's result-visibility policy permits disclosure. Per-question option shuffling is deterministic for an attempt, so refresh/resume cannot change the displayed order.

## 22. Implemented text-question policy

Open Answer supports single-line and multiline Unicode input. Exact grading compares the persisted answer byte-for-byte with any private accepted variant. Normalized grading always applies Unicode NFKC normalization and may additionally ignore case and collapse/trim whitespace according to immutable block configuration. Manual mode finalizes the response with `manual_review` and leaves the attempt score pending; ungraded mode contributes zero points. Accepted variants and feedback remain private version data and are never included in an in-progress attempt or student preview.

Word Cloud stores one response row per question containing a bounded list of short phrases. Phrase display is normalized with Unicode NFKC plus trimmed/collapsed whitespace. The existing owner's global moderation rules are evaluated server-side with the same case-insensitive `whole_word` and `contains` principles as legacy Live. `filter_only` sends matches to `pending`; `review_all` sends every submission to `pending`; neither moderation patterns nor match details are returned to participants. Legacy Live code and tables remain unchanged.

Word Cloud is ungraded by default. Optional participation grading awards the configured points only for a valid, approved, non-empty response. Public aggregation includes only approved responses from finalized attempts pinned to the same published version, groups phrases case-insensitively, and limits the rendered cloud to 150 entries while retaining total and unique counts. Aggregates are absent before attempt finalization and remain subject to the Activity result-visibility policy and the block's explicit `showResults` setting. Participant names are omitted unless `showParticipantNames` was explicitly published.

## 23. Implemented Ordering and Matching policy

Ordering persists only stable item IDs in participant answers. The immutable private key stores the canonical ID order separately from the public item array, so disabling shuffle does not turn array position into an answer key. Optional attempt-time shuffling is deterministic for the attempt and therefore remains stable across autosave, refresh and resume. All-or-nothing grading requires the complete canonical order. Partial grading awards one fraction for each item in its exact canonical position:

```text
fraction = correctly positioned items / total items
awardedPoints = maximumPoints * fraction
```

Matching similarly separates public left/right labels from the immutable private left-ID to right-ID mapping. Each side can be shuffled independently and deterministically for an attempt. Participant responses persist ID-to-ID pairs; validation rejects unknown IDs, duplicate left mappings and duplicate right mappings. All-or-nothing grading requires every pair to match. Partial grading uses:

```text
fraction = correctly matched pairs / total pairs
awardedPoints = maximumPoints * fraction
```

Both formulas round to six decimal places and clamp the result to `0..maximumPoints`. Public landing, draft preview, in-progress attempt and autosave DTOs contain neither canonical orders nor correct mappings. The browser supports handle-only ordering drag, touch movement and explicit keyboard move controls. Matching supports pointer/touch connection, click-to-connect, keyboard activation, reassignment and removal without weakening server-side duplicate validation. Segment 06 adds no database migration and leaves legacy Live storage and routes unchanged.

## 24. Implemented Image Labeling policy

Image Labeling stores normalized marker coordinates in the public immutable configuration and stable marker/label mappings only in the private key table. Participant answers persist marker-ID to label-ID assignments; neither pixel coordinates nor client-calculated scores are accepted as answers. One-to-one mode rejects reused markers and labels. All-or-nothing requires every mapping to match; partial grading awards the configured point fraction for each correctly mapped marker, rounds to six decimals and clamps the result to `0..maximumPoints`.

Activity images follow the same external-reference rule as Pages: the editor accepts an HTTPS image URL, while ShortSwitch does not upload, proxy or persist image bytes. The URL is validated as part of the typed block configuration. Administrators remain responsible for using a stable, appropriately licensed image host and for keeping that resource available.

The editor supports normalized marker creation and pointer/touch movement, stable label editing, mapping validation and a key-free interactive student preview. The participant component positions markers by percentages, recomputes visible connection lines after resizing, supports drag/drop, pointer/touch and click/keyboard connection, and permits reassignment/removal. This does not modify generic Matching or legacy Live/Pages media behavior.

## 25. Implemented timers and deadline policy

Published Activity settings independently store an optional per-attempt duration, an optional global UTC submission timestamp, its explicit IANA display timezone, and an optional low-time warning threshold. The timezone is configuration metadata; all persisted attempt timestamps remain UTC. Nonexistent local minutes during a DST spring transition are rejected, while an ambiguous fall-back minute deterministically resolves to its earlier occurrence.

At attempt creation the server persists `individual_deadline_at`, `global_deadline_at` and their earlier value as the effective `deadline_at`. The client cannot submit or alter any of these timestamps. Each authenticated attempt snapshot includes `serverNow`; countdowns derive an offset from it and reconcile after refresh or tab suspension. The countdown is presentation-only.

Expiration uses one conditional `in_progress` update inside `BEGIN IMMEDIATE`, finalizes only already-persisted response rows and performs server grading in the same transaction. Autosave, navigation and manual submission call the same finalizer before mutation, so a deadline race cannot modify a finalized attempt. Repeated reads, submissions and worker scans do not grade or finalize twice. `buildApp()` runs recovery once at startup and scans due attempts every ten seconds; this remains single-process and adds no service.

Authenticated administrators may list attempts belonging to their own Activity and add bounded minutes to an active individual deadline. The original global deadline remains an absolute cap, so extension recomputes the earlier effective deadline and cannot reopen an already finalized attempt. Extension actor, timestamp and accumulated seconds are persisted.

Migration 5 is additive: it adds timezone/warning columns to `activity_models` and individual/global/extension audit columns to `activity_attempts`. Existing published snapshots default to UTC and a five-minute warning in application normalization; existing attempts are backfilled from their immutable version settings without deleting or rewriting responses.

## 26. Implemented unified grading policy

All assessment grading now enters through `ActivityQuestionPluginRegistry`. Every registered question type owns five server-side boundaries: its published configuration schema, participant response schema, public serializer, grading function and optional feedback/correct-answer serializer. Route handlers and clients never supply an awarded score. Autosave first parses the discriminated response through the registry and then applies question-specific semantic validation against the immutable published block.

Scores use integer units internally (`1000` units per displayed point). Partial-credit formulas round once to the nearest unit and clamp to `0..maximum_score_units`; the existing real-valued score columns remain compatibility projections only. This makes fractional display values possible without accumulating binary floating-point errors. Automatic grading, manual grading and total recalculation all use the question and private key from the attempt's pinned published version.

Attempt grading state is stored independently from submission status:

- `in_progress` while responses remain editable;
- `submitted` or `expired` during finalization;
- `awaiting_manual_grading` when at least one response needs a teacher;
- `fully_graded` once every graded response has an awarded unit value.

Open Answer manual grading is restricted to finalized attempts and manual-mode questions. The administrator can award no less than zero and no more than the immutable question maximum, attach teacher feedback and revise an earlier manual grade. Pending Word Cloud responses have an owner-only approve/reject action; the chosen moderation status is regraded against the immutable published configuration, while the original response remains unchanged. The repository records each automatic grade, manual grade, moderation decision and result release in append-only `activity_grading_audit` rows; the original `answer_json` is never changed by grading. Attempt totals and pending state are recalculated transactionally.

Result disclosure combines the existing availability rule (`never`, `after_submission`, `after_close`) with the immutable feedback policy (`none`, `total_points`, `points_per_question`, `correct_answers`, `manual_release`). A manual-release attempt remains private until an owner explicitly releases it; release exposes per-question points and teacher feedback but not private answer keys. Correct answers are serialized only for `correct_answers`, only after finalization and only through the plugin's safe serializer. Private key field names and moderation rules are not part of public attempt DTOs. Approved Word Cloud aggregates may be disclosed after release when the block explicitly enables them; pending and rejected responses remain excluded.

Migration 6 is additive. It adds feedback policy, integer score/unit columns, grading state/release metadata, teacher feedback and the audit table, then backfills legacy Activity attempts without touching legacy one-question Live tables or responses.

## 27. Implemented results, analytics and export policy

Activity administration exposes a single authenticated, owner-scoped results projection. The attempt list is server-paginated (20 by default, 100 maximum), supports bounded participant/attempt-ID search and whitelisted status/grading-state filters. Attempt detail keeps the existing manual grading, moderation, feedback and immutable grading-audit workflow. Duration is calculated from the persisted start and submitted/update timestamps.

Overview metrics use the following definitions:

- total attempts includes in-progress and finalized attempts;
- submitted counts explicit manual submissions;
- expired counts server auto-submissions and historical expired status;
- completion rate is explicit manual submissions divided by all attempts, while expired attempts remain a separate outcome;
- average/median score and average percentage include only attempts with a persisted final score, so pending manual work and unfinished attempts do not become artificial zeroes.

Question analytics are computed in grouped SQLite queries across the immutable versions actually referenced by attempts. Stable block IDs join the same logical question across republishes. Answered/unanswered counts distinguish persisted response rows, fully-correct requires a graded response at the immutable maximum, and correctness is fully-correct divided by answered attempts. Word Cloud administration aggregates only approved responses from finalized attempts, normalizes case for counting, retains a representative Unicode display value and returns at most the 150 highest-frequency items per question. Pending and rejected text never enters this aggregate.

Migration 7 adds indexes for owner results filtering and question/attempt aggregation. No legacy Live, Page or Short URL rows are changed. Both CSV endpoints are authenticated and owner-scoped. They stream SQLite iterators rather than materializing the export, include a UTF-8 BOM for spreadsheet compatibility, use CRLF rows, quote every cell and prefix formula-like cells (`=`, `+`, `-`, `@`, including leading whitespace) to prevent spreadsheet formula execution. The attempts export contains one row per attempt; the response export contains one row per attempt/question, including unanswered questions.

The Activity editor no longer embeds a narrow student preview. Preview saves the current draft when needed and opens an authenticated standalone tab without the admin shell. The standalone projection passes the saved draft through the existing public preview serializer before rendering, so private answer keys never reach the preview component.

## 28. Audit conclusion

ShortSwitch already has the necessary platform foundation—secure admin sessions, shared slugs, transactional SQLite writes, public analytics, lightweight SSE, localization, themes, and a capable block-editor UX. The missing piece is a versioned assessment domain.

The central implementation rule is: **an Activity attempt must reference an immutable published version, and private answer keys must never enter a public projection.** Keeping legacy Live operational beside the new domain is safer than stretching the existing one-question tables or Page persistence beyond their current guarantees.

## 29. Implemented publishing, access and lifecycle policy

The administrator-facing lifecycle is derived without changing the legacy `live_activities.status` constraint: an Activity with no version is `draft`; a published Activity whose public status is active is `published`; a published closed Activity is `disabled`; and `activity_models.archived_at` takes precedence as `archived`. Archive is non-destructive, closes public access and preserves the shared slug, draft, immutable versions, attempts, responses and grading history. Restoring an archive returns it as disabled so reopening remains an explicit administrator decision.

Publishing is still an explicit immutable snapshot operation. The editor saves pending draft changes, requests an authenticated server checklist, and then requires confirmation that names the next version. The server independently validates title, slide presence, block/private-key schemas, the availability window and archive state before opening the publish transaction. Republishing never mutates old version rows or attempts. Duplicate creates a new closed draft with a fresh global slug and fresh slide/block stable IDs; it does not copy published versions or attempts.

Migration 8 adds only nullable `availability_start_at` and `archived_at` columns plus an administration index to `activity_models`. No legacy Live row is converted or deleted. Availability start and global submission deadline are stored as UTC instants, use the existing IANA timezone for editor/display conversion, and are copied into each immutable version. New attempts are rejected transactionally before the published start and after the global deadline. Archived Activities are absent from the public Activity API, while already-issued opaque attempt tokens remain able to read their finalized historical attempt.

The public player shows the availability window, progress semantics, server-synchronized timer, per-answer save state, required-answer errors and result policy already fixed in the attempt's version. It announces save/connectivity state to assistive technology, retries failed pending autosaves when the browser reconnects, disables progress animation under reduced-motion preference and clearly states that deadline finalization includes only server-persisted answers. Public mutations retain the existing IP and browser-participant rate limits.

## 30. Implemented legacy Live transition

Migration 9 adds `legacy_activity_migrations` as an idempotency and audit ledger. Production startup creates a consistent `VACUUM INTO` snapshot before migration 9 when a legacy database exists. Compatible Word Cloud and Multiple Choice resources receive a `slides_v1` model, one draft slide and immutable version 1 while retaining the original `live_activities` ID, `public_slugs` row, questions, participants, responses and views. Conversion is transactional per resource.

Legacy Multiple Choice becomes ungraded Single or Multiple Choice because no answer key exists in the old schema. Legacy Word Cloud becomes ungraded and retains moderation, response-limit and public-result semantics. Open Answer, Scale, malformed and multi-question legacy resources remain on the legacy runtime and are recorded as unsupported. Historical responses are not reinterpreted as attempts and historical scores are never invented.

The dashboard is labelled Activities and new creation opens the slide editor. Migrated cards link to the old result view while duplicate legacy cards are suppressed. Root slugs remain unchanged; public dispatch selects Activities only for a `slides_v1` model. Legacy routes and tables remain available for the compatibility release. Operator backup and rollback instructions are in `docs/ACTIVITIES-MIGRATION.md`.
