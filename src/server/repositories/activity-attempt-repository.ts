import type { DatabaseSync } from 'node:sqlite';
import type {
  ActivityAdminAttempt,
  ActivityAdminAttemptDetail,
  ActivityAdminResults,
  ActivityQuestionPublicConfig,
  ActivityQuestionType,
  ActivitySettings,
  ActivitySlide,
  ActivitySupportedAnswer,
  PublicActivityAttempt,
  PublicActivityLanding,
  SlideBlock
} from '@/shared/activity-types.js';
import { earliestActivityDeadline } from '../../shared/activity-deadline.js';
import { getDb } from '../db.js';
import { stableShuffleOptions } from '../domain/activity-choice-grading.js';
import { aggregateWordCloud, normalizeWordCloudText } from '../domain/activity-text-grading.js';
import {
  activityQuestionFeedback,
  gradeActivityQuestion,
  pointsToUnits,
  resolveActivityResultDisclosure,
  serializeActivityQuestionPublicConfig,
  serializeActivityCorrectAnswer,
  unitsToPoints
} from '../domain/activity-grading-engine.js';
import { createId, nowIso } from '../utils.js';
import { normalizeStoredActivitySettings } from '../domain/activity-domain.js';

interface PublishedActivityRow {
  activityId: string;
  slug: string;
  status: 'active' | 'closed';
  versionId: string;
  versionNumber: number;
  settingsJson: string;
  publishedAt: string;
  archivedAt: string | null;
}

interface AttemptRow {
  id: string;
  activityId: string;
  slug: string;
  publishedVersionId: string;
  versionNumber: number;
  settingsJson: string;
  participantName: string | null;
  status: PublicActivityAttempt['status'];
  startedAt: string;
  deadlineAt: string | null;
  individualDeadlineAt: string | null;
  globalDeadlineAt: string | null;
  submittedAt: string | null;
  submissionReason: 'manual' | 'deadline' | null;
  currentSlideId: string | null;
  revision: number;
  activityStatus: 'active' | 'closed';
  score: number | null;
  maximumScore: number;
  scoreUnits: number | null;
  maximumScoreUnits: number;
  gradingState: PublicActivityAttempt['gradingState'];
  resultsReleasedAt: string | null;
}

interface QuestionRow {
  id: string;
  questionType: ActivityQuestionType;
  required: number;
  configJson: string;
}

interface AdminAttemptRow {
  id: string;
  participantName: string | null;
  attemptNumber: number;
  status: PublicActivityAttempt['status'];
  startedAt: string;
  individualDeadlineAt: string | null;
  globalDeadlineAt: string | null;
  effectiveDeadlineAt: string | null;
  deadlineExtendedAt: string | null;
  deadlineExtendedSeconds: number;
  submittedAt: string | null;
  submissionReason: 'manual' | 'deadline' | null;
  lastSavedAt: string | null;
  score: number | null;
  maximumScore: number;
  scoreUnits: number | null;
  maximumScoreUnits: number;
  gradingState: PublicActivityAttempt['gradingState'];
  pendingManualGrading: number;
  resultsReleasedAt: string | null;
  durationSeconds: number;
}

const publishedActivitySql = `
  SELECT a.id as activityId, a.slug, a.status, v.id as versionId,
         v.version_number as versionNumber, v.settings_json as settingsJson,
         v.published_at as publishedAt, m.archived_at as archivedAt
  FROM live_activities a
  INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
  INNER JOIN activity_versions v ON v.id = m.published_version_id
`;

export class ActivityAttemptRepository {
  constructor(private readonly db: DatabaseSync = getDb()) {}

  private gradeAttempt(attemptId: string, versionId: string, timestamp: string) {
    const rows = this.db.prepare(
      `SELECT b.id, b.question_type as questionType, b.is_graded as graded,
              COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) as maximumUnits,
              b.public_config_json as configJson,
              k.key_json as keyJson, r.answer_json as answerJson,
              r.moderation_status as moderationStatus
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       LEFT JOIN activity_version_question_keys k ON k.block_id = b.id
       LEFT JOIN activity_attempt_responses r ON r.attempt_id = ? AND r.question_block_id = b.id
       LEFT JOIN activity_attempt_question_points p ON p.attempt_id = ? AND p.question_block_id = b.id
       WHERE s.version_id = ? AND b.block_type = 'question'`
    ).all(attemptId, attemptId, versionId) as unknown as Array<{
      id: string; questionType: ActivityQuestionType; graded: number; maximumUnits: number;
      configJson: string; keyJson: string | null; answerJson: string | null;
      moderationStatus: 'approved' | 'pending' | 'rejected' | null;
    }>;
    let scoreUnits = 0;
    let manualReview = false;
    for (const row of rows) {
      if (!row.answerJson) continue;
      const answer = JSON.parse(row.answerJson) as ActivitySupportedAnswer;
      const key = row.keyJson ? JSON.parse(row.keyJson) as Record<string, unknown> : {};
      const parsedConfig = JSON.parse(row.configJson) as ActivityQuestionPublicConfig;
      const config = parsedConfig.questionType === 'image_labeling'
        ? { ...parsedConfig, oneToOne: parsedConfig.oneToOne ?? true, gradingMode: parsedConfig.gradingMode ?? 'all_or_nothing' as const }
        : parsedConfig;
      const result = gradeActivityQuestion({
        questionType: row.questionType,
        config,
        answer,
        key,
        maximumUnits: Number(row.maximumUnits),
        graded: Boolean(row.graded),
        moderationStatus: row.moderationStatus ?? 'approved'
      });
      if (result.status === 'manual_review') {
        manualReview = true;
        this.db.prepare("UPDATE activity_attempt_responses SET grading_status = 'manual_review', awarded_points = NULL, awarded_points_units = NULL, grading_details_json = ? WHERE attempt_id = ? AND question_block_id = ?")
          .run(JSON.stringify(result.details), attemptId, row.id);
      } else {
        const awardedUnits = result.awardedUnits ?? 0;
        scoreUnits += awardedUnits;
        this.db.prepare("UPDATE activity_attempt_responses SET grading_status = 'graded', awarded_points = ?, awarded_points_units = ?, grading_details_json = ? WHERE attempt_id = ? AND question_block_id = ?")
          .run(unitsToPoints(awardedUnits), awardedUnits, JSON.stringify(result.details), attemptId, row.id);
      }
      this.db.prepare(
        `INSERT INTO activity_grading_audit (
          id, attempt_id, question_block_id, action, previous_awarded_units, awarded_units,
          teacher_feedback, actor_user_id, details_json, created_at
        ) VALUES (?, ?, ?, 'automatic', NULL, ?, '', NULL, ?, ?)`
      ).run(createId(), attemptId, row.id, result.awardedUnits, JSON.stringify(result.details), timestamp);
    }
    const score = manualReview ? null : unitsToPoints(scoreUnits);
    this.db.prepare(
      `UPDATE activity_attempts SET score = ?, score_units = ?, grading_revision = grading_revision + 1,
        grading_state = CASE
          WHEN ? = 1 THEN 'awaiting_manual_grading'
          WHEN status IN ('auto_submitted', 'expired') THEN 'expired'
          ELSE 'fully_graded'
        END, updated_at = ? WHERE id = ?`
    ).run(score, manualReview ? null : scoreUnits, manualReview ? 1 : 0, timestamp, attemptId);
  }

  private toAdminAttempt(row: AdminAttemptRow): ActivityAdminAttempt {
    return {
      ...row,
      attemptNumber: Number(row.attemptNumber),
      deadlineExtendedSeconds: Number(row.deadlineExtendedSeconds),
      score: row.score === null ? null : Number(row.score),
      maximumScore: row.maximumScoreUnits ? unitsToPoints(Number(row.maximumScoreUnits)) : Number(row.maximumScore),
      gradingState: row.gradingState,
      pendingManualGrading: Number(row.pendingManualGrading),
      resultsReleasedAt: row.resultsReleasedAt,
      durationSeconds: Math.max(0, Number(row.durationSeconds))
    };
  }

