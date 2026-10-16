# ShortSwitch: постоянный контекст для AI-агента

## 1. Назначение и границы проекта

ShortSwitch — самостоятельный (self-hosted) сервис коротких ссылок и интерактивных Live-опросов с одной административной учётной записью. Он объединяет:

- публичные короткие URL и серверные редиректы;
- Vue-панель администратора для управления ссылками;
- парольную защиту, срок действия и ручное отключение ссылок;
- покликовую аналитику и агрегированные отчёты;
- cookie-аутентификацию с серверными сессиями;
- одноконтейнерное развёртывание с SQLite в постоянном Docker volume.
- Live Activity с одним вопросом, публичной страницей, модерацией и SSE-результатами.
- Pages — лёгкие публичные страницы из валидируемых блоков с темами и отдельной аналитикой.

Фактическая модель приложения — single-user. Регистрации пользователей, ролей, публичного API для сторонних клиентов и фонового worker-процесса нет. Основной источник истины — код в `src/`, затем конфигурация и тесты; `README.md` полезен, но при расхождениях следует доверять реализации.

## 2. Неприкосновенные правила для будущих изменений

1. Не читать и не публиковать содержимое `.env`, SQLite-файлов, Docker volume, резервных копий или иных пользовательских данных без прямой необходимости и разрешения.
2. Не выводить в логи или ответы пароли, cookie, session ID, CSRF-токены, `IP_HASH_SECRET` и другие секреты. При добавлении логов учитывать `src/server/logger.ts` и расширять redaction для новых чувствительных полей.
3. Не запускать приложение против неизвестного или рабочего `DATABASE_PATH`: `getDb()` создаёт таблицы и выполняет встроенные `ALTER TABLE`, а `buildApp()` запускает bootstrap/reset администратора и очистку данных по retention.
4. Никогда не включать `RESET_ADMIN=true` без явного запроса. Этот режим удаляет все сессии, переводит ссылки на канонического пользователя, удаляет остальные записи пользователей и меняет учётные данные администратора.
5. Не запускать миграции, очистку аналитики, reset администратора, удаление ссылок или сессий на реальных данных для проверки. Серверные тесты используют отдельные временные БД.
6. Не менять схему, зависимости, Docker-конфигурацию или API «по описанию» без проверки зависимых слоёв: shared types → client/server → tests → docs.
7. Сохранять single-container/single-process предпосылки, пока задача явно не требует другого. Встроенные rate limiter и запись аналитики рассчитаны именно на этот режим.
8. Перед правками проверять `git status` и не перезаписывать посторонние изменения пользователя.

## 3. Фактический технологический стек

### Runtime и язык

- TypeScript, strict mode, ESM (`"type": "module"`).
- Docker использует Node.js 22 (`node:22-bookworm-slim`). Сервер зависит от встроенного `node:sqlite`, поэтому для локальной работы нужен современный Node с этим модулем; `package.json` не задаёт `engines`.
- Один npm-пакет и один `package-lock.json` формата lockfile v3.

### Клиент

- Vue 3.5, Composition API и `<script setup>`.
- Vue Router 5 с history mode.
- Vite 8; клиент собирается в `dist/client`, base path — `/app/`.
- Tailwind CSS 4 через PostCSS, `@tailwindcss/forms`, общие CSS-переменные и компоненты в `src/client/styles.css`.
- ApexCharts + `vue3-apexcharts` для графиков.
- VueUse для темы и размеров окна.
- `qrcode` для QR-кодов, `ua-parser-js` для представления user-agent.

### Сервер

- Fastify 5.
- Плагины: cookie, CORS, CSRF protection, form body, Helmet/CSP, static files.
- Argon2 для паролей пользователя и ссылок.
- Nano ID для идентификаторов и генерируемых slug.
- Pino/Pino Pretty для логирования и redaction.
- SQLite через синхронный встроенный API `node:sqlite`; WAL и foreign keys включаются при открытии.

### Тестирование и поставка

- Vitest 4; окружения Node и jsdom задаются директивами в тестах.
- Vue Test Utils и Testing Library DOM matchers.
- Multi-stage Docker build, Docker Compose, named volume.
- ESLint, Prettier, отдельного formatter/linter script и CI-конфигурации в репозитории нет.

## 4. Архитектура и поток запроса

