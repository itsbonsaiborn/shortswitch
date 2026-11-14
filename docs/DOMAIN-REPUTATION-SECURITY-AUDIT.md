# ShortSwitch security and domain reputation audit

Audit date: 2026-11-12  
Repository version during review: `1.4.0`  
Mode: read-only source, configuration, dependency, and low-impact public endpoint review

## 1. Executive summary

The source review did **not** establish that `astkh.cc` is malicious, and it did not establish the reason Forcepoint ThreatSeeker, alphaMountain, LMT, or Whalebone assigned their reported classifications. Those decisions depend on vendor telemetry, exact URLs, historical observations, and live deployment data that are not present in this repository.

The main reputation-relevant characteristic is expected product behavior: ShortSwitch is a public URL shortener. An authenticated administrator can store an arbitrary HTTP(S) destination and a public short path redirects to it. Public Pages can contain external links and images, and Boards/Live can publish participant text (and Boards can display participant-supplied HTTPS images) according to moderation settings. These are legitimate educational features, but they resemble patterns that reputation engines commonly scrutinize. No anonymous Short Link creation endpoint was found.

The reported `Whalebone Sinkhole CA` certificate is not the certificate observed when connecting to the domains outside the reported LMT path. On 2026-11-12, low-impact TLS checks observed Google Trust Services WE1 certificates for `astkh.cc`, `datorika.astkh.cc`, and `spanish.astkh.cc`. Combined with LMT's statement that its Internet protection service is provided with Whalebone, the different certificate is consistent with a filtering/sinkhole path. It identifies the interception mechanism, not the underlying reason for classification. [LMT Internet protection service](https://www.lmt.lv/interneta-sargs)

No critical source-code vulnerability was confirmed. The most important confirmed application weakness is that the authenticated password-change endpoint accepts any non-blank password, despite startup enforcing 12 characters for the bootstrap production password. Important deployment-dependent weaknesses are unconditional proxy trust combined with a broadly published Docker port, reusable credential-shaped literals in deployment examples, optional private-address filtering, and rate limits that are disabled in the checked-in local compose stub.

Priority order:

1. Obtain exact classification evidence from LMT/Whalebone, Forcepoint, and alphaMountain, including the precise flagged URL and first-seen time.
2. Audit the production link/content inventory offline and read-only; disable nothing until a human confirms the result.
3. Confirm the Cloudflare Tunnel is the only path to the origin and restrict trusted proxies/origin exposure.
4. Remove credential-shaped literals from documentation/configuration examples and rotate any value that was ever used in production.
5. Enforce the same password-strength policy on password changes as at startup.
6. Tighten Short Link destination policy and add an internal review trail without breaking legitimate redirects.

## 2. Scope, method, and limitations

### Reviewed

- Links creation, update, password access, preview, redirect, and analytics paths.
- Fastify plugins, security headers, caching, CORS, cookies, CSRF, proxy handling, and static delivery.
- Authentication, sessions, authorization, rate limiting, and input validation.
- Public Pages, Live, Activities, and Boards data/rendering paths.
- External resource use and searches for unsafe HTML/script sinks.
- SQLite schema and repository patterns, without opening production or unknown databases.
- Dockerfile, compose examples, runtime configuration validation, and documented deployment model.
- Production and development dependency trees and lockfile metadata.
- A small number of low-impact public DNS, TLS, and HTTP requests. No crawling, brute force, form submission, or mutation was performed.

### Explicitly not reviewed or unavailable

- Cloudflare dashboard, Tunnel configuration, WAF events, access logs, zone history, account settings, and live origin firewall.
- LMT/Whalebone DNS responses or TLS path from an affected LMT subscriber.
- Forcepoint or alphaMountain telemetry, scan evidence, category history, or the precise flagged URL.
- Production SQLite data, Docker volumes, backups, `.env`, secrets, and stored user content.
- The separate applications served by `datorika.astkh.cc` and `spanish.astkh.cc`; their source is not this repository.
- A complete external penetration test, malware scan, historical passive DNS review, or reputation-vendor account review.

The local `.data` directory contained only temporary `test-shortswitch-*` databases. They were not opened because they do not represent production. No private URL or stored content was submitted to a third party.

## 3. Findings register

Severity reflects application/deployment risk, not the likelihood of causing a reputation classification.

