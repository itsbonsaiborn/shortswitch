import type {
  PublicServiceSection,
  ServiceFooterLink,
  ServiceContactConfig,
  ServiceSectionAdmin,
  ServiceSectionType,
  ServiceSectionUpdate
} from '../../shared/types.js';
import { createDefaultServiceContactConfig, getServiceSectionDefinition, serviceSectionDefinitions } from '../../shared/service-section-types.js';
import type { Locale } from '../../shared/types.js';
import { getDb } from '../db.js';
import { nowIso } from '../utils.js';

interface ServiceSectionRow {
  sectionType: ServiceSectionType;
  isRequired: number;
  isEnabled: number;
  showInFooter: number;
  needsReview: number;
  draftTitleEn: string;
  draftBodyEn: string;
  draftTitleLv: string;
  draftBodyLv: string;
  publishedTitleEn: string;
  publishedBodyEn: string;
  publishedTitleLv: string;
  publishedBodyLv: string;
  isPublished: number;
  updatedAt: string;
  publishedAt: string | null;
  draftConfigJson: string;
  publishedConfigJson: string;
}

const selectColumns = `
  section_type AS sectionType,
  is_required AS isRequired,
  is_enabled AS isEnabled,
  show_in_footer AS showInFooter,
  needs_review AS needsReview,
  draft_title_en AS draftTitleEn,
  draft_body_en AS draftBodyEn,
  draft_title_lv AS draftTitleLv,
  draft_body_lv AS draftBodyLv,
  published_title_en AS publishedTitleEn,
  published_body_en AS publishedBodyEn,
  published_title_lv AS publishedTitleLv,
  published_body_lv AS publishedBodyLv,
  is_published AS isPublished,
  updated_at AS updatedAt,
  published_at AS publishedAt,
  draft_config_json AS draftConfigJson,
  published_config_json AS publishedConfigJson
`;

const contactConfig = (raw: string, content: { titleEn: string; bodyEn: string; titleLv: string; bodyLv: string }): ServiceContactConfig => {
  try {
    const parsed = JSON.parse(raw) as ServiceContactConfig;
    if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length) return parsed;
  } catch {
    // Older rows use the existing localized title/body as their visual-editor fallback.
  }
  return createDefaultServiceContactConfig(content);
};

const toAdmin = (row: ServiceSectionRow): ServiceSectionAdmin => {
  const definition = getServiceSectionDefinition(row.sectionType);
  const draftContent = {
    titleEn: row.draftTitleEn,
    bodyEn: row.draftBodyEn,
    titleLv: row.draftTitleLv,
    bodyLv: row.draftBodyLv
  };
  return {
    type: row.sectionType,
    publicPath: definition.publicPath,
    required: Boolean(row.isRequired),
    enabled: Boolean(row.isEnabled),
    showInFooter: Boolean(row.showInFooter),
    published: Boolean(row.isPublished),
    needsReview: Boolean(row.needsReview),
    titleEn: row.draftTitleEn,
    bodyEn: row.draftBodyEn,
    titleLv: row.draftTitleLv,
    bodyLv: row.draftBodyLv,
    hasUnpublishedChanges:
      row.draftTitleEn !== row.publishedTitleEn ||
      row.draftBodyEn !== row.publishedBodyEn ||
      row.draftTitleLv !== row.publishedTitleLv ||
      row.draftBodyLv !== row.publishedBodyLv ||
      row.draftConfigJson !== row.publishedConfigJson,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    ...(row.sectionType === 'contacts' ? { contactConfig: contactConfig(row.draftConfigJson, draftContent) } : {})
  };
};

export class ServiceSectionRepository {
  private db = getDb();

  private find(type: ServiceSectionType) {
    return this.db.prepare(`SELECT ${selectColumns} FROM service_sections WHERE section_type = ?`)
      .get(type) as ServiceSectionRow | undefined;
  }

  list(): ServiceSectionAdmin[] {
    const rows = this.db.prepare(`SELECT ${selectColumns} FROM service_sections`).all() as unknown as ServiceSectionRow[];
    const byType = new Map(rows.map((row) => [row.sectionType, row]));
    return serviceSectionDefinitions.flatMap((definition) => {
      const row = byType.get(definition.type);
      return row ? [toAdmin(row)] : [];
    });
  }