  private adminAttemptSelect() {
    return `SELECT a.id, a.participant_name as participantName, a.attempt_number as attemptNumber,
      a.status, a.started_at as startedAt, a.individual_deadline_at as individualDeadlineAt,
      a.global_deadline_at as globalDeadlineAt, a.deadline_at as effectiveDeadlineAt,
      a.deadline_extended_at as deadlineExtendedAt, a.deadline_extended_seconds as deadlineExtendedSeconds,
      a.submitted_at as submittedAt, a.submission_reason as submissionReason,
      a.last_saved_at as lastSavedAt, a.score, a.maximum_score as maximumScore,
      a.score_units as scoreUnits, a.maximum_score_units as maximumScoreUnits,
      a.grading_state as gradingState, a.results_released_at as resultsReleasedAt,
      CAST(MAX(0, ROUND((julianday(COALESCE(a.submitted_at, a.updated_at)) - julianday(a.started_at)) * 86400)) AS INTEGER) as durationSeconds,
      (SELECT COUNT(*) FROM activity_attempt_responses pending
       WHERE pending.attempt_id = a.id AND pending.grading_status = 'manual_review') as pendingManualGrading
      FROM activity_attempts a INNER JOIN live_activities la ON la.id = a.activity_id`;
  }

  private publishedBySlug(slug: string) {
    return this.db.prepare(`${publishedActivitySql} WHERE a.slug = ?`).get(slug) as PublishedActivityRow | undefined;
  }

  findLanding(slug: string): (PublicActivityLanding & { activityId: string; versionId: string; settings: ActivitySettings }) | undefined {
    const row = this.publishedBySlug(slug);
    if (!row || row.archivedAt) return undefined;
    const settings = normalizeStoredActivitySettings(JSON.parse(row.settingsJson) as ActivitySettings);
    const slideCount = Number((this.db.prepare(
      'SELECT COUNT(*) as count FROM activity_version_slides WHERE version_id = ?'
    ).get(row.versionId) as { count: number }).count);
    return {
      activityId: row.activityId,
      versionId: row.versionId,
      slug: row.slug,
      title: settings.title,
      description: settings.description,
      status: row.status,
      identityMode: settings.identityMode,
      maximumAttempts: settings.maximumAttempts,
      attemptTimeLimitSeconds: settings.attemptTimeLimitSeconds,
      availabilityStartAt: settings.availabilityStartAt,
      submissionDeadlineAt: settings.submissionDeadlineAt,
      submissionDeadlineTimezone: settings.submissionDeadlineTimezone,
      serverNow: nowIso(),
      publishedVersionNumber: Number(row.versionNumber),
      slideCount,
      theme: settings.theme,
      layout: settings.layout,
      backgroundPattern: settings.backgroundPattern,
      patternIntensity: settings.patternIntensity,
      settings
    };
  }

  private orderedSlideRefs(versionId: string, shuffleSeed: string, shuffleSlides: boolean) {
    const slides = this.db.prepare(
      'SELECT id, stable_id as stableId, position FROM activity_version_slides WHERE version_id = ? ORDER BY position'
    ).all(versionId) as unknown as Array<{ id: string; stableId: string; position: number }>;
    return shuffleSlides ? stableShuffleOptions(slides, shuffleSeed, 'activity-slides') : slides;
  }

  private loadSlides(versionId: string, shuffleSeed: string, shuffleAllChoiceOptions: boolean, shuffleSlides: boolean): ActivitySlide[] {
    const slides = this.db.prepare(
      'SELECT id, stable_id as stableId, position, title, description FROM activity_version_slides WHERE version_id = ? ORDER BY position'
    ).all(versionId) as unknown as Array<{ id: string; stableId: string; position: number; title: string; description: string }>;
    const blocks = this.db.prepare(
      `SELECT b.id, b.slide_id as slideId, b.stable_id as stableId, b.position,
              b.block_type as type, b.question_type as questionType, b.is_graded as graded,
              b.points, b.required, b.public_config_json as configJson
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       WHERE s.version_id = ? ORDER BY s.position, b.position`
    ).all(versionId) as unknown as Array<{
      id: string; slideId: string; stableId: string; position: number; type: SlideBlock['type'];
      questionType: ActivityQuestionType | null; graded: number; points: number; required: number; configJson: string;
    }>;
    const bySlide = new Map<string, SlideBlock[]>();
    for (const row of blocks) {
      const parsedConfig = JSON.parse(row.configJson);
      const config = parsedConfig.questionType === 'image_labeling'
        ? { ...parsedConfig, oneToOne: parsedConfig.oneToOne ?? true, gradingMode: parsedConfig.gradingMode ?? 'all_or_nothing' }
        : parsedConfig;
      let publicConfig = row.type === 'question'
        ? serializeActivityQuestionPublicConfig(config as ActivityQuestionPublicConfig)
        : config;
      if ((publicConfig.questionType === 'single_choice' || publicConfig.questionType === 'multiple_choice') && (shuffleAllChoiceOptions || publicConfig.shuffleOptions)) {
        publicConfig = { ...publicConfig, options: stableShuffleOptions(publicConfig.options, shuffleSeed, row.stableId ?? row.id) };
      } else if (publicConfig.questionType === 'ordering' && publicConfig.shuffleItems) {
        publicConfig = { ...publicConfig, items: stableShuffleOptions(publicConfig.items, shuffleSeed, row.stableId ?? row.id) };
      } else if (publicConfig.questionType === 'matching') {
        publicConfig = {
          ...publicConfig,
          leftItems: publicConfig.shuffleLeftItems ? stableShuffleOptions(publicConfig.leftItems, shuffleSeed, `${row.stableId ?? row.id}:left`) : publicConfig.leftItems,
          rightItems: publicConfig.shuffleRightItems ? stableShuffleOptions(publicConfig.rightItems, shuffleSeed, `${row.stableId ?? row.id}:right`) : publicConfig.rightItems
        };
      }
      const block = row.type === 'question'
        ? { id: row.id, stableId: row.stableId, type: 'question' as const, questionType: row.questionType!, graded: Boolean(row.graded), points: Number(row.points), required: Boolean(row.required), config: publicConfig }
        : { id: row.id, stableId: row.stableId, type: row.type, config: publicConfig } as SlideBlock;
      const list = bySlide.get(row.slideId) ?? [];
      list.push(block);
      bySlide.set(row.slideId, list);
    }
    const hydrated = slides.map((slide) => ({ ...slide, position: Number(slide.position), blocks: bySlide.get(slide.id) ?? [] }));
    const orderedIds = this.orderedSlideRefs(versionId, shuffleSeed, shuffleSlides).map((slide) => slide.id);
    const byId = new Map(hydrated.map((slide) => [slide.id, slide]));
    return orderedIds.map((id, position) => ({ ...byId.get(id)!, position }));
  }

  private finalizeExpiredAttemptInTransaction(attemptId: string, now: string) {
    const finalized = this.db.prepare(
      `UPDATE activity_attempts
       SET status = 'auto_submitted', submitted_at = ?, submission_reason = 'deadline', updated_at = ?, revision = revision + 1
       WHERE id = ? AND status = 'in_progress' AND deadline_at IS NOT NULL AND deadline_at <= ?`
    ).run(now, now, attemptId, now);
    this.db.prepare(
      `UPDATE activity_attempt_responses SET finalized_at = ?
       WHERE attempt_id = ? AND finalized_at IS NULL
         AND EXISTS (SELECT 1 FROM activity_attempts a WHERE a.id = ? AND a.status = 'auto_submitted')`
    ).run(now, attemptId, attemptId);
    if (Number(finalized.changes) > 0) {
      const attempt = this.db.prepare('SELECT published_version_id as versionId FROM activity_attempts WHERE id = ?')
        .get(attemptId) as { versionId: string } | undefined;
      if (attempt) this.gradeAttempt(attemptId, attempt.versionId, now);
    }
    return Number(finalized.changes) > 0;
  }

  private attemptRow(attemptId: string, tokenHash: string) {
    return this.db.prepare(
      `SELECT a.id, a.activity_id as activityId, la.slug, a.published_version_id as publishedVersionId,
              v.version_number as versionNumber, v.settings_json as settingsJson,
              a.participant_name as participantName, a.status, a.started_at as startedAt,
              a.deadline_at as deadlineAt, a.individual_deadline_at as individualDeadlineAt,
              a.global_deadline_at as globalDeadlineAt, a.submitted_at as submittedAt,
              a.submission_reason as submissionReason, a.current_slide_id as currentSlideId, a.revision
              , la.status as activityStatus, a.score, a.maximum_score as maximumScore,
              a.score_units as scoreUnits, a.maximum_score_units as maximumScoreUnits,
              a.grading_state as gradingState, a.results_released_at as resultsReleasedAt
       FROM activity_attempts a
       INNER JOIN activity_versions v ON v.id = a.published_version_id AND v.activity_id = a.activity_id
       INNER JOIN live_activities la ON la.id = a.activity_id
       WHERE a.id = ? AND a.access_token_hash = ?`
    ).get(attemptId, tokenHash) as AttemptRow | undefined;
  }