| ID | Category | Severity | Confidence | Summary | Plausible reputation contributor |
|---|---|---:|---:|---|---|
| A-01 | Confirmed vulnerability | Medium | High | Password changes accept a one-character non-blank password | No direct link |
| B-01 | Potential weakness | High if copied to production | High in source, unknown in production | Credential-shaped literal values and insecure/local deployment defaults are tracked | Indirect compromise risk |
| B-02 | Potential weakness | Medium | High in code, deployment-dependent | All proxies are trusted; exposed origin can accept spoofed forwarding headers | Unlikely directly |
| B-03 | Potential weakness | Medium | High | Destination policy permits arbitrary HTTP(S), URL userinfo, and DNS names resolving privately | Yes, if abused destinations exist |
| B-04 | Potential weakness | Low | High | Raw session bearer IDs are stored as SQLite primary keys | No direct link |
| B-05 | Potential weakness | Low | High | Public Page click analytics can be inflated without endpoint-specific limiting | No direct link |
| B-06 | Potential weakness | Low | Medium | CSP permits external form actions and arbitrary HTTP images more broadly than required | Unlikely directly |
| B-07 | Potential weakness | Low/Medium | Medium | Several optional rate limits are off by default and all are process-local | Indirect abuse risk |
| C-01 | Legitimate heuristic signal | Informational | High | Short paths intentionally redirect to administrator-selected external sites | Yes |
| C-02 | Legitimate heuristic signal | Informational | High | Protected links display a password form | Yes, superficially |
| C-03 | Legitimate heuristic signal | Informational | High | Public Pages/Boards/Live support externally linked or participant content | Yes |
| C-04 | Legitimate heuristic signal | Informational | Medium | Root-domain login plus opaque short paths resembles common redirect platforms | Possibly |
| D-01 | External unknown | Unknown | High | Exact vendor evidence and flagged URL are unavailable | Cannot determine |
| D-02 | External observation | Informational | High | Whalebone certificate differs from origin/Cloudflare certificate | Shows filtering path, not cause |
| D-03 | External unknown | Unknown | High | Cloudflare/Tunnel/origin isolation cannot be proven from repository | Cannot determine |

## 4. Confirmed vulnerabilities

### A-01 — Password-change endpoint does not enforce production password strength

- **Severity:** Medium
- **Affected code:** `src/server/app.ts:599-608`; `src/server/services/auth-service.ts:86-94`; compare `src/server/config.ts:47-52`.
- **Source:** authenticated administrator-supplied `password` JSON field.
- **Access:** authenticated admin API, CSRF protected.
- **Evidence:** startup rejects a production bootstrap password shorter than 12 characters, but `changePassword()` rejects only a blank trimmed value and then hashes the submitted value with Argon2.
- **Impact:** an administrator can accidentally weaken the only administrative credential to a trivial password. A temporarily compromised authenticated session could also establish a weak password while revoking other sessions.
- **Reputation relevance:** no direct explanation for the current classification; it becomes relevant only if content administration is compromised and malicious destinations/content are created.
- **Confidence:** High.
- **Recommendation:** apply a single password policy to bootstrap and password-change flows (minimum length, maximum length, reject known placeholder values); add tests for short and oversized passwords. Preserve session-version invalidation.

No critical or high-confidence remotely exploitable vulnerability was confirmed from the reviewed source.

## 5. URL shortener security

### Creation and authorization

`POST /api/links` and `PATCH /api/links/:id` require a valid server session and CSRF protection (`src/server/app.ts:634-667`). The owning user ID is taken from the authenticated session, not from the request body. No anonymous Short Link creation route was found. Link creation and update both call the same destination validator (`src/server/services/link-service.ts:80-123`, `126-178`).

### Destination parsing

`validateTargetUrl()` trims the value, requires an explicit `http://` or `https://` prefix, parses it with the WHATWG `URL` implementation, verifies the protocol and hostname, applies local/private checks, and stores the canonical `parsed.toString()` result (`src/server/utils.ts:142-176`). Therefore `javascript:`, `data:`, `file:`, protocol-relative values, control-only malformed URLs, and URL-encoding tricks that change the parsed scheme are rejected.

The public redirect does not accept a destination in query parameters. It resolves the slug from SQLite and redirects only to the stored target after enabled/expiry/password checks (`src/server/app.ts:916-957`). This is an intentional redirect service, not a classic unvalidated `?next=` open redirect.

### B-03 — Destination policy leaves abuse and local-address gaps