  updateDraft(type: ServiceSectionType, input: ServiceSectionUpdate): ServiceSectionAdmin {
    const definition = getServiceSectionDefinition(type);
    const timestamp = nowIso();
    const existing = this.find(type);
    if (!existing) throw new Error('Service section not found.');
    const configJson = type === 'contacts' && input.contactConfig
      ? JSON.stringify(input.contactConfig)
      : existing.draftConfigJson;
    this.db.prepare(`
      UPDATE service_sections SET
        draft_title_en = ?, draft_body_en = ?, draft_title_lv = ?, draft_body_lv = ?,
        is_enabled = ?, show_in_footer = ?, draft_config_json = ?, updated_at = ?
      WHERE section_type = ?
    `).run(
      input.titleEn,
      input.bodyEn,
      input.titleLv,
      input.bodyLv,
      definition.required ? 1 : Number(input.enabled),
      Number(input.showInFooter),
      configJson,
      timestamp,
      type
    );
    return toAdmin(this.find(type)!);
  }

  publish(type: ServiceSectionType): ServiceSectionAdmin {
    const timestamp = nowIso();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        UPDATE service_sections SET
          published_title_en = draft_title_en,
          published_body_en = draft_body_en,
          published_title_lv = draft_title_lv,
          published_body_lv = draft_body_lv,
          published_config_json = draft_config_json,
          is_published = 1,
          needs_review = 0,
          published_at = ?,
          updated_at = ?
        WHERE section_type = ?
      `).run(timestamp, timestamp, type);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return toAdmin(this.find(type)!);
  }

  getPublic(type: ServiceSectionType, locale: Locale): PublicServiceSection | undefined {
    const definition = getServiceSectionDefinition(type);
    const row = this.find(type);
    if (row && !row.isRequired && !row.isEnabled) return undefined;
    const useFallback = !row || !row.isPublished;
    const publishedContent = {
      titleEn: row?.publishedTitleEn ?? definition.titleEn,
      bodyEn: row?.publishedBodyEn ?? definition.bodyEn,
      titleLv: row?.publishedTitleLv ?? definition.titleLv,
      bodyLv: row?.publishedBodyLv ?? definition.bodyLv
    };
    return {
      type,
      title: useFallback
        ? (locale === 'lv' ? definition.titleLv : definition.titleEn)
        : (locale === 'lv' ? row.publishedTitleLv : row.publishedTitleEn),
      body: useFallback
        ? (locale === 'lv' ? definition.bodyLv : definition.bodyEn)
        : (locale === 'lv' ? row.publishedBodyLv : row.publishedBodyEn),
      publicPath: definition.publicPath,
      fallback: useFallback,
      ...(type === 'contacts'
        ? { contactConfig: useFallback
            ? createDefaultServiceContactConfig(definition)
            : contactConfig(row!.publishedConfigJson, publishedContent) }
        : {})
    };
  }

  getFooterLinks(locale: Locale): ServiceFooterLink[] {
    const rows = this.db.prepare(`SELECT ${selectColumns} FROM service_sections`).all() as unknown as ServiceSectionRow[];
    const byType = new Map(rows.map((row) => [row.sectionType, row]));
    const sectionLinks = serviceSectionDefinitions.flatMap((definition) => {
      const row = byType.get(definition.type);
      if (row && (!row.showInFooter || (!row.isRequired && !row.isEnabled))) return [];
      if (!row && !definition.required) return [];
      const title = row?.isPublished
        ? (locale === 'lv' ? row.publishedTitleLv : row.publishedTitleEn)
        : (locale === 'lv' ? definition.titleLv : definition.titleEn);
      return [{ type: definition.type, label: title, href: definition.publicPath }];
    });
    return [
      ...sectionLinks,
      { type: 'report_abuse', label: locale === 'lv' ? 'Ziņot par pārkāpumu' : 'Report Abuse', href: '/service/report-abuse' }
    ];
  }
}
