import type {
  AbuseReason,
  ServiceSubmissionAdmin,
  ServiceSubmissionSettings,
  ServiceSubmissionStatus,
  ServiceSubmissionType
} from '../../shared/types.js';
import { getDb } from '../db.js';
import { createId, nowIso } from '../utils.js';

interface SubmissionRow {
  id: string;
  submissionType: ServiceSubmissionType;
  status: ServiceSubmissionStatus;
  email: string | null;
  subject: string | null;
  message: string | null;
  linkIdentifier: string | null;
  reason: AbuseReason | null;
  description: string | null;
  reporterEmail: string | null;
  createdAt: string;
  updatedAt: string;
  associatedLinkId: string | null;
  associatedLinkSlug: string | null;
}

interface SettingsRow {
  allowedEmailDomainsJson: string;
  publicContactEmail: string | null;
  retentionDays: number;
  updatedAt: string;
}

export interface StoredSubmissionInput {
  type: ServiceSubmissionType;
  email?: string;
  subject?: string;
  message?: string;
  linkIdentifier?: string;
  reason?: AbuseReason;
  description?: string;
  reporterEmail?: string;
  duplicateKey: string;
}

const selectColumns = `
  service_submissions.id,
  submission_type AS submissionType,
  status,
  email,
  subject,
  message,
  link_identifier AS linkIdentifier,
  reason,
  description,
  reporter_email AS reporterEmail,
  service_submissions.created_at AS createdAt,
  service_submissions.updated_at AS updatedAt,
  linked_slug.resource_id AS associatedLinkId,
  linked_slug.slug AS associatedLinkSlug
`;

const toAdmin = ({ submissionType, ...row }: SubmissionRow): ServiceSubmissionAdmin => ({
  ...row,
  type: submissionType
});

export class ServiceSubmissionRepository {
  private db = getDb();

  create(input: StoredSubmissionInput) {
    const timestamp = nowIso();
    const id = createId();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO service_submissions (
        id, submission_type, status, email, subject, message, link_identifier, reason,
        description, reporter_email, duplicate_key, created_at, updated_at
      ) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.email ?? null,
      input.subject ?? null,
      input.message ?? null,
      input.linkIdentifier ?? null,
      input.reason ?? null,
      input.description ?? null,
      input.reporterEmail ?? null,
      input.duplicateKey,
      timestamp,
      timestamp
    );
    return { id: result.changes > 0 ? id : undefined, duplicate: result.changes === 0 };
  }

  list(filters: { type?: ServiceSubmissionType; status?: ServiceSubmissionStatus; search?: string; limit: number }) {
    const type = filters.type ?? null;
    const status = filters.status ?? null;
    const search = filters.search ?? null;
    return (this.db.prepare(`
      SELECT ${selectColumns}
      FROM service_submissions
      LEFT JOIN public_slugs AS linked_slug
        ON linked_slug.slug = service_submissions.link_identifier
        AND linked_slug.resource_type = 'link'
      WHERE (? IS NULL OR submission_type = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR instr(lower(
          coalesce(email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(message, '') || ' ' ||
          coalesce(link_identifier, '') || ' ' || coalesce(reason, '') || ' ' || coalesce(description, '') || ' ' ||
          coalesce(reporter_email, '')
        ), lower(?)) > 0)
      ORDER BY service_submissions.created_at DESC, service_submissions.id DESC
      LIMIT ?
    `).all(type, type, status, status, search, search, filters.limit) as unknown as SubmissionRow[]).map(toAdmin);
  }

  count(filters: { type?: ServiceSubmissionType; status?: ServiceSubmissionStatus; search?: string }) {
    const type = filters.type ?? null;
    const status = filters.status ?? null;
    const search = filters.search ?? null;
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM service_submissions
      WHERE (? IS NULL OR submission_type = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR instr(lower(
          coalesce(email, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(message, '') || ' ' ||
          coalesce(link_identifier, '') || ' ' || coalesce(reason, '') || ' ' || coalesce(description, '') || ' ' ||
          coalesce(reporter_email, '')
        ), lower(?)) > 0)
    `).get(type, type, status, status, search, search) as { count: number };
    return Number(row.count);
  }

  countNew() {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM service_submissions WHERE status = 'new'`).get() as { count: number };
    return Number(row.count);
  }

  updateStatus(id: string, status: ServiceSubmissionStatus) {
    this.db.prepare('UPDATE service_submissions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), id);
    const row = this.db.prepare(`SELECT ${selectColumns} FROM service_submissions LEFT JOIN public_slugs AS linked_slug ON linked_slug.slug = service_submissions.link_identifier AND linked_slug.resource_type = 'link' WHERE service_submissions.id = ?`).get(id) as SubmissionRow | undefined;
    return row ? toAdmin(row) : undefined;
  }

  delete(id: string) {
    return this.db.prepare('DELETE FROM service_submissions WHERE id = ?').run(id).changes > 0;
  }

  getSettings(): ServiceSubmissionSettings {
    const row = this.db.prepare(`
      SELECT allowed_email_domains_json AS allowedEmailDomainsJson,
        public_contact_email AS publicContactEmail, retention_days AS retentionDays, updated_at AS updatedAt
      FROM service_submission_settings WHERE id = 1
    `).get() as unknown as SettingsRow;
    let allowedEmailDomains: string[] = [];
    try {
      const parsed = JSON.parse(row.allowedEmailDomainsJson);
      if (Array.isArray(parsed)) allowedEmailDomains = parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      // Invalid persisted settings fail closed to the documented allow-all default.
    }
    return { allowedEmailDomains, publicContactEmail: row.publicContactEmail, retentionDays: Number(row.retentionDays), updatedAt: row.updatedAt };
  }

  updateSettings(input: Pick<ServiceSubmissionSettings, 'allowedEmailDomains' | 'publicContactEmail' | 'retentionDays'>) {
    const updatedAt = nowIso();
    this.db.prepare(`
      UPDATE service_submission_settings
      SET allowed_email_domains_json = ?, public_contact_email = ?, retention_days = ?, updated_at = ?
      WHERE id = 1
    `).run(JSON.stringify(input.allowedEmailDomains), input.publicContactEmail, input.retentionDays, updatedAt);
    return this.getSettings();
  }

  deleteOlderThan(cutoff: string) {
    return Number(this.db.prepare('DELETE FROM service_submissions WHERE created_at < ?').run(cutoff).changes);
  }
}