```text
Browser
  ├─ /app/*        → Fastify static/fallback → собранное Vue SPA
  ├─ /api/*        → Fastify routes → services → repositories → SQLite
  ├─ /:slug        → public_slugs → Live/Page SPA либо link preview/password/redirect
  └─ /access/:slug → серверная HTML-форма пароля → redirect

Vue pages/components
  → src/client/lib/api.ts (credentials + CSRF)
  → JSON API

Fastify app.ts
  → AuthService / SessionService / LinkService / RateLimiterService
  → User/Session/Link/Analytics/Settings repositories
  → node:sqlite
```

Сервер и клиент собираются отдельно, но в production обслуживаются одним Fastify-процессом. Отдельного reverse proxy, очереди задач, ORM, миграционного фреймворка или внешнего аналитического сервиса в проекте нет.

## 5. Структура репозитория

- `src/client/` — Vue SPA.
  - `main.ts` — создание Vue app/router и подключение глобальных стилей.
  - `App.vue` — начальная проверка сессии, auth redirect, общий shell и глобальное окно создания ссылки.
  - `router.ts` — маршруты SPA.
  - `pages/` — Login, список ссылок, аналитика ссылки, глобальная аналитика, настройки.
  - `components/` — shell/sidebar, карточка ссылки, modal create/edit, stat card, toast viewport.
  - Pages: `PagesPage.vue`, `PageEditorPage.vue`, `PageAnalyticsPage.vue`, `PublicPagePage.vue`, общий `PageRenderer.vue` и public dispatcher `PublicSlugPage.vue`.
  - `composables/` — общее состояние auth, runtime branding, тема, toast.
  - `lib/api.ts` — общий fetch wrapper, cookie credentials, получение и добавление CSRF-токена к non-GET запросам, `ApiError`.
  - `styles.css` — Tailwind import, Flexoki-подобные design tokens и общие utility-компоненты.
- `src/server/` — Fastify приложение; Live routes вынесены в `live-routes.ts`.
  - `index.ts` — `buildApp()` и listen на `0.0.0.0`.
  - `app.ts` — плагины, hooks, все HTTP-маршруты, static SPA, bootstrap/cleanup timers.
  - `config.ts` — чтение и проверка env, defaults, reserved slugs, startup warnings.
  - `db.ts` — соединение SQLite, DDL и встроенные schema upgrades.
  - `logger.ts` — Pino и список redact paths.
  - `services/` — бизнес-логика авторизации, сессий, ссылок/аналитики и in-memory rate limiting.
  - `repositories/` — SQL и преобразование строк БД.
  - `views/error-pages.ts` — самодостаточные HTML-страницы protected/expired/disabled/not-found и preview для crawler-ботов.
  - `utils.ts` — ID/hash/slug/URL/CORS/expiration helpers.
- `src/shared/types.ts` — DTO и типы, используемые клиентом и сервером.
- `docs/PAGES.md` — постоянная документация Pages: blocks, API, storage, security, cache и проверки.
- `public/` — PWA icons и Open Graph PNG; Vite копирует их в client build.
- `index.html` — Vite entry с runtime-плейсхолдерами `__APP_NAME__` и `__APP_DESCRIPTION__`, которые заменяет Fastify.
- `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml` — сборка и локальная контейнерная конфигурация.
- `README.md` — обзор, quick start и production checklist.

## 6. Реализованный функционал

### Аутентификация и административная модель

- При старте `AuthService.bootstrapAdmin()` обеспечивает одну bootstrap-admin запись из env.
- Если bootstrap admin уже существует и reset выключен, его сохранённые credentials не меняются.
- В отсутствии bootstrap admin существующая запись с тем же email либо самый ранний пользователь может быть повышен; иначе создаётся новый пользователь.
- Login создаёт серверную сессию в SQLite и ставит `HttpOnly` cookie с настраиваемыми `SameSite`, `Secure`, TTL и именем.
- UI и API позволяют выйти, увидеть сессии, отозвать чужую сессию и сменить пароль. Текущую сессию через revoke endpoint удалить нельзя.
- Смена пароля увеличивает `session_version`, сохраняет текущую сессию с новой версией и удаляет остальные.
- SPA хранит пользователя только в общем reactive state; JWT/localStorage не используются.
- CSRF реализован `@fastify/csrf-protection`; все state-changing JSON API routes защищены. Публичная HTML-форма `/access/:slug` CSRF не требует.

### Короткие ссылки

