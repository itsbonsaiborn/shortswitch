import type {
  LiveActivityInput,
  LiveActivitySummary,
  LiveQuestionOption,
  LiveResponseRecord,
  LiveResponseStatus,
  LiveResultsSnapshot,
  ModerationMatchMode,
  ModerationRule
} from '@/shared/types.js';
import { getDb } from '../db.js';
import { buildShortUrl, createId, nowIso } from '../utils.js';

interface LiveActivityRow {
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
  lastResponseAt: string | null;
  publicRevision: number;
  questionId: string;
  question: string;
  type: LiveActivitySummary['type'];
  allowMultipleChoices: number;
  maxAnswerLength: number;
  scaleMin: number | null;
  scaleMax: number | null;
  responseCount: number;
  uniqueParticipantCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
}

interface SubmitResponseInput {
  activityId: string;
  participantToken: string;
  participantName: string | null;
  originalText: string | null;
  publishedText: string | null;
  selectedOptionIds: string[];
  scaleValue: number | null;
  moderationStatus: LiveResponseStatus;
  moderationReason: string | null;
}

const activitySelect = `
  SELECT
    a.id,
    a.user_id as userId,
    a.slug,
    a.title,
    a.status,
    a.identity_mode as identityMode,
    a.allow_multiple_responses as allowMultipleResponses,
    a.max_responses_per_participant as maxResponsesPerParticipant,
    a.moderation_mode as moderationMode,
    a.public_results as publicResults,
    a.expires_at as expiresAt,
    a.created_at as createdAt,
    a.updated_at as updatedAt,
    a.last_response_at as lastResponseAt,
    a.public_revision as publicRevision,
    q.id as questionId,
    q.prompt as question,
    q.question_type as type,
    q.allow_multiple_choices as allowMultipleChoices,
    q.max_answer_length as maxAnswerLength,
    q.scale_min as scaleMin,
    q.scale_max as scaleMax,
    (SELECT COUNT(*) FROM live_responses r WHERE r.activity_id = a.id) as responseCount,
    (SELECT COUNT(DISTINCT participant_id) FROM live_responses r WHERE r.activity_id = a.id) as uniqueParticipantCount,
    (SELECT COUNT(*) FROM live_responses r WHERE r.activity_id = a.id AND r.moderation_status = 'approved') as approvedCount,
    (SELECT COUNT(*) FROM live_responses r WHERE r.activity_id = a.id AND r.moderation_status = 'pending') as pendingCount,
    (SELECT COUNT(*) FROM live_responses r WHERE r.activity_id = a.id AND r.moderation_status = 'rejected') as rejectedCount
  FROM live_activities a
  INNER JOIN live_questions q ON q.activity_id = a.id AND q.position = 0
`;

const activityRuntimeSelect = `
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
    a.last_response_at as lastResponseAt,
    a.public_revision as publicRevision,
    q.id as questionId,
    q.prompt as question,
    q.question_type as type,
    q.allow_multiple_choices as allowMultipleChoices,
    q.max_answer_length as maxAnswerLength,
    q.scale_min as scaleMin,
    q.scale_max as scaleMax,
    0 as responseCount,
    0 as uniqueParticipantCount,
    0 as approvedCount,
    0 as pendingCount,
    0 as rejectedCount
  FROM live_activities a
  INNER JOIN live_questions q ON q.activity_id = a.id AND q.position = 0
`;

export class LiveRepository {
  private db = getDb();

  private getOptions(questionId: string): LiveQuestionOption[] {
    return this.db
      .prepare(
        `SELECT id, label, position
         FROM live_question_options
         WHERE question_id = ?
         ORDER BY position ASC`
      )
      .all(questionId) as unknown as LiveQuestionOption[];
  }

