# ShortSwitch Boards release audit

Audit date: 2026-11-12. This report covers Boards Stages 1–8 as implemented in this repository. No production database, Docker volume, or deployed service was opened or modified. Performance measurements use a temporary SQLite database on Windows loopback with the server and synthetic clients in the same Node.js process; they are not a claim about WAN, Cloudflare Tunnel, browser, or production-host capacity.

## Release overview

Boards adds an administrator-owned collaborative classroom board to the existing single-container ShortSwitch runtime. A published Board has a globally unique ShortSwitch slug, responsive ordered card grid, external HTTPS images, participant card ownership and PIN recovery, moderation, session-scoped Like/Dislike reactions, Activities-compatible visual themes, a read-only presentation route, and revisioned SSE updates.

The final product deliberately has no freeform canvas, drag-and-drop card positioning, pan/zoom, or arbitrary card resizing. The legacy `board_card_positions` compatibility table remains additive and is not used by public rendering or sorting.

## Verified workflows

The automated integration suite covers the administrator boundary, board CRUD/status/duplication/archive/delete, settings and theme persistence, public card creation, ownership-scoped editing/deletion, PIN recovery, moderation, hidden-card behavior, board locking, reactions, SSE snapshots/deltas, and destructive-operation authorization. Component/domain tests cover responsive native-grid markup, presentation mode, image fallback, inert text rendering, localization key parity, deterministic sorting, realtime duplicate/gap handling, and Activities-theme fallback.

The participant workflow is verified through API integration and component tests rather than a physical-device browser session. Creation of text and image/text cards is exercised by the UI and load harness. The historical compact layout remains readable for backwards compatibility but is no longer offered by the editor. PIN disclosure is one-time, while ownership and reaction credentials remain separate HttpOnly browser sessions.

No obsolete position coordinate is read by `PublicBoardPage`; cards use stable IDs in CSS Grid reading order. Actual pixel layout on physical desktop, tablet, and mobile devices was not certified in this audit.

## Architecture summary

- Boards runs inside the existing Fastify process and process-wide `node:sqlite` connection.
- Authenticated administrator routes reuse the existing cookie session, ownership scoping, CSRF protection, and single-user conventions.
- Public card ownership and reaction identities are independent, board-scoped, opaque HttpOnly sessions represented in SQLite only by hashes.
- Vue renders participant content as text. External images are restricted to HTTPS URLs and are fetched by the browser; ShortSwitch does not proxy or store image bytes.
- Public card lists aggregate reaction counts in one query rather than an N+1 query per card.
- Every public mutation increments the board revision transactionally. SSE sends a visibility-scoped snapshot, compact revisioned deltas, 25-second keepalives, and disconnects slow clients above a 256 KiB write buffer.
- Client sorting remains local and session-scoped. Realtime upserts re-run the selected deterministic sort without rewriting timestamps or position data.

## Database migrations and integrity

Boards uses additive migrations 14–21:

| Version | Migration | Purpose |
|---:|---|---|
| 14 | `boards_foundation` | Board aggregate, public slug support, cards, compatibility positions, themes, moderation/event foundations. |
| 15 | `boards_management` | Optional expiration and supporting index. |
| 16 | `board_card_ownership` | Card layouts and expiring ownership sessions/grants. |
| 17 | `board_grid_reactions` | Converts settings to grid semantics while preserving rows; adds reaction sessions and reactions. |
| 18 | `board_theme_design` | Activities-compatible style, pattern, and intensity. |
| 19 | `board_realtime_moderation` | Hidden state and reaction-capable event journal. |
| 20 | `board_recovery_security` | Persistent PIN failure window/lockout fields and index. Existing token/PIN hashes are not rotated. |
| 21 | `board_submission_expiration` | Nullable deadline for closing only new card submissions; existing Boards retain `NULL`. |

Migration execution is transactional and versioned in `schema_migrations`. A dedicated upgrade test creates a pre-migration-20 credential row, applies the migration, verifies that ownership and recovery hashes are byte-for-byte unchanged, checks the defaults for new lockout fields, copies the database, reopens the copy read-only, and runs `PRAGMA quick_check` and `PRAGMA foreign_key_check`.

