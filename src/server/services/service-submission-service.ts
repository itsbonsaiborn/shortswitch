import type {
  AbuseReason,
  AbuseSubmissionInput,
  ContactSubmissionInput,
  ServiceSubmissionSettingsUpdate,
  ServiceSubmissionStatus,
  ServiceSubmissionType
} from '../../shared/types.js';
import { abuseReasons, serviceSubmissionStatuses, serviceSubmissionTypes } from '../../shared/service-submission-types.js';
import { config } from '../config.js';
import { ServiceSubmissionRepository } from '../repositories/service-submission-repository.js';
import { sha256 } from '../utils.js';

export type SubmissionValidationCode =
  | 'email_required' | 'email_invalid' | 'subject_required' | 'message_required'
  | 'link_required' | 'link_invalid' | 'reason_invalid' | 'description_required'
  | 'reporter_email_invalid' | 'email_domain_not_allowed' | 'field_too_long';

export class ServiceSubmissionValidationError extends Error {
  constructor(public readonly code: SubmissionValidationCode) {
    super(code);
  }
}

const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const safeIdentifier = /^[A-Za-z0-9._~!$&'()*+,;=:@-]{1,128}$/;
const clean = (value: unknown, maximum: number, requiredCode: SubmissionValidationCode) => {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
    : '';
  if (!text) throw new ServiceSubmissionValidationError(requiredCode);
  if (text.length > maximum) throw new ServiceSubmissionValidationError('field_too_long');
  return text;
};
const optionalEmail = (value: unknown, required: boolean) => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email && required) throw new ServiceSubmissionValidationError('email_required');
  if (email.length > 254) throw new ServiceSubmissionValidationError('field_too_long');
  if (email && !emailPattern.test(email)) throw new ServiceSubmissionValidationError(required ? 'email_invalid' : 'reporter_email_invalid');
  return email;
};

const normalizeDomain = (value: unknown) => {
  const domain = typeof value === 'string' ? value.trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '') : '';
  if (!domain || domain.length > 253 || !domain.includes('.')) throw new Error('Invalid email domain.');
  const labels = domain.split('.');
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('Invalid email domain.');
  return domain;
};

const emailDomain = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

const normalizeLinkIdentifier = (value: unknown) => {
  const input = clean(value, 2_048, 'link_required');
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) {
    throw new ServiceSubmissionValidationError('link_invalid');
  }
  if (/^https?:\/\//i.test(input)) {
    try {
      const parsed = new URL(input);
      const expected = new URL(config.baseUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (parsed.origin !== expected.origin || segments.length !== 1) throw new Error();
      const slug = decodeURIComponent(segments[0]!);
      if (!safeIdentifier.test(slug)) throw new Error();
      return slug;
    } catch {
      throw new ServiceSubmissionValidationError('link_invalid');
    }
  }
  if (!safeIdentifier.test(input)) throw new ServiceSubmissionValidationError('link_invalid');
  return input;
};

const duplicateKey = (type: ServiceSubmissionType, sessionId: string, fields: string[]) => {
  const bucket = Math.floor(Date.now() / (10 * 60_000));
  return sha256([type, sessionId, bucket, ...fields].join('\u001f'));
};

export class ServiceSubmissionService {
  private repository = new ServiceSubmissionRepository();

  submitContact(input: ContactSubmissionInput, sessionId: string) {
    if (typeof input?.website === 'string' && input.website.trim()) return { accepted: true, ignored: true, duplicate: false };
    const email = optionalEmail(input?.email, true);
    this.ensureAllowedSender(email);
    const subject = clean(input?.subject, 160, 'subject_required');
    const message = clean(input?.message, 5_000, 'message_required');
    const result = this.repository.create({
      type: 'contact', email, subject, message,
      duplicateKey: duplicateKey('contact', sessionId, [email, subject, message])
    });
    return { accepted: true, ignored: false, duplicate: result.duplicate };
  }

