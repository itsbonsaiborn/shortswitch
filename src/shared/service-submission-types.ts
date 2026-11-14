export const serviceSubmissionTypes = ['contact', 'report_abuse'] as const;
export type ServiceSubmissionType = (typeof serviceSubmissionTypes)[number];

export const serviceSubmissionStatuses = ['new', 'in_progress', 'resolved', 'rejected'] as const;
export type ServiceSubmissionStatus = (typeof serviceSubmissionStatuses)[number];

export const abuseReasons = ['phishing', 'malware', 'spam', 'harassment', 'copyright', 'privacy', 'other'] as const;
export type AbuseReason = (typeof abuseReasons)[number];

export interface ContactSubmissionInput {
  email: string;
  subject: string;
  message: string;
  website?: string;
}

export interface AbuseSubmissionInput {
  link: string;
  reason: AbuseReason | string;
  description: string;
  reporterEmail?: string;
  website?: string;
}

export interface ServiceSubmissionAdmin {
  id: string;
  type: ServiceSubmissionType;
  status: ServiceSubmissionStatus;
  createdAt: string;
  updatedAt: string;
  email: string | null;
  subject: string | null;
  message: string | null;
  linkIdentifier: string | null;
  reason: AbuseReason | null;
  description: string | null;
  reporterEmail: string | null;
  associatedLinkId: string | null;
  associatedLinkSlug: string | null;
}

export interface ServiceSubmissionListResponse {
  submissions: ServiceSubmissionAdmin[];
  total: number;
  newCount: number;
}

export interface ServiceSubmissionSettings {
  allowedEmailDomains: string[];
  publicContactEmail: string | null;
  retentionDays: number;
  updatedAt: string;
}

export interface ServiceSubmissionSettingsUpdate {
  allowedEmailDomains?: string[];
  publicContactEmail?: string | null;
  retentionDays?: number;
}