- **Severity:** Medium.
- **Affected code:** `src/server/utils.ts:120-176`; `src/server/config.ts:124-125`; `docker-compose.yml:49-50`.
- **Source:** authenticated administrator's Link or Page-link destination.
- **Access:** admin endpoint; public visitors later follow the stored redirect.
- **Evidence:** both HTTP and HTTPS are allowed. URL username/password fields are not rejected. Localhost is blocked by default, but private-address blocking is optional and defaults to false. When enabled, it examines only literal IP hostnames with `net.isIP()`; it does not resolve DNS, and the IPv4 list does not cover all special-use ranges such as CGNAT.
- **Impact:** a compromised/misused admin can create redirects to phishing/malware destinations, credential-looking userinfo URLs, unencrypted HTTP destinations, or local/special-use destinations. A DNS hostname that resolves to a private address bypasses the literal-IP check. This does not create server-side SSRF because ShortSwitch does not fetch the redirect target; the visitor's browser performs the navigation.
- **Reputation relevance:** Yes, if a stored target was harmful or inherited a poor reputation. The repository alone cannot establish that this happened.
- **Confidence:** High for behavior; unknown for production data.
- **Recommendation:** enable private-address blocking in production; reject URL userinfo; optionally require HTTPS; extend special-use IP handling; consider resolving and recording destination host metadata asynchronously only with DNS rebinding-safe logic. Add an admin-only audit view for destination host, creation/update time, HTTP usage, userinfo, IP literals, and repeated targets. Do not silently delete links.

### Redirect chains and destination review

ShortSwitch does not prefetch or follow destination chains. That avoids server-side SSRF and request-side malware exposure, but it also means the application cannot know the final destination of a downstream redirect. No destination reputation service, allowlist, denylist, or manual-review flag exists. Adding third-party scanning would create privacy and availability trade-offs; a local audit workflow is safer as a first step.

### Preview behavior

Recognized crawler user agents receive an escaped preview page, and unprotected links may include an escaped meta-refresh to the destination (`src/server/app.ts:81-107`, `src/server/app.ts:941-942`, `src/server/views/error-pages.ts:280-292`). Protected links do not disclose the destination through that preview. A scanner can therefore associate the short domain with the destination it observes. This is expected functionality and a plausible route for reputation inheritance, not proof of abuse.

## 6. HTTP headers, cookies, CORS, and redirects

### Source configuration

- Helmet is enabled. CSP defaults to self, blocks objects, restricts scripts to self, and sets `frame-ancestors 'none'` (`src/server/app.ts:324-342`).
- Exact configured CORS origins are accepted; arbitrary origins and missing origins do not receive an allow-origin response (`src/server/app.ts:316-323`, `src/server/utils.ts:53-57`). Production startup fails if `CORS_ORIGIN` is absent (`src/server/config.ts:31-33`).
- Session and CSRF cookies are HttpOnly, configured SameSite, scoped to `/`, and Secure according to validated production configuration (`src/server/services/auth-service.ts:13-18`, `src/server/app.ts:344-351`).
- Public content APIs receive `Cache-Control: no-store`; admin APIs receive `private, no-store`; short-link/public error responses receive no-store/no-cache headers (`src/server/app.ts:71-75`, `360-372`, `745-957`). Hashed static assets receive one-year immutable caching (`src/server/app.ts:960-973`).
- Absolute public URLs are built from `PUBLIC_URL`, not the request Host header (`src/server/utils.ts:24-25`). No Host-header-based absolute URL generation was found.
- Request bodies are capped globally at 64 KiB (`src/server/app.ts:41-47`).

### Low-impact live observations on 2026-11-12

`https://astkh.cc/` returned a 302 to `/app/links`. The observed response family included HSTS (`max-age=31536000; includeSubDomains`), CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and clickjacking protection through both CSP `frame-ancestors 'none'` and `X-Frame-Options`. `http://astkh.cc/` redirected to HTTPS. `/api/health` returned JSON with the same security-header family. `/robots.txt` was noindex/disallow-all as implemented.

An allowed `Origin: https://astkh.cc` received a matching `Access-Control-Allow-Origin`; an untrusted test origin received no such header. A CSRF-cookie response was checked after redacting its value and contained `HttpOnly; Secure; SameSite=Lax`.

These checks found no live CORS wildcard, insecure production cookie, missing HSTS on the apex, or Host-derived redirect. They are point-in-time observations, not continuous assurance.

### B-02 — Unconditional proxy trust depends on strict origin isolation

