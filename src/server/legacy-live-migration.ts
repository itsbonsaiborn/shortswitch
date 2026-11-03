import type { DatabaseSync } from 'node:sqlite';
import { createId, nowIso, sha256 } from './utils.js';

type LegacyQuestionType = 'open_answer' | 'word_cloud' | 'multiple_choice' | 'scale' | 'missing';

interface LegacyCandidate {
  id: string;
  userId: string;
  slug: string;
  title: string;
  status: 'active' | 'closed';
  identityMode: 'anonymous' | 'named';
  allowMultipleResponses: number;
  maxResponsesPerParticipant: number;
  moderationMode: 'off' | 'filter_only' | 'review_all';
  publicResults: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  questionId: string;
  questionType: LegacyQuestionType;
  prompt: string;
  allowMultipleChoices: number;
  maxAnswerLength: number;
  questionCount: number;
  responseCount: number;
  viewCount: number;
}

export interface LegacyLiveMigrationReport {
  migrated: number;
  unsupported: number;
  failed: number;
  skipped: number;
}

const createAuditTable = (db: DatabaseSync) => db.exec(`
  CREATE TABLE IF NOT EXISTS legacy_activity_migrations (
    activity_id TEXT PRIMARY KEY,
    source_question_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('migrated', 'unsupported', 'error')),
    message TEXT NOT NULL,
    legacy_response_count INTEGER NOT NULL DEFAULT 0,
    legacy_view_count INTEGER NOT NULL DEFAULT 0,
    migrated_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES live_activities(id) ON DELETE CASCADE,
    FOREIGN KEY (migrated_version_id) REFERENCES activity_versions(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_legacy_activity_migrations_status
    ON legacy_activity_migrations(status, updated_at DESC);
`);

const recordResult = (
  db: DatabaseSync,
  candidate: LegacyCandidate,
  status: 'migrated' | 'unsupported' | 'error',
  message: string,
  versionId: string | null,
  timestamp: string
) => db.prepare(`
  INSERT INTO legacy_activity_migrations (
    activity_id, source_question_type, status, message, legacy_response_count,
    legacy_view_count, migrated_version_id, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(activity_id) DO UPDATE SET
    source_question_type = excluded.source_question_type,
    status = excluded.status,
    message = excluded.message,
    legacy_response_count = excluded.legacy_response_count,
    legacy_view_count = excluded.legacy_view_count,
    migrated_version_id = excluded.migrated_version_id,
    updated_at = excluded.updated_at
`).run(
  candidate.id,
  candidate.questionType,
  status,
  message.slice(0, 1000),
  candidate.responseCount,
  candidate.viewCount,
  versionId,
  timestamp,
  timestamp
);

const settingsFor = (candidate: LegacyCandidate) => ({
  title: candidate.title,
  description: '',
  slug: candidate.slug,
  status: candidate.status,
  identityMode: candidate.identityMode,
  requiredAnswerBehavior: 'allow_incomplete' as const,
  navigationPolicy: 'linear' as const,
  resultVisibility: candidate.publicResults ? 'after_submission' as const : 'never' as const,
  feedbackPolicy: 'none' as const,
  gradingEnabled: false,
  defaultQuestionPoints: 1,
  theme: 'minimal_light',
  layout: 'classic',
  backgroundPattern: 'none',
  patternIntensity: 35,
  maximumAttempts: candidate.allowMultipleResponses
    ? Math.max(1, Math.min(100, candidate.maxResponsesPerParticipant))
    : 1,
  attemptTimeLimitSeconds: null,
  availabilityStartAt: null,
  submissionDeadlineAt: candidate.expiresAt,
  submissionDeadlineTimezone: 'UTC',
  lowTimeWarningSeconds: 300,
  shuffleQuestionOptions: false,
  shuffleSlides: false,
  allowBackNavigation: true
});

