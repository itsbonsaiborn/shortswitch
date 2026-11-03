# Activities compatibility release audit

Audit date: 2026-11-03. This report covers the legacy Live migration and the complete Activities implementation present in this repository. Measurements are local loopback results from the development workstation, not claims about a production host or its internet connection.

## Migration and data integrity

- Migration 9 adds an audit ledger and never drops or rewrites legacy Live tables.
- Production startup creates `${DATABASE_PATH}.pre-legacy-live-v9.bak` with SQLite `VACUUM INTO` before migration 9. Startup fails if the required snapshot cannot be created.
- Each compatible resource is migrated in its own `BEGIN IMMEDIATE` transaction.
- Resource IDs, root slugs, participant settings, historical responses and views are preserved.
- Multiple Choice is migrated without a correct-answer key and remains ungraded. Word Cloud retains its supported moderation and visibility settings.
- Open Answer, Scale, malformed and multi-question legacy records remain on the compatibility runtime and receive an audit-ledger reason.
- Re-running the migration does not create another model or published version.
- The integration test verifies legacy record counts, public access, immutable version creation and `PRAGMA foreign_key_check`.

No production database was present in the repository, so no real deployment data was opened or modified during this audit. The production backup path and free disk space must be checked by the operator before upgrading.

## Security review

| Area | Result |
|---|---|
| Administration | Activities CRUD, publishing, results, grading, exports and migration-facing history use the existing authenticated admin boundary; state changes retain CSRF protection. |
| Public attempts | Attempt tokens are high-entropy opaque values; only hashes are stored. Cross-attempt reads/writes and writes after finalization are rejected. |
| Answer keys | Private keys are stored separately and omitted from landing, preview, attempt and autosave payloads. Disclosure follows the published version's result policy. |
| Deadlines | Effective deadlines are calculated and enforced on the server on reads and writes. Expiration and manual submission are idempotent and transactional. |
| Autosave | Client revisions and server transactions prevent stale/finalized writes from replacing authoritative answers. Only server-persisted answers are finalized. |
| Grading | The server grades against the immutable published version using integer point units. Client scores and deadlines are ignored. |
| Images | Activity images use validated external HTTPS URLs, matching Pages. No Activity upload or image-serving endpoint is registered and the server does not store image bytes. |
| CSV | Admin-only exports are paginated and escape spreadsheet formula prefixes while preserving UTF-8 text. |
| Abuse controls | Existing public/API rate limits remain active; the attempt routes add their own scoped limits. In-memory limits remain single-process by design. |

No answer-key exposure, authorization bypass or destructive legacy-table migration was found by the automated regression suite. Accessibility and mobile behavior have component coverage, but this audit did not perform a full assistive-technology or physical-device certification.

## Automated verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | Passed: 39 files, 160 tests |
| `npm run verify:production` | Passed: client/server production builds and compression verification |
| `git diff --check` | Passed; line-ending warnings only |
| Docker no-cache build | Passed |
| Isolated Docker startup | Passed; container reached `running/healthy` and `/api/health` returned `{ "ok": true }` |

The full test suite includes Activities domain invariants, publishing immutability, public attempts, autosave, timers, grading, moderation, image validation, results/export, migration compatibility and existing Links/Pages/Live regressions.

## Build size and compression

Production verification found 41 compressible generated assets:

| Bundle group | Source | Brotli | gzip |
|---|---:|---:|---:|
| All verified assets | 1,888,599 B | 464,722 B | 547,779 B |
| Public legacy Live critical resources | 350,021 B | 97,643 B | 111,782 B |
| Public Pages critical resources | 341,081 B | 94,280 B | 108,078 B |

Activities routes use route-level lazy loading. The verification script does not yet publish a dedicated Activities critical-resource subtotal, so none is claimed here.

## Loopback load measurements

Command family: `node scripts/activities-load-test.mjs <participants> <concurrency>`. Every run used a temporary SQLite database and fictional activities/participants. Each run covered attempt starts, one autosave per normal participant, a submission burst, 50 forced expirations where applicable, and a CSV export.

| Participants | Concurrency | Start p50 / p95 / max | Autosave p50 / p95 / max | Submit p50 / p95 / max | Expiration | Export | Peak RSS | Total time |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 25 | 48 / 54 / 55 ms | 35 / 37 / 37 ms | 34 / 35 / 35 ms | 50 in 4 ms | 100 rows, 13,665 B in 4 ms | 152.2 MiB | 351 ms |
| 200 | 50 | 76 / 103 / 106 ms | 59 / 60 / 61 ms | 68 / 81 / 81 ms | 50 in 4 ms | 250 rows, 33,768 B in 7 ms | 207.6 MiB | 964 ms |
| 500 | 50 | 71 / 101 / 108 ms | 56 / 71 / 72 ms | 66 / 80 / 83 ms | 50 in 4 ms | 550 rows, 73,972 B in 9 ms | 240.2 MiB | 2,147 ms |

All scripted requests completed successfully. These values measure loopback application/database behavior only. They do not simulate 25 Mbps upload, WAN latency, reverse-proxy behavior, slow clients, or production hardware and therefore do not prove a 500-user production capacity.

## Dependency audit

Safe non-breaking updates were applied for Fastify, `fast-uri`, Undici, Vitest and related packages. The remaining production audit result is three moderate findings in `glob`/`minimatch` through `@fastify/static`. npm proposes `npm audit fix --force`, which would downgrade `@fastify/static` across a breaking major boundary; that unsafe change was not applied. The affected glob traversal is used for server-side static-file discovery, not with participant-supplied glob patterns, but should be revisited when the Fastify static dependency publishes a compatible patched chain.

Docker Scout reported zero critical and six high findings in the current Debian base packages (`util-linux`, `glibc`, `zlib` and `perl`). The image already uses the current `node:22-bookworm-slim` base and Scout lists no fixed package version or safer recommended compatible tag. These upstream findings remain visible for follow-up instead of being hidden through an unverified base-image switch.

## Known limitations and release decision

- Legacy Open Answer and Scale are intentionally not converted; they remain usable through legacy routes and UI.
- Historical Live responses are not fabricated into graded attempts and have no invented scores.
- The compatibility release retains both runtimes and tables. Removal requires independent production verification and a later migration.
- Existing in-memory rate limiting and expiration scheduling assume one ShortSwitch process/container.
- Legacy Live view analytics are queued with `setImmediate`; an abrupt process/database shutdown can lose an event. The test suite deliberately closes temporary databases aggressively and can log this handled teardown race without failing a request or test.
- Production backup restore was documented but not executed against user data.
- No WAN, bandwidth-shaped, screen-reader or physical-device test was run in this audit.
- The remaining moderate static dependency advisories require an upstream-compatible resolution.

Subject to taking and verifying the documented production backup, checking free volume space and accepting the listed limitations, the application passes the repository's automated release gates. Do not delete the legacy tables or backup after deployment; verify old URLs, historical results, a new Activity attempt, Links and Pages before considering the rollout complete.

## Deployment verification

1. Stop writes or schedule a maintenance window and take an operator-controlled volume backup.
2. Confirm the volume can hold the database plus the automatic `.pre-legacy-live-v9.bak` snapshot.
3. Deploy the new image without deleting or recreating the named data volume.
4. Check container logs for the backup path and migration summary.
5. Check `/api/health`.
6. Verify one migrated Multiple Choice or Word Cloud URL, one unsupported legacy URL, historical results, Links and Pages.
7. Create, publish, answer and submit a fictional Activity.
8. Keep the previous image and pre-migration backup until the verification window is complete.
