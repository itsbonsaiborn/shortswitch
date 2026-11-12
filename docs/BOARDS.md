# ShortSwitch Boards architecture

## Scope of this foundation

Boards is a collaborative classroom board. An administrator creates a board and shares its ShortSwitch root URL. Participants can add title/body cards with an optional externally hosted image without creating ShortSwitch accounts. Cards use an automatically arranged, predictable responsive grid; Boards intentionally has no freeform canvas, manual positioning, resizing, pan or zoom.

Stages 1–7 provide the database schema, management UI, participant card creation and recovery, moderation, responsive grid rendering, per-view sorting, session-scoped Like/Dislike reactions, Activities-compatible visual themes, presentation mode, public SSE synchronization and layered abuse protection.

No existing Links, Pages, legacy Live, Activities, analytics, or authentication behavior is changed.

## Integration with ShortSwitch

- **Runtime:** Boards stays in the existing Fastify process and uses the existing process-wide `node:sqlite` connection. It requires no new service, queue, cache, or dependency.
- **Ownership:** a board belongs to the authenticated ShortSwitch administrator through `boards.user_id`. Future admin queries must always scope by the current session user, never a client-supplied user ID.
- **Public namespace:** `public_slugs.resource_type` now accepts `board`. Board creation uses the same root namespace as Links, Pages, Live, and Activities, so `/:slug` remains globally unique.
- **Public participants:** participant identities are board-scoped opaque browser credentials represented in storage only by a hash. They are not ShortSwitch user accounts and are not reliable physical identities.
- **Card ownership:** a card has a separate opaque owner credential. Only its SHA-256 hash is stored. An optional recovery PIN is represented only by a slow password hash (Argon2 is already available in ShortSwitch). Plaintext credentials must be returned once at creation where applicable and must never be logged.
- **Images:** cards store HTTPS URLs only. ShortSwitch does not upload, proxy, transform, or persist image files in this foundation.
- **Card layouts:** the participant and administrator interfaces offer text-only and image-with-text cards. The historical `compact` value remains readable and accepted for backwards compatibility, but is no longer offered when creating or editing a card.
- **Themes:** Boards has reusable theme references. Five system themes are seeded with stable IDs matching the established Activities/Page visual surfaces. Theme records store validated configuration JSON, not executable CSS or markup.
- **Moderation:** participant cards are either immediately approved or start pending according to the board setting and shared word filter. Public reads include approved, non-hidden cards plus the current ownership session's own pending cards. Rejected and hidden cards are never returned publicly. Every administrator moderation transition is recorded.
- **Reactions:** approved cards accept one Like or Dislike per anonymous board-scoped reaction session. Reaction identity uses a separate HttpOnly cookie and is never treated as card ownership or a verified person.
- **Sorting:** newest, oldest, locale-aware title and popularity views are browser-session preferences. Popularity uses authoritative Like totals with creation time and stable card ID as deterministic tie-breakers; sorting never rewrites card data.
- **Realtime:** each public mutation increments one monotonic `boards.public_revision` and appends a durable `board_events` entry in the same transaction. SSE sends a visibility-scoped snapshot on connect/reconnect, compact deltas afterward, 25-second keepalives and a fresh snapshot after backpressure or a revision gap.

## Database model

Migrations `14 / boards_foundation` through `21 / board_submission_expiration` are transactional. Migration 17 converts the unused `freeform` board setting to `grid`, preserves legacy position rows, and adds reaction sessions and reactions. Migration 18 adds an Activities-compatible visual style, background pattern and bounded pattern intensity. Migration 19 adds a non-destructive hidden flag and extends the event journal with reaction updates. Migration 20 adds persistent recovery failure/window/lockout state without changing existing ownership hashes or PIN hashes. Migration 21 adds a nullable deadline that closes only new card submissions.

