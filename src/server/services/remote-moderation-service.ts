import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type {
  ModerationMatchMode,
  RemoteModerationParsingMode,
  RemoteModerationSource,
  RemoteModerationSourceDetails
} from '../../shared/types.js';
import {
  ModerationRemoteRepository,
  type RemoteModerationSourceRecord
} from '../repositories/moderation-remote-repository.js';
import { nowIso } from '../utils.js';
import {
  ModerationFilterService,
  normalizeModerationMatchText,
  validateModerationRule
} from './moderation-filter-service.js';

export const REMOTE_MODERATION_MAX_BYTES = 1024 * 1024;
export const REMOTE_MODERATION_MAX_RULES = 10_000;
export const REMOTE_MODERATION_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const GITHUB_RAW_HOST = 'raw.githubusercontent.com';

type FetchLike = typeof fetch;
type ResolveHost = (hostname: string) => Promise<string[]>;

export interface ParsedRemoteModerationRule {
  pattern: string;
  matchMode: ModerationMatchMode;
}

const parsingModes = new Set<RemoteModerationParsingMode>(['contains', 'whole', 'smart']);

const isBlockedIpv4 = (address: string) => {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
};

export const isBlockedRemoteAddress = (address: string) => {
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isBlockedIpv4(mapped);
  return normalized === '::' || normalized === '::1' ||
    normalized.startsWith('fc') || normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:');
};

export const validateRemoteModerationUrl = (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl ?? '').trim());
  } catch {
    throw new Error('Remote source URL is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== GITHUB_RAW_HOST ||
      parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error('Remote source must be an HTTPS GitHub Raw URL.');
  }
  if (/\\|%2f|%5c|%00/i.test(parsed.pathname)) {
    throw new Error('Remote source URL path is invalid.');
  }
  let segments: string[];
  try {
    segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new Error('Remote source URL path is invalid.');
  }
  if (segments.length < 4 || segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      !segments.at(-1)!.toLowerCase().endsWith('.txt')) {
    throw new Error('Remote source must point to a TXT file in GitHub Raw content.');
  }
  return parsed.toString();
};

