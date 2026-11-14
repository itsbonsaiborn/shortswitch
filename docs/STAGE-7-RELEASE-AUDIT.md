# ShortSwitch Stage 7 Release Audit

Audit date: 2026-11-13. This document covers the security hardening, external-link confirmation flow, Service Sections, visual Contacts editor, public Contact/Report Abuse submissions, and administrative Inbox/settings introduced in Stages 1–6.

## Release assessment

The repository passes its automated TypeScript, unit/integration, production HTTP, and clean Docker build gates. The final runtime image starts successfully, reports healthy, applies migration 25 on an empty database, and returns `PRAGMA quick_check = ok`.

The release is **conditionally ready for a staged production rollout**. Before replacing the production container, the operator must take and verify a recoverable backup of the persistent SQLite volume, keep the previous image available, and verify the real Cloudflare Tunnel/origin boundary described below. No production deployment or production database access was performed during this audit.

## Implemented functionality

- Fastify trusts forwarded addresses only from the immediate local or private Docker/tunnel hop instead of accepting an unrestricted proxy chain.
- Link destinations reject non-HTTP(S) schemes, embedded credentials, malformed hosts, localhost, and—when enabled—literal private/special-use addresses.
- External Short Links render an explicit HTTP 200 confirmation page. There is no automatic redirect, JavaScript navigation, countdown, remote preview, or query-parameter destination override. Internal ShortSwitch destinations retain direct navigation.
- Password-protected, expired, disabled, missing, and invalid-destination states remain separate; protected targets are not disclosed before successful authorization.
- Service Sections provides one draft/publish system for About, Security, Privacy, and Contacts pages, with essential fallback pages and a shared footer.
- Contacts uses a typed visual block editor and immutable published snapshot. It accepts only escaped plain text, a controlled form component, safe mail links, and validated HTTPS social links.
- Contact and Report Abuse use a shared SQLite submission model with strict validation, a honeypot, duplicate suppression, layered in-memory limits, and no stored reporter IP address.
- The administrative Inbox supports type/status/search filters, details, status updates, deletion, report-to-Link navigation, sender-domain allowlists, a public contact address, and configurable retention.
- Public forms do not send mail or submission contents to external services.

## Changed modules and files

### Server and shared domain

- `src/server/app.ts`: proxy trust boundary, external confirmation flow, shared footer integration, Service Sections registration, retention cleanup, no-store handling.
- `src/server/utils.ts`: URL and proxy-address validation.
- `src/server/views/error-pages.ts`, `src/server/public-i18n.ts`: localized public service pages, footer, confirmation and form states.
- `src/server/migrations.ts`: migrations 22–25.
- `src/server/service-section-routes.ts`: public/admin service routes and form handlers.
- `src/server/repositories/service-section-repository.ts`, `src/server/services/service-section-service.ts`: draft/publish persistence and rendering DTOs.
- `src/server/repositories/service-submission-repository.ts`, `src/server/services/service-submission-service.ts`: submission validation, Inbox, settings, deduplication, retention.
- `src/server/services/auth-service.ts`, `src/server/services/session-service.ts`: password policy and bootstrap-administrator enforcement.
- `src/server/page-routes.ts`: public Page abuse protection integration.
- `src/shared/types.ts`, `src/shared/service-section-types.ts`, `src/shared/service-submission-types.ts`: shared validated DTOs.

### Client

- `src/client/pages/ServiceSectionsPage.vue`: page editor, Inbox, filters, status workflow, and settings.
- `src/client/components/ServiceContactsEditor.vue`, `ServiceContactsRenderer.vue`, `ServiceFooter.vue`: visual Contacts editing/rendering and shared footer.
- `src/client/components/AppShell.vue`, `src/client/pages/LoginPage.vue`, `src/client/pages/LinksPage.vue`, `src/client/pages/SettingsPage.vue`, `src/client/router.ts`: navigation and integration.
- `src/client/locales/en.json`, `src/client/locales/lv.json`: English and Latvian UI copy.

### Tests, documentation, and deployment

- `src/server/app.test.ts`, `src/server/service-submission-migration.test.ts`, and Service Contacts/Footer component tests cover the new behavior and negative cases.
- `docs/SERVICE-SECTIONS.md` documents storage, publication, forms, Inbox, limits, and privacy behavior.
- `docs/DOMAIN-REPUTATION-SECURITY-AUDIT.md` records the preceding read-only security review.
- `README.md`, `.env.example`, and `docker-compose.yml` document safer local/self-hosted defaults.

## Database migrations