| Table | Purpose and important invariants |
|---|---|
| `board_themes` | Reusable system or administrator-owned theme definition. `owner_user_id = NULL` identifies system themes. `config_json` is validated by the shared Boards/Activities-compatible theme layer before writes. |
| `boards` | Board identity, administrator ownership, globally unique slug, title/description, `draft/published/disabled` state, optional expiration, archive timestamp, timestamps, and monotonic public revision. |
| `board_settings` | One-to-one board configuration: theme reference, grid layout, Activities-compatible visual style/background pattern, read-only/submission flags, optional submission deadline, participant naming, moderation mode, limits, content lengths, image URL permission, and participant edit/delete permissions. |
| `board_participants` | Board-scoped participant identity hash and optional display name. `card_count` supports atomic per-participant admission checks; participant credentials themselves are never stored. |
| `board_cards` | Card content, participant reference, author display label, external image URL, moderation state, additive hidden flag, publication time, and timestamps. |
| `board_card_positions` | Legacy Stage 1 compatibility data. Rows are retained and still created, but public rendering and sorting do not use coordinates, dimensions, or stacking order. |
| `board_card_credentials` | Card ownership token hash, optional recovery PIN hash, credential version, usage timestamps and persistent recovery lockout counters. No plaintext ownership material is accepted by the persistence model. |
| `board_ownership_sessions` | Board-scoped, expiring browser sessions. The browser receives only a random HttpOnly cookie; SQLite stores its SHA-256 hash. |
| `board_ownership_session_cards` | Grants an ownership session edit/delete access to specific cards. PIN recovery revokes prior grants before attaching the card to the recovering browser. |
| `board_reaction_sessions` | Separate board-scoped anonymous reaction sessions. Only a SHA-256 token hash is stored; the browser cookie is HttpOnly and session-scoped. |
| `board_card_reactions` | One active `like` or `dislike` per `(card_id, session_id)`, enforced by the primary key. Card deletion cascades to reactions. |
| `board_card_moderation_events` | Append-only moderation audit history with previous/next state, optional reason and administrator ID. |
| `board_events` | Ordered per-board public mutations backing realtime revision tracking and reconnect consistency. `(board_id, revision)` is unique. |

Foreign keys use cascade deletion only inside a board aggregate. Existing ShortSwitch resource tables are not referenced or changed. The shared slug row is explicitly removed by the repository before a board aggregate is deleted; all board child rows then cascade from `boards`.

### State semantics

- `draft`: administrator-only; no public board or participant writes.
- `published`: publicly readable, subject to board settings.
- `disabled`: public access is unavailable without deleting content.
- `archived_at`: a reversible administrative archive marker; an archived board is not public.
- `is_read_only`: all public participant mutations are blocked while public viewing remains available. Saving this mode also disables participant edit/delete permissions.
- `is_locked`: controls creation of new cards only. Reactions and individually allowed edit/delete operations on existing cards continue to work.
- `submissions_expires_at`: optional UTC deadline after which new cards are rejected transactionally; it does not expire the Board or block reactions and existing-card operations.

The repository treats read-only as the full participant-write denial. Administrator moderation remains possible in every mode.

### Limits and atomicity

Card creation uses `BEGIN IMMEDIATE` and verifies, in the same transaction:

1. the board is published and not archived;
2. the board accepts participant writes;
3. the participant belongs to that board;
4. the total card limit is not exhausted;
5. the participant card limit is not exhausted.

The card, compatibility position row, ownership hashes, participant count, board revision, and event are then written atomically. This prevents concurrent requests in the current single-process SQLite deployment from bypassing limits.

Participant and administrator deletes update `board_participants.card_count` in the same transaction. A future restore operation must do the inverse atomically. A periodic consistency check may derive the count from `board_cards` if one is added later.

## Backend model

- `src/shared/board-types.ts` contains transport-neutral Board, settings, card, position, participant and event types.
- `src/server/domain/board-domain.ts` validates board settings, card content, external image URLs, legacy position bounds and credential hash shapes with Zod.
- `src/server/repositories/board-repository.ts` contains prepared SQL and explicit transactions for board/card operations, moderation, ownership and atomic reactions. Public card snapshots aggregate reaction totals in one query rather than one query per card.