- Создание и редактирование target URL, custom/generated slug, комментария, пароля и срока действия.
- Удаление, enable/disable, снятие пароля, очистка аналитики конкретной ссылки.
- Copy-to-clipboard и генерация/скачивание PNG QR-кода выполняются в браузере.
- Target URL принимает только `http://` и `https://`; localhost по умолчанию блокируется. Литеральные private IP блокируются только при `BLOCK_PRIVATE_IPS=true`.
- Custom slug использует встроенный безопасный набор URL-символов; `SLUG_ALLOWED_CHARS` управляет генерируемыми slug, а не полным набором ручных slug. Запрещены reserved slugs, slash/backslash, traversal, control и опасные encoded sequences.
- Дубли slug обеспечиваются SQLite `UNIQUE`; отдельного дружелюбного преобразования constraint error нет.
- Истёкшая ссылка считается disabled в UI. При повторном включении срок может быть очищен.

### Публичный переход

- `GET /:slug` возвращает 404 HTML для отсутствующей/некорректной ссылки, 403 для disabled, 410 для expired.
- Preview crawler получает HTML с OG-метаданными. Для незащищённой ссылки preview содержит meta refresh; для защищённой destination URL не раскрывается.
- Защищённая ссылка перенаправляет на `/access/:slug`, где Fastify рендерит HTML-форму пароля.
- Успешный обычный redirect записывает аналитику асинхронно и затем перенаправляет на target URL. Успешная HTML password form отвечает 303.
- Неуспешный пароль создаёт событие `failed_password`, но не увеличивает `links.click_count`.
- Ошибка записи аналитики логируется и не блокирует редирект; из-за `setImmediate()` событие может потеряться при внезапном завершении процесса.

### Аналитика

- Для ссылки: total clicks, unique visitors, referrers, trend; графики day/week/month с учётом timezone offset браузера; последние 10/20/50 успешных переходов.
- График ссылки отдельно показывает visits, unique visitors и failed auth.
- Глобально: общие clicks/views/unique visitors/devices, объединённый day/week/month trend, сравнение Links/Pages/Live, weekday/hour heatmap, top referrers/slugs и breakdown по device/browser/OS/language. Clicks = успешные Link redirects + Page block clicks; Views = Page + Live public page views; Live не создаёт click events, Links не создаёт view events.
- Heatmap использует ту же модель Clicks/Views, что глобальные totals, и группирует события по локальному времени браузера в двухчасовые интервалы. Top referrers/slugs и environment breakdowns используют основные публичные посещения: успешный Link redirect, Page view или Live participant-page view; Page block clicks в этих таблицах отдельно не дублируются.
- Global unique visitors считаются как объединение `visitor_hash` по модулям. Total devices — число уникальных пар visitor/device по событиям с известным device type, а не число типов устройств.
- User-agent классифицируется как human/bot/unknown и разбирается `ua-parser-js`.
- Геоданные не вычисляются самим приложением: используются входящие `cf-ipcountry`, `x-region`, `x-city`, иначе `Unknown`/`null`.
- Уникальный посетитель — HMAC от IP с `IP_HASH_SECRET`.
- `STORE_RAW_IP` управляет `analytics_events.raw_ip` и частью логов, но IP сессии всегда сохраняется в `sessions.ip_address`.
- Retention cleanup выполняется при старте и каждые 12 часов; старше `ANALYTICS_RETENTION_DAYS` удаляются Link events, Page views/clicks и Live views.
- Очистка всей/одной аналитики также сбрасывает materialized `click_count` ссылок.

### UI и branding

- Разделы: Links, Live, Pages, Analytics, Settings; responsive sidebar, light/dark/system theme.
- Раздел Pages: server-side список/search/sort/pagination, компактные двухколоночные desktop-карточки, modal-based блочный редактор, общий preview/public renderer с mobile/desktop viewport и отдельная аналитика с 30-дневным графиком/Top links.
- Предпочтения sidebar и analytics range/limit хранятся в обычных session-like cookies `ss_*` (без серверной защиты); theme дополнительно сохраняется в БД пользователя.
- Название/описание загружаются из `/api/public/config`; manifest и meta-теги генерируются/подставляются сервером.
- Все страницы выставлены `noindex`; public assets обслуживаются из build output.

## 7. Маршрутизация

### Vue SPA

| Path | Назначение |
|---|---|
| `/login` | Форма входа |
| `/` | Redirect на `/app/links` |
| `/app` | Redirect на `/app/links` |
| `/app/links` | Список и управление ссылками |
| `/app/links/:id` | Аналитика конкретной ссылки |
| `/app/live` | Список и редактор Live Activity |
| `/app/live/:id` | Результаты и moderation queue активности |
| `/app/pages` | Список, статистика, поиск и управление Pages |
| `/app/pages/new` | Создание Page |
| `/app/pages/:id` | Блочный редактор Page |
| `/app/pages/:id/analytics` | Аналитика Page и кликов по блокам |
| `/app/analytics` | Глобальная аналитика |
| `/app/settings` | Пароль, сессии, очистка аналитики |
| `/:slug` | Публичная Live Activity, если slug принадлежит Live |
| `/present/:slug` | Публичный presentation mode |