  private toSummary(row: LiveActivityRow): LiveActivitySummary {
    return {
      id: row.id,
      slug: row.slug,
      publicUrl: buildShortUrl(row.slug),
      title: row.title,
      question: row.question,
      type: row.type,
      status: row.status,
      identityMode: row.identityMode,
      allowMultipleResponses: Boolean(row.allowMultipleResponses),
      maxResponsesPerParticipant: row.maxResponsesPerParticipant,
      moderationMode: row.moderationMode,
      publicResults: Boolean(row.publicResults),
      expiresAt: row.expiresAt,
      maxAnswerLength: row.maxAnswerLength,
      allowMultipleChoices: Boolean(row.allowMultipleChoices),
      options: this.getOptions(row.questionId),
      scaleMin: row.scaleMin,
      scaleMax: row.scaleMax,
      responseCount: Number(row.responseCount),
      uniqueParticipantCount: Number(row.uniqueParticipantCount),
      approvedCount: Number(row.approvedCount),
      pendingCount: Number(row.pendingCount),
      rejectedCount: Number(row.rejectedCount),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastResponseAt: row.lastResponseAt,
      publicRevision: Number(row.publicRevision)
    };
  }

  list(userId: string) {
    const rows = this.db
      .prepare(`${activitySelect} WHERE a.user_id = ? ORDER BY a.created_at DESC`)
      .all(userId) as unknown as LiveActivityRow[];
    return rows.map((row) => this.toSummary(row));
  }

  findById(id: string) {
    const row = this.db
      .prepare(`${activitySelect} WHERE a.id = ?`)
      .get(id) as unknown as LiveActivityRow | undefined;
    return row ? this.toSummary(row) : undefined;
  }

  findBySlug(slug: string) {
    const row = this.db
      .prepare(`${activitySelect} WHERE a.slug = ?`)
      .get(slug) as unknown as LiveActivityRow | undefined;
    return row ? this.toSummary(row) : undefined;
  }

  findByIdRuntime(id: string) {
    const row = this.db
      .prepare(`${activityRuntimeSelect} WHERE a.id = ?`)
      .get(id) as unknown as LiveActivityRow | undefined;
    return row ? this.toSummary(row) : undefined;
  }

  findBySlugRuntime(slug: string) {
    const row = this.db
      .prepare(`${activityRuntimeSelect} WHERE a.slug = ?`)
      .get(slug) as unknown as LiveActivityRow | undefined;
    return row ? this.toSummary(row) : undefined;
  }

  getOwnerId(activityId: string) {
    return (this.db
      .prepare('SELECT user_id as userId FROM live_activities WHERE id = ?')
      .get(activityId) as { userId: string } | undefined)?.userId;
  }

  create(userId: string, slug: string, input: LiveActivityInput, expiresAt: string | null) {
    const activityId = createId();
    const questionId = createId();
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `INSERT INTO public_slugs (slug, resource_type, resource_id, created_at)
           VALUES (?, 'live_activity', ?, ?)`
        )
        .run(slug, activityId, timestamp);
      this.db
        .prepare(
          `INSERT INTO live_activities (
            id, user_id, slug, title, status, identity_mode, allow_multiple_responses,
            max_responses_per_participant, moderation_mode, public_results, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          activityId,
          userId,
          slug,
          input.title,
          input.status,
          input.identityMode,
          input.allowMultipleResponses ? 1 : 0,
          input.maxResponsesPerParticipant,
          input.moderationMode,
          input.publicResults === false ? 0 : 1,
          expiresAt,
          timestamp,
          timestamp
        );
      this.db
        .prepare(
          `INSERT INTO live_questions (
            id, activity_id, position, question_type, prompt, allow_multiple_choices,
            max_answer_length, scale_min, scale_max, created_at, updated_at
          ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          questionId,
          activityId,
          input.type,
          input.question,
          input.allowMultipleChoices ? 1 : 0,
          input.maxAnswerLength,
          input.scaleMin ?? null,
          input.scaleMax ?? null,
          timestamp,
          timestamp
        );
      this.replaceOptions(questionId, input.options ?? []);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(activityId)!;
  }