- **Severity:** Medium.
- **Affected code/config:** `src/server/app.ts:41-46`; `docker-compose.yml:5-7`; README example at `README.md:160-168`.
- **Evidence:** Fastify is created with `trustProxy: true`, while compose publishes container port 3000 on all host interfaces.
- **Impact:** if an attacker can reach the origin directly rather than only through a trusted Cloudflare proxy, spoofed `X-Forwarded-For` values can influence `request.ip`. That can partition/bypass IP-based login, protected-link, Live, Boards, redirect, and SSE limits and contaminate IP-derived visitor analytics. It does not bypass session authorization by itself.
- **Reputation relevance:** unlikely to be a direct classifier signal, but it can make abuse controls less effective.
- **Confidence:** High for code; Medium/unknown for live exploitability.
- **Recommendation:** bind the origin to loopback/internal Docker networking, firewall port 3000, and limit Fastify trusted proxies to the actual local tunnel/proxy path. Verify the Cloudflare Tunnel service mapping and test direct-origin reachability from outside.

### B-06 — CSP is broader than current rendering requires

- **Severity:** Low.
- **Affected code:** `src/server/app.ts:327-338`.
- **Evidence:** `form-action` permits all HTTP(S) targets and `img-src` permits all HTTP and HTTPS origins. Current protected forms post back to ShortSwitch, while external images are expected only where configured.
- **Impact:** this increases impact if a future HTML injection is introduced and allows HTTP mixed-content image declarations (browsers normally block them on HTTPS). No current arbitrary HTML sink was found.
- **Reputation relevance:** missing/tolerant headers do not by themselves explain malicious classification.
- **Confidence:** High.
- **Recommendation:** reduce `form-action` to self after confirming every form flow; consider HTTPS-only images and per-feature proxy/allowlist trade-offs. Keep `style-src 'unsafe-inline'` under review because current dynamic styling may require it.

The root 302 did not carry an explicit application `Cache-Control` in the sampled response. That is a low-priority cache-hardening detail, not a plausible malware classification cause.

## 7. External resources, rendering, and XSS review

No runtime external JavaScript, stylesheet, font CDN, iframe, `v-html`, `innerHTML`, `eval`, or `new Function` use was found in the reviewed application source. Vite bundles dependencies and `index.html` loads a local theme-init script (`index.html:1-24`).

User content is rendered through Vue interpolation, for example Page heading/text/link labels (`src/client/components/PageBlockRenderer.vue:52-90`) and Board title/body (`src/client/components/BoardCardView.vue:14-47`). This renders text rather than interpreting HTML. Existing server tests include script-shaped content cases and the full suite passed.

External content that is intentionally supported:

- Short Links navigate the browser to admin-selected HTTP(S) destinations.
- Page link blocks use the same URL validator; Page image blocks require HTTPS (`src/server/services/page-service.ts:45-100`).
- Activities image blocks require HTTPS (`src/server/domain/activity-domain.ts:16`).
- Board card images require HTTPS, a hostname, and no embedded credentials (`src/server/domain/board-domain.ts:52-62`).
- Page favicons are requested from the destination origin and Page/Board images are lazy loaded with `referrerpolicy="no-referrer"` (`src/client/components/PageBlockRenderer.vue:27-31,63-85`; `src/client/components/BoardCardView.vue:20-29`).

The server does not fetch these images, so the paths are not server-side SSRF. The visitor browser still contacts a user-selected host. A remote image can change after publication, track requests within browser constraints, become unavailable, or later show inappropriate content. That is a content-governance and reputation risk; it is not arbitrary JavaScript execution.

No confirmed stored or reflected XSS was found. The remaining risk is future regression or browser behavior around externally hosted content; retain CSP and automated injection tests.

## 8. Public routes and phishing-like behavior

### Authentication and credential forms

`/login` is the ShortSwitch administrator login, not a third-party imitation. `/access/:slug` asks for the password assigned to a protected Short Link and rate limits failures by IP and slug (`src/server/app.ts:769-838`). The form does not ask for external account credentials, and a protected crawler preview does not expose the destination.

Nevertheless, a generic password form on a short domain can look credential-related to automated classifiers. This is a **legitimate heuristic signal**, not evidence of phishing.

### Public publication surface

- Pages and Activities are created/edited through authenticated admin routes. Their public renderers do not accept arbitrary HTML or JavaScript.
- Live accepts public participant answers. Text is length validated and, depending on `moderationMode`, either approved or kept pending (`src/server/services/live-service.ts:300-370`).
- Boards accept anonymous participant cards according to board settings. Card input is plain text plus an optional validated HTTPS image. Creation has board/IP/session limits and word filtering (`src/server/services/board-card-service.ts:128-164`). The safe default moderation mode is `review_all` (`src/server/domain/board-domain.ts:30-38`), while configured auto-approval can publish immediately (`src/server/repositories/board-repository.ts:662-702`). Public queries expose approved cards and only an owner's own pending card (`src/server/repositories/board-repository.ts:238-252`).

