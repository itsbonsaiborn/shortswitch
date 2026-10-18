import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import csrfProtection from '@fastify/csrf-protection';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import Fastify, { LogController } from 'fastify';
import { config } from './config.js';
import { logger } from './logger.js';
import { AuthService } from './services/auth-service.js';
import { LinkService } from './services/link-service.js';
import { SessionService } from './services/session-service.js';
import type { LinkRow } from './repositories/link-repository.js';
import { SettingsRepository } from './repositories/settings-repository.js';
import { UserRepository } from './repositories/user-repository.js';
import { RateLimiterService } from './services/rate-limiter-service.js';
import { LiveService } from './services/live-service.js';
import { LiveRealtimeService } from './services/live-realtime-service.js';
import { registerLiveRoutes } from './live-routes.js';
import { registerPageRoutes } from './page-routes.js';
import { PageService } from './services/page-service.js';
import { renderLinkDisabledPage, renderLinkExpiredPage, renderLinkNotFoundPage, renderProtectedLinkPage, renderPublicServiceUnavailablePage, renderShortLinkPreviewPage } from './views/error-pages.js';
import { isSafeRouteSlug, isTrustedCorsOrigin } from './utils.js';
import { resolvePublicLocale } from '../shared/public-locale.js';
import { publicText } from './public-i18n.js';