| Version | Name | Behavior |
|---:|---|---|
| 22 | `service_sections` | Additively creates the four fixed service-page records and separate localized draft/published fields. Uses `INSERT OR IGNORE`; does not touch ordinary Pages or public slugs. |
| 23 | `service_contacts_visual_config` | Adds draft/published typed Contacts JSON with safe defaults. Existing text content remains usable. |
| 24 | `service_submissions` | Creates the shared Contact/Report Abuse table and lookup indexes. No reporter IP column is added. |
| 25 | `service_submission_inbox_settings` | Transactionally rebuilds submissions for the four-state Inbox workflow, preserves IDs/content/timestamps/dedup keys, maps legacy statuses, recreates indexes, and adds singleton settings. |

The migration runner records each version in `schema_migrations` and runs each migration transactionally. The dedicated migration test verifies legacy status mapping and `PRAGMA quick_check`. The audit did not open or migrate a production database.

## Security review and fixes

### Confirmed findings fixed during Stage 7

1. Global Service Sections and Inbox routes originally accepted any authenticated legacy account. They now require `users.is_bootstrap_admin = 1`; unauthenticated access returns `401` and authenticated non-admin access returns `403`.
2. Authenticated Service Sections/Inbox/settings responses were not included in the central private-response cache policy. They now return `Cache-Control: private, no-store`.

### Controls verified

- State-changing administrative JSON routes require the existing CSRF protection. Public HTML form submissions do not mutate an authenticated account; they use strict validation, opaque HttpOnly form-session cookies, honeypot/deduplication, and layered limits.
- CORS uses an explicit origin allowlist and production startup fails without `CORS_ORIGIN`.
- Helmet/CSP blocks objects and framing, restricts scripts/connections to self, and restricts form actions to self. External confirmation links use safe attributes and `Referrer-Policy` behavior.
- Login, protected-link, API, link-create, redirect, Live, Boards, Page analytics, and service-form limits remain server-enforced. Service-form IP limits are deliberately secondary/high so one school NAT is not treated as one participant.
- Passwords are Argon2 hashes; password updates require 12–256 characters, rotate `session_version`, and revoke other sessions.
- Session cookies are HttpOnly with configured SameSite/Secure behavior. HTTPS production startup rejects an insecure cookie configuration.
- SQL operations use prepared statements for user input. Service content is rendered as escaped text; arbitrary administrator HTML is not accepted.
- Form contents and reporter addresses are admin-only, excluded from public APIs and logs, and removed by configurable retention.
- External destinations are never fetched by the server, which avoids URL-preview SSRF. `BLOCK_PRIVATE_IPS=true` remains recommended defense-in-depth for redirects.

## Proxy, Cloudflare, and deployment boundary

`trustProxy` now accepts forwarded chains only when the direct peer is loopback, link-local, or a private/container address. This is compatible with a local `cloudflared` process or a private Docker bridge. It prevents a directly connected public client from making Fastify trust arbitrary forwarded headers.

This source-level result depends on a deployment assumption that still requires live verification: the origin port must not be publicly reachable through an untrusted private-network peer, and `cloudflared` must be the intended immediate proxy. The repository cannot verify the Cloudflare dashboard, DNS, TLS, firewall, or the actual headers arriving at production. Bind the host port to loopback where the tunnel runs on the host, or isolate the app and tunnel on a private Docker network.

## Regression results

The full Vitest run completed successfully: **53 test files, 218 tests passed**. Coverage includes:

- Links creation/editing, protected/expired/disabled behavior, confirmation pages, URL validation, CSRF, analytics and ownership isolation;
- Pages publication, blocks, analytics, public behavior and rate limiting;
- legacy Live public/results/moderation behavior and analytics;
- Activities drafts, immutable versions, attempts, grading, exports, timers and question types;
- Boards ownership, PIN recovery, reactions, moderation, SSE, themes, sorting and release/migration checks;
- authentication, session invalidation, password changes, CORS/proxy behavior and production invariants;
- Service Sections draft/publish, Contacts blocks, forms, Inbox, allowlists, retention-related persistence, XSS/SQL-like payloads, duplicate suppression and shared-NAT limits.

QR generation remains part of the successfully compiled frontend, but this audit did not perform a physical camera scan or a dedicated browser-level QR download test. No manual multi-device visual walkthrough was performed during this run.

## Quality and build results