An authenticated admin can make a Page resemble a landing page with text, images, and links, but cannot add custom forms/scripts through the validated block model. A Board participant can publish deceptive text/images only if that Board is public, accepts submissions, and moderation permits publication. This deserves operational moderation, but it is not an anonymous Short Link creation capability.

All application pages request noindex/nofollow (`index.html:10-11` and `/robots.txt`). Security/reputation crawlers are not required to honor those directives.

## 9. Authentication, authorization, API security, and rate limits

Positive controls observed:

- Argon2 password hashing; random opaque server sessions; HttpOnly cookies.
- Session expiry and `session_version` enforcement; password changes revoke other sessions.
- CSRF on administrative state changes and cookie-authenticated public Board mutations.
- Server-derived user ownership on admin repositories/routes.
- Generic login failure response and IP+email attempt limiting.
- Protected-link password limiting; Board ownership secrets are hashed; recovery PINs use Argon2id, dummy verification, rate limiting, and persistent lockouts (`src/server/services/board-card-service.ts:184-214`).
- Prepared statements are used throughout the reviewed repositories. No SQL interpolation of request values was identified in this audit.
- Board reaction uniqueness and availability checks are enforced transactionally in SQLite; hidden/unapproved cards cannot be reacted to.

### B-04 — Session bearer IDs are stored in recoverable form

- **Severity:** Low.
- **Affected code:** `src/server/services/auth-service.ts:55-66`; `src/server/repositories/session-repository.ts:19-58`.
- **Evidence:** the random session ID is both the cookie bearer value and the SQLite `sessions.id` lookup value.
- **Impact:** read access to a live database can yield active bearer sessions until expiry/revocation. A database leak already exposes substantial private data, but hashing session tokens would reduce immediate account takeover value.
- **Reputation relevance:** None directly.
- **Confidence:** High.
- **Recommendation:** store a SHA-256 hash of a high-entropy session token and look up by hash in a backward-compatible migration; never log the raw token.

### B-05 — Page click analytics endpoint is easy to inflate

- **Severity:** Low.
- **Affected code:** `src/server/page-routes.ts:135-150`.
- **Evidence:** the endpoint is intentionally public and accepts an event ID, but no endpoint-specific limiter is applied in the route.
- **Impact:** analytics can be polluted and database writes induced within global body limits. This does not create/modify page content and is not a direct reputation threat.
- **Reputation relevance:** None directly.
- **Confidence:** High.
- **Recommendation:** add modest per-page/per-session/IP-secondary limiting and database uniqueness/retention verification without blocking shared classrooms.

### B-07 — Rate limits are optional/process-local and shared-IP behavior needs production tuning

- **Severity:** Low/Medium depending deployment.
- **Affected code:** `src/server/config.ts:108-125`; `src/server/services/rate-limiter-service.ts`; `src/server/live-routes.ts:271-278`; `src/server/services/board-card-service.ts:18-24,128-143`; `src/server/services/board-reaction-service.ts:7-52`.
- **Evidence:** generic API, Link creation, and redirect limiting default off. The checked-in local compose stub disables them. The in-memory limiter is intentionally single-process and resets on restart. Live submissions use both IP+slug and participant token keys. Boards layer generous board/IP limits with stricter anonymous session limits.
- **Impact:** disabled limits reduce abuse resistance. Conversely, a low Live IP limit can block a classroom behind one NAT even when participant keys are distinct; Boards' layered higher IP limits better accommodate shared networks.
- **Reputation relevance:** indirect only—abuse controls can affect how quickly harmful content/traffic is generated.
- **Confidence:** High for code; production values unknown.
- **Recommendation:** record actual production values, load-test shared-IP scenarios, keep IP as secondary rather than sole identity, and document that in-memory limits are not suitable for multiple app replicas.

## 10. Cloudflare, DNS, TLS, and deployment observations

### Public point-in-time observations

On 2026-11-12 all three tested names resolved to Cloudflare anycast addresses (`104.21.88.66` and `172.67.173.161`). TLS observed:

| Host | Observed issuer | Observed validity |
|---|---|---|
| `astkh.cc` | Google Trust Services WE1 | 2026-10-15 to 2027-01-13 |
| `datorika.astkh.cc` | Google Trust Services WE1 | 2026-10-30 to 2027-01-28 |
| `spanish.astkh.cc` | Google Trust Services WE1 | 2026-10-21 to 2027-01-19 |

