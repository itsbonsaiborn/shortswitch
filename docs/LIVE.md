# ShortSwitch Live

ShortSwitch Live adds one-question interactive activities to the existing single-user ShortSwitch deployment. It reuses Fastify, Vue, SQLite, cookie administration, CSRF protection and the root short-URL namespace. No additional service or runtime dependency is required.

## Activity model

Each activity owns exactly one row at `live_questions.position = 0`. The separate question table is intentional: later versions can add more questions without changing the activity or response ownership model.

Supported types:

- `open_answer` — approved text responses rendered as cards;
- `word_cloud` — each approved normalized response is one cloud item;
- `multiple_choice` — one submission can contain one or several configured options;
- `scale` — one integer inside the configured inclusive bounds.

Multiple Choice responses store option IDs. Activity updates therefore synchronize same-length option sets in place and preserve those IDs; once responses exist, the service rejects changes to option order/content or the multiple-choice mode. Recreating option rows after votes would orphan the stored selections and must be avoided.

Activities are `active` or `closed`, use `anonymous` or `named` identity, and can limit each browser participant to one or several submissions. Participant-page result preview is independently configurable; disabling it does not disable the public Presentation mode. An optional relative expiration (`minutes`, `hours`, or `days`) is stored as an absolute UTC timestamp. Once expired, participant, result, SSE and Presentation access is rejected; reopening an expired activity clears the stale expiration, matching ordinary Link behavior.

## Public identity and limits

The participant client creates a random UUID and stores it under a key scoped to the activity slug. It is sent as `participantToken`; names are only required in named mode. The last display name is remembered separately for convenience and is not treated as verified identity.

The server creates one `live_participants` row per `(activity_id, participant_token)`. Each response stores both the submitted display-name snapshot and the moderator-approved display name, so a later nickname change cannot alter already published responses and the original name is preserved. Older rows without snapshots fall back to the participant record. Response limit checks and insertion happen inside `BEGIN IMMEDIATE`, so concurrent submissions from the same token cannot exceed the configured maximum. IP is used only for an additional in-memory request-rate limit, never as participant identity.

Changing browser storage or device can create a new participant. This is an explicit non-invasive limitation of an unauthenticated audience flow.

## Unified slugs

`public_slugs` reserves every root slug for either `link` or `live_activity`. Link and Live creation/update reserve the mapping in the same transaction as the resource write. Deletion releases it. Existing links are backfilled with `INSERT OR IGNORE` during database initialization.

`GET /:slug` resolves a Live activity before looking for a redirect link. Live receives the Vue participant shell; existing link redirect behavior remains unchanged. `/present/:slug` serves the public presentation shell.

## Moderation

Global rules live in `moderation_rules` and belong to the admin user:

- `whole_word` uses Unicode letter/number boundaries;
- `contains` matches any normalized substring.

Both modes apply Unicode NFKC normalization, locale-aware lowercase conversion, trimming and whitespace collapse.

Text activities support:

- `off` — publish immediately without applying the global filter;
- `filter_only` — publish normal text and queue filter matches;
- `review_all` — queue every text response.

Responses retain `original_text`. Moderator edits are stored in `published_text`, marked with `edited_by_moderator`, and attributed through `moderated_by`. Edited text is filtered again; approving a remaining match requires explicit confirmation. Only approved data is exposed through public results/SSE. Rejecting an approved response hides it and immediately changes aggregates.

When an activity uses named identity and moderation is enabled, the same global rules are applied to the participant name. A name match sends the complete submission to the moderation queue, including Multiple Choice and Scale submissions. The moderator can edit the published participant name for every activity type; the submitted name remains available separately. Approving a response whose edited participant name still matches a rule requires explicit confirmation.

## Realtime

Submissions use normal HTTP POST. Results use Server-Sent Events:

- protocol 2 (`?protocol=2`) sends an authoritative snapshot when a connection opens, compact delta events after ordinary submissions, and a fresh snapshot after moderation/configuration changes;
- every public state mutation increments the persisted `live_activities.public_revision` inside the same SQLite transaction;
- mutations are coalesced for 500 ms, and a delta names its `baseRevision`, so a client can reject a gap and reload an authoritative snapshot;
- reconnect always receives a new snapshot; replaying missed events is intentionally unnecessary;
- keep-alive comments are sent every 25 seconds;
- closed activities broadcast their new status;
- `response.write()` backpressure pauses updates for that client; after `drain` it receives a new snapshot, while a buffer above 256 KiB is disconnected and allowed to reconnect;
- connection close/error handlers remove response objects from the hub;
- clients without `?protocol=2` retain the former full-snapshot `results` event for compatibility with tabs opened before an update.

