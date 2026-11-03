import type { DatabaseSync } from 'node:sqlite';
import type {
  Activity,
  ActivityQuestionType,
  ActivitySettings,
  ActivitySlide,
  PublishedActivityVersion,
  SlideBlock
} from '@/shared/activity-types.js';
import { getDb } from '../db.js';
import type {
  InternalActivityDraft,
  NormalizedActivityDraftBlock,
  NormalizedActivityDraftSlide
} from '../domain/activity-domain.js';
import { normalizeStoredActivitySettings } from '../domain/activity-domain.js';
import { createId, nowIso, sha256 } from '../utils.js';

interface ActivityRow {
  id: string;
  completedAttemptCount: number;
  slug: string;
  title: string;
  status: ActivitySettings['status'];
  identityMode: ActivitySettings['identityMode'];
  description: string;
  requiredAnswerBehavior: ActivitySettings['requiredAnswerBehavior'];
  navigationPolicy: ActivitySettings['navigationPolicy'];
  resultVisibility: ActivitySettings['resultVisibility'];
  feedbackPolicy: ActivitySettings['feedbackPolicy'];
  theme: ActivitySettings['theme'];
  layout: ActivitySettings['layout'];
  backgroundPattern: ActivitySettings['backgroundPattern'];
  patternIntensity: number;
  gradingEnabled: number;
  defaultQuestionPoints: number;
  maximumAttempts: number;
  attemptTimeLimitSeconds: number | null;
  availabilityStartAt: string | null;
  submissionDeadlineAt: string | null;
  submissionDeadlineTimezone: string;
  lowTimeWarningSeconds: number | null;
  shuffleQuestionOptions: number;
  shuffleSlides: number;
  allowBackNavigation: number;
  draftRevision: number;
  publishedVersionId: string | null;
  publishedVersionNumber: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DraftSlideRow {
  id: string;
  position: number;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface DraftBlockRow {
  id: string;
  slideId: string;
  position: number;
  type: NormalizedActivityDraftBlock['type'];
  questionType: string | null;
  graded: number;
  points: number;
  required: number;
  publicConfigJson: string;
  keyJson: string | null;
}

const activitySelect = `
  SELECT a.id, a.slug, a.title, a.status, a.identity_mode as identityMode,
         m.description,
         m.required_answer_behavior as requiredAnswerBehavior,
         m.navigation_policy as navigationPolicy,
         m.result_visibility as resultVisibility,
         m.feedback_policy as feedbackPolicy,
         m.theme, m.layout, m.background_pattern as backgroundPattern,
         m.pattern_intensity as patternIntensity,
         m.grading_enabled as gradingEnabled,
         m.default_question_points as defaultQuestionPoints,
         m.maximum_attempts as maximumAttempts,
         m.attempt_time_limit_seconds as attemptTimeLimitSeconds,
         m.availability_start_at as availabilityStartAt,
         m.submission_deadline_at as submissionDeadlineAt,
         m.submission_deadline_timezone as submissionDeadlineTimezone,
         m.low_time_warning_seconds as lowTimeWarningSeconds,
         m.shuffle_question_options as shuffleQuestionOptions,
         m.shuffle_slides as shuffleSlides,
         m.allow_back_navigation as allowBackNavigation,
         d.revision as draftRevision,
         m.published_version_id as publishedVersionId,
         v.version_number as publishedVersionNumber,
         m.archived_at as archivedAt,
         (SELECT COUNT(*) FROM activity_attempts aa
          WHERE aa.activity_id = a.id AND aa.status <> 'in_progress') as completedAttemptCount,
         a.created_at as createdAt, a.updated_at as updatedAt
  FROM live_activities a
  INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
  INNER JOIN activity_drafts d ON d.activity_id = a.id
  LEFT JOIN activity_versions v ON v.id = m.published_version_id
`;

const settingsFromRow = (row: ActivityRow): ActivitySettings => ({
  title: row.title,
  description: row.description,
  slug: row.slug,
  status: row.status,
  identityMode: row.identityMode,
  requiredAnswerBehavior: row.requiredAnswerBehavior,
  navigationPolicy: row.navigationPolicy,
  resultVisibility: row.resultVisibility,
  feedbackPolicy: row.feedbackPolicy,
  theme: row.theme ?? 'minimal_light',
  layout: row.layout ?? 'classic',
  backgroundPattern: row.backgroundPattern ?? 'none',
  patternIntensity: Number(row.patternIntensity ?? 35),
  gradingEnabled: Boolean(row.gradingEnabled),
  defaultQuestionPoints: Number(row.defaultQuestionPoints),
  maximumAttempts: Number(row.maximumAttempts),
  attemptTimeLimitSeconds: row.attemptTimeLimitSeconds === null ? null : Number(row.attemptTimeLimitSeconds),
  availabilityStartAt: row.availabilityStartAt,
  submissionDeadlineAt: row.submissionDeadlineAt,
  submissionDeadlineTimezone: row.submissionDeadlineTimezone || 'UTC',
  lowTimeWarningSeconds: row.lowTimeWarningSeconds === null ? null : Number(row.lowTimeWarningSeconds),
  shuffleQuestionOptions: Boolean(row.shuffleQuestionOptions),
  shuffleSlides: Boolean(row.shuffleSlides),
  allowBackNavigation: row.allowBackNavigation === undefined ? true : Boolean(row.allowBackNavigation)
});

const toActivity = (row: ActivityRow, publicUrl: string): Activity => ({
  id: row.id,
  publicUrl,
  completedAttemptCount: Number(row.completedAttemptCount),
  lifecycleState: row.archivedAt
    ? 'archived'
    : row.publishedVersionId === null
      ? 'draft'
      : row.status === 'active' ? 'published' : 'disabled',
  archivedAt: row.archivedAt,
  settings: settingsFromRow(row),
  draftRevision: Number(row.draftRevision),
  publishedVersionId: row.publishedVersionId,
  publishedVersionNumber: row.publishedVersionNumber === null ? null : Number(row.publishedVersionNumber),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

export class ActivityRepository {
  constructor(private readonly db: DatabaseSync = getDb()) {}

  list(userId: string, buildPublicUrl: (slug: string) => string) {
    const rows = this.db.prepare(`${activitySelect} WHERE a.user_id = ? ORDER BY a.created_at DESC`).all(userId) as unknown as ActivityRow[];
    return rows.map((row) => toActivity(row, buildPublicUrl(row.slug)));
  }

  findById(userId: string, activityId: string, buildPublicUrl: (slug: string) => string) {
    const row = this.db.prepare(`${activitySelect} WHERE a.user_id = ? AND a.id = ?`).get(userId, activityId) as ActivityRow | undefined;
    return row ? toActivity(row, buildPublicUrl(row.slug)) : undefined;
  }

  findBySlug(slug: string, buildPublicUrl: (slug: string) => string) {
    const row = this.db.prepare(`${activitySelect} WHERE a.slug = ?`).get(slug) as ActivityRow | undefined;
    return row ? toActivity(row, buildPublicUrl(row.slug)) : undefined;
  }

  create(userId: string, settings: ActivitySettings) {
    const id = createId();
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO public_slugs (slug, resource_type, resource_id, created_at) VALUES (?, 'live_activity', ?, ?)`)
        .run(settings.slug, id, timestamp);
      this.db.prepare(
        `INSERT INTO live_activities (
          id, user_id, slug, title, status, identity_mode, allow_multiple_responses,
          max_responses_per_participant, moderation_mode, public_results, expires_at,
          created_at, updated_at, last_response_at, public_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'off', ?, NULL, ?, ?, NULL, 0)`
      ).run(
        id,
        userId,
        settings.slug,
        settings.title,
        settings.status,
        settings.identityMode,
        settings.maximumAttempts > 1 ? 1 : 0,
        settings.maximumAttempts,
        settings.resultVisibility === 'never' ? 0 : 1,
        timestamp,
        timestamp
      );
      this.db.prepare(
        `INSERT INTO activity_models (
          activity_id, model, description, required_answer_behavior, navigation_policy,
          result_visibility, feedback_policy, theme, layout, background_pattern, pattern_intensity,
          grading_enabled, default_question_points,
          maximum_attempts, attempt_time_limit_seconds,
          availability_start_at, submission_deadline_at, submission_deadline_timezone, low_time_warning_seconds,
          shuffle_question_options, shuffle_slides, allow_back_navigation, published_version_id,
          created_at, updated_at
        ) VALUES (?, 'slides_v1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      ).run(
        id,
        settings.description,
        settings.requiredAnswerBehavior,
        settings.navigationPolicy,
        settings.resultVisibility,
        settings.feedbackPolicy,
        settings.theme,
        settings.layout,
        settings.backgroundPattern,
        settings.patternIntensity,
        settings.gradingEnabled ? 1 : 0,
        settings.defaultQuestionPoints,
        settings.maximumAttempts,
        settings.attemptTimeLimitSeconds,
        settings.availabilityStartAt,
        settings.submissionDeadlineAt,
        settings.submissionDeadlineTimezone,
        settings.lowTimeWarningSeconds,
        settings.shuffleQuestionOptions ? 1 : 0,
        settings.shuffleSlides ? 1 : 0,
        settings.allowBackNavigation ? 1 : 0,
        timestamp,
        timestamp
      );
      this.db.prepare('INSERT INTO activity_drafts (activity_id, revision, created_at, updated_at) VALUES (?, 0, ?, ?)')
        .run(id, timestamp, timestamp);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return id;
  }

  updateSettings(userId: string, activityId: string, settings: ActivitySettings, expectedRevision: number) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare(
        `SELECT a.slug, d.revision FROM live_activities a
         INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
         INNER JOIN activity_drafts d ON d.activity_id = a.id
         WHERE a.id = ? AND a.user_id = ?`
      ).get(activityId, userId) as { slug: string; revision: number } | undefined;
      if (!current) throw new Error('Activity not found.');
      if (Number(current.revision) !== expectedRevision) throw new Error('Activity draft has changed.');
      if (current.slug !== settings.slug) {
        this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'live_activity' AND resource_id = ?`).run(activityId);
        this.db.prepare(`INSERT INTO public_slugs (slug, resource_type, resource_id, created_at) VALUES (?, 'live_activity', ?, ?)`)
          .run(settings.slug, activityId, timestamp);
      }
      this.db.prepare(
        `UPDATE live_activities SET slug = ?, title = ?, status = ?, identity_mode = ?,
          allow_multiple_responses = ?, max_responses_per_participant = ?, public_results = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        settings.slug,
        settings.title,
        settings.status,
        settings.identityMode,
        settings.maximumAttempts > 1 ? 1 : 0,
        settings.maximumAttempts,
        settings.resultVisibility === 'never' ? 0 : 1,
        timestamp,
        activityId,
        userId
      );
      this.db.prepare(
        `UPDATE activity_models SET description = ?, required_answer_behavior = ?, navigation_policy = ?,
          result_visibility = ?, feedback_policy = ?, theme = ?, layout = ?, background_pattern = ?, pattern_intensity = ?,
          grading_enabled = ?, default_question_points = ?,
          maximum_attempts = ?, attempt_time_limit_seconds = ?,
          availability_start_at = ?, submission_deadline_at = ?, submission_deadline_timezone = ?, low_time_warning_seconds = ?,
          shuffle_question_options = ?, shuffle_slides = ?, allow_back_navigation = ?, updated_at = ?
         WHERE activity_id = ?`
      ).run(
        settings.description,
        settings.requiredAnswerBehavior,
        settings.navigationPolicy,
        settings.resultVisibility,
        settings.feedbackPolicy,
        settings.theme,
        settings.layout,
        settings.backgroundPattern,
        settings.patternIntensity,
        settings.gradingEnabled ? 1 : 0,
        settings.defaultQuestionPoints,
        settings.maximumAttempts,
        settings.attemptTimeLimitSeconds,
        settings.availabilityStartAt,
        settings.submissionDeadlineAt,
        settings.submissionDeadlineTimezone,
        settings.lowTimeWarningSeconds,
        settings.shuffleQuestionOptions ? 1 : 0,
        settings.shuffleSlides ? 1 : 0,
        settings.allowBackNavigation ? 1 : 0,
        timestamp,
        activityId
      );
      this.db.prepare('UPDATE activity_drafts SET revision = revision + 1, updated_at = ? WHERE activity_id = ?')
        .run(timestamp, activityId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private insertDraftSlides(activityId: string, slides: NormalizedActivityDraftSlide[], timestamp: string) {
    const slideStatement = this.db.prepare(
      'INSERT INTO activity_draft_slides (id, activity_id, position, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const blockStatement = this.db.prepare(
      `INSERT INTO activity_draft_blocks (
        id, slide_id, position, block_type, question_type, is_graded, points, required,
        public_config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const keyStatement = this.db.prepare(
      'INSERT INTO activity_draft_question_keys (block_id, question_type, key_json, updated_at) VALUES (?, ?, ?, ?)'
    );
    for (const slide of slides) {
      slideStatement.run(slide.id, activityId, slide.position, slide.title, slide.description, timestamp, timestamp);
      slide.blocks.forEach((block, position) => {
        const isQuestion = block.type === 'question';
        blockStatement.run(
          block.id,
          slide.id,
          position,
          block.type,
          isQuestion ? block.questionType : null,
          isQuestion && block.graded ? 1 : 0,
          isQuestion && block.graded ? block.points : 0,
          isQuestion && block.required ? 1 : 0,
          JSON.stringify(block.config),
          timestamp,
          timestamp
        );
        if (isQuestion && block.answerKey !== null) {
          keyStatement.run(block.id, block.questionType, JSON.stringify(block.answerKey), timestamp);
        }
      });
    }
  }

  replaceDraft(userId: string, activityId: string, expectedRevision: number, slides: NormalizedActivityDraftSlide[]) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const draft = this.db.prepare(
        `SELECT d.revision FROM activity_drafts d
         INNER JOIN live_activities a ON a.id = d.activity_id
         INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
         WHERE d.activity_id = ? AND a.user_id = ?`
      ).get(activityId, userId) as { revision: number } | undefined;
      if (!draft) throw new Error('Activity not found.');
      if (Number(draft.revision) !== expectedRevision) throw new Error('Activity draft has changed.');
      this.db.prepare('DELETE FROM activity_draft_slides WHERE activity_id = ?').run(activityId);
      this.insertDraftSlides(activityId, slides, timestamp);
      this.db.prepare('UPDATE activity_drafts SET revision = revision + 1, updated_at = ? WHERE activity_id = ?')
        .run(timestamp, activityId);
      this.db.prepare('UPDATE activity_models SET updated_at = ? WHERE activity_id = ?').run(timestamp, activityId);
      this.db.prepare('UPDATE live_activities SET updated_at = ? WHERE id = ?').run(timestamp, activityId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getDraft(userId: string, activityId: string): InternalActivityDraft | undefined {
    const draftRow = this.db.prepare(
      `SELECT d.revision, d.created_at as createdAt, d.updated_at as updatedAt
       FROM activity_drafts d
       INNER JOIN live_activities a ON a.id = d.activity_id
       INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
       WHERE d.activity_id = ? AND a.user_id = ?`
    ).get(activityId, userId) as { revision: number; createdAt: string; updatedAt: string } | undefined;
    if (!draftRow) return undefined;
    const slideRows = this.db.prepare(
      `SELECT id, position, title, description, created_at as createdAt, updated_at as updatedAt
       FROM activity_draft_slides WHERE activity_id = ? ORDER BY position`
    ).all(activityId) as unknown as DraftSlideRow[];
    const blockRows = this.db.prepare(
      `SELECT b.id, b.slide_id as slideId, b.position, b.block_type as type,
              b.question_type as questionType, b.is_graded as graded, b.points, b.required,
              b.public_config_json as publicConfigJson, k.key_json as keyJson
       FROM activity_draft_blocks b
       INNER JOIN activity_draft_slides s ON s.id = b.slide_id
       LEFT JOIN activity_draft_question_keys k ON k.block_id = b.id
       WHERE s.activity_id = ? ORDER BY s.position, b.position`
    ).all(activityId) as unknown as DraftBlockRow[];
    const blocksBySlide = new Map<string, NormalizedActivityDraftBlock[]>();
    for (const row of blockRows) {
      const config = JSON.parse(row.publicConfigJson) as Record<string, unknown>;
      const block = row.type === 'question'
        ? {
            id: row.id,
            type: 'question' as const,
            questionType: row.questionType,
            graded: Boolean(row.graded),
            points: Number(row.points),
            required: Boolean(row.required),
            config,
            answerKey: row.keyJson === null ? null : JSON.parse(row.keyJson)
          }
        : { id: row.id, type: row.type, config };
      const existing = blocksBySlide.get(row.slideId) ?? [];
      existing.push(block as NormalizedActivityDraftBlock);
      blocksBySlide.set(row.slideId, existing);
    }
    return {
      activityId,
      revision: Number(draftRow.revision),
      slides: slideRows.map((slide) => ({
        id: slide.id,
        position: Number(slide.position),
        title: slide.title,
        description: slide.description,
        blocks: blocksBySlide.get(slide.id) ?? []
      })),
      createdAt: draftRow.createdAt,
      updatedAt: draftRow.updatedAt
    };
  }

  private reconcileFinalizedAttemptPoints(
    activityId: string,
    newVersionId: string,
    actorUserId: string,
    timestamp: string
  ) {
    const newQuestions = this.db.prepare(
      `SELECT b.stable_id as stableId, b.question_type as questionType,
              CAST(ROUND(b.points * 1000) AS INTEGER) as maximumUnits
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       WHERE s.version_id = ? AND b.block_type = 'question'`
    ).all(newVersionId) as unknown as Array<{
      stableId: string;
      questionType: ActivityQuestionType;
      maximumUnits: number;
    }>;
    if (!newQuestions.length) return;
    const nextByStableId = new Map(newQuestions.map((question) => [question.stableId, question]));
    const attempts = this.db.prepare(
      `SELECT id, published_version_id as versionId, maximum_score_units as maximumUnits
       FROM activity_attempts WHERE activity_id = ? AND status <> 'in_progress'`
    ).all(activityId) as unknown as Array<{ id: string; versionId: string; maximumUnits: number }>;
    const questionsForAttempt = this.db.prepare(
      `SELECT b.id as blockId, b.stable_id as stableId, b.question_type as questionType,
              COALESCE(p.maximum_points_units, CAST(ROUND(b.points * 1000) AS INTEGER)) as maximumUnits,
              r.awarded_points_units as awardedUnits, r.grading_status as gradingStatus,
              r.grading_details_json as gradingDetailsJson, COALESCE(r.teacher_feedback, '') as teacherFeedback
       FROM activity_version_blocks b
       INNER JOIN activity_version_slides s ON s.id = b.slide_id
       LEFT JOIN activity_attempt_question_points p
         ON p.attempt_id = ? AND p.question_block_id = b.id
       LEFT JOIN activity_attempt_responses r
         ON r.attempt_id = ? AND r.question_block_id = b.id
       WHERE s.version_id = ? AND b.block_type = 'question'`
    );
    const upsertMaximum = this.db.prepare(
      `INSERT INTO activity_attempt_question_points (
        attempt_id, question_block_id, question_stable_id, maximum_points_units, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id, question_block_id) DO UPDATE SET
        maximum_points_units = excluded.maximum_points_units,
        updated_at = excluded.updated_at`
    );
    const updateResponse = this.db.prepare(
      `UPDATE activity_attempt_responses SET awarded_points_units = ?, awarded_points = ?, grading_details_json = ?
       WHERE attempt_id = ? AND question_block_id = ?`
    );
    const insertAudit = this.db.prepare(
      `INSERT INTO activity_grading_audit (
        id, attempt_id, question_block_id, action, previous_awarded_units, awarded_units,
        teacher_feedback, actor_user_id, details_json, created_at
      ) VALUES (?, ?, ?, 'automatic', ?, ?, ?, ?, ?, ?)`
    );

    for (const attempt of attempts) {
      const previousQuestions = questionsForAttempt.all(attempt.id, attempt.id, attempt.versionId) as unknown as Array<{
        blockId: string;
        stableId: string;
        questionType: ActivityQuestionType;
        maximumUnits: number;
        awardedUnits: number | null;
        gradingStatus: 'pending' | 'graded' | 'manual_review' | null;
        gradingDetailsJson: string | null;
        teacherFeedback: string;
      }>;
      let maximumDelta = 0;
      for (const previous of previousQuestions) {
        const next = nextByStableId.get(previous.stableId);
        if (!next || next.questionType !== previous.questionType) continue;
        const oldMaximum = Number(previous.maximumUnits);
        const newMaximum = Number(next.maximumUnits);
        if (oldMaximum === newMaximum) continue;
        upsertMaximum.run(attempt.id, previous.blockId, previous.stableId, newMaximum, timestamp);
        maximumDelta += newMaximum - oldMaximum;
        if (previous.awardedUnits === null) continue;
        let details: Record<string, unknown> = {};
        try { details = previous.gradingDetailsJson ? JSON.parse(previous.gradingDetailsJson) as Record<string, unknown> : {}; }
        catch { details = {}; }
        const recordedFraction = typeof details.correctCount === 'number'
          && typeof details.totalCount === 'number'
          && Number.isFinite(details.correctCount)
          && Number.isFinite(details.totalCount)
          && details.totalCount > 0
          ? Math.min(1, Math.max(0, details.correctCount / details.totalCount))
          : typeof details.fraction === 'number' && Number.isFinite(details.fraction)
            ? Math.min(1, Math.max(0, details.fraction))
            : null;
        const awardedUnits = recordedFraction !== null
          ? Math.round(newMaximum * recordedFraction)
          : oldMaximum > 0
            ? Math.min(newMaximum, Math.max(0, Math.round(Number(previous.awardedUnits) * newMaximum / oldMaximum)))
            : 0;
        const reconciliation = {
          ...details,
          pointsReconciledOnPublish: true,
          previousMaximumUnits: oldMaximum,
          maximumUnits: newMaximum,
          publishedVersionId: newVersionId
        };
        updateResponse.run(
          awardedUnits,
          awardedUnits / 1000,
          JSON.stringify(reconciliation),
          attempt.id,
          previous.blockId
        );
        insertAudit.run(
          createId(),
          attempt.id,
          previous.blockId,
          previous.awardedUnits,
          awardedUnits,
          previous.teacherFeedback,
          actorUserId,
          JSON.stringify({
            reason: 'question_points_changed_on_publish',
            previousMaximumUnits: oldMaximum,
            maximumUnits: newMaximum,
            publishedVersionId: newVersionId
          }),
          timestamp
        );
      }
      if (maximumDelta === 0) continue;
      const aggregate = this.db.prepare(
        `SELECT COALESCE(SUM(awarded_points_units), 0) as scoreUnits,
                SUM(CASE WHEN grading_status = 'manual_review' THEN 1 ELSE 0 END) as pending
         FROM activity_attempt_responses WHERE attempt_id = ?`
      ).get(attempt.id) as { scoreUnits: number; pending: number };
      const maximumUnits = Math.max(0, Number(attempt.maximumUnits) + maximumDelta);
      const pending = Number(aggregate.pending) > 0;
      const scoreUnits = Number(aggregate.scoreUnits);
      this.db.prepare(
        `UPDATE activity_attempts SET maximum_score_units = ?, maximum_score = ?,
          score_units = ?, score = ?, grading_state = CASE
            WHEN ? = 1 THEN 'awaiting_manual_grading'
            WHEN status IN ('auto_submitted', 'expired') THEN 'expired'
            ELSE 'fully_graded'
          END, grading_revision = grading_revision + 1, updated_at = ? WHERE id = ?`
      ).run(
        maximumUnits,
        maximumUnits / 1000,
        pending ? null : scoreUnits,
        pending ? null : scoreUnits / 1000,
        pending ? 1 : 0,
        timestamp,
        attempt.id
      );
    }
  }

  publish(
    userId: string,
    activity: Activity,
    draft: InternalActivityDraft,
    safeSlides: ActivitySlide[],
    expectedRevision: number
  ) {
    const timestamp = nowIso();
    const versionId = createId();
    const publicSnapshot = { settings: activity.settings, slides: safeSlides };
    const contentHash = sha256(JSON.stringify(publicSnapshot));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare(
        `SELECT d.revision FROM activity_drafts d
         INNER JOIN live_activities a ON a.id = d.activity_id
         INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
         WHERE d.activity_id = ? AND a.user_id = ?`
      ).get(activity.id, userId) as { revision: number } | undefined;
      if (!current) throw new Error('Activity not found.');
      if (Number(current.revision) !== expectedRevision || draft.revision !== expectedRevision) throw new Error('Activity draft has changed.');
      const versionNumber = Number((this.db.prepare(
        'SELECT COALESCE(MAX(version_number), 0) + 1 as value FROM activity_versions WHERE activity_id = ?'
      ).get(activity.id) as { value: number }).value);
      this.db.prepare(
        `INSERT INTO activity_versions (
          id, activity_id, version_number, settings_json, content_hash, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(versionId, activity.id, versionNumber, JSON.stringify(activity.settings), contentHash, userId, timestamp);

      const slideStatement = this.db.prepare(
        'INSERT INTO activity_version_slides (id, version_id, stable_id, position, title, description) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const blockStatement = this.db.prepare(
        `INSERT INTO activity_version_blocks (
          id, slide_id, stable_id, position, block_type, question_type, is_graded, points, required, public_config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const keyStatement = this.db.prepare(
        'INSERT INTO activity_version_question_keys (block_id, question_type, key_json) VALUES (?, ?, ?)'
      );

      for (const slide of draft.slides) {
        const versionSlideId = createId();
        slideStatement.run(versionSlideId, versionId, slide.id, slide.position, slide.title, slide.description);
        slide.blocks.forEach((block, position) => {
          const versionBlockId = createId();
          const isQuestion = block.type === 'question';
          const isGraded = isQuestion && activity.settings.gradingEnabled && block.graded;
          blockStatement.run(
            versionBlockId,
            versionSlideId,
            block.id,
            position,
            block.type,
            isQuestion ? block.questionType : null,
            isGraded ? 1 : 0,
            isGraded ? block.points : 0,
            isQuestion && block.required ? 1 : 0,
            JSON.stringify(isQuestion ? { questionType: block.questionType, ...block.config } : block.config)
          );
          if (isGraded && block.answerKey !== null) {
            keyStatement.run(versionBlockId, block.questionType, JSON.stringify(block.answerKey));
          }
        });
      }

      if (versionNumber > 1) {
        this.reconcileFinalizedAttemptPoints(activity.id, versionId, userId, timestamp);
      }

      this.db.prepare('UPDATE activity_models SET published_version_id = ?, updated_at = ? WHERE activity_id = ?')
        .run(versionId, timestamp, activity.id);
      this.db.prepare('UPDATE live_activities SET updated_at = ? WHERE id = ?').run(timestamp, activity.id);
      this.db.exec('COMMIT');
      return { versionId, versionNumber };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getPublishedVersion(userId: string, activityId: string, versionId: string): PublishedActivityVersion | undefined {
    const version = this.db.prepare(
      `SELECT v.id, v.activity_id as activityId, v.version_number as versionNumber,
              v.settings_json as settingsJson, v.content_hash as contentHash, v.published_at as publishedAt
       FROM activity_versions v
       INNER JOIN live_activities a ON a.id = v.activity_id
       WHERE v.id = ? AND v.activity_id = ? AND a.user_id = ?`
    ).get(versionId, activityId, userId) as {
      id: string;
      activityId: string;
      versionNumber: number;
      settingsJson: string;
      contentHash: string;
      publishedAt: string;
    } | undefined;
    if (!version) return undefined;
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
      id: string;
      slideId: string;
      stableId: string;
      position: number;
      type: SlideBlock['type'];
      questionType: string | null;
      graded: number;
      points: number;
      required: number;
      configJson: string;
    }>;
    const blocksBySlide = new Map<string, SlideBlock[]>();
    for (const row of blocks) {
      const config = JSON.parse(row.configJson);
      const block: SlideBlock = row.type === 'question'
        ? {
            id: row.id,
            stableId: row.stableId,
            type: 'question',
            questionType: row.questionType as ActivityQuestionType,
            graded: Boolean(row.graded),
            points: Number(row.points),
            required: Boolean(row.required),
            config
          }
        : { id: row.id, stableId: row.stableId, type: row.type, config } as SlideBlock;
      const existing = blocksBySlide.get(row.slideId) ?? [];
      existing.push(block);
      blocksBySlide.set(row.slideId, existing);
    }
    return {
      id: version.id,
      activityId: version.activityId,
      versionNumber: Number(version.versionNumber),
      settings: normalizeStoredActivitySettings(JSON.parse(version.settingsJson) as ActivitySettings),
      slides: slides.map((slide) => ({
        id: slide.id,
        stableId: slide.stableId,
        position: Number(slide.position),
        title: slide.title,
        description: slide.description,
        blocks: blocksBySlide.get(slide.id) ?? []
      })),
      contentHash: version.contentHash,
      publishedAt: version.publishedAt
    };
  }

  listVersions(userId: string, activityId: string) {
    return this.db.prepare(
      `SELECT v.id, v.version_number as versionNumber, v.content_hash as contentHash, v.published_at as publishedAt
       FROM activity_versions v INNER JOIN live_activities a ON a.id = v.activity_id
       WHERE v.activity_id = ? AND a.user_id = ? ORDER BY v.version_number DESC`
    ).all(activityId, userId) as unknown as Array<{ id: string; versionNumber: number; contentHash: string; publishedAt: string }>;
  }

  setArchived(userId: string, activityId: string, archived: boolean) {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owned = this.db.prepare(
        `SELECT a.id FROM live_activities a INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
         WHERE a.id = ? AND a.user_id = ?`
      ).get(activityId, userId);
      if (!owned) throw new Error('Activity not found.');
      this.db.prepare('UPDATE activity_models SET archived_at = ?, updated_at = ? WHERE activity_id = ?')
        .run(archived ? timestamp : null, timestamp, activityId);
      if (archived) this.db.prepare("UPDATE live_activities SET status = 'closed', updated_at = ? WHERE id = ?").run(timestamp, activityId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  delete(userId: string, activityId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owned = this.db.prepare(
        `SELECT a.id FROM live_activities a INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
         WHERE a.id = ? AND a.user_id = ?`
      ).get(activityId, userId);
      if (!owned) throw new Error('Activity not found.');
      this.db.prepare('DELETE FROM activity_attempts WHERE activity_id = ?').run(activityId);
      this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'live_activity' AND resource_id = ?`).run(activityId);
      this.db.prepare('DELETE FROM live_activities WHERE id = ? AND user_id = ?').run(activityId, userId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearResults(userId: string, activityId: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const owned = this.db.prepare(
        `SELECT a.id FROM live_activities a INNER JOIN activity_models m ON m.activity_id = a.id AND m.model = 'slides_v1'
         WHERE a.id = ? AND a.user_id = ?`
      ).get(activityId, userId);
      if (!owned) throw new Error('Activity not found.');
      const result = this.db.prepare('DELETE FROM activity_attempts WHERE activity_id = ?').run(activityId);
      this.db.exec('COMMIT');
      return Number(result.changes);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
