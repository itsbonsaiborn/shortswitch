import crypto from 'node:crypto';
import net from 'node:net';
import { customAlphabet, nanoid } from 'nanoid';
import { config } from './config.js';

export const nowIso = () => new Date().toISOString();

export const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (secret: string, value: string) =>
  crypto.createHmac('sha256', secret).update(value).digest('hex');

export const safeRedirectPath = (value: string) => {
  if (!value.startsWith('/')) return '/app/links';
  return value;
};

export const createSlugGenerator = (allowedChars: string, minLength: number) =>
  customAlphabet(allowedChars, minLength);

export const createId = () => nanoid();

export const buildShortUrl = (slug: string) =>
  `${config.publicUrl.replace(/\/$/, '')}/${encodeURIComponent(slug)}`;

export const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

export const humanReferrer = (referrer: string | undefined) => {
  if (!referrer) return 'Direct';
  try {
    return new URL(referrer).hostname;
  } catch {
    return 'Direct';
  }
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CONTROL_CHARACTERS = /[\0-\x1F\x7F]/;
const SAFE_CUSTOM_SLUG_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~!$&'()*+,;=:@";

export const isDevelopmentLocalhostOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

export const isTrustedCorsOrigin = (origin: string | undefined) => {
  if (!origin) return false;
  if (config.corsAllowedOrigins.includes(origin)) return true;
  if (config.isDevelopment && isDevelopmentLocalhostOrigin(origin)) return true;
  return false;
};

export const validateSlug = (
  rawSlug: string,
  options = {
    allowedChars: config.defaults.slugAllowedChars,
    minLength: config.defaults.minSlugLength,
    maxLength: config.defaults.maxSlugLength,
    invalidCharacterReason: 'Slug contains characters outside the configured charset.'
  }
) => {
  const slug = rawSlug?.trim?.() ?? '';
  if (!slug) return { ok: false, reason: 'Slug cannot be empty.' } as const;
  if (CONTROL_CHARACTERS.test(slug)) return { ok: false, reason: 'Slug contains control characters.' } as const;
  if (slug.includes('/') || slug.includes('\\')) return { ok: false, reason: 'Slug cannot contain slashes.' } as const;
  if (slug.includes('..')) return { ok: false, reason: 'Slug cannot contain traversal sequences.' } as const;
  if (/%2f|%5c|%2e|%00/i.test(slug)) return { ok: false, reason: 'Slug contains encoded unsafe characters.' } as const;
  if (slug.length < options.minLength) return { ok: false, reason: 'Slug is shorter than allowed minimum.' } as const;
  if (slug.length > options.maxLength) return { ok: false, reason: 'Slug is longer than allowed maximum.' } as const;
  if (config.reservedSlugs.has(slug.toLowerCase())) return { ok: false, reason: 'Slug is reserved.' } as const;

  const allowedSet = new Set(options.allowedChars.split(''));
  if (!slug.split('').every((char) => allowedSet.has(char))) {
    return { ok: false, reason: options.invalidCharacterReason } as const;
  }

  return { ok: true, slug } as const;
};

export const validateGeneratedSlug = (
  rawSlug: string,
  options = {
    allowedChars: config.defaults.slugAllowedChars,
    minLength: config.defaults.minSlugLength,
    maxLength: config.defaults.maxSlugLength
  }
) =>
  validateSlug(rawSlug, {
    ...options,
    invalidCharacterReason: 'Slug contains characters outside the configured charset.'
  });

export const validateCustomSlug = (
  rawSlug: string,
  options = {
    minLength: config.defaults.minSlugLength,
    maxLength: config.defaults.maxSlugLength
  }
) =>
  validateSlug(rawSlug, {
    allowedChars: SAFE_CUSTOM_SLUG_CHARACTERS,
    minLength: options.minLength,
    maxLength: options.maxLength,
    invalidCharacterReason: 'Slug contains unsafe characters.'
  });

export const isSafeRouteSlug = (rawSlug: string) =>
  validateCustomSlug(rawSlug, {
    minLength: 1,
    maxLength: config.defaults.maxSlugLength
  }).ok;

const isPrivateIpv4 = (hostname: string) => {
  const [first, second] = hostname.split('.').map(Number);
  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
};

const isPrivateIpv6 = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
};

const isPrivateIpAddress = (hostname: string) => {
  const ipType = net.isIP(hostname);
  if (ipType === 4) return isPrivateIpv4(hostname);
  if (ipType === 6) return isPrivateIpv6(hostname);
  return false;
};

export const validateTargetUrl = (rawTargetUrl: string) => {
  const targetUrl = rawTargetUrl?.trim?.() ?? '';
  if (!targetUrl) {
    throw new Error('Target URL is required.');
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error('Target URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }

  if (!parsed.hostname) {
    throw new Error('Target URL must include a hostname.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (config.blockLocalUrls && (LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost'))) {
    throw new Error('Localhost destinations are blocked by server policy.');
  }

  if (config.blockPrivateIps && isPrivateIpAddress(hostname)) {
    throw new Error('Private IP destinations are blocked by server policy.');
  }

  return parsed.toString();
};

export const expirationFromInput = (
  value: number | null | undefined,
  unit: 'minutes' | 'hours' | 'days' | undefined
) => {
  if (!value || !unit || value < 1) return null;
  const multiplier =
    unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 24 * 3_600_000;
  return new Date(Date.now() + value * multiplier).toISOString();
};