The repository deliberately accepts already hashed credentials. `BoardService` owns board CRUD, slug validation, theme validation, expiration checks and public availability. `BoardCardService` generates opaque credentials and six-digit recovery PINs, hashes PINs with Argon2, manages HttpOnly ownership sessions, and applies dedicated create/recovery rate limits. `BoardReactionService` manages the independent anonymous reaction session.

## Proposed API

The board management, public read, moderation, participant mutation, PIN recovery, reaction and realtime routes below are registered.

### Authenticated administrator API

All modifying routes use the existing cookie session and CSRF protection. Every lookup is scoped to the authenticated user's ID.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/boards` | List the administrator's boards and aggregate counts. |
| `POST` | `/api/boards` | Validate slug/settings and create a draft or published board plus its shared slug. |
| `GET` | `/api/boards/:boardId` | Board settings and moderation summary. |
| `PATCH` | `/api/boards/:boardId` | Update board metadata/settings and emit `board_updated`. |
| `DELETE` | `/api/boards/:boardId` | Delete the owned aggregate and release its slug after explicit confirmation. |
| `POST` | `/api/boards/:boardId/status` | Publish, disable or move to draft. |
| `POST` | `/api/boards/:boardId/duplicate` | Duplicate configuration into a new empty draft with a generated slug. |
| `POST` | `/api/boards/:boardId/archive` | Reversibly archive or restore a board. |
| `GET` | `/api/boards/themes` | List selectable system/owned themes. |
| `GET` | `/api/boards/:boardId/cards` | Cards including pending/rejected states and moderation information. |
| `PATCH/DELETE` | `/api/boards/:boardId/cards/:cardId` | Administrator edit/delete for any owned Board card. |
| `POST` | `/api/boards/:boardId/cards/:cardId/moderation` | Approve, reject or return a card to pending with an audit event. |
| `POST` | `/api/boards/:boardId/cards/:cardId/visibility` | Hide an approved card or restore it without destroying reactions/content. |
| `POST` | `/api/boards/:boardId/cards/:cardId/ownership/reset` | Revoke participant ownership sessions and return a new recovery PIN once. |

### Public API