Fresh migration was also verified inside the no-cache Docker image: the latest row was version 20, `quick_check` returned `ok`, and the foreign-key check returned zero violations. Load runs finished with zero foreign-key violations and `quick_check = ok`; card deletion and Board aggregate deletion have regression coverage for reaction/child cleanup.

No upgrade was executed against real user data. An operator-controlled SQLite/Docker-volume backup and restore rehearsal remains mandatory before production rollout.

## Security controls and findings

| Area | Verified behavior |
|---|---|
| Admin authorization | Every Board/card management mutation requires the authenticated owner and CSRF. Cross-user access and public access to admin routes are rejected. |
| Participant ownership | Card IDs do not authorize writes. Edit/delete require a server-side board ownership session grant; administrator reset rotates ownership. |
| PIN recovery | Six-digit PINs use cryptographic generation and Argon2 hashes. Recovery has generic failures, dummy hash verification for missing credentials, per-card/IP limits, a shared-IP secondary limit, and persistent per-card lockout. Sensitive fields are redacted from logs. |
| Reactions | One row per card/session is enforced by a primary key and atomic transaction. Counts are server-derived; inaccessible, pending, rejected, hidden, expired, or unavailable cards reject public reactions. |
| Moderation/filter | The shared Live filter runs server-side on title, body, and display name after NFKC/format-control normalization. Pending/rejected/hidden data and moderation reasons are excluded from public DTOs and SSE. |
| Input/rendering | Strict Zod schemas, bounded lengths, global 64 KiB request limit, unsafe control rejection, Vue text binding, validated reaction enums, and HTTPS-only image URLs prevent the tested XSS/invalid-input paths. The server never fetches card image URLs. |
| SSE | Board-scoped availability checks, connection attempt limits, active caps, visibility-scoped snapshots, no admin stream, no token/PIN/identity payloads, cleanup handlers, heartbeat, revision gaps, and backpressure disconnects. |
| Concurrency | `BEGIN IMMEDIATE`, uniqueness constraints, and cascades protect card admission, reaction switching, revision/event writes, and deletes under the single-process architecture. |

Layered limits avoid treating a classroom's shared IP as a verified participant identity:

| Operation | Board-wide | Shared-IP secondary | Browser/session |
|---|---:|---:|---:|
| Public reads | 2,000/min | 1,000/min | — |
| Card creation | 500/min | 300/min | 15/min and 3/6 seconds |
| Card edit/delete | — | 600/min | 60/min and 20/6 seconds |
| Reactions | 2,000/min | 600/min | 60/min and 10/3 seconds |
| PIN recovery | — | 100/10 min per board/IP; 5/10 min per card/IP | 10 failures/10 min locks the card for 30 min |
| SSE connect | 600/min per board | 300/min per board/IP | 500 active per board; 250 active per board/IP |

Anonymous sessions are not proof of a person. Clearing cookies or using another browser/device creates a new reaction/card identity. IP is intentionally only a secondary defense. Rate-limit buckets are in memory and therefore assume the documented single-process deployment.

`npm audit --omit=dev` reports zero production dependency vulnerabilities. Docker Scout reports zero critical and seven high findings in Debian `util-linux`, `zlib`, `perl`, and `glibc`; Scout reports no fixed package version for these findings. This is an unresolved base-image risk, not an application dependency finding. Rebuild against updated `node:22-bookworm-slim` releases and repeat Scout before and after deployment.

## Realtime behavior

Public Board SSE supports:

- `snapshot` — current Board/theme/settings, only cards visible to that connection, authoritative counts, and revision;
- `board_updated` — theme, lock, submission, and other public Board settings;
- `card_upserted` — published creation/edit/approval/restore;
- `card_deleted` — delete, reject, or hide from the public view;
- `reaction_updated` — authoritative Like/Dislike counts for one card.