This does not reproduce the LMT path. The reported `Whalebone Sinkhole CA` is therefore not the ordinary certificate observed from the audit environment. It is consistent with Whalebone-mediated blocking/interception, but only LMT/Whalebone can provide the policy decision and triggering evidence.

`datorika.astkh.cc` and `spanish.astkh.cc` returned separate static applications, not the ShortSwitch app. Their sampled responses used `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=0, must-revalidate`, `nosniff`, and `Referrer-Policy: strict-origin-when-cross-origin`; the sampled responses did not show CSP, HSTS, or frame protection. Wildcard CORS on public static assets is not inherently a vulnerability. Those deployments require a separate source/configuration audit and live header policy review.

### B-01 — Deployment examples contain reusable credential-shaped values

- **Severity:** High if any example value was copied into production; Low as documentation alone.
- **Affected files:** `docker-compose.yml:9-52`; `README.md:154-200`.
- **Evidence:** tracked compose/documentation contain literal admin-password and IP-hash-secret-shaped values. The compose stub also uses HTTP localhost, a non-secure cookie, disabled generic/link/redirect limits, and private-IP blocking off. README correctly labels the checked-in compose a local test stub, but its self-hosted example also contains concrete credential-shaped literals.
- **Impact:** copying examples can create predictable administrator credentials or a shared HMAC secret. If any tracked value was ever deployed, it must be treated as exposed. Reused visitor HMAC secrets also weaken privacy across installations.
- **Reputation relevance:** only indirectly through possible administrative compromise; source does not show production values.
- **Confidence:** High for repository contents, unknown for production reuse.
- **Recommendation:** replace literals with required environment interpolation/placeholders; add `.env.example` containing placeholders only; make public examples HTTPS-consistent; bind the port to loopback when used with a local Tunnel; rotate every example-like value that was ever used. Never publish the replacement.

### What the repository cannot prove

No `cloudflared`/Tunnel ingress configuration is tracked. The repository cannot establish:

- whether the origin port is reachable from the Internet;
- which public hostname maps to which local service;
- whether Cloudflare Access, WAF, Bot Management, Transform Rules, or redirects are active;
- whether `CF-Connecting-IP`/`X-Forwarded-For` are sanitized before reaching Fastify;
- whether the subdomains share the same zone/account/origin;
- whether historical DNS or compromised content existed before the current deployment.

The Docker image runs the Node process as an unprivileged `app` user through the entrypoint (`Dockerfile:8-29`, `docker-entrypoint.sh:1-11`), uses `npm ci`, removes npm from runtime, and includes a healthcheck. The published port should still be restricted at the host level.

## 11. Dependencies and supply chain

Commands run on 2026-11-12:

| Check | Result |
|---|---|
| `npm ls --depth=0` | dependency tree resolved cleanly |
| `npm audit --omit=dev` | 0 production vulnerabilities |
| `npm audit` | 4 moderate development-only findings through `js-beautify` / `editorconfig` / `glob` / `minimatch`; fixes reported available |
| lockfile review | npm lockfile present; expected install scripts for native/build packages (`argon2`, `esbuild`, optional `fsevents`) |

No suspicious package name, runtime executable download, or server-side call to a remote API was identified. Browser network access is feature-driven (redirect targets and externally hosted images/favicons). Docker build performs normal package-manager network operations and an OS package upgrade; pinning base image digests and adding image/SBOM scanning would improve reproducibility.

Development-only advisories do not explain an externally observed malicious-site category by themselves. They should still be remediated in a separate dependency update with tests, not automatically during this read-only audit.

## 12. Database and stored-content audit procedure

No production database was available. Do not run ShortSwitch itself against a copied production database merely to inspect it, because startup performs schema upgrades, bootstrap, retention cleanup, and timers.

Safe procedure:

1. Create a filesystem-level backup using the existing operational backup method; preserve the original database plus WAL/SHM consistently.
2. Work only on a second offline copy on an isolated host.
3. Open with SQLite read-only URI semantics (`mode=ro`) or `DatabaseSync(path, { readOnly: true })`; verify writes fail.
4. Query only necessary columns from `links`, `pages`, Page blocks, Boards/cards, Activities/Live public configuration, and `public_slugs`.
5. Parse URLs locally. Produce aggregate counts/hostnames for review; do not upload full URLs, query strings, user content, or credentials to reputation services.
6. Flag for human review: non-HTTPS targets; URL userinfo; IP literals; localhost/private/special-use addresses; punycode/IDN confusables; unusually long hosts/paths; recently changed destinations; many slugs to one destination; disabled/expired but historically shared destinations; external image hosts; and redirector-to-redirector targets.
7. For each suspicious record, retain record ID, timestamps, owner, status, and a local cryptographic hash of the full URL. Resolve or visit it only in an approved isolated environment.
8. Reconcile totals before/after the audit and record the database hash. Make no updates during inspection.

