import type {
  LiveActivityInput,
  LiveActivityStatus,
  LiveActivitySummary,
  LiveResultsSnapshot,
  LiveResponseStatus,
  ModerationRule,
  ModerationMatchMode
} from '@/shared/types.js';
import { UAParser } from 'ua-parser-js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { LiveRepository } from '../repositories/live-repository.js';
import { createSlugGenerator, expirationFromInput, hmacSha256, humanReferrer, nowIso, validateCustomSlug, validateGeneratedSlug } from '../utils.js';

const activityTypes = new Set(['open_answer', 'word_cloud', 'multiple_choice', 'scale']);
const identityModes = new Set(['anonymous', 'named']);
const activityStatuses = new Set(['active', 'closed']);
const moderationModes = new Set(['off', 'filter_only', 'review_all']);
const responseStatuses = new Set(['approved', 'pending', 'rejected']);
const matchModes = new Set(['whole_word', 'contains']);

const normalizedText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const normalizedMatchText = (value: string) => normalizedText(value).toLocaleLowerCase();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const LIVE_PUBLIC_OPEN_ANSWER_LIMIT = 100;
export const LIVE_PUBLIC_WORD_CLOUD_LIMIT = 150;
const LIVE_PUBLIC_PAGE_LIMIT = 100;

const normalizeOsLabel = (name?: string, version?: string) => {
  if (!name) return 'Unknown';
  if (/windows/i.test(name)) return 'Windows';
  if (/mac/i.test(name)) return 'macOS';
  if (/ios/i.test(name)) return 'iOS';
  if (/android/i.test(name)) return 'Android';
  if (/linux|ubuntu|debian|fedora|arch/i.test(name)) return 'Linux';
  return [name, version].filter(Boolean).join(' ');
};

export class LiveService {
  private repository = new LiveRepository();
  private moderationRuleCache = new Map<string, ModerationRule[]>();

  list(userId: string) {
    return this.repository.list(userId);
  }

  getOwned(userId: string, activityId: string) {
    const activity = this.repository.findById(activityId);
    if (!activity || this.repository.getOwnerId(activityId) !== userId) throw new Error('Activity not found.');
    return activity;
  }