  submitAbuse(input: AbuseSubmissionInput, sessionId: string) {
    if (typeof input?.website === 'string' && input.website.trim()) return { accepted: true, ignored: true, duplicate: false };
    const linkIdentifier = normalizeLinkIdentifier(input?.link);
    const reason = typeof input?.reason === 'string' && abuseReasons.includes(input.reason as AbuseReason)
      ? input.reason as AbuseReason
      : undefined;
    if (!reason) throw new ServiceSubmissionValidationError('reason_invalid');
    const description = clean(input?.description, 5_000, 'description_required');
    const reporterEmail = optionalEmail(input?.reporterEmail, false);
    if (reporterEmail) this.ensureAllowedSender(reporterEmail);
    const result = this.repository.create({
      type: 'report_abuse', linkIdentifier, reason, description,
      ...(reporterEmail ? { reporterEmail } : {}),
      duplicateKey: duplicateKey('report_abuse', sessionId, [linkIdentifier, reason, description, reporterEmail])
    });
    return { accepted: true, ignored: false, duplicate: result.duplicate };
  }

  list(filters: { type?: string; status?: string; search?: string; limit?: number }) {
    const type = filters.type && serviceSubmissionTypes.includes(filters.type as ServiceSubmissionType)
      ? filters.type as ServiceSubmissionType : undefined;
    const status = filters.status && serviceSubmissionStatuses.includes(filters.status as ServiceSubmissionStatus)
      ? filters.status as ServiceSubmissionStatus : undefined;
    const limit = Math.max(1, Math.min(100, Number(filters.limit) || 50));
    const search = typeof filters.search === 'string' ? filters.search.trim().slice(0, 100) : '';
    const normalized = { type, status, ...(search ? { search } : {}) };
    return {
      submissions: this.repository.list({ ...normalized, limit }),
      total: this.repository.count(normalized),
      newCount: this.repository.countNew()
    };
  }

  updateStatus(id: string, value: unknown) {
    if (typeof value !== 'string' || !serviceSubmissionStatuses.includes(value as ServiceSubmissionStatus)) {
      throw new Error('Invalid submission status.');
    }
    return this.repository.updateStatus(id, value as ServiceSubmissionStatus);
  }

  delete(id: string) {
    return this.repository.delete(id);
  }

  getSettings() {
    return this.repository.getSettings();
  }

  updateSettings(input: ServiceSubmissionSettingsUpdate | undefined) {
    if (!input || typeof input !== 'object') throw new Error('Invalid settings.');
    const current = this.repository.getSettings();
    if (input.allowedEmailDomains !== undefined && !Array.isArray(input.allowedEmailDomains)) throw new Error('Invalid email domains.');
    const allowedEmailDomains = input.allowedEmailDomains === undefined
      ? current.allowedEmailDomains
      : [...new Set(input.allowedEmailDomains.map(normalizeDomain))].sort();
    if (allowedEmailDomains.length > 50) throw new Error('A maximum of 50 email domains is allowed.');
    const publicContactEmail = input.publicContactEmail === undefined
      ? current.publicContactEmail
      : (input.publicContactEmail === null || input.publicContactEmail.trim() === ''
          ? null
          : optionalEmail(input.publicContactEmail, true));
    const retentionDays = input.retentionDays === undefined ? current.retentionDays : Number(input.retentionDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      throw new Error('Retention must be between 1 and 3650 days.');
    }
    return this.repository.updateSettings({ allowedEmailDomains, publicContactEmail, retentionDays });
  }

  cleanupExpired() {
    const { retentionDays } = this.repository.getSettings();
    return this.repository.deleteOlderThan(new Date(Date.now() - retentionDays * 86_400_000).toISOString());
  }

  private ensureAllowedSender(email: string) {
    const allowed = this.repository.getSettings().allowedEmailDomains;
    if (allowed.length > 0 && !allowed.includes(emailDomain(email))) {
      throw new ServiceSubmissionValidationError('email_domain_not_allowed');
    }
  }
}
