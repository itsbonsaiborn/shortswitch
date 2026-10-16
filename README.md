# ShortSwitch

Privacy-aware self-hosted URL shortener with a modern Vue 3 dashboard, interactive Live activities, lightweight public Pages, secure server-side sessions, and analytics.

## Screenshots

| Links | Link analytics |
| :---: | :---: |
| [![Links dashboard](docs/screenshots/links-1.png)](docs/screenshots/links-1.png) | [![Link analytics](docs/screenshots/links-2.png)](docs/screenshots/links-2.png) |
| **Live activities** | **Live presentation** |
| [![Live activities](docs/screenshots/live-1.png)](docs/screenshots/live-1.png) | [![Live presentation](docs/screenshots/live-2.png)](docs/screenshots/live-2.png) |
| **Pages** | **Page editor and live preview** |
| [![Pages dashboard](docs/screenshots/pages-1.png)](docs/screenshots/pages-1.png) | [![Page editor and live preview](docs/screenshots/pages-2.png)](docs/screenshots/pages-2.png) |
| **Global analytics** | **Settings** |
| [![Global analytics](docs/screenshots/analytics.png)](docs/screenshots/analytics.png) | [![Settings](docs/screenshots/settings.png)](docs/screenshots/settings.png) |

## Highlights

- Vue 3 + TypeScript + TailwindCSS frontend
- Fastify + TypeScript backend
- SQLite storage with Docker volume persistence
- Responsive mobile-first dashboard
- Light and dark themes
- Password-protected and expiring links
- Live open-answer, word-cloud, multiple-choice and scale activities
- Anonymous or named participation with live SSE result boards
- Global ban filter and manual moderation queue
- Linktree-style public Pages with reusable blocks, themes, preview and independent analytics
- Per-link analytics and global analytics
- Cookie-based authentication with server-side sessions
- Single-container Docker deployment

## Stack

- Frontend: Vue 3, TypeScript, TailwindCSS
- Backend: Fastify, TypeScript
- Database: SQLite
- Deployment: Docker, Docker Compose
- Tests: Vitest

## Features

- Clean dashboard with `Links`, `Live`, `Pages`, `Analytics`, and `Settings`
- Link creation with custom slug, password, and expiration
- QR code generation and download
- Per-link stats:
  - Daily, weekly, and monthly trends
  - Visits, unique visitors, referrers, failed auth attempts
  - Recent click details
- Global analytics:
  - Combined clicks, views, unique visitors, and devices across Links, Pages, and Live
  - Daily, weekly, and monthly activity trend
  - Module comparison for clicks, views, and unique visitors
  - Weekday/hour activity heatmap with clicks, views, and unique-visitor modes
  - Top referrers and public slugs with All/Links/Pages/Live filters
  - Device, browser, operating-system, and browser-language breakdowns
- Session management and password reset flow
- Single-user admin reset flow for self-hosted recovery
- Presentation mode with direct activity QR codes
- Public Page editor with shared live preview, draft/published/disabled lifecycle and unified root slugs

## Security

ShortSwitch is built around secure defaults for self-hosted use.

- Cookie-based auth with server-side sessions
- `HttpOnly` session cookies
- `SameSite=Lax` by default
- `Secure` cookies supported and recommended for HTTPS
- CSRF protection on authenticated state-changing routes
- Argon2 password hashing for account passwords and protected links
- Session revocation and invalidation after password changes
- CORS allowlist instead of reflective CORS
- Helmet with strict CSP support
- Centralized log redaction for passwords, cookies, auth headers, CSRF tokens, and session identifiers
- Rate limits for login and password-protected links
- Strict slug validation and reserved slug protection
- Safe redirect validation for destination URLs
- Privacy-aware analytics with hashed IP support
- Analytics cleanup retention job

## Privacy Notes

- No JWTs are stored in `localStorage`
- Analytics can run with `STORE_RAW_IP=false` and `IP_HASH_SECRET`
- Analytics failures do not block redirects
- The built-in rate limiter is in-memory and intended for a single-container deployment

## Quick Start

### Docker image

The current production image is [`bonsaiborn/shortswitch:latest`](https://hub.docker.com/r/bonsaiborn/shortswitch):

```bash
docker pull bonsaiborn/shortswitch:latest
```

### Local Docker run

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000).

### Local development

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
npm run typecheck
npm run build
npm run verify:production
npm run load:live:200
npm run load:live:500
npm run load:live:word-cloud
npm run load:live:open
npm run load:live:history
npm run load:links:50
npm run load:links:200
npm run load:links:500
npm run load:live:50
npm run load:pages:50
npm run load:pages:200
npm run load:pages:500
```

## Branding Assets

Drop branding assets into `public/`:

- `public/icons/favicon-32.png`
- `public/icons/apple-touch-icon.png`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/maskable-512.png`
- `public/og/app-og.png`
- `public/og/app-og-mobile.png`