  update(id: string, slug: string, input: LiveActivityInput, expiresAt: string | null) {
    const current = this.findById(id);
    if (!current) return undefined;
    const timestamp = nowIso();
    const questionId = this.db
      .prepare('SELECT id FROM live_questions WHERE activity_id = ? AND position = 0')
      .get(id) as { id: string };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (slug !== current.slug) {
        this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'live_activity' AND resource_id = ?`).run(id);
        this.db
          .prepare(
            `INSERT INTO public_slugs (slug, resource_type, resource_id, created_at)
             VALUES (?, 'live_activity', ?, ?)`
          )
          .run(slug, id, timestamp);
      }
      this.db
        .prepare(
          `UPDATE live_activities
           SET slug = ?, title = ?, status = ?, identity_mode = ?, allow_multiple_responses = ?,
                max_responses_per_participant = ?, moderation_mode = ?, public_results = ?, expires_at = ?, updated_at = ?
                 , public_revision = public_revision + 1
           WHERE id = ?`
        )
        .run(
          slug,
          input.title,
          input.status,
          input.identityMode,
          input.allowMultipleResponses ? 1 : 0,
          input.maxResponsesPerParticipant,
          input.moderationMode,
          input.publicResults === false ? 0 : 1,
          expiresAt,
          timestamp,
          id
        );
      this.db
        .prepare(
          `UPDATE live_questions
           SET question_type = ?, prompt = ?, allow_multiple_choices = ?, max_answer_length = ?,
               scale_min = ?, scale_max = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.type,
          input.question,
          input.allowMultipleChoices ? 1 : 0,
          input.maxAnswerLength,
          input.scaleMin ?? null,
          input.scaleMax ?? null,
          timestamp,
          questionId.id
        );
      this.syncOptions(questionId.id, input.options ?? []);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.findById(id)!;
  }

  private replaceOptions(questionId: string, labels: string[]) {
    const insert = this.db.prepare(
      `INSERT INTO live_question_options (id, question_id, position, label) VALUES (?, ?, ?, ?)`
    );
    labels.forEach((label, position) => insert.run(createId(), questionId, position, label));
  }

  private syncOptions(questionId: string, labels: string[]) {
    const current = this.getOptions(questionId);
    if (current.length !== labels.length) {
      this.db.prepare('DELETE FROM live_question_options WHERE question_id = ?').run(questionId);
      this.replaceOptions(questionId, labels);
      return;
    }
    const update = this.db.prepare(
      `UPDATE live_question_options SET label = ?, position = ? WHERE id = ? AND question_id = ?`
    );
    labels.forEach((label, position) => update.run(label, position, current[position].id, questionId));
  }

  delete(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM live_activities WHERE id = ?').run(id);
      this.db.prepare(`DELETE FROM public_slugs WHERE resource_type = 'live_activity' AND resource_id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearResponses(id: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const responses = this.db.prepare('DELETE FROM live_responses WHERE activity_id = ?').run(id).changes;
      const participants = this.db.prepare('DELETE FROM live_participants WHERE activity_id = ?').run(id).changes;
      this.db
        .prepare('UPDATE live_activities SET last_response_at = NULL, public_revision = public_revision + 1, updated_at = ? WHERE id = ?')
        .run(nowIso(), id);
      this.db.exec('COMMIT');
      return Number(responses) + Number(participants);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  clearAllResponses(userId: string) {
    const activityIds = (this.db
      .prepare('SELECT id FROM live_activities WHERE user_id = ?')
      .all(userId) as unknown as Array<{ id: string }>).map((row) => row.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const responses = this.db
        .prepare('DELETE FROM live_responses WHERE activity_id IN (SELECT id FROM live_activities WHERE user_id = ?)')
        .run(userId).changes;
      const participants = this.db
        .prepare('DELETE FROM live_participants WHERE activity_id IN (SELECT id FROM live_activities WHERE user_id = ?)')
        .run(userId).changes;
      this.db
        .prepare('UPDATE live_activities SET last_response_at = NULL, public_revision = public_revision + 1, updated_at = ? WHERE user_id = ?')
        .run(nowIso(), userId);
      this.db.exec('COMMIT');
      return { activityIds, deletedRows: Number(responses) + Number(participants) };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setStatus(id: string, status: 'active' | 'closed', expiresAt?: string | null) {
    this.db
      .prepare('UPDATE live_activities SET status = ?, expires_at = ?, updated_at = ?, public_revision = public_revision + 1 WHERE id = ?')
      .run(status, expiresAt ?? null, nowIso(), id);
    return this.findById(id);
  }

  getParticipantResponseCount(activityId: string, participantToken: string) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM live_responses r
         INNER JOIN live_participants p ON p.id = r.participant_id
         WHERE r.activity_id = ? AND p.participant_token = ?`
      )
      .get(activityId, participantToken) as { count: number };
    return Number(row.count);
  }

