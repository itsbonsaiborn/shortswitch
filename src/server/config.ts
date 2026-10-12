import crypto from 'node:crypto';
import path from 'node:path';

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return value === 'true';
};

const parseOrigins = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const isDevelopment = !isProduction;
const dataDir = process.env.APP_DATA_DIR ?? '.data';
const publicUrl = process.env.PUBLIC_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000';
const corsOrigins = parseOrigins(process.env.CORS_ORIGIN);
const cookieSecure = parseBoolean(process.env.COOKIE_SECURE, isProduction);
const storeRawIp = parseBoolean(process.env.STORE_RAW_IP, false);

if (isProduction && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGIN must be set in production.');
}

const ipHashSecret =
  process.env.IP_HASH_SECRET ??
  (storeRawIp
    ? ''
    : isProduction
      ? ''
      : `dev-ip-hash-secret-${crypto.randomUUID()}`);

if (isProduction && !storeRawIp && !ipHashSecret) {
  throw new Error('IP_HASH_SECRET must be set in production when STORE_RAW_IP=false.');
}

const startupWarnings: string[] = [];

if (isProduction && !cookieSecure) {
  startupWarnings.push('COOKIE_SECURE=false in production. Session cookies will travel over insecure transport.');
}

if (publicUrl.startsWith('https://') && !cookieSecure) {
  startupWarnings.push('PUBLIC_URL uses https:// but COOKIE_SECURE=false. Browsers may expose session cookies insecurely.');
}

const resetAdminOnStart = parseBoolean(
  process.env.RESET_ADMIN ?? process.env.RESET_ADMIN_ON_START,
  false
);
if (resetAdminOnStart) {
  startupWarnings.push('RESET_ADMIN=true. Single-user admin credentials will be forcefully reset on startup and active sessions will be revoked.');
}

export const config = {
  nodeEnv,
  isProduction,
  isDevelopment,
  logPretty: process.env.LOG_PRETTY === 'true',
  port: parseNumber(process.env.PORT, 3000),
  appName: process.env.APP_NAME ?? 'ShortSwitch',
  appDescription:
    process.env.APP_DESCRIPTION ??
    'Privacy-aware self-hosted URL shortener with secure links and lightweight analytics.',
  publicUrl,
  baseUrl: publicUrl,
  dataDir,
  databasePath: process.env.DATABASE_PATH ?? path.join(dataDir, 'shortswitch.db'),
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'shortswitch_session',
  sessionTtlHours: parseNumber(process.env.SESSION_TTL_HOURS, 24 * 30),
  cookieSecure,
  cookieSameSite: (process.env.COOKIE_SAME_SITE ?? 'lax') as 'lax' | 'strict' | 'none',
  enableCsp: parseBoolean(process.env.ENABLE_CSP, isProduction),
  corsAllowedOrigins: corsOrigins,
  admin: {
    email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
    password: process.env.ADMIN_PASSWORD ?? 'change-me-now',
    name: process.env.ADMIN_NAME ?? 'Admin'
  },
  resetAdminOnStart,
  logLevel: process.env.LOG_LEVEL ?? 'info',
  defaults: {
    minSlugLength: parseNumber(process.env.MIN_SLUG_LENGTH, 6),
    maxSlugLength: parseNumber(process.env.MAX_SLUG_LENGTH, 64),
    slugAllowedChars:
      process.env.SLUG_ALLOWED_CHARS ??
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    loginMaxFailedAttempts: parseNumber(process.env.LOGIN_MAX_FAILED_ATTEMPTS, 5),
    loginAttemptWindowMinutes: parseNumber(process.env.LOGIN_ATTEMPT_WINDOW_MINUTES, 10),
    loginBlockMinutes: parseNumber(process.env.LOGIN_BLOCK_MINUTES, 15),
    protectedLinkMaxFailedAttempts: parseNumber(process.env.PROTECTED_LINK_MAX_FAILED_ATTEMPTS, 5),
    protectedLinkAttemptWindowMinutes: parseNumber(
      process.env.PROTECTED_LINK_ATTEMPT_WINDOW_MINUTES,
      10
    ),
    protectedLinkBlockMinutes: parseNumber(process.env.PROTECTED_LINK_BLOCK_MINUTES, 15),
    apiRateLimitEnabled: parseBoolean(process.env.API_RATE_LIMIT_ENABLED, false),
    apiRateLimitMaxRequests: parseNumber(process.env.API_RATE_LIMIT_MAX_REQUESTS, 300),
    apiRateLimitWindowMinutes: parseNumber(process.env.API_RATE_LIMIT_WINDOW_MINUTES, 1),
    linkCreateRateLimitEnabled: parseBoolean(process.env.LINK_CREATE_RATE_LIMIT_ENABLED, false),
    linkCreateMaxRequests: parseNumber(process.env.LINK_CREATE_MAX_REQUESTS, 30),
    linkCreateWindowMinutes: parseNumber(process.env.LINK_CREATE_WINDOW_MINUTES, 60),
    redirectRateLimitEnabled: parseBoolean(process.env.REDIRECT_RATE_LIMIT_ENABLED, false),
    redirectRateLimitMaxRequests: parseNumber(process.env.REDIRECT_RATE_LIMIT_MAX_REQUESTS, 600),
    redirectRateLimitWindowMinutes: parseNumber(process.env.REDIRECT_RATE_LIMIT_WINDOW_MINUTES, 1),
    redirectRateLimitBlockMinutes: parseNumber(process.env.REDIRECT_RATE_LIMIT_BLOCK_MINUTES, 10),
    liveSubmitMaxRequests: parseNumber(process.env.LIVE_SUBMIT_MAX_REQUESTS, 60),
    liveSubmitWindowMinutes: parseNumber(process.env.LIVE_SUBMIT_WINDOW_MINUTES, 1)
  },
  blockLocalUrls: parseBoolean(process.env.BLOCK_LOCAL_URLS, true),
  blockPrivateIps: parseBoolean(process.env.BLOCK_PRIVATE_IPS, false),
  storeRawIp,
  ipHashSecret,
  analyticsRetentionDays: parseNumber(process.env.ANALYTICS_RETENTION_DAYS, 90),
  startupWarnings,
  reservedSlugs: new Set([
    '',
    'api',
    'auth',
    'app',
    'login',
    'logout',
    'admin',
    'settings',
    'analytics',
    'links',
    'live',
    'pages',
    'present',
    'sessions',
    'access',
    'static',
    'assets',
    'health',
    'favicon.ico',
    'robots.txt',
    'site.webmanifest',
    'icons',
    'og'
  ])
};