export const parseRemoteModerationList = (content: string, parsingMode: RemoteModerationParsingMode) => {
  if (!parsingModes.has(parsingMode)) throw new Error('Invalid remote parsing mode.');
  const rules: ParsedRemoteModerationRule[] = [];
  const seen = new Set<string>();
  let parsedLineCount = 0;
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (!line || line.startsWith('#')) continue;
    parsedLineCount += 1;
    if (parsedLineCount > REMOTE_MODERATION_MAX_RULES) {
      throw new Error(`Remote list exceeds the ${REMOTE_MODERATION_MAX_RULES} rule limit.`);
    }
    let matchMode: ModerationMatchMode;
    let pattern: string;
    if (parsingMode === 'smart') {
      const directive = line.match(/^(contains|whole):(.*)$/u);
      if (!directive) throw new Error(`Malformed Smart rule on line ${index + 1}.`);
      matchMode = directive[1] === 'contains' ? 'contains' : 'whole_word';
      pattern = directive[2]!;
    } else {
      matchMode = parsingMode === 'contains' ? 'contains' : 'whole_word';
      pattern = line;
    }
    let validated: ParsedRemoteModerationRule;
    try {
      validated = validateModerationRule(pattern, matchMode);
    } catch {
      throw new Error(`Invalid remote rule on line ${index + 1}.`);
    }
    const key = `${validated.matchMode}\u0000${normalizeModerationMatchText(validated.pattern)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(validated);
  }
  if (rules.length === 0) throw new Error('Remote list does not contain any rules.');
  return rules;
};

const rulesHash = (rules: ParsedRemoteModerationRule[]) => {
  const canonical = rules
    .map((rule) => [rule.matchMode, normalizeModerationMatchText(rule.pattern)] as const)
    .sort(([modeA, patternA], [modeB, patternB]) => modeA.localeCompare(modeB) || patternA.localeCompare(patternB));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};

const defaultResolveHost: ResolveHost = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

const readLimitedText = async (response: Response) => {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > REMOTE_MODERATION_MAX_BYTES) {
    throw new Error('Remote list response is too large.');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > REMOTE_MODERATION_MAX_BYTES) {
      await reader.cancel();
      throw new Error('Remote list response is too large.');
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new Error('Remote list is not valid UTF-8 text.');
  }
};

export class RemoteModerationService {
  private readonly syncing = new Map<string, Promise<RemoteModerationSource>>();

  constructor(
    private readonly filter: ModerationFilterService,
    private readonly repository = new ModerationRemoteRepository(),
    private readonly fetchImpl: FetchLike = fetch,
    private readonly resolveHost: ResolveHost = defaultResolveHost
  ) {}

  private toPublic(source: RemoteModerationSourceRecord): RemoteModerationSource {
    const { userId: _userId, contentHash: _contentHash, ...publicSource } = source;
    return { ...publicSource, syncing: this.syncing.has(source.id) };
  }

  list(userId: string) {
    return this.repository.listSources(userId).map((source) => this.toPublic(source));
  }

  inspect(userId: string, id: string, requestedLimit = 100): RemoteModerationSourceDetails {
    const source = this.requireSource(userId, id);
    const previewLimit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 100;
    return {
      source: this.toPublic(source),
      rules: this.repository.listRulePreviews(id, previewLimit),
      previewLimit
    };
  }

  create(userId: string, input: unknown) {
    const validated = this.validateInput(input);
    return this.toPublic(this.repository.createSource({ userId, ...validated }));
  }

  update(userId: string, id: string, input: unknown) {
    const current = this.requireSource(userId, id);
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const validated = this.validateInput({
      url: body.url ?? current.url,
      parsingMode: body.parsingMode ?? current.parsingMode,
      updateIntervalMinutes: body.updateIntervalMinutes === undefined ? current.updateIntervalMinutes : body.updateIntervalMinutes,
      enabled: body.enabled === undefined ? current.enabled : body.enabled
    });
    const sourceChanged = validated.url !== current.url || validated.parsingMode !== current.parsingMode;
    const updated = this.repository.updateSource(id, userId, { ...validated, sourceChanged });
    if (!updated) throw new Error('Remote moderation source not found.');
    if (updated.enabled !== current.enabled) this.filter.invalidate(userId);
    return this.toPublic(updated);
  }

  setEnabled(userId: string, id: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new Error('Enabled must be a boolean.');
    const updated = this.repository.setEnabled(id, userId, enabled);
    if (!updated) throw new Error('Remote moderation source not found.');
    this.filter.invalidate(userId);
    return this.toPublic(updated);
  }

  delete(userId: string, id: string) {
    if (!this.repository.deleteSource(id, userId)) throw new Error('Remote moderation source not found.');
    this.filter.invalidate(userId);
  }

  sync(userId: string, id: string) {
    const source = this.requireSource(userId, id);
    return this.startSync(source);
  }

  async syncDueSources(now = Date.now()) {
    const due = this.repository.listAutomatedSources().filter((source) => {
      const lastChecked = source.lastCheckedAt ? Date.parse(source.lastCheckedAt) : 0;
      return !Number.isFinite(lastChecked) || lastChecked + source.updateIntervalMinutes! * 60_000 <= now;
    });
    const outcomes = await Promise.allSettled(due.map((source) => this.startSync(source)));
    return {
      checked: outcomes.length,
      failed: outcomes.filter((outcome) => outcome.status === 'rejected').length
    };
  }

  private startSync(source: RemoteModerationSourceRecord) {
    const active = this.syncing.get(source.id);
    if (active) return active;
    const task = this.performSync(source).finally(() => this.syncing.delete(source.id));
    this.syncing.set(source.id, task);
    return task;
  }

  private async performSync(source: RemoteModerationSourceRecord) {
    const checkedAt = nowIso();
    try {
      const content = await this.download(source.url);
      const rules = parseRemoteModerationList(content, source.parsingMode);
      const latest = this.repository.getSource(source.userId, source.id);
      if (!latest || latest.url !== source.url || latest.parsingMode !== source.parsingMode) {
        throw new Error('Remote moderation source changed while synchronization was running.');
      }
      const contentHash = rulesHash(rules);
      const currentRules = this.repository.listAllRules(source.id);
      const currentHash = rulesHash(currentRules);
      if (source.contentHash === contentHash && currentHash === contentHash) {
        this.repository.recordUnchanged(source.id, checkedAt, rules.length, contentHash);
      } else {
        this.repository.replaceRules(source.id, checkedAt, contentHash, rules);
        this.filter.invalidate(source.userId);
      }
      return this.toPublic(this.requireSource(source.userId, source.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Remote moderation synchronization failed.';
      const current = this.repository.getSource(source.userId, source.id);
      if (current && current.url === source.url && current.parsingMode === source.parsingMode) {
        this.repository.recordFailure(source.id, checkedAt, message);
      }
      throw new Error(message);
    }
  }

  private async download(initialUrl: string) {
    let currentUrl = validateRemoteModerationUrl(initialUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_MODERATION_TIMEOUT_MS);
    try {
      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const parsed = new URL(currentUrl);
        const addresses = await this.resolveHost(parsed.hostname);
        if (!addresses.length || addresses.some(isBlockedRemoteAddress)) {
          throw new Error('Remote source resolved to a blocked network address.');
        }
        const response = await this.fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { Accept: 'text/plain' }
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location || redirectCount === MAX_REDIRECTS) throw new Error('Remote source redirect is not allowed.');
          currentUrl = validateRemoteModerationUrl(new URL(location, currentUrl).toString());
          continue;
        }
        if (!response.ok) throw new Error(`Remote source returned HTTP ${response.status}.`);
        return await readLimitedText(response);
      }
      throw new Error('Remote source redirect limit exceeded.');
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Remote source request timed out.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireSource(userId: string, id: string) {
    const source = this.repository.getSource(userId, id);
    if (!source) throw new Error('Remote moderation source not found.');
    return source;
  }

  private validateInput(input: unknown) {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const url = validateRemoteModerationUrl(String(body.url ?? ''));
    const parsingMode = body.parsingMode as RemoteModerationParsingMode;
    if (!parsingModes.has(parsingMode)) throw new Error('Invalid remote parsing mode.');
    let updateIntervalMinutes: number | null = null;
    if (body.updateIntervalMinutes !== null && body.updateIntervalMinutes !== undefined) {
      updateIntervalMinutes = Number(body.updateIntervalMinutes);
      if (!Number.isInteger(updateIntervalMinutes) || updateIntervalMinutes < MIN_INTERVAL_MINUTES ||
          updateIntervalMinutes > MAX_INTERVAL_MINUTES) {
        throw new Error(`Update interval must be manual or between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes.`);
      }
    }
    const enabled = body.enabled === undefined ? true : body.enabled;
    if (typeof enabled !== 'boolean') throw new Error('Enabled must be a boolean.');
    return { url, parsingMode, updateIntervalMinutes, enabled };
  }
}