  submitResponse(input: SubmitResponseInput) {
    const timestamp = nowIso();
    const responseId = createId();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const activity = this.db
        .prepare(
          `SELECT status, expires_at as expiresAt, identity_mode as identityMode, allow_multiple_responses as allowMultipleResponses,
                  max_responses_per_participant as maxResponsesPerParticipant
           FROM live_activities WHERE id = ?`
        )
        .get(input.activityId) as {
          status: 'active' | 'closed';
          expiresAt: string | null;
          identityMode: 'anonymous' | 'named';
          allowMultipleResponses: number;
          maxResponsesPerParticipant: number;
        } | undefined;
      if (!activity) throw new Error('Activity not found.');
      if (activity.status !== 'active') throw new Error('This activity is closed.');
      if (activity.expiresAt && activity.expiresAt <= timestamp) throw new Error('This activity has expired.');

      let participant = this.db
        .prepare(
          `SELECT id FROM live_participants WHERE activity_id = ? AND participant_token = ?`
        )
        .get(input.activityId, input.participantToken) as { id: string } | undefined;
      if (!participant) {
        participant = { id: createId() };
        this.db
          .prepare(
            `INSERT INTO live_participants (
              id, activity_id, participant_token, display_name, created_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            participant.id,
            input.activityId,
            input.participantToken,
            activity.identityMode === 'named' ? input.participantName : null,
            timestamp,
            timestamp
          );
      } else {
        this.db
          .prepare(
            `UPDATE live_participants SET display_name = ?, last_seen_at = ? WHERE id = ?`
          )
          .run(activity.identityMode === 'named' ? input.participantName : null, timestamp, participant.id);
      }

      const count = this.db
        .prepare('SELECT COUNT(*) as count FROM live_responses WHERE activity_id = ? AND participant_id = ?')
        .get(input.activityId, participant.id) as { count: number };
      const maximum = activity.allowMultipleResponses ? activity.maxResponsesPerParticipant : 1;
      if (Number(count.count) >= maximum) {
        throw new Error('Response limit reached for this activity.');
      }

      const question = this.db
        .prepare('SELECT id FROM live_questions WHERE activity_id = ? AND position = 0')
        .get(input.activityId) as { id: string };
      this.db
        .prepare(
          `INSERT INTO live_responses (
            id, activity_id, question_id, participant_id, participant_name, published_participant_name,
            original_text, published_text,
            selected_options_json, scale_value, moderation_status, moderation_reason,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          responseId,
          input.activityId,
          question.id,
          participant.id,
          activity.identityMode === 'named' ? input.participantName : null,
          activity.identityMode === 'named' ? input.participantName : null,
          input.originalText,
          input.publishedText,
          JSON.stringify(input.selectedOptionIds),
          input.scaleValue,
          input.moderationStatus,
          input.moderationReason,
          timestamp,
          timestamp
        );
      this.db
        .prepare('UPDATE live_activities SET last_response_at = ?, updated_at = ?, public_revision = public_revision + ? WHERE id = ?')
        .run(timestamp, timestamp, input.moderationStatus === 'approved' ? 1 : 0, input.activityId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getResponse(responseId)!;
  }

  getResponse(responseId: string) {
    const row = this.db
      .prepare(
        `SELECT
          r.id,
          r.activity_id as activityId,
          COALESCE(r.participant_name, p.display_name) as originalParticipantName,
          COALESCE(r.published_participant_name, r.participant_name, p.display_name) as participantName,
          r.original_text as originalText,
          r.published_text as publishedText,
          r.selected_options_json as selectedOptionsJson,
          r.scale_value as scaleValue,
          r.moderation_status as status,
          r.moderation_reason as moderationReason,
          r.edited_by_moderator as editedByModerator,
          r.name_edited_by_moderator as nameEditedByModerator,
          r.created_at as createdAt,
          r.updated_at as updatedAt
         FROM live_responses r
         INNER JOIN live_participants p ON p.id = r.participant_id
         WHERE r.id = ?`
      )
      .get(responseId) as unknown as (Omit<LiveResponseRecord, 'selectedOptionIds' | 'editedByModerator' | 'nameEditedByModerator'> & {
        selectedOptionsJson: string;
        editedByModerator: number;
        nameEditedByModerator: number;
      }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      selectedOptionIds: JSON.parse(row.selectedOptionsJson) as string[],
      editedByModerator: Boolean(row.editedByModerator),
      nameEditedByModerator: Boolean(row.nameEditedByModerator)
    };
  }

  listResponses(activityId: string): LiveResponseRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          r.id,
          r.activity_id as activityId,
          COALESCE(r.participant_name, p.display_name) as originalParticipantName,
          COALESCE(r.published_participant_name, r.participant_name, p.display_name) as participantName,
          r.original_text as originalText,
          r.published_text as publishedText,
          r.selected_options_json as selectedOptionsJson,
          r.scale_value as scaleValue,
          r.moderation_status as status,
          r.moderation_reason as moderationReason,
          r.edited_by_moderator as editedByModerator,
          r.name_edited_by_moderator as nameEditedByModerator,
          r.created_at as createdAt,
          r.updated_at as updatedAt
         FROM live_responses r
         INNER JOIN live_participants p ON p.id = r.participant_id
         WHERE r.activity_id = ?
         ORDER BY r.created_at DESC`
      )
      .all(activityId) as unknown as Array<Omit<LiveResponseRecord, 'selectedOptionIds' | 'editedByModerator' | 'nameEditedByModerator'> & {
        selectedOptionsJson: string;
        editedByModerator: number;
        nameEditedByModerator: number;
      }>;
    return rows.map((row) => ({
      ...row,
      selectedOptionIds: JSON.parse(row.selectedOptionsJson) as string[],
      editedByModerator: Boolean(row.editedByModerator),
      nameEditedByModerator: Boolean(row.nameEditedByModerator)
    }));
  }

  moderateResponse(
    responseId: string,
    userId: string,
    status: LiveResponseStatus,
    publishedText: string | null,
    participantName: string | null,
    reason: string | null
  ) {
    const current = this.getResponse(responseId);
    if (!current) return undefined;
    const edited = publishedText !== null && publishedText !== current.originalText;
    const nameEdited = participantName !== null && participantName !== current.originalParticipantName;
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare(
          `UPDATE live_responses
           SET moderation_status = ?, published_text = ?, moderation_reason = ?, edited_by_moderator = ?,
               published_participant_name = ?, name_edited_by_moderator = ?, moderated_by = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(status, publishedText, reason, edited ? 1 : 0, participantName, nameEdited ? 1 : 0, userId, timestamp, responseId);
      this.db
        .prepare('UPDATE live_activities SET updated_at = ?, public_revision = public_revision + 1 WHERE id = ?')
        .run(timestamp, current.activityId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getResponse(responseId);
  }

  getResults(
    activity: LiveActivitySummary,
    options: { openAnswerLimit?: number; wordCloudLimit?: number } = {}
  ): LiveResultsSnapshot {
    const stats = this.db
      .prepare(
        `SELECT COUNT(*) as responseCount, COUNT(DISTINCT participant_id) as uniqueParticipantCount
         FROM live_responses
         WHERE activity_id = ? AND moderation_status = 'approved'`
      )
      .get(activity.id) as { responseCount: number; uniqueParticipantCount: number };
    const responseCount = Number(stats.responseCount);
    const uniqueParticipantCount = Number(stats.uniqueParticipantCount);
    const openAnswerLimit = options.openAnswerLimit;
    const openAnswerSql = `
      SELECT r.id, r.published_text as text,
             COALESCE(r.published_participant_name, r.participant_name, p.display_name) as participantName,
             r.edited_by_moderator as editedByModerator, r.created_at as createdAt
      FROM live_responses r
      INNER JOIN live_participants p ON p.id = r.participant_id
      WHERE r.activity_id = ? AND r.moderation_status = 'approved'
      ORDER BY r.created_at DESC, r.id DESC${openAnswerLimit === undefined ? '' : ' LIMIT ?'}`;
    const openAnswerRows = activity.type === 'open_answer'
      ? (openAnswerLimit === undefined
          ? this.db.prepare(openAnswerSql).all(activity.id)
          : this.db.prepare(openAnswerSql).all(activity.id, openAnswerLimit)) as unknown as Array<{
            id: string;
            text: string;
            participantName: string | null;
            editedByModerator: number;
            createdAt: string;
          }>
      : [];
    const openAnswers = openAnswerRows.map((response) => ({
      ...response,
      text: response.text ?? '',
      editedByModerator: Boolean(response.editedByModerator)
    }));
    const lastOpenAnswer = openAnswers.at(-1);
    const wordCounts = new Map<string, { text: string; count: number }>();
    if (activity.type === 'word_cloud') {
      const rows = this.db
        .prepare(
          `SELECT published_text as publishedText FROM live_responses
           WHERE activity_id = ? AND moderation_status = 'approved'`
        )
        .all(activity.id) as unknown as Array<{ publishedText: string | null }>;
      for (const response of rows) {
        const text = (response.publishedText ?? '').trim().replace(/\s+/gu, ' ');
        const key = text.normalize('NFKC').toLocaleLowerCase();
        const current = wordCounts.get(key);
        wordCounts.set(key, current ? { ...current, count: current.count + 1 } : { text, count: 1 });
      }
    }
    const allWordCloud = [...wordCounts.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
    const wordCloud = options.wordCloudLimit === undefined
      ? allWordCloud
      : allWordCloud.slice(0, options.wordCloudLimit);
    const choiceCounts = new Map(activity.options.map((option) => [option.id, 0]));
    if (activity.type === 'multiple_choice') {
      const rows = this.db
        .prepare(
          `SELECT selected_options_json as selectedOptionsJson FROM live_responses
           WHERE activity_id = ? AND moderation_status = 'approved'`
        )
        .all(activity.id) as unknown as Array<{ selectedOptionsJson: string | null }>;
      for (const response of rows) {
        const optionIds = JSON.parse(response.selectedOptionsJson ?? '[]') as string[];
        for (const optionId of optionIds) {
          if (choiceCounts.has(optionId)) choiceCounts.set(optionId, (choiceCounts.get(optionId) ?? 0) + 1);
        }
      }
    }
    const scaleRows = activity.type === 'scale'
      ? this.db
          .prepare(
            `SELECT scale_value as value, COUNT(*) as count
             FROM live_responses
             WHERE activity_id = ? AND moderation_status = 'approved' AND scale_value IS NOT NULL
             GROUP BY scale_value`
          )
          .all(activity.id) as unknown as Array<{ value: number; count: number }>
      : [];
    const scaleCounts = new Map(scaleRows.map((row) => [Number(row.value), Number(row.count)]));
    const scaleDistribution = activity.type === 'scale' && activity.scaleMin !== null && activity.scaleMax !== null
      ? Array.from({ length: activity.scaleMax - activity.scaleMin + 1 }, (_, index) => ({
          value: activity.scaleMin! + index,
          count: scaleCounts.get(activity.scaleMin! + index) ?? 0
        }))
      : [];
    const scaleTotal = scaleRows.reduce((sum, row) => sum + Number(row.count), 0);
    const scaleSum = scaleRows.reduce((sum, row) => sum + Number(row.value) * Number(row.count), 0);

    return {
      activityId: activity.id,
      slug: activity.slug,
      type: activity.type,
      status: activity.status,
      publicResults: activity.publicResults,
      responseCount,
      uniqueParticipantCount,
      openAnswers,
      openAnswerTotal: activity.type === 'open_answer' ? responseCount : 0,
      openAnswerNextCursor: activity.type === 'open_answer' && openAnswerLimit !== undefined && responseCount > openAnswers.length && lastOpenAnswer
        ? Buffer.from(JSON.stringify({ createdAt: lastOpenAnswer.createdAt, id: lastOpenAnswer.id })).toString('base64url')
        : null,
      wordCloud,
      wordCloudTotal: allWordCloud.length,
      choices: activity.options.map((option) => ({
        id: option.id,
        label: option.label,
        count: choiceCounts.get(option.id) ?? 0,
        percentage: responseCount
          ? Number((((choiceCounts.get(option.id) ?? 0) / responseCount) * 100).toFixed(1))
          : 0
      })),
      scale: activity.type === 'scale'
        ? {
            average: scaleTotal
              ? Number((scaleSum / scaleTotal).toFixed(2))
              : null,
            distribution: scaleDistribution
          }
        : null,
      revision: activity.publicRevision
    };
  }

  listApprovedOpenAnswers(
    activityId: string,
    limit: number,
    before?: { createdAt: string; id: string }
  ) {
    const cursorClause = before
      ? 'AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))'
      : '';
    const parameters = before
      ? [activityId, before.createdAt, before.createdAt, before.id, limit + 1]
      : [activityId, limit + 1];
    const rows = this.db
      .prepare(
        `SELECT r.id, r.published_text as text,
                COALESCE(r.published_participant_name, r.participant_name, p.display_name) as participantName,
                r.edited_by_moderator as editedByModerator, r.created_at as createdAt
         FROM live_responses r
         INNER JOIN live_participants p ON p.id = r.participant_id
         WHERE r.activity_id = ? AND r.moderation_status = 'approved' ${cursorClause}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ?`
      )
      .all(...parameters) as unknown as Array<{
        id: string;
        text: string;
        participantName: string | null;
        editedByModerator: number;
        createdAt: string;
      }>;
    return rows.map((row) => ({ ...row, text: row.text ?? '', editedByModerator: Boolean(row.editedByModerator) }));
  }

  listApprovedWordCloud(activityId: string) {
    const activity = this.findById(activityId);
    if (!activity || activity.type !== 'word_cloud') return [];
    return this.getResults(activity).wordCloud;
  }

  listModerationRules(userId: string): ModerationRule[] {
    return this.db
      .prepare(
        `SELECT id, pattern, match_mode as matchMode, created_at as createdAt, updated_at as updatedAt
         FROM moderation_rules WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(userId) as unknown as ModerationRule[];
  }

  createModerationRule(userId: string, pattern: string, matchMode: ModerationMatchMode) {
    const id = createId();
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO moderation_rules (id, user_id, pattern, match_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId, pattern, matchMode, timestamp, timestamp);
    return this.listModerationRules(userId).find((rule) => rule.id === id)!;
  }

  updateModerationRule(id: string, userId: string, pattern: string, matchMode: ModerationMatchMode) {
    this.db
      .prepare(
        `UPDATE moderation_rules SET pattern = ?, match_mode = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(pattern, matchMode, nowIso(), id, userId);
    return this.listModerationRules(userId).find((rule) => rule.id === id);
  }

  deleteModerationRule(id: string, userId: string) {
    return this.db.prepare('DELETE FROM moderation_rules WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  }
}