Duplicate revisions are ignored. A revision gap requests a consistent snapshot; delayed events cannot restore a deleted card. Reaction deltas preserve the current browser's own selection locally and expose no participant identity. Closing/deleting/unpublishing a Board closes its streams. Slow clients are disconnected and rely on native EventSource reconnect plus a new scoped snapshot.

## Synthetic loopback performance

Harness: `scripts/boards-load-test.mjs`. Every run builds a published fictional Board in a temporary database, creates mixed/long/image cards up to the target size, performs public reads, owned edits, Like → Dislike → remove cycles, opens SSE clients, measures a mutation-to-event propagation sample, performs reconnects, and validates database integrity. No production URL or data is accepted by the script.

| Participants | Cards | Access concurrency | Requests | Errors | Throughput | Access p50 / p95 / p99 | Create p50 / p95 / p99 | SSE connect p50 / p95 / p99 | Event p50 / p95 / p99 | Peak RSS | Result |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 30 | 100 | 30 | 340 | 0 | 184.2 req/s | 39 / 42 / 42 ms | 226 / 327 / 328 ms | 121 / 125 / 125 ms | 103 / 103 / 103 ms | 239 MiB | Passed |
| 50 | 100 | 50 | 500 | 0 | 194.2 req/s | 67 / 72 / 78 ms | 359 / 533 / 533 ms | 244 / 250 / 251 ms | 179 / 180 / 180 ms | 272 MiB | Passed |
| 200 | 200 | 200 | 1,800 | 0 | 225.5 req/s | 266 / 447 / 449 ms | 140 / 190 / 228 ms | 958 / 961 / 962 ms | 600 / 603 / 603 ms | 522 MiB | Passed |
| 500 | 500 | 100 | 4,100 | 0 | 211.6 req/s | 398 / 435 / 452 ms | 92 / 99 / 122 ms | 1,217 / 1,909 / 1,911 ms | 246 / 335 / 343 ms | 1,321 MiB | Passed with controlled cold-access ramp |

All passed runs finished with zero active reaction rows after removal, expected card counts, no foreign-key violations, and `quick_check = ok`. The 500-participant run established 500 concurrent SSE streams and completed 100 reconnect attempts successfully.

One additional deliberately abrupt test opened all 500 cold public TCP connections at exactly the same time. It recorded 230 connection errors out of 4,100 measured requests (5.61%) even after increasing the Fastify listen backlog to 1,024. The remaining phases completed, including 500 SSE connections, but the run is a failure and is not represented as capacity. The reproducible package command therefore uses an access concurrency of 100.

These memory and CPU values include both the server and all synthetic Node fetch/SSE clients plus retained response bodies in one process. They are not server-only production consumption. Browser memory, browser main-thread responsiveness, network bandwidth, Cloudflare behavior, slow WAN clients, and 25 Mbps uplink were not measured. The results support the intended 30–200 classroom range on the test workstation, while 500 is only a synthetic stress observation and not a production guarantee.

The public-card query uses `idx_board_cards_board_status_created` but SQLite still reports a temporary B-tree for the deterministic final order term. This was not a correctness problem in the 500-card run; a covering order index and/or public pagination should be evaluated before materially exceeding the current 500-card default.

## Automated and deployment verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed. |
| `npm test -- --reporter=dot` | Passed: 49 files, 204 tests, including popularity sorting, submission-only locking, submission deadline enforcement and read-only mutation denial. |
| `npm run verify:production` | Passed: Vite client build, server TypeScript build, runtime HTTP/cache/compression checks. |
| Production precompression | Passed: 50 files; 1,993,904 B source, 490,038 B Brotli, 577,922 B gzip. |
| `npm audit --omit=dev` | Passed: zero vulnerabilities. |
| Docker `--no-cache` build | Passed with `node:22-bookworm-slim`; runtime install reported zero npm vulnerabilities. |
| Isolated Docker startup | Passed: `running/healthy`, `/api/health` returned `{ "ok": true }`. No volume was attached. |
| Container migration/integrity | Passed: migration 21 (`board_submission_expiration`), expected column present, `quick_check = ok`, zero foreign-key violations. |
| Docker Scout critical/high scan | Zero critical, seven high Debian findings with no fixed version reported. |

