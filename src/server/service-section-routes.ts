import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  AbuseSubmissionInput,
  ContactSubmissionInput,
  ServiceSectionUpdate,
  ServiceSubmissionSettingsUpdate,
  ServiceSubmissionStatus
} from '../shared/types.js';
import type { SessionService } from './services/session-service.js';
import type { ServiceSectionService } from './services/service-section-service.js';
import type { RateLimiterService } from './services/rate-limiter-service.js';
import {
  ServiceSubmissionService,
  ServiceSubmissionValidationError,
  type SubmissionValidationCode
} from './services/service-submission-service.js';
import { config } from './config.js';
import { createId } from './utils.js';
import { resolvePublicLocale } from '../shared/public-locale.js';
import {
  renderReportAbusePage,
  renderServiceSectionPage,
  type PublicServiceFormState
} from './views/error-pages.js';

const FORM_SESSION_COOKIE = 'shortswitch_service_form';
const formCookieOptions = {
  path: '/',
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: config.cookieSameSite,
  maxAge: 24 * 60 * 60
} as const;

const rateLimits = {
  session: { maxAttempts: 8, windowMinutes: 10, blockMinutes: 10 },
  ip: { maxAttempts: 120, windowMinutes: 10, blockMinutes: 10 },
  global: { maxAttempts: 500, windowMinutes: 10, blockMinutes: 10 }
};

const stringValue = (value: unknown) => typeof value === 'string' ? value : '';
const publicValues = (body: Record<string, unknown>, names: string[]) => Object.fromEntries(
  names.map((name) => [name, stringValue(body[name])])
);

const formSession = (request: FastifyRequest, reply: FastifyReply) => {
  const current = request.cookies[FORM_SESSION_COOKIE];
  if (current && /^[A-Za-z0-9_-]{16,128}$/.test(current)) return current;
  const sessionId = `${createId()}${createId()}`;
  reply.setCookie(FORM_SESSION_COOKIE, sessionId, formCookieOptions);
  return sessionId;
};

const canSubmit = (
  rateLimiter: RateLimiterService,
  type: 'contact' | 'report_abuse',
  request: FastifyRequest,
  sessionId: string
) => rateLimiter.consume('service-form-global', type, rateLimits.global) &&
  rateLimiter.consume('service-form-ip', `${type}:${request.ip ?? 'unknown'}`, rateLimits.ip) &&
  rateLimiter.consume('service-form-session', `${type}:${sessionId}`, rateLimits.session);

const validationMessages: Record<'en' | 'lv', Record<SubmissionValidationCode | 'rate_limited' | 'unknown', string>> = {
  en: {
    email_required: 'Enter your email address.', email_invalid: 'Enter a valid email address.',
    subject_required: 'Enter a subject.', message_required: 'Enter a message.',
    link_required: 'Enter a ShortSwitch link or identifier.', link_invalid: 'Enter a valid ShortSwitch link or identifier.',
    reason_invalid: 'Select a valid reason.', description_required: 'Enter a description.',
    reporter_email_invalid: 'Enter a valid reporter email address.', field_too_long: 'One or more fields are too long.',
    email_domain_not_allowed: 'This email domain is not accepted for public submissions.',
    rate_limited: 'Too many submissions. Please wait and try again.', unknown: 'The submission could not be saved. Please try again.'
  },
  lv: {
    email_required: 'Ievadiet savu e-pasta adresi.', email_invalid: 'Ievadiet derīgu e-pasta adresi.',
    subject_required: 'Ievadiet tematu.', message_required: 'Ievadiet ziņojumu.',
    link_required: 'Ievadiet ShortSwitch saiti vai identifikatoru.', link_invalid: 'Ievadiet derīgu ShortSwitch saiti vai identifikatoru.',
    reason_invalid: 'Izvēlieties derīgu iemeslu.', description_required: 'Ievadiet aprakstu.',
    reporter_email_invalid: 'Ievadiet derīgu ziņotāja e-pasta adresi.', field_too_long: 'Viens vai vairāki lauki ir pārāk gari.',
    email_domain_not_allowed: 'Šis e-pasta domēns publiskiem iesniegumiem nav atļauts.',
    rate_limited: 'Pārāk daudz iesniegumu. Uzgaidiet un mēģiniet vēlreiz.', unknown: 'Iesniegumu neizdevās saglabāt. Mēģiniet vēlreiz.'
  }
};

const formError = (error: unknown, locale: 'en' | 'lv') => error instanceof ServiceSubmissionValidationError
  ? validationMessages[locale][error.code]
  : validationMessages[locale].unknown;