  private getAttemptSnapshot(attemptId: string, tokenHash: string): PublicActivityAttempt | undefined {
    const row = this.attemptRow(attemptId, tokenHash);
    if (!row) return undefined;
    const settings = normalizeStoredActivitySettings(JSON.parse(row.settingsJson) as ActivitySettings);
    const responses = this.db.prepare(
      `SELECT question_block_id as questionBlockId, answer_json as answerJson,
              client_revision as clientRevision, server_revision as serverRevision, saved_at as savedAt
       FROM activity_attempt_responses WHERE attempt_id = ? ORDER BY saved_at`
    ).all(attemptId) as unknown as Array<{ questionBlockId: string; answerJson: string; clientRevision: number; serverRevision: number; savedAt: string }>;
    const { discloseResult, showQuestionPoints, showCorrectAnswers } = resolveActivityResultDisclosure({
      attemptFinalized: row.status !== 'in_progress',
      activityClosed: row.activityStatus === 'closed',
      resultVisibility: settings.resultVisibility,
      feedbackPolicy: settings.feedbackPolicy,
      resultsReleased: Boolean(row.resultsReleasedAt)
    });
    const resultRows = discloseResult && showQuestionPoints ? this.db.prepare(
      `SELECT b.id as questionBlockId,
              COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) / 1000.0 as maximumPoints,
              b.question_type as questionType, b.public_config_json as configJson,
              r.awarded_points as awardedPoints, r.grading_details_json as gradingDetailsJson,
              r.teacher_feedback as teacherFeedback,
              k.key_json as keyJson
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       LEFT JOIN activity_attempt_responses r ON r.attempt_id = ? AND r.question_block_id = b.id
       LEFT JOIN activity_attempt_question_points p ON p.attempt_id = ? AND p.question_block_id = b.id
       LEFT JOIN activity_version_question_keys k ON k.block_id = b.id
       WHERE s.version_id = ? AND b.block_type = 'question' AND b.is_graded = 1
       ORDER BY s.position, b.position`
    ).all(row.id, row.id, row.publishedVersionId) as unknown as Array<{
      questionBlockId: string; maximumPoints: number; questionType: ActivityQuestionType; configJson: string;
      awardedPoints: number | null; gradingDetailsJson: string | null; teacherFeedback: string; keyJson: string | null;
    }> : [];
    const wordClouds = discloseResult ? (this.db.prepare(
      `SELECT b.id as questionBlockId, b.public_config_json as configJson
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       WHERE s.version_id = ? AND b.question_type = 'word_cloud'
       ORDER BY s.position, b.position`
    ).all(row.publishedVersionId) as unknown as Array<{ questionBlockId: string; configJson: string }>).flatMap((block) => {
      const config = JSON.parse(block.configJson) as ActivityQuestionPublicConfig;
      if (config.questionType !== 'word_cloud' || !config.showResults) return [];
      const approved = this.db.prepare(
        `SELECT r.answer_json as answerJson, a.participant_name as participantName
         FROM activity_attempt_responses r
         INNER JOIN activity_attempts a ON a.id = r.attempt_id
         WHERE a.published_version_id = ? AND a.status <> 'in_progress'
           AND r.question_block_id = ? AND r.moderation_status = 'approved'`
      ).all(row.publishedVersionId, block.questionBlockId) as unknown as Array<{ answerJson: string; participantName: string | null }>;
      const values = approved.flatMap((item) => {
        const answer = JSON.parse(item.answerJson) as ActivitySupportedAnswer;
        if (answer.questionType !== 'word_cloud') return [];
        const entries = 'responses' in answer ? answer.responses : [answer.text];
        return entries.map((text) => ({ text, participantName: item.participantName }));
      });
      const aggregate = aggregateWordCloud(values);
      return [{
        questionBlockId: block.questionBlockId,
        totalResponses: aggregate.totalResponses,
        uniqueResponses: aggregate.uniqueResponses,
        items: aggregate.items.map((item) => config.showParticipantNames
          ? item
          : { text: item.text, count: item.count })
      }];
    }) : [];
    return {
      id: row.id,
      activityId: row.activityId,
      slug: row.slug,
      publishedVersionId: row.publishedVersionId,
      publishedVersionNumber: Number(row.versionNumber),
      status: row.status,
      participantName: row.participantName,
      startedAt: row.startedAt,
      serverNow: nowIso(),
      deadlineAt: row.deadlineAt,
      individualDeadlineAt: row.individualDeadlineAt,
      globalDeadlineAt: row.globalDeadlineAt,
      lowTimeWarningSeconds: settings.lowTimeWarningSeconds,
      submittedAt: row.submittedAt,
      submissionReason: row.submissionReason,
      currentSlideId: row.currentSlideId,
      revision: Number(row.revision),
      gradingState: row.gradingState,
      resultsReleasedAt: row.resultsReleasedAt,
      settings: {
        title: settings.title,
        description: settings.description,
        navigationPolicy: settings.navigationPolicy,
        requiredAnswerBehavior: settings.requiredAnswerBehavior,
        resultVisibility: settings.resultVisibility,
        feedbackPolicy: settings.feedbackPolicy,
        theme: settings.theme,
        layout: settings.layout,
        backgroundPattern: settings.backgroundPattern,
        patternIntensity: settings.patternIntensity,
        allowBackNavigation: settings.allowBackNavigation
      },
      slides: this.loadSlides(row.publishedVersionId, row.id, settings.shuffleQuestionOptions, settings.shuffleSlides),
      responses: responses.map((response) => ({
        questionBlockId: response.questionBlockId,
        answer: JSON.parse(response.answerJson) as ActivitySupportedAnswer,
        clientRevision: Number(response.clientRevision),
        serverRevision: Number(response.serverRevision),
        savedAt: response.savedAt
      })),
      result: discloseResult ? {
        score: row.scoreUnits === null ? null : unitsToPoints(Number(row.scoreUnits)),
        maximumScore: row.maximumScoreUnits ? unitsToPoints(Number(row.maximumScoreUnits)) : Number(row.maximumScore),
        questions: resultRows.map((result) => {
          const details = result.gradingDetailsJson ? JSON.parse(result.gradingDetailsJson) as Record<string, unknown> : {};
          const key = result.keyJson ? JSON.parse(result.keyJson) as Record<string, unknown> : {};
          const config = JSON.parse(result.configJson) as ActivityQuestionPublicConfig;
          return {
            questionBlockId: result.questionBlockId,
            awardedPoints: result.awardedPoints === null ? null : Number(result.awardedPoints),
            maximumPoints: Number(result.maximumPoints),
            correct: showCorrectAnswers && typeof details.correct === 'boolean' ? details.correct : null,
            feedback: [result.teacherFeedback, activityQuestionFeedback(result.questionType, key)].filter(Boolean).join('\n'),
            ...(showCorrectAnswers ? { correctAnswer: serializeActivityCorrectAnswer(result.questionType, config, key) } : {})
          };
        }),
        wordClouds
      } : null
    };
  }