The runtime manifest and meta tags are generated by the app, so you only need to provide the image assets.

## Docker Configuration

The checked-in [docker-compose.yml](docker-compose.yml) is intentionally a local test stub. It is useful for local validation, but you should edit it before deploying to a public VPS.

### Self-hosted `docker-compose.yaml` example

```yaml
services:
  shortswitch:
    image: bonsaiborn/shortswitch:latest
    container_name: shortswitch
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000

      PUBLIC_URL: http://localhost:3000
      CORS_ORIGIN: http://localhost:3000
      APP_NAME: ShortSwitch
      APP_DESCRIPTION: ${APP_DESCRIPTION:-Privacy-aware self-hosted URL shortener.}

      DATABASE_PATH: /app/data/shortswitch.db
      APP_DATA_DIR: /app/data

      SESSION_COOKIE_NAME: shortswitch_session
      SESSION_TTL_HOURS: 720
      COOKIE_SECURE: "true"
      COOKIE_SAME_SITE: lax
      ENABLE_CSP: "true"

      ADMIN_EMAIL: test@test.en
      ADMIN_PASSWORD: Q7b1GftYTQ7jbnz1CbJ*
      ADMIN_NAME: username
      RESET_ADMIN: "false"

      API_RATE_LIMIT_ENABLED: "true"
      REDIRECT_RATE_LIMIT_ENABLED: "true"
      LIVE_SUBMIT_MAX_REQUESTS: 600
      LIVE_SUBMIT_WINDOW_MINUTES: 1

      BLOCK_LOCAL_URLS: "true"
      BLOCK_PRIVATE_IPS: "true"
      STORE_RAW_IP: "false"
      IP_HASH_SECRET: "&ygj03ZNyqr&0vDeNkXmkz$TZMd0cfBrkuj"
      ANALYTICS_RETENTION_DAYS: 90

      LOG_LEVEL: info
      LOG_PRETTY: "false"
    volumes:
      - shortswitch-data:/app/data

volumes:
  shortswitch-data:
```

Then start the service:

```bash
docker compose pull
docker compose up -d
```

The application will be available on port `3000`. For public hosting, place it behind an HTTPS reverse proxy or tunnel and keep `PUBLIC_URL` and `CORS_ORIGIN` aligned with the public origin.

Important environment values:

- `APP_NAME`
- `APP_DESCRIPTION`
- `PUBLIC_URL`
- `CORS_ORIGIN`
- `COOKIE_SECURE`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`
- `RESET_ADMIN`
- `STORE_RAW_IP`
- `IP_HASH_SECRET`
- `ENABLE_CSP`

### Admin bootstrap

ShortSwitch follows a single-user self-hosted model.

- If no admin exists, the container creates one from `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME`
- Production startup requires an explicit, non-default `ADMIN_PASSWORD` with at least 12 characters
- If `RESET_ADMIN=false`, existing credentials in the database remain in use
- If `RESET_ADMIN=true`, the container force-resets the single admin account from Docker config, revokes active sessions, and keeps the system aligned to one canonical user

Use `RESET_ADMIN=true` only when you intentionally want to recover or rotate the main admin account.

## Production Checklist

Before deploying to a real VPS, update the Docker config:

- Set `PUBLIC_URL` to your external HTTPS URL
- Set `CORS_ORIGIN` to your exact trusted origin
- Set `COOKIE_SECURE=true`
- Set an explicit, non-default `ADMIN_PASSWORD` with at least 12 characters
- Set a long random `IP_HASH_SECRET`
- Prefer `STORE_RAW_IP=false`
- Keep `ENABLE_CSP=true`
- Keep `RESET_ADMIN=false` for normal operation
- Back up the SQLite volume at `/app/data`

## Known Deployment Notes

- The current checked-in Docker setup is best for local testing first
- The runtime image upgrades the base security package needed by the entrypoint and removes npm/npx after installing production dependencies
- SQLite is stored inside the Docker volume mounted at `/app/data`
- The application currently targets a single-container self-hosted deployment

## Project Structure

- `src/client/` - Vue application
- `src/server/` - Fastify server, services, repositories, views
- `src/shared/` - shared TypeScript types
- `docs/LIVE.md` - Live architecture, API, storage, moderation, realtime and load-test guide
- `docs/PAGES.md` - Pages architecture, blocks, API, storage, security and verification guide
- `public/` - branding and OG assets

## License

MIT license.