export const registerServiceSectionRoutes = async (
  app: FastifyInstance<any, any, any, any>,
  dependencies: {
    sections: ServiceSectionService;
    submissions: ServiceSubmissionService;
    sessions: SessionService;
    rateLimiter: RateLimiterService;
  }
) => {
  const { sections, submissions, sessions, rateLimiter } = dependencies;
  const requireAdmin = async (request: any, reply: any) => sessions.requireAdmin(request, reply);

  app.get('/api/service-sections', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    return { sections: sections.list() };
  });

  app.patch('/api/service-sections/:type', { onRequest: app.csrfProtection }, async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      return sections.update((request.params as { type: string }).type, request.body as ServiceSectionUpdate);
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.includes('not found') ? 404 : 400).send({ message });
    }
  });

  app.post('/api/service-sections/:type/publish', { onRequest: app.csrfProtection }, async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      return sections.publish(
        (request.params as { type: string }).type,
        request.body as ServiceSectionUpdate | undefined
      );
    } catch (error) {
      const message = (error as Error).message;
      return reply.code(message.includes('not found') ? 404 : 400).send({ message });
    }
  });

  app.get('/api/service-submissions', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    const query = request.query as { type?: string; status?: string; search?: string; limit?: string };
    return submissions.list({ ...query, limit: Number(query.limit) });
  });

  app.delete('/api/service-submissions/:id', { onRequest: app.csrfProtection }, async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    return submissions.delete((request.params as { id: string }).id)
      ? reply.code(204).send()
      : reply.code(404).send({ message: 'Submission not found.' });
  });

  app.get('/api/service-submission-settings', async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    return submissions.getSettings();
  });

  app.patch('/api/service-submission-settings', { onRequest: app.csrfProtection }, async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      return submissions.updateSettings(request.body as ServiceSubmissionSettingsUpdate | undefined);
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
  });

  app.patch('/api/service-submissions/:id/status', { onRequest: app.csrfProtection }, async (request, reply) => {
    if (!await requireAdmin(request, reply)) return;
    try {
      const updated = submissions.updateStatus(
        (request.params as { id: string }).id,
        (request.body as { status?: ServiceSubmissionStatus } | undefined)?.status
      );
      return updated ?? reply.code(404).send({ message: 'Submission not found.' });
    } catch (error) {
      return reply.code(400).send({ message: (error as Error).message });
    }
  });

  app.get('/api/public/service-sections', async (request) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    return { links: sections.getFooterLinks(locale) };
  });

  app.get('/service/report-abuse', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    formSession(request, reply);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return reply.code(200).type('text/html').send(renderReportAbusePage({ locale, footerLinks: sections.getFooterLinks(locale) }));
  });

  app.post('/service/report-abuse/submit', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const values = publicValues(body, ['link', 'reason', 'description', 'reporterEmail']);
    const sessionId = formSession(request, reply);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    if (!canSubmit(rateLimiter, 'report_abuse', request, sessionId)) {
      return reply.code(429).type('text/html').send(renderReportAbusePage({
        locale, footerLinks: sections.getFooterLinks(locale), state: { error: validationMessages[locale].rate_limited, values }
      }));
    }
    try {
      submissions.submitAbuse(body as unknown as AbuseSubmissionInput, sessionId);
      return reply.code(200).type('text/html').send(renderReportAbusePage({
        locale, footerLinks: sections.getFooterLinks(locale), state: { success: true }
      }));
    } catch (error) {
      const status = error instanceof ServiceSubmissionValidationError ? 400 : 500;
      return reply.code(status).type('text/html').send(renderReportAbusePage({
        locale, footerLinks: sections.getFooterLinks(locale), state: { error: formError(error, locale), values }
      }));
    }
  });

  app.post('/service/contacts/submit', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const values = publicValues(body, ['email', 'subject', 'message']);
    const sessionId = formSession(request, reply);
    const section = sections.getPublic('contacts', locale);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const render = (state: PublicServiceFormState, status: number) => reply.code(status).type('text/html').send(
      renderServiceSectionPage({
        locale,
        title: section?.title ?? (locale === 'lv' ? 'Kontakti' : 'Contacts'),
        body: section?.body ?? '',
        contactConfig: section?.contactConfig,
        publicContactEmail: submissions.getSettings().publicContactEmail,
        contactFormState: state,
        footerLinks: sections.getFooterLinks(locale)
      })
    );
    if (!canSubmit(rateLimiter, 'contact', request, sessionId)) {
      return render({ error: validationMessages[locale].rate_limited, values }, 429);
    }
    try {
      submissions.submitContact(body as unknown as ContactSubmissionInput, sessionId);
      return render({ success: true }, 200);
    } catch (error) {
      return render({ error: formError(error, locale), values }, error instanceof ServiceSubmissionValidationError ? 400 : 500);
    }
  });

  app.get('/service/:type', async (request, reply) => {
    const locale = resolvePublicLocale(request.headers['accept-language']);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const type = (request.params as { type: string }).type;
      const section = sections.getPublic(type, locale);
      if (!section) return reply.code(404).type('text/html').send(renderServiceSectionPage({
        locale,
        title: locale === 'lv' ? 'Lapa nav pieejama' : 'Page unavailable',
        body: locale === 'lv' ? 'Šī izvēles informācijas lapa nav publicēta.' : 'This optional information page is not published.',
        footerLinks: sections.getFooterLinks(locale)
      }));
      if (type === 'contacts') formSession(request, reply);
      return reply.code(200).type('text/html').send(renderServiceSectionPage({
        locale,
        title: section.title,
        body: section.body,
        contactConfig: section.contactConfig,
        publicContactEmail: type === 'contacts' ? submissions.getSettings().publicContactEmail : null,
        footerLinks: sections.getFooterLinks(locale)
      }));
    } catch {
      return reply.code(404).send({ message: 'Not found.' });
    }
  });
};