Production asset verification currently publishes dedicated critical-path totals for legacy Live and Pages, not Boards. The route-level Board chunks themselves are 17.84 kB JS + 4.13 kB CSS uncompressed for the public page and 7.83 kB for the admin list in this build, but shared runtime/i18n/style transfer must also be included in real browser measurements.

The full suite includes existing Links redirects/passwords/analytics, Pages rendering/editor/analytics, legacy Live moderation/SSE, Activities attempts/grading/export/migration, authentication/sessions/preferences/localization, plus Boards. This gives automated regression coverage across all existing modules. No full assistive-technology, cross-browser, physical-device, or end-to-end visual comparison was executed.

## Known limitations and unresolved risks

1. An exact 500-connection cold burst failed on Windows loopback; only the controlled 100-wide access ramp passed at 500 participants.
2. Docker Scout reports seven high base-image CVEs without an available fixed package in the analyzed Bookworm image.
3. Public Board bootstrap is a full visibility-scoped snapshot. There is no card pagination or viewport loading; very large Boards amplify transfer, parse, and reconnect memory.
4. Rate limiting and SSE client registries are process-local by design. Multiple replicas would require a coordinated identity/event/limit design and are outside current architecture.
5. Anonymous ownership/reaction sessions cannot prevent repeat participation after cookie clearing or across devices.
6. External images reveal the participant browser's address/referrer to the external image host according to browser policy; ShortSwitch validates HTTPS but does not proxy or scan remote content.
7. The load harness is synthetic loopback. WAN, Cloudflare Tunnel, constrained upload, browser memory, and physical mobile behavior remain unmeasured.
8. A backup copy/restore was tested on a synthetic database, not on a real deployment volume.

## Release readiness assessment

No critical correctness, authorization, migration, or data-integrity failure was found in the tested 30–200 participant classroom range. Automated tests, production verification, clean Docker build/start, healthcheck, fresh migrations, and production npm audit pass.

The release is **conditionally ready for a staged production rollout at the intended classroom scale**, provided the operator takes and verifies a volume backup, accepts the anonymous-session model, updates/scans the base image as fixes become available, and does not advertise a 500-user instantaneous cold-start guarantee. It is not validated for a simultaneous 500-connection cold burst, WAN/Cloudflare capacity, or large Boards beyond the current default limit.

## Deployment considerations

1. Stop or minimize writes and take an operator-controlled backup of the Docker volume/SQLite database.
2. Verify the backup can be opened and `PRAGMA quick_check` succeeds before replacing the image.
3. Keep the previous image and backup available. Rolling back to an older binary after Boards rows exist should restore the pre-upgrade database backup because old code does not understand the `board` public-slug type.
4. Deploy without deleting/recreating the named data volume and without running `docker compose down -v`.
5. Confirm startup applies migrations 14–21 once, then check `/api/health` and logs for migration/startup failures.
6. Smoke-test one Link redirect, one Page, one legacy Live URL, one Activity, administrator login, and a fictional Board create → publish → card → reaction → moderation → presentation workflow.
7. Test SSE through the actual Cloudflare Tunnel and reconnect after a short network interruption.
8. Monitor container RSS, CPU, 429/5xx rates, SSE reconnects, SQLite/WAL growth, and external-image failures during the first classroom session.

## Recommended follow-up patches

- Add a browser E2E matrix for desktop/tablet/mobile widths, keyboard traversal, focus visibility, fullscreen exit, and image failure/layout-shift checks.
- Add a production-like test behind the actual reverse proxy/Tunnel with bandwidth shaping and server-only CPU/RSS collection.
- Add public-card cursor pagination or bounded snapshot strategy before increasing the 500-card default.
- Re-evaluate a covering public-card order index using production-shaped `EXPLAIN QUERY PLAN` data.
- Rebuild and re-scan when patched Bookworm packages become available; do not hide unresolved CVEs by switching base images without compatibility testing.
- Add operational metrics for active SSE clients, slow-client disconnects, event latency, 429s, and SQLite busy duration.