Auth guard реализован watcher’ом в `App.vue`, не router middleware. Fastify SPA fallback отдаёт `index.html` для неизвестных `/app/*` только когда существует `dist/client`.

### JSON API и runtime assets

| Method / path | Auth | CSRF | Назначение |
|---|---:|---:|---|
| `GET /api/health` | нет | нет | Healthcheck `{ ok: true }` |
| `GET /api/public/config` | нет | нет | Публичные app name/description |
| `GET /api/auth/csrf-token` | нет | нет | CSRF token + cookie |
| `GET /api/auth/me` | да | нет | Текущий пользователь |
| `POST /api/auth/login` | нет | да | Login, rate-limited |
| `POST /api/auth/logout` | cookie optional | да | Удаление сессии/cookie |
| `GET /api/sessions` | да | нет | Список сессий пользователя |
| `DELETE /api/sessions/:id` | да | да | Отзыв не текущей сессии |
| `POST /api/settings/theme` | да | да | Сохранение theme |
| `POST /api/settings/password` | да | да | Смена пароля, отзыв других сессий |
| `POST /api/settings/analytics/clear` | да | да | Очистка Link analytics, Live views/responses/participants и Page views/clicks |
| `GET /api/links` | да | нет | Список ссылок текущего пользователя |
| `POST /api/links` | да | да | Создание ссылки |
| `PATCH /api/links/:id` | да | да | Изменение ссылки |
| `DELETE /api/links/:id` | да | да | Удаление ссылки |
| `POST /api/links/:id/enabled` | да | да | Enable/disable и optional expiration reset |
| `POST /api/links/:id/analytics/clear` | да | да | Очистка аналитики ссылки |
| `GET /api/links/:id/analytics` | да | нет | Detail analytics; query: range, limit, timezone offset |
| `GET /api/analytics/global` | да | нет | Combined Links/Pages/Live analytics; query: range (`day/week/month`), timezone offset |
| `GET /api/analytics/global/activity-over-time` | да | нет | Только временной ряд глобальной аналитики при переключении day/week/month; не пересчитывает остальные dashboard-секции |
| `GET /api/live/public/:slug` | нет | нет | Participant view; result snapshot only when preview is enabled |
| `POST /api/live/:id/analytics/clear` | да | да | Очистка views, ответов и участников одной Activity без удаления её конфигурации |
| `POST /api/live/public/:slug/responses` | нет | нет | Submit participant response; server-enforced limits and moderation |
| `GET /api/live/public/:slug/results`, `/events` | нет | нет | Participant result preview snapshot/SSE; unavailable when preview is disabled |
| `GET /api/live/public/:slug/presentation`, `/presentation/events` | нет | нет | Approved Presentation snapshot/SSE; independent of participant preview |
| `GET/POST /api/pages` | GET/POST: да | POST: да | Список с search/sort/pagination и создание Page |
| `GET/PATCH/DELETE /api/pages/:id` | да | PATCH/DELETE: да | Detail, атомарное сохранение и удаление Page |
| `POST /api/pages/:id/duplicate`, `/status` | да | да | Копирование в новый draft и смена статуса |
| `GET /api/pages/:id/analytics` | да | нет | Views, unique visitors, Daily/Weekly/Month series и block clicks; query: range, timezone offset |
| `POST /api/pages/:id/analytics/clear` | да | да | Очистка views/clicks одной Page |
| `GET /api/pages/public/:slug` | нет | нет | Минимальная опубликованная Page с visible blocks |
| `POST /api/pages/public/:slug/clicks` | нет | нет | Идемпотентное событие клика по публичному блоку |
| `GET /robots.txt` | нет | нет | Полный запрет индексирования |
| `GET /site.webmanifest` | нет | нет | Runtime PWA manifest |
| `GET /icons/:file`, `/og/:file`, `/favicon.ico` | нет | нет | Ограниченная раздача branding assets |

### Public link routes

| Method / path | Назначение |
|---|---|
| `GET /:slug` | Preview, password handoff или redirect |
| `GET /access/:slug` | Password form либо возврат к обычной ссылке |
| `POST /access/:slug` | Проверка пароля и 303 redirect |