Example read-only inventory query (run only on the offline copy):

```sql
SELECT id, slug, target_url, enabled, expires_at, created_at, updated_at
FROM links
ORDER BY updated_at DESC;
```

This repository review cannot say whether production currently contains an unexpected destination.

## 13. Potential reputation-related signals

### C-01 — Public redirector behavior

Short paths issue HTTP redirects to administrator-selected external destinations. The redirect is authenticated at creation time and validated structurally, but the public visitor and reputation crawler see a cross-domain redirect. This is the strongest source-based heuristic signal. It is legitimate URL-shortener behavior and not proof of malicious use.

### C-02 — Password-gated redirect pages

Protected Short Links expose a generic password form. Although it is rate-limited and does not imitate a named third-party service, automated systems may treat credential-like forms on redirect domains cautiously.

### C-03 — Public content and remote media

Pages can act as landing pages with outbound links. Boards and Live can show participant content under configured moderation, and Board cards can reference remote HTTPS images. Auto-approval increases the window in which unwanted content can be public. Default Board moderation is review-all, which is a positive control.

### C-04 — Shared-domain and path reputation

Many opaque paths under one domain, a root that sends users toward an authenticated dashboard, and destination meta refreshes for crawlers resemble common shortening platforms. A single historical bad destination can sometimes influence a shared-domain score. This is a hypothesis to verify with vendor evidence, not a conclusion.

The two reported VirusTotal vendor detections are not enough to determine truth or cause. VirusTotal documentation acknowledges that mistaken industry detections can occur, but a false-positive conclusion still requires examining each vendor's evidence. [VirusTotal overview mentioning mistaken detections](https://assets.virustotal.com/vt-alerts-360.pdf)

## 14. External reputation issues not determinable from source

### D-01 — Forcepoint and alphaMountain classification basis