  getAttempt(attemptId: string, tokenHash: string): PublicActivityAttempt | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.finalizeExpiredAttemptInTransaction(attemptId, nowIso());
      const result = this.getAttemptSnapshot(attemptId, tokenHash);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  startAttempt(input: {
    landing: NonNullable<ReturnType<ActivityAttemptRepository['findLanding']>>;
    participantTokenHash: string;
    participantName: string | null;
    accessTokenHash: string;
  }) {
    const { landing, participantTokenHash, participantName, accessTokenHash } = input;
    const timestamp = nowIso();
    const attemptId = createId();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.publishedBySlug(landing.slug);
      if (!current || current.versionId !== landing.versionId) throw new Error('Published Activity changed. Please reload.');
      if (current.archivedAt) throw new Error('Activity not found.');
      if (current.status !== 'active') throw new Error('Activity is closed.');
      if (landing.settings.availabilityStartAt && Date.parse(landing.settings.availabilityStartAt) > Date.parse(timestamp)) {
        throw new Error('Activity is not available yet.');
      }
      if (landing.settings.submissionDeadlineAt && Date.parse(landing.settings.submissionDeadlineAt) <= Date.parse(timestamp)) {
        throw new Error('Activity deadline has passed.');
      }
      let participant = this.db.prepare(
        'SELECT id FROM live_participants WHERE activity_id = ? AND participant_token = ?'
      ).get(landing.activityId, participantTokenHash) as { id: string } | undefined;
      if (!participant) {
        participant = { id: createId() };
        this.db.prepare(
          'INSERT INTO live_participants (id, activity_id, participant_token, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(participant.id, landing.activityId, participantTokenHash, participantName, timestamp, timestamp);
      } else {
        this.db.prepare('UPDATE live_participants SET display_name = ?, last_seen_at = ? WHERE id = ?')
          .run(participantName, timestamp, participant.id);
      }
      const attempts = Number((this.db.prepare(
        'SELECT COUNT(*) as count FROM activity_attempts WHERE activity_id = ? AND participant_id = ?'
      ).get(landing.activityId, participant.id) as { count: number }).count);
      if (attempts >= landing.settings.maximumAttempts) throw new Error('Maximum attempts reached for this browser.');
      const firstSlide = this.orderedSlideRefs(landing.versionId, attemptId, landing.settings.shuffleSlides)[0];
      if (!firstSlide) throw new Error('Published Activity has no slides.');
      const maximumScore = Number((this.db.prepare(
        `SELECT COALESCE(SUM(b.points), 0) as score FROM activity_version_blocks b
         INNER JOIN activity_version_slides s ON s.id = b.slide_id
         WHERE s.version_id = ? AND b.block_type = 'question' AND b.is_graded = 1`
      ).get(landing.versionId) as { score: number }).score);
      const maximumScoreUnits = pointsToUnits(maximumScore);
      const timedDeadline = landing.settings.attemptTimeLimitSeconds
        ? new Date(Date.parse(timestamp) + landing.settings.attemptTimeLimitSeconds * 1000).toISOString()
        : null;
      const globalDeadline = landing.settings.submissionDeadlineAt
        ? new Date(landing.settings.submissionDeadlineAt).toISOString()
        : null;
      const deadlineAt = earliestActivityDeadline(timedDeadline, globalDeadline);
      this.db.prepare(
        `INSERT INTO activity_attempts (
          id, activity_id, published_version_id, participant_id, participant_name, attempt_number,
          access_token_hash, status, started_at, deadline_at, individual_deadline_at,
          global_deadline_at, current_slide_id, revision,
          maximum_score, maximum_score_units, score_units, grading_state,
          grading_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, ?, 0, ?, ?, NULL, 'in_progress', 0, ?, ?)`
      ).run(attemptId, landing.activityId, landing.versionId, participant.id, participantName, attempts + 1, accessTokenHash, timestamp, deadlineAt, timedDeadline, globalDeadline, firstSlide.id, maximumScore, maximumScoreUnits, timestamp, timestamp);
      this.db.prepare(
        `INSERT INTO activity_attempt_question_points (
          attempt_id, question_block_id, question_stable_id, maximum_points_units, updated_at
        )
        SELECT ?, b.id, b.stable_id, CAST(ROUND(b.points * 1000) AS INTEGER), ?
        FROM activity_version_blocks b
        INNER JOIN activity_version_slides s ON s.id = b.slide_id
        WHERE s.version_id = ? AND b.block_type = 'question'`
      ).run(attemptId, timestamp, landing.versionId);
      this.db.prepare(
        `INSERT INTO activity_attempt_slide_progress (attempt_id, slide_id, status, first_viewed_at)
         VALUES (?, ?, 'viewed', ?)`
      ).run(attemptId, firstSlide.id, timestamp);
      this.db.exec('COMMIT');
      return attemptId;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getQuestion(attemptId: string, tokenHash: string, questionBlockId: string): QuestionRow | undefined {
    const attempt = this.attemptRow(attemptId, tokenHash);
    if (!attempt || attempt.status !== 'in_progress') return undefined;
    return this.db.prepare(
      `SELECT b.id, b.question_type as questionType, b.required, b.public_config_json as configJson
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       WHERE b.id = ? AND b.block_type = 'question' AND s.version_id = ?`
    ).get(questionBlockId, attempt.publishedVersionId) as QuestionRow | undefined;
  }

  getModerationRules(attemptId: string, tokenHash: string) {
    return this.db.prepare(
      `SELECT mr.pattern, mr.match_mode as matchMode
       FROM moderation_rules mr
       INNER JOIN live_activities la ON la.user_id = mr.user_id
       INNER JOIN activity_attempts a ON a.activity_id = la.id
       WHERE a.id = ? AND a.access_token_hash = ?
       ORDER BY mr.created_at`
    ).all(attemptId, tokenHash) as unknown as Array<{ pattern: string; matchMode: 'whole_word' | 'contains' }>;
  }

  saveAnswer(input: {
    attemptId: string;
    tokenHash: string;
    questionBlockId: string;
    answer: ActivitySupportedAnswer;
    clientRevision: number;
    moderationStatus?: 'approved' | 'pending';
    moderationReason?: string | null;
  }) {
    const timestamp = nowIso();
    const answerJson = JSON.stringify(input.answer);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.finalizeExpiredAttemptInTransaction(input.attemptId, timestamp);
      const attempt = this.attemptRow(input.attemptId, input.tokenHash);
      if (!attempt) throw new Error('Attempt not found.');
      if (attempt.status !== 'in_progress') throw new Error('Attempt is finalized.');
      const belongs = this.db.prepare(
        `SELECT b.id FROM activity_version_blocks b INNER JOIN activity_version_slides s ON s.id = b.slide_id
         WHERE b.id = ? AND b.block_type = 'question' AND s.version_id = ?`
      ).get(input.questionBlockId, attempt.publishedVersionId);
      if (!belongs) throw new Error('Question not found.');
      const existing = this.db.prepare(
        'SELECT answer_json as answerJson, client_revision as clientRevision, server_revision as serverRevision, saved_at as savedAt FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?'
      ).get(input.attemptId, input.questionBlockId) as { answerJson: string; clientRevision: number; serverRevision: number; savedAt: string } | undefined;
      if (existing && input.clientRevision <= Number(existing.clientRevision)) {
        if (input.clientRevision === Number(existing.clientRevision) && existing.answerJson === answerJson) {
          this.db.exec('COMMIT');
          return { serverRevision: Number(existing.serverRevision), savedAt: existing.savedAt };
        }
        throw new Error('Answer revision is stale.');
      }
      const serverRevision = existing ? Number(existing.serverRevision) + 1 : 1;
      this.db.prepare(
        `INSERT INTO activity_attempt_responses (
          attempt_id, question_block_id, answer_json, moderation_status, client_revision,
          server_revision, saved_at, grading_status, moderation_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(attempt_id, question_block_id) DO UPDATE SET
          answer_json = excluded.answer_json, client_revision = excluded.client_revision,
          server_revision = excluded.server_revision, saved_at = excluded.saved_at,
          moderation_status = excluded.moderation_status, moderation_reason = excluded.moderation_reason,
          grading_status = 'pending', awarded_points = NULL, grading_details_json = NULL`
      ).run(
        input.attemptId,
        input.questionBlockId,
        answerJson,
        input.moderationStatus ?? 'approved',
        input.clientRevision,
        serverRevision,
        timestamp,
        input.moderationReason ?? null
      );
      this.db.prepare('UPDATE activity_attempts SET last_saved_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, input.attemptId);
      this.db.exec('COMMIT');
      return { serverRevision, savedAt: timestamp };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearAnswer(input: {
    attemptId: string;
    tokenHash: string;
    questionBlockId: string;
    clientRevision: number;
  }) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.finalizeExpiredAttemptInTransaction(input.attemptId, timestamp);
      const attempt = this.attemptRow(input.attemptId, input.tokenHash);
      if (!attempt) throw new Error('Attempt not found.');
      if (attempt.status !== 'in_progress') throw new Error('Attempt is finalized.');
      const belongs = this.db.prepare(
        `SELECT b.id FROM activity_version_blocks b INNER JOIN activity_version_slides s ON s.id = b.slide_id
         WHERE b.id = ? AND b.block_type = 'question' AND s.version_id = ?`
      ).get(input.questionBlockId, attempt.publishedVersionId);
      if (!belongs) throw new Error('Question not found.');
      const existing = this.db.prepare(
        'SELECT client_revision as clientRevision, server_revision as serverRevision, saved_at as savedAt FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?'
      ).get(input.attemptId, input.questionBlockId) as { clientRevision: number; serverRevision: number; savedAt: string } | undefined;
      if (existing && input.clientRevision <= Number(existing.clientRevision)) {
        throw new Error('Answer revision is stale.');
      }
      const serverRevision = existing ? Number(existing.serverRevision) + 1 : 1;
      this.db.prepare('DELETE FROM activity_attempt_responses WHERE attempt_id = ? AND question_block_id = ?')
        .run(input.attemptId, input.questionBlockId);
      this.db.prepare('UPDATE activity_attempts SET last_saved_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, input.attemptId);
      this.db.exec('COMMIT');
      return { serverRevision, savedAt: timestamp };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  navigate(attemptId: string, tokenHash: string, targetSlideId: string) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.finalizeExpiredAttemptInTransaction(attemptId, timestamp);
      const attempt = this.attemptRow(attemptId, tokenHash);
      if (!attempt) throw new Error('Attempt not found.');
      if (attempt.status !== 'in_progress') throw new Error('Attempt is finalized.');
      const settings = normalizeStoredActivitySettings(JSON.parse(attempt.settingsJson) as ActivitySettings);
      const orderedSlides = this.orderedSlideRefs(attempt.publishedVersionId, attempt.id, settings.shuffleSlides);
      const targetIndex = orderedSlides.findIndex((slide) => slide.id === targetSlideId);
      const currentIndex = orderedSlides.findIndex((slide) => slide.id === attempt.currentSlideId);
      const target = orderedSlides[targetIndex];
      const current = orderedSlides[currentIndex];
      if (!target || targetIndex < 0) throw new Error('Slide not found.');
      if (!settings.allowBackNavigation && current && targetIndex < currentIndex) {
        throw new Error('Back navigation is disabled.');
      }
      if (settings.navigationPolicy === 'linear' && current && Math.abs(targetIndex - currentIndex) > 1) {
        throw new Error('This slide is not available yet.');
      }
      if (settings.requiredAnswerBehavior === 'require_all' && current && targetIndex > currentIndex) {
        const missing = Number((this.db.prepare(
          `SELECT COUNT(*) as count FROM activity_version_blocks b
           WHERE b.slide_id = ? AND b.block_type = 'question' AND b.required = 1
             AND NOT EXISTS (
               SELECT 1 FROM activity_attempt_responses r
               WHERE r.attempt_id = ? AND r.question_block_id = b.id
                 AND (b.question_type != 'image_labeling'
                   OR json_array_length(json_extract(r.answer_json, '$.assignments')) = json_array_length(json_extract(b.public_config_json, '$.markers')))
             )`
        ).get(current.id, attemptId) as { count: number }).count);
        if (missing > 0) throw new Error('Answer the required question before continuing.');
      }
      this.db.prepare('UPDATE activity_attempts SET current_slide_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(target.id, timestamp, attemptId);
      this.db.prepare(
        `INSERT INTO activity_attempt_slide_progress (attempt_id, slide_id, status, first_viewed_at)
         VALUES (?, ?, 'viewed', ?)
         ON CONFLICT(attempt_id, slide_id) DO UPDATE SET status = 'viewed', first_viewed_at = COALESCE(first_viewed_at, excluded.first_viewed_at)`
      ).run(attemptId, target.id, timestamp);
      if (current) this.db.prepare(
        `UPDATE activity_attempt_slide_progress SET status = 'completed', completed_at = COALESCE(completed_at, ?)
         WHERE attempt_id = ? AND slide_id = ?`
      ).run(timestamp, attemptId, current.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  submit(attemptId: string, tokenHash: string) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.finalizeExpiredAttemptInTransaction(attemptId, timestamp);
      const attempt = this.attemptRow(attemptId, tokenHash);
      if (!attempt) throw new Error('Attempt not found.');
      if (attempt.status === 'submitted' || attempt.status === 'auto_submitted') {
        this.db.exec('COMMIT');
        return;
      }
      if (attempt.status !== 'in_progress') throw new Error('Attempt is finalized.');
      const settings = JSON.parse(attempt.settingsJson) as ActivitySettings;
      if (settings.requiredAnswerBehavior === 'require_all') {
        const missing = Number((this.db.prepare(
          `SELECT COUNT(*) as count FROM activity_version_blocks b
           INNER JOIN activity_version_slides s ON s.id = b.slide_id
           WHERE s.version_id = ? AND b.block_type = 'question' AND b.required = 1
             AND NOT EXISTS (
               SELECT 1 FROM activity_attempt_responses r
               WHERE r.attempt_id = ? AND r.question_block_id = b.id
                 AND (b.question_type != 'image_labeling'
                   OR json_array_length(json_extract(r.answer_json, '$.assignments')) = json_array_length(json_extract(b.public_config_json, '$.markers')))
             )`
        ).get(attempt.publishedVersionId, attemptId) as { count: number }).count);
        if (missing > 0) throw new Error('Required questions are unanswered.');
      }
      this.db.prepare(
        `UPDATE activity_attempts SET status = 'submitted', submitted_at = ?, submission_reason = 'manual',
                revision = revision + 1, updated_at = ? WHERE id = ?`
      ).run(timestamp, timestamp, attemptId);
      this.db.prepare('UPDATE activity_attempt_responses SET finalized_at = ? WHERE attempt_id = ? AND finalized_at IS NULL')
        .run(timestamp, attemptId);
      this.gradeAttempt(attemptId, attempt.publishedVersionId, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  expireDueAttempts(referenceTime = nowIso(), limit = 250) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rows = this.db.prepare(
        `SELECT id FROM activity_attempts
         WHERE status = 'in_progress' AND deadline_at IS NOT NULL AND deadline_at <= ?
         ORDER BY deadline_at LIMIT ?`
      ).all(referenceTime, limit) as unknown as Array<{ id: string }>;
      let finalized = 0;
      for (const row of rows) finalized += this.finalizeExpiredAttemptInTransaction(row.id, referenceTime) ? 1 : 0;
      this.db.exec('COMMIT');
      return finalized;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listAdminAttempts(userId: string, activityId: string): ActivityAdminAttempt[] {
    this.expireDueAttempts();
    const activity = this.db.prepare('SELECT id FROM live_activities WHERE id = ? AND user_id = ?').get(activityId, userId);
    if (!activity) throw new Error('Activity not found.');
    const rows = this.db.prepare(
      `${this.adminAttemptSelect()} WHERE la.user_id = ? AND a.activity_id = ?
       ORDER BY COALESCE(a.submitted_at, a.updated_at, a.started_at) DESC, a.id DESC`
    ).all(userId, activityId) as unknown as AdminAttemptRow[];
    return rows.map((row) => this.toAdminAttempt(row));
  }

  getAdminResults(userId: string, activityId: string, input: {
    page: number;
    pageSize: number;
    search: string;
    status: 'all' | 'submitted' | 'expired';
    gradingState: 'all' | Exclude<PublicActivityAttempt['gradingState'], 'in_progress'>;
  }): ActivityAdminResults {
    this.expireDueAttempts();
    const activity = this.db.prepare('SELECT id FROM live_activities WHERE id = ? AND user_id = ?').get(activityId, userId);
    if (!activity) throw new Error('Activity not found.');

    const overviewRow = this.db.prepare(
      `SELECT COUNT(*) as totalAttempts,
              SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submittedAttempts,
              SUM(CASE WHEN status IN ('auto_submitted', 'expired') THEN 1 ELSE 0 END) as expiredAttempts,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressAttempts,
              SUM(CASE WHEN grading_state = 'awaiting_manual_grading' THEN 1 ELSE 0 END) as awaitingManualGrading,
              AVG(CASE WHEN score_units IS NOT NULL THEN score_units / 1000.0 END) as averageScore,
              AVG(CASE WHEN score_units IS NOT NULL AND maximum_score_units > 0
                THEN score_units * 100.0 / maximum_score_units END) as averagePercentage
       FROM activity_attempts WHERE activity_id = ? AND status <> 'in_progress'`
    ).get(activityId) as {
      totalAttempts: number; submittedAttempts: number | null; expiredAttempts: number | null;
      inProgressAttempts: number | null; awaitingManualGrading: number | null;
      averageScore: number | null; averagePercentage: number | null;
    };
    const medianRow = this.db.prepare(
      `WITH scored AS (
         SELECT score_units, ROW_NUMBER() OVER (ORDER BY score_units) as rowNumber,
                COUNT(*) OVER () as total
         FROM activity_attempts WHERE activity_id = ? AND status <> 'in_progress' AND score_units IS NOT NULL
       )
       SELECT AVG(score_units / 1000.0) as medianScore FROM scored
       WHERE rowNumber IN ((total + 1) / 2, (total + 2) / 2)`
    ).get(activityId) as { medianScore: number | null };
    const totalAttempts = Number(overviewRow.totalAttempts);
    const submittedAttempts = Number(overviewRow.submittedAttempts ?? 0);

    const conditions = ['la.user_id = ?', 'a.activity_id = ?', "a.status <> 'in_progress'"];
    const params: Array<string | number> = [userId, activityId];
    if (input.search) {
      const escaped = input.search.toLocaleLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
      conditions.push("(LOWER(COALESCE(a.participant_name, '')) LIKE ? ESCAPE '\\' OR LOWER(a.id) LIKE ? ESCAPE '\\')");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    if (input.status === 'expired') conditions.push("a.status IN ('auto_submitted', 'expired')");
    else if (input.status !== 'all') { conditions.push('a.status = ?'); params.push(input.status); }
    if (input.gradingState !== 'all') { conditions.push('a.grading_state = ?'); params.push(input.gradingState); }
    const where = conditions.join(' AND ');
    const totalItems = Number((this.db.prepare(
      `SELECT COUNT(*) as count FROM activity_attempts a INNER JOIN live_activities la ON la.id = a.activity_id WHERE ${where}`
    ).get(...params) as { count: number }).count);
    const page = Math.min(input.page, Math.max(1, Math.ceil(totalItems / input.pageSize)));
    const rows = this.db.prepare(
      `${this.adminAttemptSelect()} WHERE ${where}
       ORDER BY COALESCE(a.submitted_at, a.updated_at, a.started_at) DESC, a.id DESC LIMIT ? OFFSET ?`
    ).all(...params, input.pageSize, (page - 1) * input.pageSize) as unknown as AdminAttemptRow[];

    const questions = (this.db.prepare(
      `SELECT b.stable_id as questionId, MIN(s.position) + 1 as slideNumber,
              b.question_type as questionType,
              MAX(json_extract(b.public_config_json, '$.prompt')) as prompt,
              COUNT(DISTINCT a.id) as attempts,
              SUM(CASE WHEN r.answer_json IS NOT NULL THEN 1 ELSE 0 END) as answered,
              SUM(CASE WHEN r.answer_json IS NULL THEN 1 ELSE 0 END) as unanswered,
              SUM(CASE WHEN b.is_graded = 1
                AND COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) > 0
                AND r.grading_status = 'graded'
                AND r.awarded_points_units >= COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) THEN 1 ELSE 0 END) as fullyCorrect,
              AVG(CASE WHEN r.awarded_points_units IS NOT NULL THEN r.awarded_points_units / 1000.0 END) as averageAwardedPoints,
              MAX(COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER))) / 1000.0 as maximumPoints
       FROM activity_attempts a
       INNER JOIN activity_version_slides s ON s.version_id = a.published_version_id
       INNER JOIN activity_version_blocks b ON b.slide_id = s.id AND b.block_type = 'question'
       LEFT JOIN activity_attempt_responses r ON r.attempt_id = a.id AND r.question_block_id = b.id
       LEFT JOIN activity_attempt_question_points p ON p.attempt_id = a.id AND p.question_block_id = b.id
       WHERE a.activity_id = ? AND a.status <> 'in_progress'
       GROUP BY b.stable_id, b.question_type
       ORDER BY MIN(s.position), MIN(b.position)`
    ).all(activityId) as unknown as Array<{
      questionId: string; slideNumber: number; questionType: ActivityQuestionType; prompt: string; attempts: number;
      answered: number; unanswered: number; fullyCorrect: number; averageAwardedPoints: number | null; maximumPoints: number;
    }>).map((row) => ({
      ...row,
      slideNumber: Number(row.slideNumber),
      attempts: Number(row.attempts),
      answered: Number(row.answered),
      unanswered: Number(row.unanswered),
      fullyCorrect: Number(row.fullyCorrect),
      correctnessRate: Number(row.answered) > 0 ? Number(row.fullyCorrect) * 100 / Number(row.answered) : 0,
      averageAwardedPoints: row.averageAwardedPoints === null ? null : Number(row.averageAwardedPoints),
      maximumPoints: Number(row.maximumPoints)
    }));

    const wordRows = this.db.prepare(
      `WITH phrases AS (
         SELECT b.stable_id as questionId,
                json_extract(b.public_config_json, '$.prompt') as prompt,
                TRIM(CAST(item.value AS TEXT)) as text,
                printf('%s|%s|%010d', a.started_at, r.saved_at, CAST(item.key AS INTEGER)) as firstSeen
         FROM activity_attempts a
         INNER JOIN activity_attempt_responses r ON r.attempt_id = a.id
         INNER JOIN activity_version_blocks b ON b.id = r.question_block_id AND b.question_type = 'word_cloud'
         JOIN json_each(CASE
           WHEN json_type(r.answer_json, '$.responses') = 'array' THEN json_extract(r.answer_json, '$.responses')
           ELSE json_array(json_extract(r.answer_json, '$.text')) END) item
         WHERE a.activity_id = ? AND a.status <> 'in_progress' AND r.moderation_status = 'approved'
       )
       SELECT questionId, MAX(prompt) as prompt, text, COUNT(*) as count, MIN(firstSeen) as firstSeen
       FROM phrases WHERE text <> ''
       GROUP BY questionId, text ORDER BY questionId, count DESC, text`
    ).all(activityId) as unknown as Array<{
      questionId: string; prompt: string; text: string; count: number; firstSeen: string;
    }>;
    const cloudGroups = new Map<string, {
      questionId: string;
      prompt: string;
      entries: Map<string, { text: string; count: number; firstSeen: string }>;
    }>();
    for (const row of wordRows) {
      const text = normalizeWordCloudText(row.text);
      if (!text) continue;
      const cloud = cloudGroups.get(row.questionId) ?? {
        questionId: row.questionId,
        prompt: row.prompt,
        entries: new Map<string, { text: string; count: number; firstSeen: string }>()
      };
      const key = text.toLowerCase();
      const entry = cloud.entries.get(key) ?? { text, count: 0, firstSeen: row.firstSeen };
      if (row.firstSeen < entry.firstSeen) {
        entry.text = text;
        entry.firstSeen = row.firstSeen;
      }
      entry.count += Number(row.count);
      cloud.entries.set(key, entry);
      cloudGroups.set(row.questionId, cloud);
    }
    const wordClouds = [...cloudGroups.values()].map((cloud) => {
      const items = [...cloud.entries.values()].sort((left, right) => right.count - left.count || left.text.localeCompare(right.text));
      return {
        questionId: cloud.questionId,
        prompt: cloud.prompt,
        totalResponses: items.reduce((sum, item) => sum + item.count, 0),
        uniqueResponses: items.length,
        items: items.slice(0, 150).map(({ text, count }) => ({ text, count }))
      };
    });

    return {
      overview: {
        totalAttempts,
        submittedAttempts,
        expiredAttempts: Number(overviewRow.expiredAttempts ?? 0),
        inProgressAttempts: Number(overviewRow.inProgressAttempts ?? 0),
        awaitingManualGrading: Number(overviewRow.awaitingManualGrading ?? 0),
        averageScore: overviewRow.averageScore === null ? null : Number(overviewRow.averageScore),
        medianScore: medianRow.medianScore === null ? null : Number(medianRow.medianScore),
        averagePercentage: overviewRow.averagePercentage === null ? null : Number(overviewRow.averagePercentage),
        completionRate: totalAttempts > 0 ? submittedAttempts * 100 / totalAttempts : 0
      },
      attempts: rows.map((row) => this.toAdminAttempt(row)),
      pagination: { page, pageSize: input.pageSize, totalItems, totalPages: Math.ceil(totalItems / input.pageSize) },
      questions,
      wordClouds
    };
  }

  iterateAttemptExport(userId: string, activityId: string) {
    const activity = this.db.prepare('SELECT id FROM live_activities WHERE id = ? AND user_id = ?').get(activityId, userId);
    if (!activity) throw new Error('Activity not found.');
    return this.db.prepare(
      `SELECT a.id as attemptId, a.participant_name as participantName, a.attempt_number as attemptNumber,
              a.status, a.grading_state as gradingState, a.started_at as startedAt,
              a.submitted_at as submittedAt, a.submission_reason as submissionReason,
              CAST(MAX(0, ROUND((julianday(COALESCE(a.submitted_at, a.updated_at)) - julianday(a.started_at)) * 86400)) AS INTEGER) as durationSeconds,
              a.score_units as scoreUnits, a.maximum_score_units as maximumScoreUnits
       FROM activity_attempts a WHERE a.activity_id = ? AND a.status <> 'in_progress' ORDER BY a.started_at, a.id`
    ).iterate(activityId) as Iterable<Record<string, string | number | null>>;
  }

  iterateResponseExport(userId: string, activityId: string) {
    const activity = this.db.prepare('SELECT id FROM live_activities WHERE id = ? AND user_id = ?').get(activityId, userId);
    if (!activity) throw new Error('Activity not found.');
    return this.db.prepare(
      `SELECT a.id as attemptId, a.participant_name as participantName, a.status as attemptStatus,
              a.started_at as startedAt, a.submitted_at as submittedAt,
              b.stable_id as questionId, b.question_type as questionType, b.public_config_json as configJson,
              json_extract(b.public_config_json, '$.prompt') as prompt,
              r.answer_json as answerJson, r.moderation_status as moderationStatus,
              r.grading_status as gradingStatus, r.awarded_points_units as awardedUnits,
              COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) as maximumUnits,
              a.score_units as attemptScoreUnits, a.maximum_score_units as attemptMaximumScoreUnits,
              COALESCE(r.teacher_feedback, '') as teacherFeedback, r.saved_at as savedAt
       FROM activity_attempts a
       INNER JOIN activity_version_slides s ON s.version_id = a.published_version_id
       INNER JOIN activity_version_blocks b ON b.slide_id = s.id AND b.block_type = 'question'
       LEFT JOIN activity_attempt_responses r ON r.attempt_id = a.id AND r.question_block_id = b.id
       LEFT JOIN activity_attempt_question_points p ON p.attempt_id = a.id AND p.question_block_id = b.id
       WHERE a.activity_id = ? AND a.status <> 'in_progress'
       ORDER BY a.started_at, a.id, s.position, b.position`
    ).iterate(activityId) as Iterable<Record<string, string | number | null>>;
  }

  getAdminAttemptDetail(userId: string, activityId: string, attemptId: string): ActivityAdminAttemptDetail {
    this.expireDueAttempts();
    const row = this.db.prepare(
      `${this.adminAttemptSelect()} WHERE la.user_id = ? AND a.activity_id = ? AND a.id = ?`
    ).get(userId, activityId, attemptId) as unknown as AdminAttemptRow | undefined;
    if (!row) throw new Error('Attempt not found.');
    const attempt = this.toAdminAttempt(row);
    const version = this.db.prepare('SELECT published_version_id as versionId FROM activity_attempts WHERE id = ?')
      .get(attemptId) as { versionId: string };
    const responses = this.db.prepare(
      `SELECT b.id as questionBlockId, s.position + 1 as slideNumber, b.question_type as questionType,
              COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) as maximumUnits,
              b.public_config_json as configJson, k.key_json as keyJson, r.answer_json as answerJson,
              COALESCE(r.moderation_status, 'approved') as moderationStatus,
              r.moderation_reason as moderationReason,
              COALESCE(r.grading_status, 'pending') as gradingStatus,
              r.awarded_points_units as awardedUnits, COALESCE(r.teacher_feedback, '') as teacherFeedback
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       LEFT JOIN activity_version_question_keys k ON k.block_id = b.id
       LEFT JOIN activity_attempt_responses r ON r.attempt_id = ? AND r.question_block_id = b.id
       LEFT JOIN activity_attempt_question_points p ON p.attempt_id = ? AND p.question_block_id = b.id
       WHERE s.version_id = ? AND b.block_type = 'question'
       ORDER BY s.position, b.position`
    ).all(attemptId, attemptId, version.versionId) as unknown as Array<{
      questionBlockId: string; slideNumber: number; questionType: ActivityQuestionType; maximumUnits: number;
      configJson: string; keyJson: string | null;
      answerJson: string | null; moderationStatus: 'approved' | 'pending' | 'rejected'; moderationReason: string | null;
      gradingStatus: 'pending' | 'graded' | 'manual_review';
      awardedUnits: number | null; teacherFeedback: string;
    }>;
    const audit = this.db.prepare(
      `SELECT id, question_block_id as questionBlockId, action,
              previous_awarded_units as previousUnits, awarded_units as awardedUnits,
              teacher_feedback as teacherFeedback, created_at as createdAt
       FROM activity_grading_audit WHERE attempt_id = ? ORDER BY created_at, id`
    ).all(attemptId) as unknown as Array<{
      id: string; questionBlockId: string | null; action: 'automatic' | 'manual' | 'moderation' | 'release';
      previousUnits: number | null; awardedUnits: number | null; teacherFeedback: string; createdAt: string;
    }>;
    return {
      ...attempt,
      responses: responses.map((response) => {
        const config = JSON.parse(response.configJson) as ActivityQuestionPublicConfig;
        const key = response.keyJson ? JSON.parse(response.keyJson) as Record<string, unknown> : {};
        const maximumUnits = Number(response.maximumUnits);
        const awardedUnits = response.awardedUnits === null ? null : Number(response.awardedUnits);
        return {
          questionBlockId: response.questionBlockId,
          slideNumber: Number(response.slideNumber),
          questionType: response.questionType,
          prompt: config.prompt,
          questionConfig: config,
          answer: response.answerJson ? JSON.parse(response.answerJson) as ActivitySupportedAnswer : null,
          correctAnswer: serializeActivityCorrectAnswer(response.questionType, config, key) ?? null,
          correct: response.answerJson && response.gradingStatus === 'graded' && maximumUnits > 0 && awardedUnits !== null
            ? awardedUnits >= maximumUnits
            : null,
          moderationStatus: response.moderationStatus,
          moderationReason: response.moderationReason,
          gradingStatus: response.gradingStatus,
          awardedPoints: awardedUnits === null ? null : unitsToPoints(awardedUnits),
          maximumPoints: unitsToPoints(maximumUnits),
          teacherFeedback: response.teacherFeedback
        };
      }),
      audit: audit.map((entry) => ({
        id: entry.id,
        questionBlockId: entry.questionBlockId,
        action: entry.action,
        previousAwardedPoints: entry.previousUnits === null ? null : unitsToPoints(Number(entry.previousUnits)),
        awardedPoints: entry.awardedUnits === null ? null : unitsToPoints(Number(entry.awardedUnits)),
        teacherFeedback: entry.teacherFeedback,
        createdAt: entry.createdAt
      }))
    };
  }

  deleteAdminAttempt(userId: string, activityId: string, attemptId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owned = this.db.prepare(
        `SELECT a.id FROM activity_attempts a
         INNER JOIN live_activities la ON la.id = a.activity_id
         WHERE a.id = ? AND a.activity_id = ? AND la.user_id = ?`
      ).get(attemptId, activityId, userId);
      if (!owned) throw new Error('Attempt not found.');
      this.db.prepare('DELETE FROM activity_attempts WHERE id = ?').run(attemptId);
      this.db.exec('COMMIT');
      return { id: attemptId, deleted: true as const };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private recalculateAttemptTotal(attemptId: string, timestamp: string) {
    const aggregate = this.db.prepare(
      `SELECT COALESCE(SUM(awarded_points_units), 0) as totalUnits,
              SUM(CASE WHEN grading_status = 'manual_review' THEN 1 ELSE 0 END) as pending
       FROM activity_attempt_responses WHERE attempt_id = ?`
    ).get(attemptId) as { totalUnits: number; pending: number };
    const pending = Number(aggregate.pending) > 0;
    const totalUnits = Number(aggregate.totalUnits);
    this.db.prepare(
      `UPDATE activity_attempts SET score_units = ?, score = ?,
        grading_state = CASE
          WHEN ? = 1 THEN 'awaiting_manual_grading'
          WHEN status IN ('auto_submitted', 'expired') THEN 'expired'
          ELSE 'fully_graded'
        END,
        grading_revision = grading_revision + 1, updated_at = ? WHERE id = ?`
    ).run(pending ? null : totalUnits, pending ? null : unitsToPoints(totalUnits), pending ? 1 : 0, timestamp, attemptId);
  }

  gradeManualResponse(input: {
    userId: string;
    activityId: string;
    attemptId: string;
    questionBlockId: string;
    awardedUnits: number;
    teacherFeedback: string;
  }) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(
        `SELECT a.status, b.question_type as questionType,
                COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) as maximumUnits,
                r.grading_status as gradingStatus, r.awarded_points_units as previousUnits
         FROM activity_attempts a
         INNER JOIN live_activities la ON la.id = a.activity_id
         INNER JOIN activity_attempt_responses r ON r.attempt_id = a.id
         INNER JOIN activity_version_blocks b ON b.id = r.question_block_id
         INNER JOIN activity_version_slides s ON s.id = b.slide_id AND s.version_id = a.published_version_id
         LEFT JOIN activity_attempt_question_points p ON p.attempt_id = a.id AND p.question_block_id = b.id
         WHERE a.id = ? AND a.activity_id = ? AND la.user_id = ? AND b.id = ?`
      ).get(input.attemptId, input.activityId, input.userId, input.questionBlockId) as {
        status: PublicActivityAttempt['status']; maximumUnits: number; questionType: ActivityQuestionType;
        gradingStatus: 'pending' | 'graded' | 'manual_review'; previousUnits: number | null;
      } | undefined;
      if (!row) throw new Error('Attempt response not found.');
      if (row.status === 'in_progress') throw new Error('Attempt is still in progress.');
      if (row.gradingStatus !== 'graded' && row.gradingStatus !== 'manual_review') {
        throw new Error('This response is not ready for grading.');
      }
      const maximumUnits = Number(row.maximumUnits);
      if (!Number.isInteger(input.awardedUnits) || input.awardedUnits < 0 || input.awardedUnits > maximumUnits) {
        throw new Error('Awarded points are outside the allowed range.');
      }
      this.db.prepare(
        `UPDATE activity_attempt_responses SET grading_status = 'graded', awarded_points_units = ?,
          awarded_points = ?, teacher_feedback = ?, grading_details_json = ?
         WHERE attempt_id = ? AND question_block_id = ?`
      ).run(
        input.awardedUnits,
        unitsToPoints(input.awardedUnits),
        input.teacherFeedback,
        JSON.stringify({ automaticallyGraded: false, gradingMode: 'manual_override', manuallyGraded: true, previousGradingStatus: row.gradingStatus }),
        input.attemptId,
        input.questionBlockId
      );
      this.db.prepare(
        `INSERT INTO activity_grading_audit (
          id, attempt_id, question_block_id, action, previous_awarded_units, awarded_units,
          teacher_feedback, actor_user_id, details_json, created_at
        ) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, '{}', ?)`
      ).run(createId(), input.attemptId, input.questionBlockId, row.previousUnits, input.awardedUnits, input.teacherFeedback, input.userId, timestamp);
      this.recalculateAttemptTotal(input.attemptId, timestamp);
      this.db.exec('COMMIT');
      return this.getAdminAttemptDetail(input.userId, input.activityId, input.attemptId);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  moderateResponse(input: {
    userId: string;
    activityId: string;
    attemptId: string;
    questionBlockId: string;
    status: 'approved' | 'rejected';
  }) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(
        `SELECT a.status as attemptStatus, b.question_type as questionType, b.is_graded as graded,
                COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) as maximumUnits,
                b.public_config_json as configJson, k.key_json as keyJson,
                r.answer_json as answerJson, r.moderation_status as moderationStatus,
                r.awarded_points_units as previousUnits
         FROM activity_attempts a
         INNER JOIN live_activities la ON la.id = a.activity_id
         INNER JOIN activity_attempt_responses r ON r.attempt_id = a.id
         INNER JOIN activity_version_blocks b ON b.id = r.question_block_id
         INNER JOIN activity_version_slides s ON s.id = b.slide_id AND s.version_id = a.published_version_id
         LEFT JOIN activity_version_question_keys k ON k.block_id = b.id
         LEFT JOIN activity_attempt_question_points p ON p.attempt_id = a.id AND p.question_block_id = b.id
         WHERE a.id = ? AND a.activity_id = ? AND la.user_id = ? AND b.id = ?`
      ).get(input.attemptId, input.activityId, input.userId, input.questionBlockId) as {
        attemptStatus: PublicActivityAttempt['status']; questionType: ActivityQuestionType; graded: number;
        maximumUnits: number; configJson: string; keyJson: string | null; answerJson: string;
        moderationStatus: 'approved' | 'pending' | 'rejected'; previousUnits: number | null;
      } | undefined;
      if (!row) throw new Error('Attempt response not found.');
      if (row.attemptStatus === 'in_progress') throw new Error('Attempt is still in progress.');
      if (row.questionType !== 'word_cloud') throw new Error('Only Word Cloud responses can be moderated here.');
      const config = JSON.parse(row.configJson) as ActivityQuestionPublicConfig;
      const answer = JSON.parse(row.answerJson) as ActivitySupportedAnswer;
      const key = row.keyJson ? JSON.parse(row.keyJson) as Record<string, unknown> : {};
      const result = gradeActivityQuestion({
        questionType: row.questionType,
        config,
        answer,
        key,
        maximumUnits: Number(row.maximumUnits),
        graded: Boolean(row.graded),
        moderationStatus: input.status
      });
      const awardedUnits = result.awardedUnits ?? 0;
      this.db.prepare(
        `UPDATE activity_attempt_responses SET moderation_status = ?, moderation_reason = NULL,
          grading_status = 'graded', awarded_points_units = ?, awarded_points = ?, grading_details_json = ?
         WHERE attempt_id = ? AND question_block_id = ?`
      ).run(input.status, awardedUnits, unitsToPoints(awardedUnits), JSON.stringify(result.details), input.attemptId, input.questionBlockId);
      this.db.prepare(
        `INSERT INTO activity_grading_audit (
          id, attempt_id, question_block_id, action, previous_awarded_units, awarded_units,
          teacher_feedback, actor_user_id, details_json, created_at
        ) VALUES (?, ?, ?, 'moderation', ?, ?, '', ?, ?, ?)`
      ).run(createId(), input.attemptId, input.questionBlockId, row.previousUnits, awardedUnits, input.userId, JSON.stringify({ previousStatus: row.moderationStatus, status: input.status }), timestamp);
      this.recalculateAttemptTotal(input.attemptId, timestamp);
      this.db.exec('COMMIT');
      return this.getAdminAttemptDetail(input.userId, input.activityId, input.attemptId);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  releaseResults(userId: string, activityId: string, attemptId: string) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const attempt = this.db.prepare(
        `SELECT a.grading_state as gradingState, a.results_released_at as releasedAt
         FROM activity_attempts a INNER JOIN live_activities la ON la.id = a.activity_id
         WHERE a.id = ? AND a.activity_id = ? AND la.user_id = ?`
      ).get(attemptId, activityId, userId) as { gradingState: PublicActivityAttempt['gradingState']; releasedAt: string | null } | undefined;
      if (!attempt) throw new Error('Attempt not found.');
      if (attempt.gradingState === 'in_progress' || attempt.gradingState === 'submitted' || attempt.gradingState === 'awaiting_manual_grading') {
        throw new Error('Attempt must be fully graded before results are released.');
      }
      if (!attempt.releasedAt) {
        this.db.prepare('UPDATE activity_attempts SET results_released_at = ?, results_released_by = ?, updated_at = ? WHERE id = ?')
          .run(timestamp, userId, timestamp, attemptId);
        this.db.prepare(
          `INSERT INTO activity_grading_audit (
            id, attempt_id, question_block_id, action, previous_awarded_units, awarded_units,
            teacher_feedback, actor_user_id, details_json, created_at
          ) VALUES (?, ?, NULL, 'release', NULL, NULL, '', ?, '{}', ?)`
        ).run(createId(), attemptId, userId, timestamp);
      }
      this.db.exec('COMMIT');
      return this.getAdminAttemptDetail(userId, activityId, attemptId);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  extendIndividualDeadline(userId: string, activityId: string, attemptId: string, additionalSeconds: number) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owned = this.db.prepare(
        `SELECT a.id FROM activity_attempts a INNER JOIN live_activities la ON la.id = a.activity_id
         WHERE a.id = ? AND a.activity_id = ? AND la.user_id = ?`
      ).get(attemptId, activityId, userId) as { id: string } | undefined;
      if (!owned) throw new Error('Attempt not found.');
      this.finalizeExpiredAttemptInTransaction(attemptId, timestamp);
      const current = this.db.prepare(
        `SELECT status, individual_deadline_at as individualDeadlineAt, global_deadline_at as globalDeadlineAt
         FROM activity_attempts WHERE id = ?`
      ).get(attemptId) as { status: PublicActivityAttempt['status']; individualDeadlineAt: string | null; globalDeadlineAt: string | null };
      if (current.status !== 'in_progress') throw new Error('Attempt is finalized.');
      if (!current.individualDeadlineAt) throw new Error('Attempt does not have an individual time limit.');
      const individualDeadlineAt = new Date(Date.parse(current.individualDeadlineAt) + additionalSeconds * 1000).toISOString();
      const effectiveDeadlineAt = earliestActivityDeadline(individualDeadlineAt, current.globalDeadlineAt);
      this.db.prepare(
        `UPDATE activity_attempts SET individual_deadline_at = ?, deadline_at = ?,
          deadline_extended_at = ?, deadline_extended_seconds = deadline_extended_seconds + ?,
          deadline_extended_by = ?, revision = revision + 1, updated_at = ? WHERE id = ?`
      ).run(individualDeadlineAt, effectiveDeadlineAt, timestamp, additionalSeconds, userId, timestamp, attemptId);
      const row = this.db.prepare(
        `${this.adminAttemptSelect()} WHERE la.user_id = ? AND a.activity_id = ? AND a.id = ?`
      ).get(userId, activityId, attemptId) as unknown as AdminAttemptRow;
      this.db.exec('COMMIT');
      return this.toAdminAttempt(row);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