Public mutations do not use administrator session authorization, but they do require the existing anonymous CSRF cookie/header pair. Ownership mutations additionally require board-scoped or card-scoped opaque credentials and all public mutations use dedicated rate limits. Responses expose the minimum public DTO and never include credential hashes, moderation reasons, rejected/pending cards, administrator IDs, or raw event payloads that contain private fields.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/boards/public/:slug` | Published snapshot with approved cards, ownership visibility, aggregate reaction counts and the current reaction state. |
| `POST` | `/api/boards/public/:slug/cards` | Create a card, establish an HttpOnly ownership session, and return a six-digit recovery PIN once. |
| `PATCH` | `/api/boards/public/:slug/cards/:cardId` | Edit card content through the server-side ownership session. |
| `DELETE` | `/api/boards/public/:slug/cards/:cardId` | Delete through the ownership session when allowed. |
| `POST` | `/api/boards/public/:slug/cards/:cardId/recover` | Verify a rate-limited recovery PIN, revoke old grants, rotate ownership, and attach the current browser. |
| `GET` | `/api/boards/public/:slug/cards/:cardId/reaction` | Reaction totals and the current reaction session's choice. |
| `PUT` | `/api/boards/public/:slug/cards/:cardId/reaction` | Idempotently select Like or Dislike. |
| `DELETE` | `/api/boards/public/:slug/cards/:cardId/reaction` | Remove the current reaction. |
| `GET` | `/api/boards/public/:slug/events` | SSE stream: visibility-scoped initial snapshot, revisioned deltas, keepalive and reconnect recovery. |

The root `/:slug` dispatcher resolves published Boards through the shared slug namespace. `/boards/:slug/presentation` opens the same approved-card snapshot in a dedicated read-only presentation route. Draft and archived Boards return not found; disabled Boards return 403; expired Boards return 410. Short URL redirects, password access, Pages, Live and Activities behavior remains unchanged.

## Security decisions

- Board and card inputs use strict schemas; unknown fields are rejected.
- Public image URLs are restricted to HTTPS and bounded in length. The UI must still render them safely with normal browser image loading; the server must never fetch arbitrary participant URLs.
- Ownership tokens should contain at least 256 bits of cryptographic randomness. Store only SHA-256 token hashes and compare fixed-size hashes.
- Recovery PINs use Argon2id and three controls: per-IP/board throttling, per-IP/board/card throttling and a persistent per-card failure window/lockout. Missing cards use a dummy Argon2 verification path and receive the same generic error. A PIN is never used as a database lookup key and is returned only on creation or an explicit administrator ownership reset.
- Ownership cookies are random, HttpOnly, SameSite, Secure whenever configured for the deployment, scoped to the public Boards API, and represented in SQLite only by SHA-256 hashes. Card IDs alone never authorize a mutation.
- Display names, titles and bodies are untrusted text. Vue rendering must use text binding, not `v-html`.
- Pending cards are visible only to their owning browser. Rejected and hidden cards are excluded from every public snapshot and delta, including for their former owner.
- A participant identity is scoped to one board and is not based primarily on IP. No fingerprinting is introduced.
- Reaction identity is separate from ownership identity. The anonymous reaction cookie is session-scoped; clearing cookies, closing the browser session, or using another browser can create another reaction identity. ShortSwitch does not claim one reaction per physical person.
- Reaction writes require an approved card, an available published non-read-only board, CSRF validation, a valid server-side reaction session, an atomic uniqueness constraint, and a dedicated process-local rate limit. Closing new submissions does not disable reactions.
- Admin ownership checks happen in SQL before moderation/deletion. A client-supplied user ID is never part of the API contract.
- Sensitive Board token/PIN field names are included in Pino redaction. Card text rejects unsafe control characters, image URLs are HTTPS-only and Fastify keeps the global 64 KiB request-body limit.

## Realtime strategy

Boards follows the existing Live SSE reliability model without WebSockets or another service:

1. every connection receives its own current snapshot, including only cards visible to its ownership session;
2. card/theme/lock/moderation changes are coalesced for 75 ms and emitted as `board_updated`, `card_upserted`, or `card_deleted` delta changes;
3. reactions emit direct `reaction_updated` counts without re-querying the full Board for every connected participant;
4. every message carries the monotonic Board revision as its SSE event ID;
5. duplicate revisions are ignored, while a revision gap triggers a safe snapshot refresh;
6. a 25-second heartbeat keeps compatible proxies from buffering or closing an idle stream;
7. clients over the 256 KiB writable-buffer limit are disconnected and recover through EventSource reconnect;
8. disconnect handlers remove client references and prevent subscription leaks.

The database remains authoritative. Events never contain ownership tokens, PINs, moderation reasons, reaction identities or administrator data.

## Migration and compatibility

Migration 14 rebuilds only the small registry table when its CHECK constraint does not yet permit `board`. It copies every existing slug row before dropping the old table. All Boards tables are then created and system themes are inserted with `INSERT OR IGNORE`. Migration 15 conditionally adds expiration, migration 16 adds ownership sessions, and migration 17 rebuilds only `board_settings` to replace its `freeform` CHECK with `grid`, copying every settings row before adding reaction tables. Migration 18 adds `visual_style`, `background_pattern` and `pattern_intensity`. Migration 19 adds `board_cards.is_hidden = 0` and recreates only the event journal constraint so `reaction_updated` can be recorded; existing event IDs and revisions are copied. Migration 20 conditionally adds recovery counters and lock timestamps plus an index; all existing credentials remain valid with zero failures. Migration 21 conditionally adds `board_settings.submissions_expires_at` and an index; existing Boards receive `NULL`, preserving their previous acceptance state. Each migration runs in its own transaction and is recorded in `schema_migrations`.

## Stage 7 abuse-protection rules

The limits are intentionally layered so a school NAT is not the sole identity boundary:

| Operation | Board-wide | Shared-IP secondary limit | Browser/session limit |
|---|---:|---:|---:|
| Public board/card read | 2,000/min | 1,000/min per board/IP | — |
| Card create | 500/min | 300/min per board/IP | 15/min and 3/6 seconds per ownership session |
| Card edit/delete | — | 600/min per board/IP | 60/min and 20/6 seconds per ownership session |
| Reaction mutation | 2,000/min | 600/min per board/IP | 60/min and 10/3 seconds per reaction session |
| Recovery | — | 100/10 minutes per board/IP; 5/10 minutes per card/IP | 10 failed attempts/10 minutes per card persistently locks recovery for 30 minutes |
| SSE connect | 600/min per board | 300/min per board/IP | maximum 500 active per board and 250 active per board/IP |

Process-local rate buckets are swept after expiry to prevent unbounded memory growth from disposable anonymous identities. Database uniqueness and `BEGIN IMMEDIATE` transactions, rather than the limiter, remain authoritative for card limits and reaction uniqueness.

The word filter strips Unicode format controls after NFKC normalization, so zero-width characters cannot trivially split a banned phrase. The same normalization remains shared with Live.

Anonymous browser sessions are not verified people. Clearing cookies or changing browser/device can obtain another card/reaction identity; IP is deliberately only a secondary defense because many pupils can share one address. Persistent recovery lockout can also be abused to temporarily deny PIN recovery for a known card ID; administrator ownership reset remains the recovery path.

## Stage 6 moderation and word filter

- Boards and Live share Unicode NFKC normalization, repeated-whitespace normalization, case-insensitive `contains` and Unicode-aware `whole_word` matching and cache invalidation.
- The filter runs server-side against card title, body and participant display name on creation and editing.
- A match sends the card to `pending`, including on an `auto_approve` Board. Boards does not mask or automatically reject matching text; the administrator decides.
- Matching rule details are retained only in the administrator moderation reason. Public DTOs and SSE never expose rule text.
- `review_all` continues to send all participant submissions to pending even without a rule match.

## Stage 5 presentation and visual design

- Boards reuse the five visual surfaces already used by Activities: Classic Cream, Forest Dark, Soft Lavender, Ocean Blue and Minimal Light.
- Card radius and shadow use the compatible `classic`, `minimal`, `soft` or `bold` visual style.
- Backgrounds support the lightweight `none`, `dots`, `grid`, `soft_glow` and `crosses` patterns with a bounded 0–100 intensity.
- The editor renders an unsaved live sample. Saving updates only Board settings; card content, ownership and reactions are untouched.
- Missing or incompatible theme configuration falls back to `minimal_light`.
- `/boards/:slug/presentation` uses the presentation-filtered public payload, maximizes the grid, supports browser fullscreen, preserves session sorting and exposes no participant mutations or moderation data.
- External card images remain HTTPS-only and browser-fetched. A fixed aspect-ratio frame prevents layout shifts, lazy loading avoids eager downloads and a local fallback replaces failed images. ShortSwitch does not proxy, resize or upload images.

- No existing table or row belonging to Links, Pages, Live or Activities is deleted.
- Existing root URLs retain their resource types and IDs.
- Existing databases receive the same Boards schema as fresh databases.
- Re-running startup is idempotent because the migration version is recorded.
- Docker requires no new volume, port, service, package, or environment variable for this foundation.

As with every ShortSwitch schema update, production deployment should be preceded by a SQLite volume backup. Rollback to an older binary should restore that backup because an older binary's `public_slugs` CHECK does not know the `board` type once boards actually exist.

## Deferred decisions

The following choices are intentionally unresolved until the corresponding UI/API slice is implemented:

- custom administrator theme creation; the current editor selects seeded system themes and is ready to list owned themes later;
- event retention; reconnect intentionally receives a current snapshot rather than replaying an unbounded journal;
- board view/click analytics and how they join global Analytics;
- maximum public snapshot size and card pagination/viewport loading strategy;
- whether participant deletion is soft-delete/tombstone based for realtime consistency.

Grid placement is final for this product direction. Future work must not reintroduce manual positions or create a competing realtime transport.