Public payloads are bounded: Open Answer snapshots contain the latest 100 approved responses and Word Cloud snapshots contain the 150 most frequent normalized phrases. All rows remain in SQLite. Open Answer uses cursor pagination, while the complete Word Cloud list is available through a searchable paginated endpoint. Multiple Choice and Scale remain aggregate-only. Presentation uses the same bounded public snapshots; the authenticated activity detail continues to return the full response history.

SSE state is process-local, matching the existing single-container architecture. Multiple server replicas would require a shared pub/sub layer and are not currently supported.

## API

Authenticated admin routes (state-changing routes require the existing CSRF token):

- `GET/POST /api/live`
- `GET/PATCH/DELETE /api/live/:id`
- `POST /api/live/:id/status`
- `POST /api/live/:id/analytics/clear` — atomically removes responses and participant records while preserving the Activity and question configuration
- `PATCH /api/live/:id/responses/:responseId`
- `GET /api/live/moderation/pending`
- `GET/POST /api/moderation/rules`
- `PATCH/DELETE /api/moderation/rules/:id`

Public minimal routes:

- `GET /api/live/public/:slug`
- `POST /api/live/public/:slug/responses`
- `GET /api/live/public/:slug/results`
- `GET /api/live/public/:slug/answers` — approved Open Answer cursor pagination (`cursor`, `limit` up to 100)
- `GET /api/live/public/:slug/words` — approved aggregate phrase list (`cursor`, `limit`, optional `search`)
- `GET /api/live/public/:slug/events` (SSE)
- `GET /api/live/public/:slug/presentation`
- `GET /api/live/public/:slug/presentation/events` (Presentation/admin SSE)

The ordinary results and SSE routes honor the participant result-preview toggle. Presentation routes always return approved aggregates so `/present/:slug` remains usable. Pending/rejected text, moderation reasons and admin identifiers never appear in public responses.

## Tables

- `public_slugs` — global root namespace mapping;
- `live_activities` — ownership, activity configuration, optional `expires_at` timestamp and sequential `public_revision`;
- `live_questions` — question type and per-type constraints;
- `live_question_options` — ordered multiple-choice options;
- `live_participants` — activity-scoped browser identities and optional names;
- `live_responses` — submitted/published display names, original/published answer values and moderation state;
- `moderation_rules` — global ban-filter rules.

Tables and indexes are created by the existing startup schema initializer. There is still no versioned migration/rollback framework; back up `/app/data` before deploying a build that first introduces Live.

Approved response pages use `idx_live_responses_public_page (activity_id, moderation_status, created_at DESC, id DESC)`. Public aggregation reads only approved rows. Moderation rules use a small process-local cache per admin user which is invalidated immediately after create/update/delete; this matches the single-process deployment assumption.

## Transfer and cache behavior

- Vite route splitting keeps ApexCharts and administrative overlays out of the Public Live critical graph.
- `npm run build` produces Brotli and gzip siblings for compressible client assets; Fastify negotiates them with `Vary: Accept-Encoding` and preserves the original content type.
- hashed JS/CSS use `public, max-age=31536000, immutable`;
- SPA/Public Live HTML uses `no-cache`, so a deployment is revalidated and can point to new hashes;
- Live API uses `no-store` (authenticated Live API uses `private, no-store`);
- SSE uses `no-cache` and `X-Accel-Buffering: no`;
- dynamic short redirects/password/expiration responses remain `no-store`.

Dynamic HTML is only about 2 KiB and is not compressed at runtime, avoiding per-request compression CPU. SSE is never compressed, avoiding proxy/runtime buffering. Cloudflare or another reverse proxy may forward these headers, but no CDN/tunnel configuration is stored or changed by this repository.

## Configuration

- `LIVE_SUBMIT_MAX_REQUESTS` — per-IP and per-participant in-memory submission threshold; default 60.
- `LIVE_SUBMIT_WINDOW_MINUTES` — rate-limit window/block duration; default 1 minute.

The application-wide Fastify body limit is 64 KiB. Field limits, type-specific values, ownership, activity status and response limits are validated again on the server.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run verify:production
npm run load:live:200
npm run load:live:500
npm run load:live:word-cloud
npm run load:live:open
npm run load:live:history
```

The load harness builds the project, starts Fastify on a loopback ephemeral port with a unique temporary SQLite database, opens the public API and one protocol-2 SSE stream per virtual participant, submits responses, verifies every stream receives an update, checks final counts, and removes the database. It reports API/SSE bytes, event type, timings, process CPU and peak RSS. The Open Answer history harness verifies complete cursor traversal at 2,000 stored answers. `verify:production` performs real HTTP negotiation checks for Brotli/gzip, cache headers, SSE streaming and Short URL cache isolation.

All harnesses are loopback-only and never target the configured production database. Do not interpret their throughput or the calculated 25 Mbps serialization time as a production capacity guarantee. This Windows environment cannot faithfully emulate the server's real 25 Mbps uplink, reverse proxy, Cloudflare Tunnel, Wi-Fi, TLS or browser rendering.
