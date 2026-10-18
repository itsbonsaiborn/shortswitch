# ShortSwitch Pages

Pages is a lightweight Linktree-style module built into the existing ShortSwitch process. It reuses Vue, Fastify, SQLite, the administrator session, CSRF protection and the shared root slug namespace. It adds no runtime service or dependency.

## Model and lifecycle

A Page has a title, optional description, emoji or HTTPS avatar, theme, layout, background pattern, SEO fields and an ordered list of blocks. Status controls root URL visibility:

- `draft` — saved in the dashboard, public root URL returns 404;
- `published` — public root URL and public API are available;
- `disabled` — public root URL returns 403.

Changing a slug releases the old mapping immediately. Old slugs are not redirected. Duplicating a Page copies content into a new draft with a generated unique slug and no analytics.

The root resolver checks Live, then Pages, then ordinary Links. All three resource types reserve their slug in `public_slugs` in the same transaction as the resource change. Existing Short URL redirect, password, expiration and analytics behavior is unchanged.

## Blocks

The renderer and editor support:

- heading;
- plain text;
- external HTTP(S) link;
- existing ShortSwitch Link selected by ID;
- existing Live Activity selected by ID;
- email action;
- divider;
- spacer;
- external HTTPS image;
- Double: exactly two non-Double blocks rendered in one row.

Blocks are ordered by `position`, may be hidden, edited in a modal, deleted and reordered with drag/drop. New blocks may be clicked to append them or dragged into a chosen position. Double owns two nested blocks with stable IDs, supports the same content types except another Double, and preserves individual click analytics for nested actions. New Live Activity blocks open in a new browser tab by default; the editor can still override this per block. The editor and public page use the same `PageRenderer.vue`, so saved output matches the preview. Live Preview defaults to the full-width desktop viewport and can switch to a clean 390px mobile viewport. Text is rendered through Vue interpolation; raw HTML, JavaScript and custom CSS are not accepted. External images and link favicons are browser-loaded only; content images are lazy-loaded and the server does not fetch remote media.

An existing Link or Live block stores the resource ID instead of a copied destination. Its current root URL is resolved when the Page is read. If the resource has been deleted, the block remains in the Page but renders as unavailable.

## Themes and layouts

Built-in themes:

- Classic Cream;
- Forest Dark;
- Soft Lavender;
- Ocean Blue;
- Minimal Light.

Built-in layouts: Classic, Minimal, Soft and Bold. They are implemented using scoped CSS variables and do not inject user CSS.

The Design section also offers `none`, `dots`, `grid`, `waves`, `soft_glow`, `contours` and `crosses` background patterns. Patterns are lightweight CSS gradients and inline renderer-owned SVG data, never user-provided markup or raster assets. `patternIntensity` is an integer from 0 to 100 and controls pattern opacity. Pattern colors come from the selected Page theme, update immediately in both preview sizes and sit behind non-transparent content with pointer events disabled. Existing Pages migrate to `none` and intensity `35`, preserving their previous appearance.

## Dashboard and editor

`/app/pages` provides aggregate cards, title/slug search, server-side sorting and 12-item pagination. Desktop displays two cards per row and mobile displays one. Each card shows its identity, status, block count, views and visitors; clicking the card opens analytics. Copy and QR use the shared Link controls, Edit is a direct card action, and Duplicate, Publish/Disable/Draft and Delete live in the animated overflow menu.

The editor is split into General, Content, Design and SEO sections. Desktop uses an editor/preview split; mobile switches explicitly between Edit and Preview. Saving sends the entire Page document and replaces its block order atomically in one SQLite transaction. Unsaved changes are kept after an API error and guarded by browser/navigation warnings.

## Public rendering and metadata

`GET /:slug` returns the compressed Vue shell for a published Page. Fastify injects title, description, Open Graph, Twitter, canonical URL and a resource-type marker into the HTML before sending it. The marker lets the shared public route lazy-load Pages or Live without an extra resource-resolution request.

Public system labels and loading/error states use the shared English/Latvian locale files. The visitor locale is resolved from `navigator.language`: `lv`/`lv-*` selects Latvian, while English, unsupported or unavailable values use English. The public locale is not persisted and never follows the owner's dashboard preference. Server-rendered disabled/not-found states apply the same primary-language rule to `Accept-Language`.

The repository-wide `robots.txt` and default HTML metadata continue to request `noindex`. Pages therefore have link-preview metadata but are not intended for search-engine indexing until a separate product decision changes that global policy.

Caching rules:

- hashed `/app/assets/*`: `public, max-age=31536000, immutable` with precompressed Brotli/gzip;
- public Page HTML: `no-cache`, compressed in memory and cached by Page ID/update timestamp;
- public Page API: `no-store`;
- authenticated Page API: `private, no-store`.

## Analytics and privacy

Opening the public JSON Page endpoint records one Page view asynchronously, including the parsed device type. Unique visitors use the existing HMAC IP identity. Raw IP is stored only when the existing `STORE_RAW_IP` setting enables it. Clickable blocks send a generated event ID to the Page click endpoint; the database unique constraint makes retries idempotent.

Page analytics are independent of Short URL analytics. Following an existing ShortSwitch Link block records the Page block click first, then the ordinary redirect records its own Link analytics. Dashboard analytics expose total views, unique visitors, total tracked clicks, Daily/Weekly/Month trend ranges, device/browser/OS/language breakdowns, a Top links list and the latest 10/20/50 block-click details. Equal-count links retain their Page order. The existing analytics retention interval also removes old Page views and clicks. Per-Page clearing removes only that Page's views and block clicks; the Settings-wide clear also removes Page analytics.

## API

Authenticated routes (state-changing routes also require CSRF):

- `GET /api/pages?search=&sort=&page=&pageSize=`
- `POST /api/pages`
- `GET /api/pages/:id`
- `PATCH /api/pages/:id`
- `DELETE /api/pages/:id`
- `POST /api/pages/:id/duplicate`
- `POST /api/pages/:id/status`
- `GET /api/pages/:id/analytics?range=day|week|month&timezoneOffsetMinutes=&limit=10|20|50`
- `POST /api/pages/:id/analytics/clear`

Public routes:

- `GET /api/pages/public/:slug`
- `POST /api/pages/public/:slug/clicks`

Public responses include only rendering fields and visible blocks. Draft and disabled Pages are never returned by the public API. Pending/administrative data from Links or Live is not embedded.

## SQLite schema and migration

Pages uses four tables:

- `pages` — owner, slug, identity, design (`theme`, `layout`, `background_pattern`, `pattern_intensity`), status and SEO metadata;
- `page_blocks` — ordered typed blocks with validated JSON configuration;
- `page_views` — view timestamp, visitor identity, device/browser/OS, normalized referrer, browser language and optional raw IP;
- `page_block_clicks` — idempotent block-click events, labels and the request's device/browser/OS/referrer/language metadata used by Recent click details.

Foreign keys cascade on Page deletion. Indexes cover owner/creation ordering, block ordering, view time/visitor queries and click time/block queries.

Older databases can have a `public_slugs` CHECK constraint that only permits Links and Live, a `page_blocks` CHECK constraint created before Double existed, Page rows without pattern fields, or Page view/click tables without analytics metadata columns. Startup performs data-preserving upgrades, then ensures the required indexes exist. Existing Pages receive `background_pattern = 'none'` and `pattern_intensity = 35`. Existing Page analytics rows receive neutral `unknown`/`Unknown`/`Direct`/`null` metadata defaults; historical browser, OS, referrer and language values cannot be reconstructed. As with all ShortSwitch startup schema upgrades, back up `/app/data/shortswitch.db` before deploying a new image and do not treat first startup as read-only.

## Verification

Use temporary databases only:

```bash
npm run typecheck
npm test
npm run build
npm run verify:production
npm run load:pages:200
npm run load:pages:500
```

`verify:production` validates actual Brotli/gzip delivery, cache headers, dynamic metadata, a minimal public payload, click intake and regressions in Live/Short URL routing. The Page load scripts create an isolated temporary server/database and exercise HTML, JSON, analytics and concurrent clicks.

On the development machine used for the initial implementation, the critical public Page assets measured 52,657 bytes Brotli (58,655 gzip) across six files; Page HTML measured about 0.5 KB Brotli. The loopback scripts passed with 200 and 500 virtual visitors. Those figures are reproducible local baselines, not proof of behavior through a real 25 Mbps uplink, TLS proxy, Cloudflare Tunnel or production hardware.

## Known constraints

- Pages intentionally has no custom HTML, JavaScript, CSS, file upload, scheduling, expiration, passwords, animation builder or external analytics integration.
- Deleted linked resources remain visible to the editor as unavailable blocks and should be removed or replaced before the next save.
- Page analytics writes are best-effort and process-local scheduling matches the existing Link analytics approach.
- The app remains single-process/single-container. No new multi-replica coordination was introduced.
- Browser-level visual and accessibility audits are still manual; component and integration tests do not replace testing in the target browsers.