Public link responses применяют `Cache-Control: no-store`. Зарезервированные корневые slug не доступны для пользовательских ссылок.

## 8. SQLite: схема и жизненный цикл

`src/server/db.ts` — единственное место инициализации схемы. При первом `getDb()` создаётся parent directory, открывается один process-wide `DatabaseSync`, включаются WAL и foreign keys.

### Таблицы

- `users`
  - `id`, unique `email`, `name`, `password_hash`;
  - `is_bootstrap_admin`, `theme`, `session_version`;
  - `created_at`, `updated_at`.
- `sessions`
  - `id`, FK `user_id` с cascade delete;
  - `session_version`, `csrf_secret`, timestamps/expiry;
  - `ip_address`, `user_agent`.
  - `csrf_secret` записывается, но текущая реализация CSRF его не читает.
- `links`
  - `id`, FK `user_id`, unique `slug`, `target_url`;
  - optional `comment`, `password_hash`, `expires_at`;
  - `enabled`, timestamps, materialized `click_count`.
- `analytics_events`
  - FK `link_id` с cascade delete и denormalized `slug`;
  - timestamp, browser/OS/device/referrer/location/language/traffic type;
  - `auth_outcome` (`success` или `failed_password` в текущем коде);
  - `visitor_hash`, optional `raw_ip`.
- `settings`
  - key/value таблица создаётся, но текущий `SettingsRepository` её не читает и не пишет; security settings берутся из env/defaults.
- Live использует нормализованные `public_slugs`, `live_activities`, `live_questions`, `live_question_options`, `live_participants`, `live_responses`, `live_views` и `moderation_rules`; `live_activities.expires_at` задаёт необязательный срок жизни, `public_revision` последовательно версионирует публичное состояние, `live_responses.participant_name` фиксирует исходный nickname, а `published_participant_name` — одобренную модератором версию. `live_views` хранит HMAC visitor identity, device/browser/OS, normalized referrer и browser language для общей аналитики. Подробности: `docs/LIVE.md`.
- Pages использует `pages`, `page_blocks`, `page_views`, `page_block_clicks` и тот же `public_slugs`. `page_views` и `page_block_clicks` хранят HMAC visitor identity и request metadata (device/browser/OS, normalized referrer, browser language, optional raw IP); старые строки после upgrade получают нейтральные defaults. `page_blocks.config_json` хранит только серверно валидированный типизированный config. Page analytics отделена от Short URL analytics. Подробности: `docs/PAGES.md`.

Индексы есть для `sessions.user_id`, `links.user_id`, analytics `(link_id, timestamp)` и `(slug, timestamp)`, а также для публичной пагинации и подсчёта ответов Live.

### Schema upgrades

Полноценной системы миграций и version table нет. Startup делает `CREATE TABLE/INDEX IF NOT EXISTS`, затем по `PRAGMA table_info` условно добавляет старым БД поля:

- `links.enabled`;
- `links.comment`;
- `users.is_bootstrap_admin`;
- `analytics_events.auth_outcome`;
- `analytics_events.raw_ip`;
- `live_activities.expires_at`;
- `live_activities.public_revision`;
- `live_responses.participant_name`;
- `live_responses.published_participant_name`;
- `live_responses.name_edited_by_moderator`.
- `live_views.device_type`, `browser`, `os`, `referrer`, `language`;
- `page_views.device_type`, `browser`, `os`, `referrer`, `language`;
- `page_block_clicks.device_type`, `browser`, `os`, `referrer`, `language`, `raw_ip`.

Изменение схемы требует backward-compatible upgrade в `db.ts`, теста со старой схемой при необходимости и отдельного плана rollback/backup. Не считать обычный запуск «read-only».

## 9. Конфигурация окружения

Не фиксировать реальные значения в Git или в этом документе. `.env.example` в текущем репозитории отсутствует.

### Core и paths

- `NODE_ENV`, `PORT`.
- `APP_NAME`, `APP_DESCRIPTION`.
- `PUBLIC_URL`; `APP_BASE_URL` поддерживается как fallback alias.
- `CORS_ORIGIN` — comma-separated allowlist; обязателен в production.
- `APP_DATA_DIR`, `DATABASE_PATH`.
- `LOG_LEVEL`, `LOG_PRETTY`.

### Auth/security

