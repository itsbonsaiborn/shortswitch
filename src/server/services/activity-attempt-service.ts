import crypto from 'node:crypto';
import type {
  ActivityQuestionPublicConfig,
  ActivitySupportedAnswer,
  PublicActivityAttempt
} from '@/shared/activity-types.js';
import { matchesModerationRule, normalizeWordCloudText } from '../domain/activity-text-grading.js';
import { parseActivityPluginResponse } from '../domain/activity-grading-engine.js';
import { ActivityAttemptRepository } from '../repositories/activity-attempt-repository.js';

const hashSecret = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const cleanName = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export class ActivityAttemptService {
  constructor(private readonly repository = new ActivityAttemptRepository()) {}

  getLanding(slug: string) {
    return this.repository.findLanding(slug);
  }

  start(slug: string, input: { participantKey?: unknown; participantName?: unknown }) {
    const landing = this.repository.findLanding(slug);
    if (!landing) throw new Error('Activity not found.');
    if (landing.status !== 'active') throw new Error('Activity is closed.');
    const participantKey = cleanName(input.participantKey);
    if (participantKey.length < 20 || participantKey.length > 200 || !/^[A-Za-z0-9_-]+$/.test(participantKey)) {
      throw new Error('Participant key is invalid.');
    }
    const participantName = cleanName(input.participantName);
    if (landing.identityMode === 'named' && (participantName.length < 1 || participantName.length > 80)) {
      throw new Error('Participant name is required and must be at most 80 characters.');
    }
    const attemptToken = crypto.randomBytes(32).toString('base64url');
    const attemptId = this.repository.startAttempt({
      landing,
      participantTokenHash: hashSecret(`${landing.activityId}:${participantKey}`),
      participantName: landing.identityMode === 'named' ? participantName : null,
      accessTokenHash: hashSecret(attemptToken)
    });
    const attempt = this.repository.getAttempt(attemptId, hashSecret(attemptToken));
    if (!attempt) throw new Error('Attempt could not be created.');
    return { attemptId, attemptToken, attempt };
  }

  get(attemptId: string, attemptToken: string, expectedSlug?: string) {
    const attempt = this.repository.getAttempt(attemptId, hashSecret(attemptToken));
    if (!attempt) throw new Error('Attempt not found.');
    if (expectedSlug && attempt.slug !== expectedSlug) throw new Error('Attempt not found.');
    return attempt;
  }

  saveAnswer(slug: string, attemptId: string, attemptToken: string, questionBlockId: string, input: { answer?: unknown; clientRevision?: unknown }) {
    const activeAttempt = this.get(attemptId, attemptToken, slug);
    if (activeAttempt.status !== 'in_progress') throw new Error('Attempt is finalized.');
    const question = this.repository.getQuestion(attemptId, hashSecret(attemptToken), questionBlockId);
    if (!question) throw new Error('Question or active attempt not found.');
    const clientRevision = Number(input.clientRevision);
    if (!Number.isInteger(clientRevision) || clientRevision < 1 || clientRevision > 1_000_000_000) {
      throw new Error('Answer revision is invalid.');
    }
    const parsedConfig = JSON.parse(question.configJson) as ActivityQuestionPublicConfig;
    const config: ActivityQuestionPublicConfig = parsedConfig.questionType === 'image_labeling'
      ? { ...parsedConfig, oneToOne: parsedConfig.oneToOne ?? true, gradingMode: parsedConfig.gradingMode ?? 'all_or_nothing' }
      : parsedConfig;
    const answer = this.validateAnswer(config, input.answer);
    if (this.isEmptyAnswer(answer)) {
      return this.repository.clearAnswer({
        attemptId,
        tokenHash: hashSecret(attemptToken),
        questionBlockId,
        clientRevision
      });
    }
    let moderationStatus: 'approved' | 'pending' = 'approved';
    let moderationReason: string | null = null;
    if (config.questionType === 'word_cloud' && answer.questionType === 'word_cloud' && config.moderationMode !== 'off') {
      const responses = 'responses' in answer ? answer.responses : [answer.text];
      if (config.moderationMode === 'review_all') {
        moderationStatus = 'pending';
        moderationReason = 'Manual review required.';
      } else {
        const rules = this.repository.getModerationRules(attemptId, hashSecret(attemptToken));
        if (responses.some((response) => matchesModerationRule(response, rules))) {
          moderationStatus = 'pending';
          moderationReason = 'Response matched a moderation rule.';
        }
      }
    }
    return this.repository.saveAnswer({
      attemptId,
      tokenHash: hashSecret(attemptToken),
      questionBlockId,
      answer,
      clientRevision,
      moderationStatus,
      moderationReason
    });
  }

  navigate(slug: string, attemptId: string, attemptToken: string, targetSlideId: unknown) {
    this.get(attemptId, attemptToken, slug);
    if (typeof targetSlideId !== 'string' || !targetSlideId) throw new Error('Target slide is required.');
    this.repository.navigate(attemptId, hashSecret(attemptToken), targetSlideId);
    return this.get(attemptId, attemptToken, slug);
  }

  submit(slug: string, attemptId: string, attemptToken: string): PublicActivityAttempt {
    this.get(attemptId, attemptToken, slug);
    this.repository.submit(attemptId, hashSecret(attemptToken));
    return this.get(attemptId, attemptToken, slug);
  }

  expireDueAttempts() {
    return this.repository.expireDueAttempts();
  }

  listAdminAttempts(userId: string, activityId: string) {
    return this.repository.listAdminAttempts(userId, activityId);
  }

  getAdminResults(userId: string, activityId: string, raw: Record<string, unknown>) {
    const page = Number(raw.page ?? 1);
    const pageSize = Number(raw.pageSize ?? 20);
    if (!Number.isInteger(page) || page < 1) throw new Error('Page must be a positive integer.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Page size must be between 1 and 100.');
    const search = typeof raw.search === 'string' ? raw.search.trim().slice(0, 120) : '';
    const status = typeof raw.status === 'string' ? raw.status : 'all';
    if (!['all', 'submitted', 'expired'].includes(status)) throw new Error('Attempt status filter is invalid.');
    const gradingState = typeof raw.gradingState === 'string' ? raw.gradingState : 'all';
    if (!['all', 'submitted', 'expired', 'awaiting_manual_grading', 'fully_graded'].includes(gradingState)) {
      throw new Error('Grading state filter is invalid.');
    }
    return this.repository.getAdminResults(userId, activityId, {
      page,
      pageSize,
      search,
      status: status as 'all' | 'submitted' | 'expired',
      gradingState: gradingState as 'all' | 'submitted' | 'expired' | 'awaiting_manual_grading' | 'fully_graded'
    });
  }

  iterateAttemptExport(userId: string, activityId: string) {
    return this.repository.iterateAttemptExport(userId, activityId);
  }

  iterateResponseExport(userId: string, activityId: string) {
    return this.repository.iterateResponseExport(userId, activityId);
  }

  getAdminAttempt(userId: string, activityId: string, attemptId: string) {
    return this.repository.getAdminAttemptDetail(userId, activityId, attemptId);
  }

  deleteAdminAttempt(userId: string, activityId: string, attemptId: string) {
    return this.repository.deleteAdminAttempt(userId, activityId, attemptId);
  }

  gradeManualResponse(userId: string, activityId: string, attemptId: string, questionBlockId: string, input: { awardedPoints?: unknown; teacherFeedback?: unknown }) {
    const awardedPoints = Number(input.awardedPoints);
    if (!Number.isFinite(awardedPoints) || awardedPoints < 0 || Math.round(awardedPoints * 1000) !== awardedPoints * 1000) {
      throw new Error('Awarded points must use at most three decimal places.');
    }
    const teacherFeedback = typeof input.teacherFeedback === 'string' ? input.teacherFeedback.trim() : '';
    if (teacherFeedback.length > 4000) throw new Error('Teacher feedback must be at most 4000 characters.');
    return this.repository.gradeManualResponse({
      userId,
      activityId,
      attemptId,
      questionBlockId,
      awardedUnits: Math.round(awardedPoints * 1000),
      teacherFeedback
    });
  }

  moderateResponse(userId: string, activityId: string, attemptId: string, questionBlockId: string, input: { status?: unknown }) {
    if (input.status !== 'approved' && input.status !== 'rejected') throw new Error('Moderation status must be approved or rejected.');
    return this.repository.moderateResponse({ userId, activityId, attemptId, questionBlockId, status: input.status });
  }

  releaseResults(userId: string, activityId: string, attemptId: string) {
    return this.repository.releaseResults(userId, activityId, attemptId);
  }

  extendIndividualDeadline(userId: string, activityId: string, attemptId: string, additionalMinutes: unknown) {
    const minutes = Number(additionalMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) {
      throw new Error('Extension must be between 1 and 10080 minutes.');
    }
    return this.repository.extendIndividualDeadline(userId, activityId, attemptId, minutes * 60);
  }

  private isEmptyAnswer(answer: ActivitySupportedAnswer) {
    if (answer.questionType === 'single_choice') return answer.optionId === null;
    if (answer.questionType === 'multiple_choice') return answer.optionIds.length === 0;
    if (answer.questionType === 'open_answer') return answer.text.trim().length === 0;
    if (answer.questionType === 'word_cloud') return ('responses' in answer ? answer.responses : [answer.text]).every((value) => !value.trim());
    if (answer.questionType === 'matching') return answer.pairs.length === 0;
    if (answer.questionType === 'image_labeling') return answer.assignments.length === 0;
    return false;
  }

  private validateAnswer(config: ActivityQuestionPublicConfig, value: unknown): ActivitySupportedAnswer {
    const parsed = parseActivityPluginResponse(config.questionType, value);
    const answer = parsed as unknown as Record<string, unknown>;
    if (answer.questionType !== config.questionType) throw new Error('Answer type does not match the question.');
    if (config.questionType === 'single_choice') {
      const optionId = answer.optionId === null ? null : typeof answer.optionId === 'string' ? answer.optionId : '';
      if (optionId === null) return { questionType: 'single_choice', optionId: null };
      if (!config.options.some((option) => option.id === optionId)) throw new Error('Selected option is invalid.');
      return { questionType: 'single_choice', optionId };
    }
    if (config.questionType === 'multiple_choice') {
      if (!Array.isArray(answer.optionIds) || answer.optionIds.some((id) => typeof id !== 'string')) throw new Error('Selected options are invalid.');
      const optionIds = [...new Set(answer.optionIds as string[])];
      const valid = new Set(config.options.map((option) => option.id));
      if (!optionIds.length) return { questionType: 'multiple_choice', optionIds };
      if (optionIds.length < config.minimumSelections || optionIds.length > config.maximumSelections || optionIds.some((id) => !valid.has(id))) {
        throw new Error('Selected options do not satisfy the question rules.');
      }
      return { questionType: 'multiple_choice', optionIds };
    }
    if (config.questionType === 'open_answer') {
      const text = typeof answer.text === 'string' ? answer.text : '';
      const meaningfulLength = text.trim().length;
      if (meaningfulLength > 0 && meaningfulLength < config.minimumLength) {
        throw new Error(`Answer must contain at least ${config.minimumLength} characters.`);
      }
      if (text.length > config.maximumLength) throw new Error(`Answer must contain at most ${config.maximumLength} characters.`);
      return { questionType: 'open_answer', text };
    }
    if (config.questionType === 'word_cloud') {
      const rawResponses = Array.isArray(answer.responses)
        ? answer.responses
        : typeof answer.text === 'string' ? [answer.text] : [];
      if (rawResponses.some((entry) => typeof entry !== 'string')) throw new Error('Word Cloud responses are invalid.');
      const responses = (rawResponses as string[]).map(normalizeWordCloudText).filter(Boolean);
      const maximumResponses = config.allowMultipleResponses ? config.maximumResponses : 1;
      if (responses.length > maximumResponses) throw new Error(`No more than ${maximumResponses} responses are allowed.`);
      if (responses.some((text) => text.length > config.maximumLength)) {
        throw new Error(`Each response must contain at most ${config.maximumLength} characters.`);
      }
      return { questionType: 'word_cloud', responses };
    }
    if (config.questionType === 'ordering') {
      if (!Array.isArray(answer.orderedItemIds) || answer.orderedItemIds.some((id) => typeof id !== 'string')) throw new Error('Ordered items are invalid.');
      const orderedItemIds = answer.orderedItemIds as string[];
      const validIds = new Set(config.items.map((item) => item.id));
      if (orderedItemIds.length !== config.items.length || new Set(orderedItemIds).size !== orderedItemIds.length || orderedItemIds.some((id) => !validIds.has(id))) {
        throw new Error('Ordered items must contain every item exactly once.');
      }
      return { questionType: 'ordering', orderedItemIds };
    }
    if (config.questionType === 'matching') {
      if (!Array.isArray(answer.pairs) || answer.pairs.some((pair) => !pair || typeof pair !== 'object')) throw new Error('Matching pairs are invalid.');
      const pairs = (answer.pairs as Array<Record<string, unknown>>).map((pair) => ({
        leftId: typeof pair.leftId === 'string' ? pair.leftId : '',
        rightId: typeof pair.rightId === 'string' ? pair.rightId : ''
      }));
      const leftIds = new Set(config.leftItems.map((item) => item.id));
      const rightIds = new Set(config.rightItems.map((item) => item.id));
      const usedLeft = new Set(pairs.map((pair) => pair.leftId));
      const usedRight = new Set(pairs.map((pair) => pair.rightId));
      if (usedLeft.size !== pairs.length || usedRight.size !== pairs.length || pairs.some((pair) => !leftIds.has(pair.leftId) || !rightIds.has(pair.rightId))) {
        throw new Error('Each matching item may be connected only once.');
      }
      return { questionType: 'matching', pairs };
    }
    if (config.questionType === 'image_labeling') {
      if (!Array.isArray(answer.assignments) || answer.assignments.some((assignment) => !assignment || typeof assignment !== 'object')) throw new Error('Image label assignments are invalid.');
      const assignments = (answer.assignments as Array<Record<string, unknown>>).map((assignment) => ({
        markerId: typeof assignment.markerId === 'string' ? assignment.markerId : '',
        labelId: typeof assignment.labelId === 'string' ? assignment.labelId : ''
      }));
      const markerIds = new Set(config.markers.map((marker) => marker.id));
      const labelIds = new Set(config.labels.map((label) => label.id));
      const usedMarkers = new Set(assignments.map((assignment) => assignment.markerId));
      const usedLabels = new Set(assignments.map((assignment) => assignment.labelId));
      if (usedMarkers.size !== assignments.length || (config.oneToOne && usedLabels.size !== assignments.length) || assignments.some((assignment) => !markerIds.has(assignment.markerId) || !labelIds.has(assignment.labelId))) {
        throw new Error('Each image marker and label may be connected only as configured.');
      }
      return { questionType: 'image_labeling', assignments };
    }
    throw new Error('This question type is not available in the student player yet.');
  }
}