Forcepoint documents categories including Malicious Web Sites, Phishing, Suspicious Content, and Dynamic DNS, and its URL filtering relies on the external ThreatSeeker category service. The user-reported label does not reveal whether the apex, a particular slug, historical content, or a destination chain triggered it. [Forcepoint category reference](https://help.forcepoint.com/fpone/migration/webtothreatseekerurl/guid-b8ac3928-a64c-4468-bf16-4a6d4932c2c7.html), [Forcepoint URL filtering architecture](https://help.forcepoint.com/ngfw/en-us/6.10.100/GUID-84699F72-0B00-4504-851F-66A805E3C71A.html)

Forcepoint provides a URL lookup workflow, but the audit did not submit private ShortSwitch URLs to it. [Forcepoint URL lookup documentation](https://help.forcepoint.com/fpdsc/app-security/euprod/oxy_ex-1/deployment_guide/guid-05275ffc-7376-4a18-a24b-91d88b079325.html)

No authoritative alphaMountain evidence or classification history was available in this audit.

### D-02 — LMT/Whalebone interception

The reported sinkhole certificate and successful operation through alternative DNS strongly suggest DNS/security-filter intervention on the affected network. The audit environment did not reproduce an LMT subscriber path, so it cannot identify the returned sinkhole IP, DNS policy, category, or trigger.

### D-03 — Historical compromise or content

Source code cannot establish whether an administrator account was previously compromised, a harmful short destination existed and was later removed, DNS records changed, a subdomain previously hosted different content, or a third-party reputation feed inherited a destination/parent-domain score.

## 15. Evidence to request from vendors and operator systems

Request the following without sending private destination URLs publicly:

### LMT / Whalebone

- exact queried hostname and URL/path, timestamp with timezone, subscriber/APN type, and warning/request ID;
- DNS query/response including resolver IP, sinkhole answer, TTL, CNAME chain, and whether encrypted DNS was bypassed;
- complete redacted TLS certificate chain shown on the blocked path and SNI used;
- policy/category name, first-seen time, last evaluation time, and whether blocking applies to apex, wildcard, subdomain, path, or destination chain;
- evidence snapshot/hash and a formal false-positive/reclassification channel;
- confirmation whether `datorika`/`spanish` are blocked because of parent-domain inheritance or independent observations.

### Forcepoint ThreatSeeker

- exact normalized URL classified, category IDs/names, confidence, first/last seen, and redirect chain;
- page/content snapshot or hash and observed response status;
- whether the score is host-, path-, IP-, or destination-reputation based;
- historical category changes and reconsideration case ID.

### alphaMountain

- exact URL/host, risk category and score, first/last observed time;
- contributing signals, redirect/destination relationship, and historical DNS/content evidence;
- scope (apex/subdomain/path) and review/reclassification case ID.

### Cloudflare/operator records

- Tunnel ingress/public-hostname mapping and tunnel connector versions;
- origin firewall exposure and direct-origin reachability test;
- DNS change history, Access/WAF/security events, unusual admin logins, and request spikes around vendor first-seen time;
- application audit/inventory changes around that time, without publishing sensitive URLs.

## 16. Recommended remediation priorities

### P0 — Evidence preservation and production verification

1. Preserve Cloudflare, application, and system logs covering the earliest reported detection; avoid destructive cleanup.
2. Obtain exact vendor evidence before changing or deleting content.
3. Audit a production database backup with the read-only offline procedure above.
4. Verify origin isolation and that port 3000 is unreachable except from the intended local Tunnel/proxy path.
5. Rotate tracked/example-like credentials if there is any chance they were used.

### P1 — Application security changes

1. Enforce password strength on password changes (A-01).
2. Make trusted-proxy configuration explicit and deployment-specific (B-02).
3. Tighten destination validation: reject userinfo, prefer/require HTTPS, enable special/private-address safeguards, and add admin audit metadata (B-03).
4. Replace concrete deployment example secrets with placeholders and safe interpolation (B-01).
5. Add auditable creation/update/security events for Links without logging full sensitive URLs or secrets.

### P2 — Abuse resistance and hardening

1. Tune and enable production rate limits using classroom shared-IP tests.
2. Hash stored session bearer tokens.
3. Rate-limit public analytics writes.
4. Narrow CSP where current behavior allows.
5. Add a periodic local content-host inventory and alerting workflow; do not automatically transmit private URLs.
6. Remediate development dependency advisories through a tested dependency-only change.

### P3 — Reputation recovery

1. Publish a simple public service/about/abuse-contact page that explains educational use, moderation, and a reporting channel. Do not expose the admin UI as the only apex-domain context.
2. After evidence-based cleanup/hardening, request reconsideration separately from Forcepoint, alphaMountain, and Whalebone/LMT with timestamps, controls, and proof of ownership.
3. Monitor apex, subdomains, and representative public routes separately. Do not use VirusTotal or other external services for private short URLs.

## 17. Verification results

| Check | Result |
|---|---|
| Git state before audit | clean, branch `main` |
| Source/config review | completed without application/config/database changes |
| Unsafe-rendering search | no runtime `v-html`, `innerHTML`, `eval`, `new Function`, or iframe found |
| TypeScript | `npm run typecheck` passed |
| Tests | 49 files, 204 tests passed |
| Initial sandboxed test attempt | no tests executed due Windows `EPERM` rename in temporary Vitest cache |
| Retried test run | passed outside the filesystem sandbox; only deprecation/experimental test-environment warnings observed |
| Production dependency audit | 0 vulnerabilities |
| Full dependency audit | 4 moderate, development-only transitive findings |
| Public endpoint checks | low-impact DNS/TLS/HTTP only; no mutation/crawl/brute force |
| Production database | unavailable and not accessed |

## 18. Final assessment

The repository contains a generally defensive implementation: administrator-only Short Link creation, centralized URL parsing, CSRF-protected admin mutations, exact-origin CORS, secure production startup invariants, security headers, no arbitrary HTML rendering, prepared SQL, private answer data handling, and substantial automated tests.

ShortSwitch can still be used as a phishing redirector **by an authorized or compromised administrator**, because redirecting to arbitrary external sites is its purpose and no reputation/content-review layer exists. Anonymous users cannot create Short Links through the reviewed API. Boards/Live create a separate moderated user-content exposure whose risk depends on production settings.

Nothing in source proves that this capability was abused or that it caused the current block. The first investigation should therefore correlate the vendors' exact flagged URL/time with an offline production content inventory and Cloudflare/application logs. Security hardening should proceed regardless, especially password-change policy, proxy/origin trust, deployment example secrets, and destination review controls.