- `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`.
- `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `ENABLE_CSP`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`.
- `RESET_ADMIN`; `RESET_ADMIN_ON_START` — legacy fallback.
- `LOGIN_MAX_FAILED_ATTEMPTS`, `LOGIN_ATTEMPT_WINDOW_MINUTES`, `LOGIN_BLOCK_MINUTES`.
- `PROTECTED_LINK_MAX_FAILED_ATTEMPTS`, `PROTECTED_LINK_ATTEMPT_WINDOW_MINUTES`, `PROTECTED_LINK_BLOCK_MINUTES`.

### Links и rate limits

- `MIN_SLUG_LENGTH`, `MAX_SLUG_LENGTH`, `SLUG_ALLOWED_CHARS`.
- `BLOCK_LOCAL_URLS`, `BLOCK_PRIVATE_IPS`.
- `API_RATE_LIMIT_ENABLED`, `API_RATE_LIMIT_MAX_REQUESTS`, `API_RATE_LIMIT_WINDOW_MINUTES`.
- `LINK_CREATE_RATE_LIMIT_ENABLED`, `LINK_CREATE_MAX_REQUESTS`, `LINK_CREATE_WINDOW_MINUTES`.
- `REDIRECT_RATE_LIMIT_ENABLED`, `REDIRECT_RATE_LIMIT_MAX_REQUESTS`, `REDIRECT_RATE_LIMIT_WINDOW_MINUTES`, `REDIRECT_RATE_LIMIT_BLOCK_MINUTES`.

### Analytics/privacy

- `STORE_RAW_IP`.
- `IP_HASH_SECRET`; обязателен в production, если raw IP storage выключен.
- `ANALYTICS_RETENTION_DAYS`.
- `LIVE_SUBMIT_MAX_REQUESTS`, `LIVE_SUBMIT_WINDOW_MINUTES`.

Production invariants из кода: задать точный `CORS_ORIGIN`; явно задать `ADMIN_PASSWORD` длиной не менее 12 символов и не использовать встроенное значение; для HTTPS обязателен secure cookie; при `STORE_RAW_IP=false` задать стабильный длинный `IP_HASH_SECRET`. Нарушение этих условий останавливает startup.

## 10. Локальная разработка, сборка и Docker

### npm-команды

```bash
npm ci                 # установить строго package-lock
npm run dev            # concurrent Fastify watch + Vite
npm run dev:server     # tsx watch, обычно порт 3000
npm run dev:client     # Vite, порт 5173
npm run typecheck      # client и server TypeScript checks
npm test               # Vitest один проход
npm run test:watch     # Vitest watch
npm run load:links:50  # isolated loopback: 50 redirects + analytics integrity
npm run load:links:200 # то же для 200 virtual visitors
npm run load:links:500 # то же для 500 virtual visitors
npm run load:live:50   # isolated loopback: page API + 50 SSE + 50 submissions
npm run load:live:200  # isolated loopback test: page API + 200 SSE + 200 submissions
npm run load:live:500  # то же для 500 virtual participants
npm run load:live:word-cloud # 200 unique Word Cloud phrases + SSE
npm run load:live:open # 200 Open Answer submissions + SSE
npm run load:live:history # 2,000 stored Open Answers + complete cursor traversal
npm run load:pages:50  # isolated loopback Page HTML/API/click analytics test for 50 visitors
npm run load:pages:200 # isolated loopback Page HTML/API/click analytics test
npm run load:pages:500 # тот же сценарий для 500 virtual visitors
npm run verify:production # real HTTP Brotli/gzip/cache/SSE header checks on a temporary DB
npm run build          # clean, Vite client, tsc server
npm start              # node dist/server/index.js
```

Vite dev server проксирует `/api` и runtime branding assets на Fastify `:3000`; production обслуживается одним origin из `dist/client`.

Не запускать `npm start` без предварительного `npm run build`: сервер ожидает `dist/server/index.js`, а SPA/static handling — `dist/client`.

### Docker

```bash
docker compose up --build
docker compose --profile test run --rm shortswitch-test
```

- Build stage: `npm ci`, copy source, `npm run build`.
- Runtime stage: security upgrade `perl-base`, production dependencies only, удаление npm/npx из готового image, копирование `dist`, создание непривилегированного пользователя `app`.
- Entrypoint при старте от root создаёт/chown `/app/data`, затем запускает процесс как `app`.
- Healthcheck вызывает `GET /api/health`.
- Compose публикует порт 3000 и монтирует named volume `shortswitch-data` в `/app/data`.
- Сервис `shortswitch-test` использует build stage и выполняет typecheck + tests.
- Checked-in Compose — локальный test stub. В нём есть демонстрационные credentials/secret-like значения; не копировать их в документацию и обязательно заменить перед публичным deployment.
- Отдельного документированного update/rollback workflow нет. Пересборка контейнера не должна удалять named volume, но backup/restore SQLite и процедура обновления VPS в репозитории не описаны.