  create(userId: string, rawInput: LiveActivityInput) {
    const input = this.validateActivityInput(rawInput);
    const manualSlug = rawInput.slug?.trim() || undefined;
    const slug = manualSlug ?? createSlugGenerator(config.defaults.slugAllowedChars, config.defaults.minSlugLength)();
    const validation = manualSlug
      ? validateCustomSlug(slug)
      : validateGeneratedSlug(slug);
    if (!validation.ok) throw new Error(validation.reason);
    try {
      return this.repository.create(userId, slug, input, expirationFromInput(input.expirationValue, input.expirationUnit));
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new Error('This slug is already in use.');
      }
      throw error;
    }
  }

  update(userId: string, activityId: string, rawInput: LiveActivityInput) {
    const current = this.getOwned(userId, activityId);
    const input = this.validateActivityInput(rawInput);
    if (current.responseCount > 0) {
      if (input.type !== current.type) throw new Error('Activity type cannot be changed after responses exist.');
      if (current.type === 'multiple_choice') {
        const currentLabels = current.options.map((option) => normalizedMatchText(option.label));
        const nextLabels = (input.options ?? []).map(normalizedMatchText);
        if (
          JSON.stringify(currentLabels) !== JSON.stringify(nextLabels) ||
          input.allowMultipleChoices !== current.allowMultipleChoices
        ) {
          throw new Error('Choice configuration cannot be changed after responses exist.');
        }
      }
      if (current.type === 'scale' && (input.scaleMin !== current.scaleMin || input.scaleMax !== current.scaleMax)) {
        throw new Error('Scale bounds cannot be changed after responses exist.');
      }
    }
    const slug = rawInput.slug?.trim() || current.slug;
    const validation = validateCustomSlug(slug);
    if (!validation.ok) throw new Error(validation.reason);
    try {
      const expiresAt = rawInput.expirationValue === undefined && rawInput.expirationUnit === undefined
        ? current.expiresAt
        : expirationFromInput(input.expirationValue, input.expirationUnit);
      return this.repository.update(activityId, slug, input, expiresAt)!;
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) {
        throw new Error('This slug is already in use.');
      }
      throw error;
    }
  }

  delete(userId: string, activityId: string) {
    this.getOwned(userId, activityId);
    this.repository.delete(activityId);
  }

  clearResponses(userId: string, activityId: string) {
    this.getOwned(userId, activityId);
    const deletedRows = this.repository.clearResponses(activityId);
    return { activity: this.getOwned(userId, activityId), deletedRows };
  }

  clearAllResponses(userId: string) {
    return this.repository.clearAllResponses(userId);
  }

  getAdminResponses(userId: string, activityId: string) {
    this.getOwned(userId, activityId);
    return this.repository.listResponses(activityId);
  }

  setStatus(userId: string, activityId: string, status: LiveActivityStatus, clearExpirationOnReopen = false) {
    const activity = this.getOwned(userId, activityId);
    if (!activityStatuses.has(status)) throw new Error('Invalid activity status.');
    const expiresAt = status === 'active' && (clearExpirationOnReopen || this.isExpired(activity.expiresAt))
      ? null
      : activity.expiresAt;
    return this.repository.setStatus(activityId, status, expiresAt)!;
  }

  getAdminDetails(
    userId: string,
    activityId: string,
    range: 'day' | 'week' | 'month' = 'month',
    timezoneOffsetMinutes = 0,
    limit = 10
  ) {
    const activity = this.getOwned(userId, activityId);
    const safeLimit = [10, 20, 50].includes(limit) ? limit : 10;
    return {
      activity,
      responses: this.repository.listResponses(activityId),
      results: this.repository.getResults(activity),
      analytics: this.repository.analytics(activityId, range, timezoneOffsetMinutes, safeLimit)
    };
  }

  getPublic(
    slug: string,
    participantToken?: string,
    deferResults = false,
    requestMeta?: { ip?: string; userAgent?: string; referrer?: string; language?: string }
  ) {
    const activity = this.repository.findBySlugRuntime(slug);
    if (!activity) throw new Error('Activity not found.');
    this.requireNotExpired(activity);
    if (requestMeta?.ip) {
      setImmediate(() => {
        try {
          const parser = new UAParser(requestMeta.userAgent);
          const browser = parser.getBrowser();
          const os = parser.getOS();
          this.repository.recordView({
            activityId: activity.id,
            visitorHash: hmacSha256(config.ipHashSecret, requestMeta.ip!),
            deviceType: parser.getDevice().type ?? 'desktop',
            browser: browser.name || 'Unknown',
            os: normalizeOsLabel(os.name, os.version),
            referrer: humanReferrer(requestMeta.referrer),
            language: requestMeta.language?.split(',')[0]?.trim() || null,
            rawIp: config.storeRawIp ? requestMeta.ip! : null
          });
        } catch (error) {
          logger.error({ activityId: activity.id, err: error }, 'Live view analytics write failed');
        }
      });
    }
    return this.toPublicActivity(activity, participantToken, activity.publicResults && !deferResults);
  }

  cleanupAnalytics() {
    const cutoff = new Date(Date.now() - config.analyticsRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    return this.repository.cleanupViews(cutoff);
  }

  getPresentation(slug: string) {
    const activity = this.repository.findBySlugRuntime(slug);
    if (!activity) throw new Error('Activity not found.');
    this.requireNotExpired(activity);
    return this.toPublicActivity(activity, undefined, true);
  }

  private toPublicActivity(
    activity: LiveActivitySummary,
    participantToken: string | undefined,
    includeResults: boolean
  ) {
    return {
      id: activity.id,
      slug: activity.slug,
      publicUrl: activity.publicUrl,
      title: activity.title,
      question: activity.question,
      type: activity.type,
      status: activity.status,
      identityMode: activity.identityMode,
      allowMultipleResponses: activity.allowMultipleResponses,
      maxResponsesPerParticipant: activity.maxResponsesPerParticipant,
      maxAnswerLength: activity.maxAnswerLength,
      allowMultipleChoices: activity.allowMultipleChoices,
      options: activity.options,
      scaleMin: activity.scaleMin,
      scaleMax: activity.scaleMax,
      publicResults: activity.publicResults,
      participantResponseCount: participantToken
        ? this.repository.getParticipantResponseCount(activity.id, participantToken)
        : 0,
      results: includeResults ? this.getPublicSnapshot(activity) : null
    };
  }

  getPublicResults(slug: string) {
    const activity = this.repository.findBySlugRuntime(slug);
    if (!activity) throw new Error('Activity not found.');
    this.requireNotExpired(activity);
    if (!activity.publicResults) throw new Error('Results are not public.');
    return this.getPublicSnapshot(activity);
  }

  getResultsForActivityId(activityId: string) {
    const activity = this.repository.findByIdRuntime(activityId);
    if (!activity) throw new Error('Activity not found.');
    return this.getPublicSnapshot(activity);
  }

  getParticipantResponseCount(activityId: string, participantToken: string) {
    return this.repository.getParticipantResponseCount(activityId, participantToken);
  }

  listPublicOpenAnswers(slug: string, cursor?: string, requestedLimit?: number) {
    const activity = this.requirePublicResultsActivity(slug, 'open_answer');
    const limit = this.normalizePageLimit(requestedLimit);
    const before = cursor ? this.decodeAnswerCursor(cursor) : undefined;
    const rows = this.repository.listApprovedOpenAnswers(activity.id, limit, before);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url')
        : null,
      total: activity.approvedCount
    };
  }

  listPublicWordCloud(slug: string, cursor?: string, requestedLimit?: number, search?: string) {
    const activity = this.requirePublicResultsActivity(slug, 'word_cloud');
    const limit = this.normalizePageLimit(requestedLimit);
    const offset = cursor ? this.decodeOffsetCursor(cursor) : 0;
    const needle = normalizedMatchText(String(search ?? ''));
    const all = this.repository
      .listApprovedWordCloud(activity.id)
      .filter((item) => !needle || normalizedMatchText(item.text).includes(needle));
    const items = all.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      nextCursor: nextOffset < all.length ? Buffer.from(String(nextOffset)).toString('base64url') : null,
      total: all.length
    };
  }

  findBySlug(slug: string) {
    return this.repository.findBySlugRuntime(slug);
  }

  isExpired(expiresAt: string | null) {
    return Boolean(expiresAt && expiresAt <= nowIso());
  }

  private requireNotExpired(activity: Pick<LiveActivitySummary, 'expiresAt'>) {
    if (this.isExpired(activity.expiresAt)) throw new Error('This activity has expired.');
  }

  submit(slug: string, raw: {
    participantToken?: string;
    participantName?: string;
    text?: string;
    optionIds?: string[];
    scaleValue?: number;
  }) {
    const activity = this.repository.findBySlugRuntime(slug);
    if (!activity) throw new Error('Activity not found.');
    this.requireNotExpired(activity);
    if (activity.status !== 'active') throw new Error('This activity is closed.');
    const participantToken = String(raw.participantToken ?? '');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(participantToken)) {
      throw new Error('A valid participant identifier is required.');
    }
    const participantName = activity.identityMode === 'named'
      ? normalizedText(String(raw.participantName ?? ''))
      : null;
    if (activity.identityMode === 'named' && (!participantName || participantName.length > 80)) {
      throw new Error('Participant name must contain between 1 and 80 characters.');
    }

    let originalText: string | null = null;
    let publishedText: string | null = null;
    let selectedOptionIds: string[] = [];
    let scaleValue: number | null = null;
    let moderationStatus: LiveResponseStatus = 'approved';
    let moderationReason: string | null = null;

    if (activity.type === 'open_answer' || activity.type === 'word_cloud') {
      originalText = normalizedText(String(raw.text ?? ''));
      if (!originalText || originalText.length > activity.maxAnswerLength) {
        throw new Error(`Answer must contain between 1 and ${activity.maxAnswerLength} characters.`);
      }
      publishedText = originalText;
    } else if (activity.type === 'multiple_choice') {
      selectedOptionIds = [...new Set(Array.isArray(raw.optionIds) ? raw.optionIds.map(String) : [])];
      const allowed = new Set(activity.options.map((option) => option.id));
      if (!selectedOptionIds.length || selectedOptionIds.some((id) => !allowed.has(id))) {
        throw new Error('Select a valid answer option.');
      }
      if (!activity.allowMultipleChoices && selectedOptionIds.length !== 1) {
        throw new Error('Only one option can be selected.');
      }
    } else {
      scaleValue = Number(raw.scaleValue);
      if (
        !Number.isInteger(scaleValue) ||
        activity.scaleMin === null ||
        activity.scaleMax === null ||
        scaleValue < activity.scaleMin ||
        scaleValue > activity.scaleMax
      ) {
        throw new Error('Select a valid scale value.');
      }
    }

    if (activity.moderationMode !== 'off') {
      const ownerId = this.repository.getOwnerId(activity.id)!;
      const nameMatch = participantName ? this.findRuleMatch(ownerId, participantName) : null;
      const answerMatch = originalText ? this.findRuleMatch(ownerId, originalText) : null;
      const matchReasons = [
        nameMatch ? `Participant name matched ban rule: ${nameMatch.pattern}` : null,
        answerMatch ? `Answer matched ban rule: ${answerMatch.pattern}` : null
      ].filter((reason): reason is string => Boolean(reason));
      const reviewTextAnswer = activity.moderationMode === 'review_all' && originalText !== null;
      if (matchReasons.length > 0 || reviewTextAnswer) {
        moderationStatus = 'pending';
        moderationReason = matchReasons.join('; ') || 'Manual review required.';
      }
    }

    return this.repository.submitResponse({
      activityId: activity.id,
      participantToken,
      participantName,
      originalText,
      publishedText,
      selectedOptionIds,
      scaleValue,
      moderationStatus,
      moderationReason
    });
  }

  moderate(userId: string, activityId: string, responseId: string, input: {
    status?: LiveResponseStatus;
    publishedText?: string | null;
    participantName?: string | null;
    confirmRuleMatch?: boolean;
  }) {
    const activity = this.getOwned(userId, activityId);
    const response = this.repository.getResponse(responseId);
    if (!response || response.activityId !== activityId) throw new Error('Response not found.');
    const status = String(input.status ?? '') as LiveResponseStatus;
    if (!responseStatuses.has(status)) throw new Error('Invalid moderation status.');
    let publishedText = response.publishedText;
    if (response.originalText !== null) {
      publishedText = normalizedText(String(input.publishedText ?? response.publishedText ?? response.originalText));
      if (!publishedText) throw new Error('Published text cannot be empty.');
      if (publishedText.length > activity.maxAnswerLength) throw new Error('Published text is too long.');
      const match = this.findRuleMatch(userId, publishedText);
      if (status === 'approved' && match && !input.confirmRuleMatch) {
        throw new Error(`Edited text still matches ban rule: ${match.pattern}. Confirm to approve.`);
      }
    }
    let participantName = response.participantName;
    if (activity.identityMode === 'named') {
      participantName = normalizedText(String(input.participantName ?? response.participantName ?? response.originalParticipantName));
      if (!participantName || participantName.length > 80) {
        throw new Error('Participant name must contain between 1 and 80 characters.');
      }
    } else {
      participantName = null;
    }
    const participantNameMatch = participantName
      ? this.findRuleMatch(userId, participantName)
      : null;
    if (status === 'approved' && participantNameMatch && !input.confirmRuleMatch) {
      throw new Error(`Participant name still matches ban rule: ${participantNameMatch.pattern}. Confirm to approve.`);
    }
    return this.repository.moderateResponse(responseId, userId, status, publishedText, participantName, null)!;
  }

  listRules(userId: string) {
    const rules = this.repository.listModerationRules(userId);
    this.moderationRuleCache.set(userId, rules);
    return rules;
  }

  createRule(userId: string, pattern: string, matchMode: ModerationMatchMode) {
    const validated = this.validateRule(pattern, matchMode);
    const result = this.repository.createModerationRule(userId, validated.pattern, validated.matchMode);
    this.moderationRuleCache.delete(userId);
    return result;
  }

  updateRule(userId: string, id: string, pattern: string, matchMode: ModerationMatchMode) {
    const validated = this.validateRule(pattern, matchMode);
    const result = this.repository.updateModerationRule(id, userId, validated.pattern, validated.matchMode);
    if (!result) throw new Error('Moderation rule not found.');
    this.moderationRuleCache.delete(userId);
    return result;
  }

  deleteRule(userId: string, id: string) {
    if (!this.repository.deleteModerationRule(id, userId)) throw new Error('Moderation rule not found.');
    this.moderationRuleCache.delete(userId);
  }

  private validateRule(pattern: string, matchMode: ModerationMatchMode) {
    const cleanPattern = normalizedText(String(pattern ?? ''));
    if (!cleanPattern || cleanPattern.length > 120) throw new Error('Rule must contain between 1 and 120 characters.');
    if (!matchModes.has(matchMode)) throw new Error('Invalid match mode.');
    return { pattern: cleanPattern, matchMode };
  }

  private findRuleMatch(userId: string, text: string) {
    const normalized = normalizedMatchText(text);
    let rules = this.moderationRuleCache.get(userId);
    if (!rules) {
      rules = this.repository.listModerationRules(userId);
      this.moderationRuleCache.set(userId, rules);
    }
    return rules.find((rule) => {
      const pattern = normalizedMatchText(rule.pattern);
      if (rule.matchMode === 'contains') return normalized.includes(pattern);
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(pattern)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalized);
    });
  }

  private getPublicSnapshot(activity: LiveActivitySummary): LiveResultsSnapshot {
    return this.repository.getResults(activity, {
      openAnswerLimit: LIVE_PUBLIC_OPEN_ANSWER_LIMIT,
      wordCloudLimit: LIVE_PUBLIC_WORD_CLOUD_LIMIT
    });
  }

  private requirePublicResultsActivity(slug: string, type: LiveActivitySummary['type']) {
    const activity = this.repository.findBySlug(slug);
    if (!activity) throw new Error('Activity not found.');
    this.requireNotExpired(activity);
    if (!activity.publicResults) throw new Error('Results are not public.');
    if (activity.type !== type) throw new Error('This result view is not available for the activity type.');
    return activity;
  }

  private normalizePageLimit(value?: number) {
    const parsed = Number(value ?? 50);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error('Invalid page limit.');
    return Math.min(parsed, LIVE_PUBLIC_PAGE_LIMIT);
  }

  private decodeAnswerCursor(cursor: string) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
      if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string' || parsed.id.length > 128) throw new Error();
      if (Number.isNaN(Date.parse(parsed.createdAt))) throw new Error();
      return { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      throw new Error('Invalid pagination cursor.');
    }
  }

  private decodeOffsetCursor(cursor: string) {
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid pagination cursor.');
    return value;
  }

  private validateActivityInput(raw: LiveActivityInput): LiveActivityInput {
    const title = normalizedText(String(raw.title ?? ''));
    const question = normalizedText(String(raw.question ?? ''));
    if (!title || title.length > 120) throw new Error('Title must contain between 1 and 120 characters.');
    if (!question || question.length > 500) throw new Error('Question must contain between 1 and 500 characters.');
    if (!activityTypes.has(raw.type)) throw new Error('Invalid activity type.');
    if (!identityModes.has(raw.identityMode)) throw new Error('Invalid participant identity mode.');
    if (!activityStatuses.has(raw.status)) throw new Error('Invalid activity status.');
    if (!moderationModes.has(raw.moderationMode)) throw new Error('Invalid moderation mode.');
    const maxResponses = raw.allowMultipleResponses ? Number(raw.maxResponsesPerParticipant) : 1;
    if (!Number.isInteger(maxResponses) || maxResponses < 1 || maxResponses > 100) {
      throw new Error('Maximum responses must be between 1 and 100.');
    }
    const maxAnswerLength = Number(raw.maxAnswerLength);
    if (!Number.isInteger(maxAnswerLength) || maxAnswerLength < 1 || maxAnswerLength > 2000) {
      throw new Error('Maximum answer length must be between 1 and 2000.');
    }
    let options: string[] = [];
    if (raw.type === 'multiple_choice') {
      options = (raw.options ?? []).map((option) => normalizedText(String(option))).filter(Boolean);
      if (options.length < 2 || options.length > 12) throw new Error('Multiple choice requires between 2 and 12 options.');
      if (options.some((option) => option.length > 120)) throw new Error('Choice labels cannot exceed 120 characters.');
      if (new Set(options.map(normalizedMatchText)).size !== options.length) throw new Error('Choice labels must be unique.');
    }
    let scaleMin: number | undefined;
    let scaleMax: number | undefined;
    if (raw.type === 'scale') {
      scaleMin = Number(raw.scaleMin);
      scaleMax = Number(raw.scaleMax);
      if (
        !Number.isInteger(scaleMin) || !Number.isInteger(scaleMax) ||
        scaleMin < -10 || scaleMax > 100 || scaleMax <= scaleMin || scaleMax - scaleMin > 20
      ) {
        throw new Error('Scale must be ascending, stay between -10 and 100, and contain at most 21 values.');
      }
    }
    return {
      title,
      question,
      type: raw.type,
      slug: raw.slug,
      status: raw.status,
      identityMode: raw.identityMode,
      allowMultipleResponses: Boolean(raw.allowMultipleResponses),
      maxResponsesPerParticipant: maxResponses,
      moderationMode: raw.type === 'open_answer' || raw.type === 'word_cloud' || raw.identityMode === 'named'
        ? raw.moderationMode
        : 'off',
      maxAnswerLength,
      allowMultipleChoices: raw.type === 'multiple_choice' && Boolean(raw.allowMultipleChoices),
      options,
      scaleMin,
      scaleMax,
      publicResults: raw.publicResults !== false,
      expirationValue: raw.expirationValue,
      expirationUnit: raw.expirationUnit
    };
  }
}