export const buildApp = async () => {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 64 * 1024
  });
  const auth = new AuthService();
  const sessions = new SessionService();
  const links = new LinkService();
  const settingsRepository = new SettingsRepository();
  const users = new UserRepository();
  const rateLimiter = new RateLimiterService();
  const live = new LiveService();
  const liveRealtime = new LiveRealtimeService();
  const pages = new PageService();
  const clientRoot = path.resolve('dist/client');
  const clientIndexPath = path.resolve(clientRoot, 'index.html');
  const publicIconRoot = path.join(clientRoot, 'icons');
  const publicOgRoot = path.join(clientRoot, 'og');
  const analyticsCleanupIntervalMs = 12 * 60 * 60 * 1000;
  const getRequestIpForLogs = (ip: string | undefined) => (config.storeRawIp ? ip : undefined);
  const applyNoStore = (reply: any) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    return reply;
  };
  const applyNoCache = (reply: any) => {
    reply.header('Cache-Control', 'no-cache');
    return reply;
  };
  const isPreviewBot = (userAgent: string | undefined) =>
    /facebookexternalhit|Facebot|Twitterbot|Slackbot|Discordbot|TelegramBot|WhatsApp|LinkedInBot|SkypeUriPreview|googlebot|bingbot|applebot|DuckAssistBot|embedly|quora link preview|vkShare|pinterest|redditbot|ia_archiver/i.test(
      userAgent ?? ''
    );
  const getLinkPreviewMeta = (link: LinkRow) => {
    const shortUrl = `${new URL(config.baseUrl).host}/${link.slug}`;
    let targetHost = 'destination';
    try {
      targetHost = new URL(link.targetUrl).host;
    } catch {
      targetHost = 'destination';
    }

    if (link.passwordHash) {
      return {
        title: shortUrl,
        description: `Password-protected short link on ${config.appName}. Access to ${targetHost} requires a password.`,
        shortUrl: `${config.baseUrl.replace(/\/$/, '')}/${link.slug}`
      };
    }

    return {
      title: shortUrl,
      description: `Short link on ${config.appName} that points to ${targetHost}.`,
      shortUrl: `${config.baseUrl.replace(/\/$/, '')}/${link.slug}`,
      targetUrl: link.targetUrl
    };
  };
  const escapeHtml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  const getContentType = (filePath: string) => {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.svg') return 'image/svg+xml';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.ico') return 'image/x-icon';
    if (extension === '.json' || extension === '.webmanifest') return 'application/manifest+json';
    if (extension === '.txt') return 'text/plain; charset=utf-8';
    return 'application/octet-stream';
  };
  const sendStaticAsset = (reply: any, rootDir: string, fileName: string) => {
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      return reply.code(404).send({ message: 'Not found.' });
    }
    const filePath = path.resolve(rootDir, fileName);
    if (!filePath.startsWith(rootDir + path.sep)) {
      return reply.code(404).send({ message: 'Not found.' });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return reply.code(404).send({ message: 'Not found.' });
    }
    return reply.type(getContentType(filePath)).send(fs.readFileSync(filePath));
  };
  const renderClientIndexHtml = (metadata?: {
    resourceType?: 'live' | 'page';
    title?: string;
    description?: string;
    canonicalUrl?: string;
  }) => {
    const rawHtml = fs.readFileSync(clientIndexPath, 'utf8');
    let html = rawHtml
      .replaceAll('__APP_NAME__', escapeHtml(config.appName))
      .replaceAll('__APP_DESCRIPTION__', escapeHtml(config.appDescription));
    if (metadata?.title) {
      const title = escapeHtml(metadata.title);
      html = html
        .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
        .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
        .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`);
    }
    if (metadata?.description) {
      const description = escapeHtml(metadata.description);
      html = html
        .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`)
        .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${description}" />`)
        .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${description}" />`);
    }
    const additions = [
      metadata?.resourceType ? `<meta name="shortswitch-resource-type" content="${metadata.resourceType}" />` : '',
      metadata?.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />` : ''
    ].filter(Boolean).join('\n    ');
    return additions ? html.replace('</head>', `    ${additions}\n  </head>`) : html;
  };
  type ClientIndexPayloads = { identity: Buffer; br: Buffer; gzip: Buffer };
  const compressClientHtml = (html: string): ClientIndexPayloads => {
    const identity = Buffer.from(html);
    return {
      identity,
      br: brotliCompressSync(identity, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }),
      gzip: gzipSync(identity, { level: 9 })
    };
  };
  let clientIndexPayloads: ClientIndexPayloads | undefined;
  let liveIndexPayloads: ClientIndexPayloads | undefined;
  const pageIndexPayloadCache = new Map<string, ClientIndexPayloads>();
  const getClientIndexPayloads = () => {
    if (clientIndexPayloads) return clientIndexPayloads;
    clientIndexPayloads = compressClientHtml(renderClientIndexHtml());
    return clientIndexPayloads;
  };
  const getLiveIndexPayloads = () => {
    if (!liveIndexPayloads) liveIndexPayloads = compressClientHtml(renderClientIndexHtml({ resourceType: 'live' }));
    return liveIndexPayloads;
  };
  const getPageIndexPayloads = (page: { id: string; updatedAt: string; title: string; seoTitle: string | null; description: string | null; seoDescription: string | null; publicUrl: string }) => {
    const key = `${page.id}:${page.updatedAt}`;
    const cached = pageIndexPayloadCache.get(key);
    if (cached) return cached;
    const payloads = compressClientHtml(renderClientIndexHtml({
      resourceType: 'page',
      title: page.seoTitle || page.title,
      description: page.seoDescription || page.description || config.appDescription,
      canonicalUrl: page.publicUrl
    }));
    if (pageIndexPayloadCache.size >= 100) {
      const oldestKey = pageIndexPayloadCache.keys().next().value as string | undefined;
      if (oldestKey) pageIndexPayloadCache.delete(oldestKey);
    }
    pageIndexPayloadCache.set(key, payloads);
    return payloads;
  };
  const acceptedEncodingQuality = (header: string | undefined, encoding: 'br' | 'gzip') => {
    if (!header) return 0;
    let wildcardQuality = 0;
    for (const item of header.toLowerCase().split(',')) {
      const [name, ...parameters] = item.trim().split(';');
      const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='));
      const parsedQuality = qualityParameter ? Number.parseFloat(qualityParameter.trim().slice(2)) : 1;
      const quality = Number.isFinite(parsedQuality) ? Math.max(0, Math.min(1, parsedQuality)) : 0;
      if (name === encoding) return quality;
      if (name === '*') wildcardQuality = quality;
    }
    return wildcardQuality;
  };
  const sendClientIndex = (
    request: { headers: { 'accept-encoding'?: string } },
    reply: any,
    payloads = getClientIndexPayloads()
  ) => {
    const acceptEncoding = request.headers['accept-encoding'];
    const brQuality = acceptedEncodingQuality(acceptEncoding, 'br');
    const gzipQuality = acceptedEncodingQuality(acceptEncoding, 'gzip');
    applyNoCache(reply).header('Vary', 'Accept-Encoding').type('text/html; charset=utf-8');
    if (brQuality > 0 && brQuality >= gzipQuality) {
      return reply.header('Content-Encoding', 'br').send(payloads.br);
    }
    if (gzipQuality > 0) {
      return reply.header('Content-Encoding', 'gzip').send(payloads.gzip);
    }
    return reply.send(payloads.identity);
  };
  const isInvalidSlugRequest = (slug: string) => !isSafeRouteSlug(slug);

  await auth.bootstrapAdmin();
  sessions.cleanup();
  links.cleanupAnalytics();
  pages.cleanupAnalytics();
  live.cleanupAnalytics();

  for (const warning of config.startupWarnings) {
    logger.warn({ category: 'security' }, warning);
  }

  const analyticsCleanupTimer = setInterval(() => {
    try {
      const deletedRows = links.cleanupAnalytics();
      const deletedPageRows = pages.cleanupAnalytics();
      const deletedLiveRows = live.cleanupAnalytics();
      if (deletedRows > 0 || deletedPageRows > 0 || deletedLiveRows > 0) {
        logger.info({ deletedRows, deletedPageRows, deletedLiveRows }, 'analytics retention cleanup completed');
      }
    } catch (error) {
      logger.error({ err: error }, 'analytics retention cleanup failed');
    }
  }, analyticsCleanupIntervalMs);

  app.addHook('onClose', async () => {
    clearInterval(analyticsCleanupTimer);
    liveRealtime.close();
    await links.flushAnalytics();
  });

  await app.register(cookie, {
    secret: crypto.randomBytes(32).toString('hex')
  });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) return callback(null, false);
      return callback(null, isTrustedCorsOrigin(origin));
    },
    credentials: true,
    strictPreflight: true
  });
  await app.register(helmet, {
    contentSecurityPolicy: config.enableCsp
      ? {
          directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            // Protected link forms legitimately redirect to validated external http(s) destinations.
            formAction: ["'self'", 'https:', 'http:'],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"]
          }
        }
      : false
  });
  await app.register(formbody);
  await app.register(csrfProtection, {
    cookieOpts: {
      signed: false,
      sameSite: config.cookieSameSite,
      secure: config.cookieSecure,
      httpOnly: true,
      path: '/'
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const rawPathname = request.raw.url?.split('?')[0] ?? '';
    if (/(^|\/)(\.\.|%2e%2e|%2f|%5c|%00)/i.test(rawPathname)) {
      return reply.code(404).send({ message: 'Not found.' });
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0];
    if (pathname.startsWith('/api/live/public/') || pathname.startsWith('/api/pages/public/')) {
      reply.header('Cache-Control', 'no-store');
    } else if (
      pathname === '/api/live' || pathname.startsWith('/api/live/') || pathname.startsWith('/api/moderation/') ||
      pathname.startsWith('/api/settings/') ||
      pathname === '/api/pages' || pathname.startsWith('/api/pages/')
    ) {
      reply.header('Cache-Control', 'private, no-store');
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!config.defaults.apiRateLimitEnabled) return;
    if (!request.url.startsWith('/api/')) return;
    if (request.url === '/api/health') return;

    const allowed = rateLimiter.consume(
      'api',
      request.ip ?? 'unknown',
      {
        maxAttempts: config.defaults.apiRateLimitMaxRequests,
        windowMinutes: config.defaults.apiRateLimitWindowMinutes,
        blockMinutes: config.defaults.apiRateLimitWindowMinutes
      }
    );

    if (!allowed) {
      return reply.code(429).send({ message: 'Too many requests. Please try again later.' });
    }
  });

  await registerLiveRoutes(app, {
    live,
    realtime: liveRealtime,
    sessions,
    rateLimiter
  });
  await registerPageRoutes(app, { pages, sessions });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/public/config', async () => ({
    appName: config.appName,
    appDescription: config.appDescription
  }));

  app.get('/robots.txt', async (_request, reply) => {
    reply.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate');
    return reply.type('text/plain; charset=utf-8').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/site.webmanifest', async (_request, reply) => {
    return reply.type('application/manifest+json').send({
      name: config.appName,
      short_name: config.appName,
      description: config.appDescription,
      start_url: '/app/links',
      display: 'standalone',
      background_color: '#87D3C3',
      theme_color: '#100F0F',
      icons: [
        {
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png'
        },
        {
          src: '/icons/maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ],
      screenshots: [
        {
          src: '/og/app-og.png',
          sizes: '1280x640',
          type: 'image/png',
          form_factor: 'wide'
        },
        {
          src: '/og/app-og-mobile.png',
          sizes: '640x680',
          type: 'image/png'
        }
      ]
    });
  });

  app.get('/icons/:file', async (request, reply) => {
    return sendStaticAsset(reply, publicIconRoot, (request.params as { file: string }).file);
  });

  app.get('/og/:file', async (request, reply) => {
    return sendStaticAsset(reply, publicOgRoot, (request.params as { file: string }).file);
  });

  app.get('/favicon.ico', async (_request, reply) => {
    if (fs.existsSync(path.join(publicIconRoot, 'favicon-32.png'))) {
      return sendStaticAsset(reply, publicIconRoot, 'favicon-32.png');
    }
    return reply.code(204).send();
  });

  app.get('/api/auth/csrf-token', async (_request, reply) => ({
    csrfToken: reply.generateCsrf()
  }));

  app.get('/api/auth/me', async (request, reply) => {
    const authenticated = await sessions.getAuthenticatedUser(request);
    if (!authenticated) return reply.code(401).send({ message: 'Authentication required.' });
    return authenticated.user;
  });

  app.post(
    '/api/auth/login',
    { onRequest: app.csrfProtection },
    async (request, reply) => {
      const current = settingsRepository.getSecuritySettings();
      const body = request.body as { email: string; password: string };
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const loginRateLimitKey = `${request.ip ?? 'unknown'}:${email}`;
      const allowed = rateLimiter.consume(
        'auth',
        loginRateLimitKey,
        {
          maxAttempts: current.loginMaxFailedAttempts,
          windowMinutes: current.loginAttemptWindowMinutes,
          blockMinutes: current.loginBlockMinutes
        }
      );
      if (!allowed) {
        return reply.code(429).send({ message: 'Too many attempts. Please try again later.' });
      }
      const user = await auth.login(request, reply, email, password);
      if (!user) {
        return reply.code(401).send({ message: 'Invalid email or password.' });
      }
      rateLimiter.reset('auth', loginRateLimitKey);
      return user;
    }
  );

  app.post('/api/auth/logout', { onRequest: app.csrfProtection }, async (request, reply) => {
    const sessionId = request.cookies[config.sessionCookieName];
    auth.logout(reply, sessionId);
    return { ok: true };
  });

  app.get('/api/sessions', async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    return sessions.listSessions(authenticated.currentUser.id, authenticated.sessionId);
  });

  app.delete('/api/sessions/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const deleted = sessions.revokeSession(
      authenticated.currentUser.id,
      authenticated.sessionId,
      (request.params as { id: string }).id
    );
    return deleted ? { ok: true } : reply.code(404).send({ message: 'Session not found.' });
  });

  app.post('/api/settings/theme', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const body = request.body as { theme: 'light' | 'dark' | 'system' };
    if (!['light', 'dark', 'system'].includes(body.theme)) {
      return reply.code(400).send({ message: 'Invalid theme.' });
    }
    users.updatePreferences(authenticated.currentUser.id, { theme: body.theme });
    return { ok: true };
  });

  app.get('/api/settings/preferences', async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const user = users.findById(authenticated.currentUser.id);
    if (!user) return reply.code(404).send({ message: 'User not found.' });
    return {
      theme: user.theme,
      sidebarCollapsed: user.sidebarCollapsed,
      locale: user.locale,
      initialized: user.preferencesInitialized
    };
  });

  app.patch('/api/settings/preferences', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const body = (request.body ?? {}) as { theme?: unknown; sidebarCollapsed?: unknown; locale?: unknown };
    if (body.theme !== undefined && !['light', 'dark', 'system'].includes(String(body.theme))) {
      return reply.code(400).send({ message: 'Invalid theme.' });
    }
    if (body.sidebarCollapsed !== undefined && typeof body.sidebarCollapsed !== 'boolean') {
      return reply.code(400).send({ message: 'Invalid sidebar preference.' });
    }
    if (body.locale !== undefined && !['en', 'lv'].includes(String(body.locale))) {
      return reply.code(400).send({ message: 'Invalid locale.' });
    }
    if (body.theme === undefined && body.sidebarCollapsed === undefined && body.locale === undefined) {
      return reply.code(400).send({ message: 'No preferences supplied.' });
    }
    return users.updatePreferences(authenticated.currentUser.id, {
      ...(body.theme !== undefined ? { theme: body.theme as 'light' | 'dark' | 'system' } : {}),
      ...(body.sidebarCollapsed !== undefined ? { sidebarCollapsed: body.sidebarCollapsed } : {}),
      ...(body.locale !== undefined ? { locale: body.locale as 'en' | 'lv' } : {})
    });
  });

  app.post('/api/settings/password', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const body = request.body as { password: string };
    try {
      await auth.changePassword(authenticated.currentUser.id, authenticated.sessionId, body.password);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
  });

  app.post('/api/settings/analytics/clear', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const linkRows = Number(links.clearAnalytics());
    const pageRows = pages.clearAllAnalytics(authenticated.currentUser.id);
    const liveResult = live.clearAllResponses(authenticated.currentUser.id);
    for (const activityId of liveResult.activityIds) {
      liveRealtime.schedule(activityId, () => live.getResultsForActivityId(activityId), { forceSnapshot: true });
    }
    const deletedRows = linkRows + pageRows + liveResult.deletedRows;
    logger.warn(
      { userId: authenticated.currentUser.id, deletedRows, linkRows, pageRows, liveRows: liveResult.deletedRows },
      'analytics and Live responses cleared'
    );
    return { ok: true, deletedRows, linkRows, pageRows, liveRows: liveResult.deletedRows };
  });

  app.get('/api/links', async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    return links.list(authenticated.currentUser.id);
  });

  app.post('/api/links', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    if (config.defaults.linkCreateRateLimitEnabled) {
      const allowed = rateLimiter.consume(
        'link-create',
        authenticated.currentUser.id,
        {
          maxAttempts: config.defaults.linkCreateMaxRequests,
          windowMinutes: config.defaults.linkCreateWindowMinutes,
          blockMinutes: config.defaults.linkCreateWindowMinutes
        },
        { userId: authenticated.currentUser.id }
      );
      if (!allowed) {
        return reply.code(429).send({ message: 'Too many requests. Please try again later.' });
      }
    }
    try {
      return await links.create(authenticated.currentUser.id, request.body as any);
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
  });

  app.patch('/api/links/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    try {
      return await links.update(authenticated.currentUser.id, (request.params as any).id, request.body as any);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message === 'Link not found.' ? 404 : 400).send({ message });
    }
  });

  app.delete('/api/links/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    try {
      links.delete(authenticated.currentUser.id, (request.params as any).id);
      return { ok: true };
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.post('/api/links/:id/enabled', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const body = request.body as { enabled: boolean; clearExpirationOnEnable?: boolean };
    try {
      return links.setEnabled(
        authenticated.currentUser.id,
        (request.params as any).id,
        Boolean(body.enabled),
        Boolean(body.clearExpirationOnEnable)
      );
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.post('/api/links/:id/analytics/clear', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    try {
      const updated = links.clearLinkAnalytics(authenticated.currentUser.id, (request.params as any).id);
      return updated;
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.get('/api/links/:id/analytics', async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const query = request.query as { range?: 'day' | 'week' | 'month'; limit?: string; timezoneOffsetMinutes?: string };
    try {
      return links.getLinkDetails(
        authenticated.currentUser.id,
        (request.params as any).id,
        query.range ?? 'week',
        Number(query.limit ?? 10),
        Number(query.timezoneOffsetMinutes ?? 0)
      );
    } catch (error) {
      return reply.code(404).send({ message: (error as Error).message });
    }
  });

  app.get('/api/analytics/global', async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const query = request.query as { range?: string; timezoneOffsetMinutes?: string };
    const range = query.range === 'day' || query.range === 'week' || query.range === 'month' ? query.range : 'month';
    return links.getGlobalAnalytics(authenticated.currentUser.id, range, Number(query.timezoneOffsetMinutes ?? 0));
  });

  app.get('/api/analytics/global/activity-over-time', async (request, reply) => {
    const authenticated = await sessions.requireAuth(request, reply);
    if (!authenticated) return;
    const query = request.query as { range?: string; timezoneOffsetMinutes?: string };
    const range = query.range === 'day' || query.range === 'week' || query.range === 'month' ? query.range : 'month';
    return links.getGlobalActivityOverTime(authenticated.currentUser.id, range, Number(query.timezoneOffsetMinutes ?? 0));
  });

  app.get('/access/:slug', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    const slug = (request.params as { slug: string }).slug;
    if (isInvalidSlugRequest(slug)) {
      return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
    }
    const link = links.getLinkBySlug(slug);
    if (!link) return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
    if (!link.enabled) {
      logger.info({ slug }, 'disabled link access');
      return applyNoStore(reply).code(403).type('text/html').send(renderLinkDisabledPage(locale));
    }
    if (links.isExpired(link.expiresAt)) {
      logger.info({ slug }, 'expired link access');
      return applyNoStore(reply).code(410).type('text/html').send(renderLinkExpiredPage(locale));
    }
    if (!link.passwordHash) {
      return applyNoStore(reply).redirect(`/${encodeURIComponent(slug)}`);
    }

    const preview = getLinkPreviewMeta(link);
    return applyNoStore(reply).type('text/html').send(renderProtectedLinkPage({
      title: preview.title,
      description: preview.description,
      locale
    }));
  });

  app.post(
    '/access/:slug',
    async (request, reply) => {
      const locale = resolvePublicLocale(request.headers['accept-language']);
      const slug = (request.params as { slug: string }).slug;
      if (isInvalidSlugRequest(slug)) {
        return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
      }
      const link = links.getLinkBySlug(slug);
      if (!link) return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
      if (!link.enabled) {
        logger.info({ slug }, 'disabled link access');
        return applyNoStore(reply).code(403).type('text/html').send(renderLinkDisabledPage(locale));
      }
      if (links.isExpired(link.expiresAt)) {
        logger.info({ slug }, 'expired link access');
        return applyNoStore(reply).code(410).type('text/html').send(renderLinkExpiredPage(locale));
      }
      if (!link.passwordHash) {
        return applyNoStore(reply).redirect(`/${encodeURIComponent(slug)}`);
      }

      const current = settingsRepository.getSecuritySettings();
      const allowed = rateLimiter.consume(
        'link-password',
        `${request.ip ?? 'unknown'}:${slug}`,
        {
          maxAttempts: current.protectedLinkMaxFailedAttempts,
          windowMinutes: current.protectedLinkAttemptWindowMinutes,
          blockMinutes: current.protectedLinkBlockMinutes
        },
        { slug }
      );
      if (!allowed) {
        return applyNoStore(reply).code(429).type('text/html').send(renderProtectedLinkPage({
          error: publicText(locale, 'tooManyAttempts'),
          locale
        }));
      }

      const form = request.body as any;
      const valid = await links.verifyPassword(slug, form.password ?? '');
      if (!valid) {
        logger.warn({ slug, ip: getRequestIpForLogs(request.ip) }, 'invalid password attempts');
        links.queueFailedPasswordAttempt(link.id, link.slug, {
          userAgent: request.headers['user-agent'],
          referrer: request.headers.referer,
          language: request.headers['accept-language'],
          ip: request.ip,
          country: request.headers['cf-ipcountry'] as string | undefined,
          region: request.headers['x-region'] as string | undefined,
          city: request.headers['x-city'] as string | undefined
        });
        return applyNoStore(reply).code(401).type('text/html').send(renderProtectedLinkPage({
          error: publicText(locale, 'invalidPassword'),
          locale
        }));
      }

      logger.info({ slug, ip: getRequestIpForLogs(request.ip) }, 'password protected link access');
      links.queueAnalytics(link.id, link.slug, {
        userAgent: request.headers['user-agent'],
        referrer: request.headers.referer,
        language: request.headers['accept-language'],
        ip: request.ip,
        country: request.headers['cf-ipcountry'] as string | undefined,
        region: request.headers['x-region'] as string | undefined,
        city: request.headers['x-city'] as string | undefined
      });
      return applyNoStore(reply).code(303).redirect(link.targetUrl);
    }
  );

  app.get('/', async (_request, reply) => {
    return reply.redirect('/app/links');
  });

  app.get('/present/:slug', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    const slug = (request.params as { slug: string }).slug;
    const liveActivity = isInvalidSlugRequest(slug) ? undefined : live.findBySlug(slug);
    if (!liveActivity) {
      return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
    }
    if (live.isExpired(liveActivity.expiresAt)) {
      return applyNoStore(reply).code(410).type('text/html').send(renderLinkExpiredPage(locale, 'live'));
    }
    if (!fs.existsSync(clientIndexPath)) {
      return applyNoStore(reply).code(503).type('text/html').send(renderPublicServiceUnavailablePage(locale));
    }
    return sendClientIndex(request, reply);
  });

  app.get('/:slug', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    const slug = (request.params as { slug: string }).slug;
    if (config.reservedSlugs.has(slug.toLowerCase())) return applyNoStore(reply).redirect('/app/links');
    if (isInvalidSlugRequest(slug)) {
      return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
    }
    const liveActivity = live.findBySlug(slug);
    if (liveActivity) {
      if (live.isExpired(liveActivity.expiresAt)) {
        return applyNoStore(reply).code(410).type('text/html').send(renderLinkExpiredPage(locale, 'live'));
      }
      if (!fs.existsSync(clientIndexPath)) {
        return applyNoStore(reply).code(503).type('text/html').send(renderPublicServiceUnavailablePage(locale));
      }
      return sendClientIndex(request, reply, getLiveIndexPayloads());
    }
    const page = pages.findPublicRoute(slug);
    if (page) {
      if (page.status === 'draft') {
        return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
      }
      if (page.status === 'disabled') {
        return applyNoStore(reply).code(403).type('text/html').send(renderLinkDisabledPage(locale, 'page'));
      }
      if (!fs.existsSync(clientIndexPath)) {
        return applyNoStore(reply).code(503).type('text/html').send(renderPublicServiceUnavailablePage(locale));
      }
      return sendClientIndex(request, reply, getPageIndexPayloads(page));
    }
    const link = links.getLinkBySlug(slug);
    if (!link) return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
    if (!link.enabled) {
      logger.info({ slug }, 'disabled link access');
      return applyNoStore(reply).code(403).type('text/html').send(renderLinkDisabledPage(locale));
    }
    if (links.isExpired(link.expiresAt)) {
      logger.info({ slug }, 'expired link access');
      return applyNoStore(reply).code(410).type('text/html').send(renderLinkExpiredPage(locale));
    }
    if (config.defaults.redirectRateLimitEnabled) {
      const allowed = rateLimiter.consume(
        'redirect',
        request.ip ?? 'unknown',
        {
          maxAttempts: config.defaults.redirectRateLimitMaxRequests,
          windowMinutes: config.defaults.redirectRateLimitWindowMinutes,
          blockMinutes: config.defaults.redirectRateLimitBlockMinutes
        },
        { slug }
      );
      if (!allowed) {
        return applyNoStore(reply).code(429).type('text/plain; charset=utf-8').send(publicText(locale, 'tooManyRequests'));
      }
    }
    if (isPreviewBot(request.headers['user-agent'])) {
      return applyNoStore(reply).type('text/html').send(renderShortLinkPreviewPage({ ...getLinkPreviewMeta(link), locale }));
    }

    if (link.passwordHash) return applyNoStore(reply).redirect(`/access/${encodeURIComponent(slug)}`);

    links.queueAnalytics(link.id, link.slug, {
      userAgent: request.headers['user-agent'],
      referrer: request.headers.referer,
      language: request.headers['accept-language'],
      ip: request.ip,
      country: request.headers['cf-ipcountry'] as string | undefined,
      region: request.headers['x-region'] as string | undefined,
      city: request.headers['x-city'] as string | undefined
    });

    return applyNoStore(reply).redirect(link.targetUrl);
  });

  if (fs.existsSync(clientRoot)) {
    await app.register(staticPlugin, {
      root: clientRoot,
      prefix: '/app/',
      wildcard: false,
      index: false,
      preCompressed: true,
      allowedPath: (pathName) => !/\.(?:br|gz)$/i.test(pathName),
      setHeaders: (reply, filePath) => {
        const sourcePath = filePath.replace(/\.(?:br|gz)$/i, '');
        if (/[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/i.test(sourcePath)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          reply.header('Cache-Control', 'no-cache');
        }
      }
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) return reply.code(404).send({ message: 'Not found.' });
      if (request.url.startsWith('/app')) {
        if (!clientIndexPath.startsWith(clientRoot + path.sep) && clientIndexPath !== path.join(clientRoot, 'index.html')) {
          return reply.code(500).send({ message: 'Client root resolution failed.' });
        }
        return sendClientIndex(request, reply);
      }
      const locale = resolvePublicLocale(request.headers['accept-language']);
      return applyNoStore(reply).code(404).type('text/html').send(renderLinkNotFoundPage(locale));
    });
  }

  return app;
};
