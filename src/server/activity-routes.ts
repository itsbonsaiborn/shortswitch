import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { ZodError } from 'zod';
import { ACTIVITY_CSV_BOM, activityCsvRow } from './domain/activity-csv.js';
import { buildActivityResponsesWorkbook, type ActivityResponseExportRow } from './domain/activity-xlsx.js';
import { ActivityService } from './services/activity-service.js';
import type { SessionService } from './services/session-service.js';
import type { ActivityAttemptService } from './services/activity-attempt-service.js';

interface ActivityRouteDependencies {
  activities: ActivityService;
  attempts: ActivityAttemptService;
  sessions: SessionService;
}

const errorStatus = (error: unknown) => {
  const message = error instanceof ZodError ? 'Activity data is invalid.' : (error as Error).message;
  if (message.includes('not found')) return { status: 404, message };
  if (message.includes('has changed') || message.includes('already in use') || message.includes('finalized') || message.includes('FOREIGN KEY constraint failed')) {
    return { status: 409, message };
  }
  return { status: 400, message };
};

export const registerActivityRoutes = async (app: FastifyInstance<any, any, any, any>, dependencies: ActivityRouteDependencies) => {
  const { activities, attempts, sessions } = dependencies;
  const requireAdmin = async (request: Parameters<SessionService['requireAuth']>[0], reply: Parameters<SessionService['requireAuth']>[1]) =>
    sessions.requireAuth(request, reply);
  const handle = (reply: any, error: unknown) => {
    const result = errorStatus(error);
    return reply.code(result.status).send({ message: result.message });
  };

  app.get('/api/activities', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    return activities.list(authenticated.currentUser.id);
  });

  app.post('/api/activities', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return reply.code(201).send(activities.create(authenticated.currentUser.id, (request.body as { settings?: unknown })?.settings ?? request.body));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return activities.get(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.patch('/api/activities/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return activities.update(
        authenticated.currentUser.id,
        (request.params as { id: string }).id,
        request.body as { expectedRevision?: unknown; settings?: unknown }
      );
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.delete('/api/activities/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      activities.delete(authenticated.currentUser.id, (request.params as { id: string }).id);
      return { ok: true };
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/analytics/clear', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const id = (request.params as { id: string }).id;
      const clearedAttempts = activities.clearResults(authenticated.currentUser.id, id);
      return { activity: activities.get(authenticated.currentUser.id, id).activity, clearedAttempts };
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/draft', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return activities.getDraft(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.put('/api/activities/:id/draft', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return activities.replaceDraft(authenticated.currentUser.id, (request.params as { id: string }).id, request.body);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/slides', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return reply.code(201).send(activities.addSlide(
        authenticated.currentUser.id,
        (request.params as { id: string }).id,
        request.body as { expectedRevision?: unknown; position?: unknown; slide?: unknown }
      ));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.patch('/api/activities/:id/slides/:slideId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; slideId: string };
      return activities.updateSlide(
        authenticated.currentUser.id,
        params.id,
        params.slideId,
        request.body as { expectedRevision?: unknown; position?: unknown; slide?: unknown }
      );
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.delete('/api/activities/:id/slides/:slideId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; slideId: string };
      const expectedRevision = (request.query as { expectedRevision?: string }).expectedRevision;
      return activities.deleteSlide(authenticated.currentUser.id, params.id, params.slideId, Number(expectedRevision));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/publish', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return reply.code(201).send(activities.publish(
        authenticated.currentUser.id,
        (request.params as { id: string }).id,
        (request.body as { expectedRevision?: unknown })?.expectedRevision
      ));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/publish-validation', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return activities.validatePublish(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/duplicate', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return reply.code(201).send(activities.duplicate(authenticated.currentUser.id, (request.params as { id: string }).id));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.patch('/api/activities/:id/archive', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const archived = (request.body as { archived?: unknown })?.archived;
      if (typeof archived !== 'boolean') throw new Error('Archived state must be a boolean.');
      return activities.setArchived(authenticated.currentUser.id, (request.params as { id: string }).id, archived);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/versions', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return activities.listVersions(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/versions/:versionId', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; versionId: string };
      return activities.getPublishedVersion(authenticated.currentUser.id, params.id, params.versionId);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/attempts', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return attempts.listAdminAttempts(authenticated.currentUser.id, (request.params as { id: string }).id);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/results', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      return attempts.getAdminResults(
        authenticated.currentUser.id,
        (request.params as { id: string }).id,
        request.query as Record<string, unknown>
      );
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/exports/attempts.csv', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const rows = attempts.iterateAttemptExport(authenticated.currentUser.id, (request.params as { id: string }).id);
      function* csv() {
        yield ACTIVITY_CSV_BOM;
        yield activityCsvRow(['Attempt ID', 'Participant', 'Attempt number', 'Status', 'Grading state', 'Started at', 'Submitted at', 'Submission reason', 'Duration seconds', 'Score', 'Maximum score']);
        for (const row of rows) yield activityCsvRow([
          row.attemptId, row.participantName, row.attemptNumber, row.status, row.gradingState,
          row.startedAt, row.submittedAt, row.submissionReason, row.durationSeconds,
          row.scoreUnits === null ? '' : Number(row.scoreUnits) / 1000,
          Number(row.maximumScoreUnits) / 1000
        ]);
      }
      return reply.header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="activity-attempts.csv"')
        .send(Readable.from(csv()));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/exports/responses.csv', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const rows = attempts.iterateResponseExport(authenticated.currentUser.id, (request.params as { id: string }).id);
      function* csv() {
        yield ACTIVITY_CSV_BOM;
        yield activityCsvRow(['Attempt ID', 'Participant', 'Attempt status', 'Started at', 'Submitted at', 'Question ID', 'Question type', 'Question', 'Response JSON', 'Moderation status', 'Grading status', 'Awarded points', 'Maximum points', 'Teacher feedback', 'Saved at']);
        for (const row of rows) yield activityCsvRow([
          row.attemptId, row.participantName, row.attemptStatus, row.startedAt, row.submittedAt,
          row.questionId, row.questionType, row.prompt, row.answerJson, row.moderationStatus,
          row.gradingStatus, row.awardedUnits === null ? '' : Number(row.awardedUnits) / 1000,
          Number(row.maximumUnits) / 1000, row.teacherFeedback, row.savedAt
        ]);
      }
      return reply.header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="activity-responses.csv"')
        .send(Readable.from(csv()));
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/exports/responses.xlsx', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const rows = attempts.iterateResponseExport(authenticated.currentUser.id, (request.params as { id: string }).id) as Iterable<ActivityResponseExportRow>;
      const workbook = await buildActivityResponsesWorkbook(rows);
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="activity-responses.xlsx"')
        .send(workbook);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.get('/api/activities/:id/attempts/:attemptId', async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; attemptId: string };
      return attempts.getAdminAttempt(authenticated.currentUser.id, params.id, params.attemptId);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.delete('/api/activities/:id/attempts/:attemptId', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; attemptId: string };
      return attempts.deleteAdminAttempt(authenticated.currentUser.id, params.id, params.attemptId);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/attempts/:attemptId/responses/:questionBlockId/grade', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; attemptId: string; questionBlockId: string };
      return attempts.gradeManualResponse(
        authenticated.currentUser.id,
        params.id,
        params.attemptId,
        params.questionBlockId,
        request.body as { awardedPoints?: unknown; teacherFeedback?: unknown }
      );
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/attempts/:attemptId/responses/:questionBlockId/moderate', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; attemptId: string; questionBlockId: string };
      return attempts.moderateResponse(
        authenticated.currentUser.id,
        params.id,
        params.attemptId,
        params.questionBlockId,
        request.body as { status?: unknown }
      );
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/attempts/:attemptId/release-results', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; attemptId: string };
      return attempts.releaseResults(authenticated.currentUser.id, params.id, params.attemptId);
    } catch (error) {
      return handle(reply, error);
    }
  });

  app.post('/api/activities/:id/attempts/:attemptId/extend', { onRequest: app.csrfProtection }, async (request, reply) => {
    const authenticated = await requireAdmin(request, reply);
    if (!authenticated) return;
    try {
      const params = request.params as { id: string; attemptId: string };
      return attempts.extendIndividualDeadline(
        authenticated.currentUser.id,
        params.id,
        params.attemptId,
        (request.body as { additionalMinutes?: unknown })?.additionalMinutes
      );
    } catch (error) {
      return handle(reply, error);
    }
  });
};