const migrateCandidate = (db: DatabaseSync, candidate: LegacyCandidate) => {
  if (candidate.questionCount !== 1) {
    return { status: 'unsupported' as const, message: `Expected one legacy question, found ${candidate.questionCount}.` };
  }
  if (candidate.questionType !== 'word_cloud' && candidate.questionType !== 'multiple_choice') {
    return { status: 'unsupported' as const, message: `${candidate.questionType} remains on the legacy runtime in this release.` };
  }

  const options = db.prepare(`
    SELECT id, label FROM live_question_options WHERE question_id = ? ORDER BY position
  `).all(candidate.questionId) as unknown as Array<{ id: string; label: string }>;
  if (candidate.questionType === 'multiple_choice' && options.length < 2) {
    return { status: 'unsupported' as const, message: 'Multiple Choice requires at least two options.' };
  }

  const settings = settingsFor(candidate);
  const timestamp = nowIso();
  const slideId = createId();
  const blockId = createId();
  const versionId = createId();
  const versionSlideId = createId();
  const versionBlockId = createId();
  const questionType = candidate.questionType === 'word_cloud'
    ? 'word_cloud'
    : candidate.allowMultipleChoices ? 'multiple_choice' : 'single_choice';
  const config = candidate.questionType === 'word_cloud'
    ? {
        prompt: candidate.prompt,
        instructions: '',
        maximumLength: Math.max(1, Math.min(500, candidate.maxAnswerLength)),
        allowMultipleResponses: Boolean(candidate.allowMultipleResponses),
        maximumResponses: candidate.allowMultipleResponses
          ? Math.max(1, Math.min(20, candidate.maxResponsesPerParticipant))
          : 1,
        moderationMode: candidate.moderationMode,
        showResults: Boolean(candidate.publicResults),
        showParticipantNames: false,
        gradingMode: 'ungraded'
      }
    : questionType === 'multiple_choice'
      ? {
          prompt: candidate.prompt,
          description: '',
          options,
          minimumSelections: 1,
          maximumSelections: options.length,
          shuffleOptions: false,
          gradingMode: 'all_or_nothing'
        }
      : {
          prompt: candidate.prompt,
          description: '',
          options,
          shuffleOptions: false
        };
  const publicBlock = {
    id: blockId,
    type: 'question' as const,
    questionType,
    graded: false,
    points: 0,
    required: false,
    config
  };
  const publicSnapshot = {
    settings,
    slides: [{ id: slideId, stableId: slideId, position: 0, title: '', description: '', blocks: [publicBlock] }]
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO activity_models (
        activity_id, model, description, required_answer_behavior, navigation_policy,
        result_visibility, feedback_policy, grading_enabled, default_question_points,
        maximum_attempts, attempt_time_limit_seconds,
        availability_start_at, submission_deadline_at, submission_deadline_timezone,
        low_time_warning_seconds, shuffle_question_options, published_version_id,
        created_at, updated_at
      ) VALUES (?, 'slides_v1', '', 'allow_incomplete', 'linear', ?, 'none', 0, 1, ?, NULL,
        NULL, ?, 'UTC', 300, 0, NULL, ?, ?)
    `).run(
      candidate.id,
      settings.resultVisibility,
      settings.maximumAttempts,
      settings.submissionDeadlineAt,
      candidate.createdAt,
      candidate.updatedAt
    );
    db.prepare('INSERT INTO activity_drafts (activity_id, revision, created_at, updated_at) VALUES (?, 0, ?, ?)')
      .run(candidate.id, timestamp, timestamp);
    db.prepare(`
      INSERT INTO activity_draft_slides (id, activity_id, position, title, description, created_at, updated_at)
      VALUES (?, ?, 0, '', '', ?, ?)
    `).run(slideId, candidate.id, timestamp, timestamp);
    db.prepare(`
      INSERT INTO activity_draft_blocks (
        id, slide_id, position, block_type, question_type, is_graded, points, required,
        public_config_json, created_at, updated_at
      ) VALUES (?, ?, 0, 'question', ?, 0, 0, 0, ?, ?, ?)
    `).run(blockId, slideId, questionType, JSON.stringify(config), timestamp, timestamp);
    db.prepare(`
      INSERT INTO activity_versions (
        id, activity_id, version_number, settings_json, content_hash, published_by, published_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?)
    `).run(versionId, candidate.id, JSON.stringify(settings), sha256(JSON.stringify(publicSnapshot)), candidate.userId, timestamp);
    db.prepare(`
      INSERT INTO activity_version_slides (id, version_id, stable_id, position, title, description)
      VALUES (?, ?, ?, 0, '', '')
    `).run(versionSlideId, versionId, slideId);
    db.prepare(`
      INSERT INTO activity_version_blocks (
        id, slide_id, stable_id, position, block_type, question_type, is_graded,
        points, required, public_config_json
      ) VALUES (?, ?, ?, 0, 'question', ?, 0, 0, 0, ?)
    `).run(versionBlockId, versionSlideId, blockId, questionType, JSON.stringify({ questionType, ...config }));
    db.prepare('UPDATE activity_models SET published_version_id = ? WHERE activity_id = ?')
      .run(versionId, candidate.id);
    recordResult(
      db,
      candidate,
      'migrated',
      'Converted to an ungraded immutable Activity version; legacy responses and views remain authoritative historical records.',
      versionId,
      timestamp
    );
    db.exec('COMMIT');
    return { status: 'migrated' as const, message: 'Migrated.', versionId };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};

export const migrateLegacyLiveActivities = (db: DatabaseSync): LegacyLiveMigrationReport => {
  createAuditTable(db);
  const candidates = db.prepare(`
    SELECT
      a.id, a.user_id as userId, a.slug, a.title, a.status,
      a.identity_mode as identityMode,
      a.allow_multiple_responses as allowMultipleResponses,
      a.max_responses_per_participant as maxResponsesPerParticipant,
      a.moderation_mode as moderationMode,
      a.public_results as publicResults,
      a.expires_at as expiresAt,
      a.created_at as createdAt,
      a.updated_at as updatedAt,
      COALESCE(q.id, '') as questionId,
      COALESCE(q.question_type, 'missing') as questionType,
      COALESCE(q.prompt, '') as prompt,
      COALESCE(q.allow_multiple_choices, 0) as allowMultipleChoices,
      COALESCE(q.max_answer_length, 500) as maxAnswerLength,
      (SELECT COUNT(*) FROM live_questions allq WHERE allq.activity_id = a.id) as questionCount,
      (SELECT COUNT(*) FROM live_responses r WHERE r.activity_id = a.id) as responseCount,
      (SELECT COUNT(*) FROM live_views v WHERE v.activity_id = a.id) as viewCount
    FROM live_activities a
    LEFT JOIN live_questions q ON q.activity_id = a.id AND q.position = 0
    LEFT JOIN activity_models m ON m.activity_id = a.id
    LEFT JOIN legacy_activity_migrations migration ON migration.activity_id = a.id
    WHERE m.activity_id IS NULL AND (migration.activity_id IS NULL OR migration.status = 'error')
    ORDER BY a.created_at, a.id
  `).all() as unknown as LegacyCandidate[];
  const report: LegacyLiveMigrationReport = { migrated: 0, unsupported: 0, failed: 0, skipped: 0 };

  for (const candidate of candidates) {
    try {
      const result = migrateCandidate(db, candidate);
      if (result.status === 'migrated') report.migrated += 1;
      else {
        recordResult(db, candidate, 'unsupported', result.message, null, nowIso());
        report.unsupported += 1;
      }
    } catch (error) {
      recordResult(db, candidate, 'error', (error as Error).message || 'Unknown migration error.', null, nowIso());
      report.failed += 1;
    }
  }
  report.skipped = Number((db.prepare(`
    SELECT COUNT(*) as count FROM live_activities a
    WHERE EXISTS (SELECT 1 FROM activity_models m WHERE m.activity_id = a.id)
       OR EXISTS (SELECT 1 FROM legacy_activity_migrations migration WHERE migration.activity_id = a.id)
  `).get() as { count: number }).count);
  return report;
};