## 11. Соглашения по коду

- TypeScript strict; ESM; single quotes, semicolons, 2-space indentation.
- Имена: `camelCase` для функций/переменных, `PascalCase` для Vue-компонентов, классов и TS interfaces/types; файлы server/service/repository — kebab-case, Vue components/pages — PascalCase.
- Server imports для локальных TS-модулей пишутся с `.js`, так как output — NodeNext ESM. Client imports обычно без расширения.
- Alias `@/*` указывает на `src/*` и доступен в Vite/Vitest/TypeScript.
- Vue: Composition API, `<script setup lang="ts">`, `ref/reactive/computed/watch`, lazy route components.
- SQL держать в repositories, orchestration/business rules — в services, HTTP semantics/plugins — в `app.ts`, общие DTO — в `src/shared/types.ts`.
- Multiple Choice ответы Live хранят ID вариантов в `selected_options_json`; при обычном редактировании Activity нельзя удалять и пересоздавать неизменённые `live_question_options`, иначе сохранённые голоса потеряют связь с вариантами.
- Page block `double` хранит ровно два вложенных блока в `config_json`; вложенный `double` запрещён. ID дочерних блоков стабильны и используются click analytics, поэтому при обычном редактировании их нельзя без необходимости генерировать заново.
- Публичные Live snapshots ограничены последними 100 Open Answer и top-150 Word Cloud; полная история остаётся в БД и доступна через `/answers` и `/words`. Административный detail остаётся полным.
- SSE protocol 2 использует persisted `public_revision`, initial/reconnect snapshot и 500-ms delta batches. При изменении модерации/конфигурации предпочитай forced snapshot; не возвращай full-snapshot broadcast на каждую обычную отправку.
- Не удаляй `?protocol=2` и legacy SSE fallback без отдельного плана совместимости уже открытых вкладок.
- Hashed `/app/assets/*` immutable и precompressed; HTML должен оставаться `no-cache`, Live API `no-store`, SSE `no-cache`, а Short URL redirects/password/expiry — `no-store`.
- Pages HTML также `no-cache`; public Page API `no-store`, admin Page API `private, no-store`. Динамические Page title/description/canonical/OG metadata экранируются и кешируются in-memory по `page.id:updatedAt` с лимитом 100 записей.
- Page blocks всегда валидировать на сервере. Не добавлять `v-html`, custom HTML/JS/CSS или server-side fetch внешних изображений. Existing Link/Live blocks хранят ID и разрешают текущий URL при чтении; удалённый ресурс должен отображаться unavailable, а не превращаться в устаревшую копию URL.
- При сохранении Page сохранять единый `BEGIN IMMEDIATE` для Page, slug mapping и полного порядка blocks. При смене slug старый slug освобождается без redirect; duplicate всегда создаёт новый draft без аналитики.
- При изменении moderation rules сохранять немедленную инвалидацию process-local cache; он допустим только из-за single-process архитектуры.
- Client network calls вести через `src/client/lib/api.ts`, чтобы сохранялись credentials, CSRF и единый `ApiError`.
- State-changing API route должен подключать `app.csrfProtection` и затем проверять ownership/auth в service/repository path.
- Для ресурсов по ID всегда проверять `userId`, как сделано для links/analytics, чтобы не допустить IDOR.
- Пароли хранить только как Argon2 hash. Visitor identity — HMAC, не простой SHA-256.
- Ошибки в API обычно возвращаются как `{ message }`; public-link failures — отдельные HTML pages. Централизованного Fastify error handler нет, поэтому новую ошибку обрабатывать на границе route и не раскрывать DB/internal details.
- Асинхронная аналитика должна оставаться best-effort и не ломать redirect.
- При новых protected data fields обновлять redaction и тесты на отсутствие утечек.
- UI-тема строится на CSS variables + Tailwind utility classes; сохранять light/dark варианты и responsive поведение.

## 12. Тесты и безопасная проверка

Существующие тесты:

- `src/server/app.test.ts` — большой sequential integration/security suite через `Fastify.inject`: production config, CORS/CSP/cookies/CSRF, auth, IDOR, rate limits, protected links, cache headers, slug/URL validation, comments, analytics cleanup/privacy, log redaction, admin bootstrap/reset, session expiry/logout/password invalidation.
- `src/server/services/rate-limiter-service.test.ts` — unit test window reset с fake timers.
- `src/server/services/live-realtime-service.test.ts` — delta protocol, удаление результатов и защита от медленных SSE-клиентов.
- `src/client/components/CreateLinkModal.test.ts` — jsdom component smoke test advanced fields.
- `src/client/components/LiveResultsBoard.test.ts`, `QrCodePopover.test.ts` — Live visualization and shared QR behavior.
- `src/client/components/PageRenderer.test.ts` — безопасный общий renderer, hidden blocks, темы/layout и link behavior.
- `src/client/pages/LivePresentationPage.test.ts`, `PublicLivePage.test.ts` — Presentation URL handling and public form validation.
- `src/client/tests/setup.ts` — подключение `@testing-library/jest-dom`.

Server tests создают уникальные файлы `.data/test-shortswitch-*.db`, вызывают `resetDb()` и удаляют test DB в `afterEach`. При аварийном завершении временный тестовый файл может остаться; не путать его с рабочей БД.

Минимальный порядок проверки изменения:

1. `npm run typecheck`.
2. `npm test`.
3. `npm run build` для изменений client/server/build config.
4. Для route/auth/schema/security изменений добавить или обновить `app.test.ts`.
5. Для UI-логики добавить Vitest/Vue Test Utils test; текущий client coverage минимален.

Перед запуском тестов убедиться, что зависимости уже установлены из lockfile. Не направлять тесты на рабочий `DATABASE_PATH`. Автоматического coverage script, e2e browser suite, lint, formatting check и CI pipeline сейчас нет.

## 13. Известные ограничения и потенциальные проблемы

Это наблюдения по текущему коду, а не реализованные задачи:

1. **Compose не production-ready:** checked-in values демонстрационные, TLS/reverse proxy не описаны, а некоторые rate limits выключены.
2. **`trustProxy: true`:** при прямой публикации Fastify без доверенного proxy клиент может влиять на forwarded IP; это затрагивает rate limiting, session IP и аналитику.
3. **In-memory rate limits:** состояние теряется при restart, не делится между replicas и Map не имеет общей фоновой очистки устаревших уникальных ключей. Горизонтальное масштабирование не поддерживается.
4. **Нет migration framework/rollback:** schema upgrades выполняются на старте приложения.
5. **Исторические данные общей аналитики:** Live views до появления `live_views` восстановить нельзя; browser/OS/referrer/language и часть device metadata старых Page/Live views не реконструируются и остаются `Unknown`/`Direct`/`null`.
6. **Счётчик и события не транзакционны:** analytics event и `links.click_count` записываются отдельно и асинхронно; при частичном сбое возможен drift.
7. **Privacy scope:** `STORE_RAW_IP=false` скрывает raw IP аналитики и части логов, но не IP в таблице `sessions`.
8. **Runtime validation неполна:** часть JSON body/query значений приводится через TypeScript casts/`any`; non-finite limit может попасть глубже.
9. **DB errors:** duplicate slug и другие SQLite errors могут возвращаться клиенту как raw `Error.message` через route-level catch.
10. **Unused schema/API remnants:** таблица `settings`, `sessions.csrf_secret`, `sha256`, `safeRedirectPath`, `SessionRepository.deleteOutdatedVersions()` не используются текущим рабочим потоком.
11. **Документационные пробелы:** нет `.env.example`, versioned migration guide, backup/restore procedure, VPS update/rollback runbook, CI, API schema/OpenAPI и отдельного LICENSE-файла, хотя README заявляет MIT.
12. **Client tests:** покрытие UI сведено к одному smoke test; нет e2e проверки login → CRUD → redirect → analytics.

При исправлении любого пункта сначала зафиксировать ожидаемое поведение тестом и обновить этот файл вместе с README/config examples, если фактический workflow изменился.

## 14. Что считать установленным, а что неизвестно

Фактически установлено из репозитория: архитектура, routes, SQLite schema, env parsing, Docker build, npm scripts и перечисленный функционал.

Не установлено из содержимого проекта:

- реальный production hostname, reverse proxy, TLS и инфраструктура VPS;
- реальные значения env и расположение production database/backup;
- внешний процесс мониторинга и лог-сбор;
- рабочая процедура backup/restore/update/rollback;
- целевые браузеры и формальная accessibility policy;
- наличие внешнего CI/CD вне этого репозитория.

Не делать предположений об этих пунктах; запрашивать контекст у пользователя перед инфраструктурными или data-affecting изменениями.
