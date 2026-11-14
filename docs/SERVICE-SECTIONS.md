# Service Sections

Service Sections is the administrative source of shared public information pages used by ShortSwitch. It is intentionally separate from user-created Pages and does not use page blocks, analytics, slugs, or publication state from the Pages module.

## Managed page types

The initial fixed types are:

- `about` → `/service/about` (optional);
- `security` → `/service/security` (essential);
- `privacy` → `/service/privacy` (essential);
- `contacts` → `/service/contacts` (essential).

Essential pages cannot be disabled. If their stored record is unavailable or has never been published, the server renders conservative built-in fallback text. Footer visibility is independently configurable. A future Report Abuse page can extend the same registry without creating a separate persistence system.

## Persistence and publication

Migration 22 creates `service_sections`. Each row contains localized English and Latvian draft content, a separate published snapshot, enable/footer flags, review state, and timestamps. Additive migration 23 adds separate draft and published JSON snapshots for the visual Contacts configuration. Existing rows are not rewritten: when the new columns are empty, the server derives a compatible text block from the existing localized Contacts body and adds the reserved system form position.

Saving updates only draft fields. Publishing transactionally copies all localized draft fields to the public snapshot. Existing published content therefore remains unchanged while an administrator edits a draft.

## Visual Contacts editor

The Contacts page uses a typed block model rather than executable HTML:

- localized heading and plain-text blocks;
- one optional public contact email block;
- HTTPS-only social cards with a fixed icon allowlist;
- dividers;
- exactly one controlled `contact_form` system component.

The editor reuses the Pages block icon and rendering conventions, plus its compact ordered-card and desktop/mobile preview patterns. It intentionally does not reuse Pages persistence, public slugs, analytics, or arbitrary Page block configuration. The contact form position is a system block and cannot contain administrator-provided HTML or be removed. Its public fields and submission action are rendered entirely by the server, without arbitrary administrator HTML.

Blocks have stable IDs and explicit array order. Pointer drag, move buttons, and the same responsive preview all update only the draft configuration. Publishing creates an independent immutable public snapshot. A configured email is rendered as an escaped `mailto:` link; no contact address is supplied by default. Social cards use escaped labels and safe external-link attributes and never load social scripts, embeds, previews, or remote metadata.

The migration is additive and seeds four default records with `INSERT OR IGNORE`. It does not touch ordinary Pages or any existing public slug.

## API

Administrative endpoints require the existing bootstrap-administrator session and CSRF protection for mutations. A retained legacy non-administrator account receives `403` and cannot read or change global service content or Inbox submissions:

- `GET /api/service-sections`
- `PATCH /api/service-sections/:type`
- `POST /api/service-sections/:type/publish`
- `GET /api/service-submissions`
- `PATCH /api/service-submissions/:id/status`
- `DELETE /api/service-submissions/:id`
- `GET /api/service-submission-settings`
- `PATCH /api/service-submission-settings`

The public footer endpoint returns only enabled links:

- `GET /api/public/service-sections`

Public pages are served as server-rendered HTML at the stable `/service/:type` routes. Locale selection follows the existing primary `Accept-Language` rule.

## Contact and abuse submissions

Additive migration 24 creates the shared `service_submissions` table for `contact` and `report_abuse` records. It stores only the fields required by the selected type, a processing status, timestamps and a one-way duplicate key. It does not store the reporter IP address.

Migration 25 upgrades the administrative workflow to `new`, `in_progress`, `resolved` and `rejected`. Existing `in_review` rows become `in_progress`; existing `dismissed` rows become `rejected`. The table rebuild is transactional and retains IDs, form contents, duplicate keys and timestamps. The same migration creates the singleton `service_submission_settings` record with safe defaults: all sender domains allowed, no public contact email, and 365-day retention.

The controlled Contact form posts to `POST /service/contacts/submit`. The dedicated Report Abuse page is available at `/service/report-abuse` and posts to `POST /service/report-abuse/submit`. Report Abuse is always included in the shared service footer, including the external-link confirmation page. The public API never returns submissions; the authenticated Service Sections screen is the only UI that lists their content and updates processing status.

The administrative Inbox supports type/status filters, bounded full-text-style search, details, status changes, manual deletion, and a link into the existing Links screen when a reported identifier currently resolves to a Short URL. Resolution happens only in the authenticated response; public form responses never disclose whether the submitted identifier exists.

The optional sender-domain allowlist is an exact, normalized domain match and applies to the required Contact email and the optional Report Abuse reporter email. An empty list means allow all. Email syntax and domain membership do not verify mailbox ownership. The public contact email is rendered only as an escaped `mailto:` link; ShortSwitch does not send outbound email and no delivery provider is configured.

Retention cleanup runs at application startup and with the existing 12-hour retention timer. It removes submissions older than the configured 1–3650 day period and logs only aggregate deletion counts, never submission content. Public anti-spam continues to use the Stage 5 honeypot, duplicate suppression, and layered session/IP/global in-memory limits. IP is used transiently as a secondary limiter but is not persisted with the submission.

Report identifiers may be a safe short identifier or a URL on the configured ShortSwitch origin with exactly one path segment. Submission does not query the links table and therefore does not disclose whether a private or arbitrary resource exists. Reports never disable content automatically.

Both forms use strict server-side field limits, an invisible honeypot, a ten-minute duplicate hash scoped to an opaque HttpOnly form-session cookie, and layered in-memory limits: 8 submissions per form session, 120 per IP and form type, and 500 per process and form type in ten minutes. The relatively high IP limit avoids treating a shared school NAT as one student; the session and duplicate layers handle ordinary repeated submissions. As with the existing in-memory limiter, limits reset on process restart and are local to the single-process deployment model.

No message or reporter address is sent to an email provider or another third party. ShortSwitch does not implement email delivery in this stage.

## Rendering and security

Service content is plain text. HTML and Markdown are not accepted as executable markup. Titles, content, metadata, footer labels, and every Contacts block field are HTML-escaped; line breaks are added only after escaping. Social URLs must parse as HTTPS URLs, icons are selected from a fixed allowlist, and the public renderer emits no arbitrary styles or scripts. This prevents stored scripts or attributes from being rendered.

The login page loads the public footer endpoint and retains local links to essential pages if that request fails. Server-rendered error, protected-link, and external-link confirmation pages receive the same footer in a Fastify response hook. No administrative fields or draft content are exposed by public APIs.

## Default content

Defaults describe ShortSwitch only at a product level. They deliberately avoid legal claims, operator contact details, security guarantees, and deployment-specific privacy statements. Every seed row starts with `needs_review = 1`; publishing from the administration UI marks it reviewed.