| Check | Result |
|---|---|
| `npm run typecheck` | Passed (client and server strict TypeScript). |
| `npm test -- --reporter=dot` | Passed: 53 files, 218 tests. |
| `npm run verify:production` | Passed: client/server build and HTTP/cache/compression verification. |
| Production compression | 54 files; 2,046,602 source bytes, 503,120 Brotli bytes, 592,986 gzip bytes in the verification run. |
| `npm audit --omit=dev` | Passed: 0 runtime vulnerabilities. |
| Full `npm audit` | 4 moderate development-only findings in `@vue/test-utils -> js-beautify -> editorconfig/glob/minimatch`. Not present in the runtime install. |
| `git diff --check` | Passed; only existing line-ending conversion warnings were reported. |
| Clean Docker build | Passed with `--no-cache`, Node 22 Debian bookworm-slim runtime. |
| Container smoke test | Passed: `/api/health` returned `{ ok: true }`, Docker health `healthy`, migration 25 present, SQLite `quick_check = ok`. |
| Runtime identity | Node child process runs as UID 999 (`app`); PID 1 is the root `runuser` wrapper used to prepare volume ownership. |
| Lint | Not run: the repository has no lint script or ESLint configuration. |

The production verifier observed immutable caching for hashed assets, no-cache HTML, no-store public APIs and short URLs, private/no-store administrative APIs, and no-cache SSE.

## Remaining risks and limitations

1. Real Cloudflare Tunnel headers, origin exposure, TLS, DNS, and firewall policy were not accessible and must be verified in the deployment.
2. Session IDs are opaque random values but are stored directly in SQLite. Theft of a readable live database can therefore enable session replay until expiry/revocation; hashing stored session tokens is a future schema/compatibility change.
3. In-memory rate limits reset on restart and are process-local. This matches the supported single-process container but is not sufficient for a horizontally scaled deployment.
4. Literal private/special-use targets are blocked when `BLOCK_PRIVATE_IPS=true`; the application does not resolve DNS destinations. There is no server-side destination fetch, but a public hostname may later resolve to a private address in the visitor's own network.
5. Public sender email syntax/allowlist checks do not verify mailbox ownership. The honeypot and limits reduce abuse but do not eliminate spam.
6. The development dependency audit has four moderate transitive findings. Runtime dependencies are clean; update the test tooling chain separately and retest rather than applying an unreviewed automatic lockfile rewrite during release audit.
7. The synthetic backup/restore test covers Boards migration data, and the final test database passed integrity checks. A real production-volume restore rehearsal was not performed.
8. Automated tests emit known Vue duplicate-plugin warnings and occasional expected asynchronous analytics error logs from negative tests; they do not fail the suite but should be cleaned up for quieter CI diagnostics.

## Required deployment actions

1. Schedule a short write-free maintenance window and stop the existing container without deleting the named volume.
2. Back up the entire persistent volume (including the SQLite database) and verify the copy can be opened read-only with `PRAGMA quick_check`. Keep the backup outside the Docker volume.
3. Keep the previous image/tag available. Do not run `docker compose down -v`.
4. Review the server Compose/environment values: production `PUBLIC_URL`, exact `CORS_ORIGIN`, `COOKIE_SECURE=true`, strong `ADMIN_PASSWORD`, stable `IP_HASH_SECRET`, `RESET_ADMIN=false`, and preferably `BLOCK_PRIVATE_IPS=true`.
5. Ensure only Cloudflare Tunnel/the intended reverse proxy can reach the origin. Do not publish port 3000 broadly; use loopback binding or a private tunnel network.
6. Pull/start the new image normally. Startup applies migrations 22–25 automatically; watch logs for migration/startup failures without logging secrets.
7. Verify `/api/health`, login, one existing short-link confirmation, a protected link, an existing Page, Activity, Live activity, Board, analytics, Service Sections, Contact, and Report Abuse.
8. Confirm the footer and confirmation page on both English and Latvian browser locales. Confirm Inbox submissions are visible only to the bootstrap administrator.
9. Keep the old image and backup through an observation window. Database rollback means restoring the matching backup, not deleting migration rows manually.

## Recommended follow-up improvements

1. Add a CI workflow that runs typecheck, tests, production verification, runtime dependency audit, and clean Docker build.
2. Add a lint configuration/script and make Vue warning cleanup part of CI quality gates.
3. Hash session tokens at rest with a migration and forced expiry strategy designed separately.
4. Add an operator diagnostic that reports the direct peer and trusted client-IP source without logging full sensitive addresses.
5. Add browser E2E coverage for responsive service pages, footer navigation, QR download/scan handoff, and form keyboard accessibility.
6. Upgrade the `@vue/test-utils`/`js-beautify` transitive development chain when compatible releases are available, then rerun the complete release gate.
