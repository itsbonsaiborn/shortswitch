import type { Locale, ServiceContactBlock, ServiceContactConfig, ServiceSectionType, ServiceSectionUpdate } from '../../shared/types.js';
import { isServiceSectionType, serviceContactBlockTypes } from '../../shared/service-section-types.js';
import { ServiceSectionRepository } from '../repositories/service-section-repository.js';
import { stripRichText } from '../../shared/rich-text.js';

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 20_000;
const MAX_CONTACT_BLOCKS = 50;
const contactBlockTypes = new Set(serviceContactBlockTypes);
const contactIcons = new Set(['website', 'linkedin', 'facebook', 'instagram', 'youtube', 'x', 'github', 'other']);

const cleanText = (value: unknown, maximum: number, field: string, required: boolean) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !stripRichText(text)) throw new Error(`${field} is required before publishing.`);
  if (text.length > maximum) throw new Error(`${field} must be at most ${maximum} characters.`);
  return text;
};

const validateContactConfig = (raw: ServiceContactConfig | undefined, publishing: boolean): ServiceContactConfig | undefined => {
  if (!raw) return undefined;
  if (!Array.isArray(raw.blocks)) throw new Error('Contact blocks must be an array.');
  if (raw.blocks.length > MAX_CONTACT_BLOCKS) throw new Error(`Contacts can contain at most ${MAX_CONTACT_BLOCKS} blocks.`);
  const ids = new Set<string>();
  let formCount = 0;
  let emailCount = 0;
  const blocks = raw.blocks.map((candidate): ServiceContactBlock => {
    if (!candidate || typeof candidate !== 'object' || !contactBlockTypes.has(candidate.type)) {
      throw new Error('Unsupported contact block type.');
    }
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    if (!id || id.length > 128 || ids.has(id)) throw new Error('Contact block IDs must be unique and valid.');
    ids.add(id);
    if (candidate.type === 'heading') return {
      id, type: candidate.type,
      titleEn: cleanText(candidate.titleEn, 160, 'English heading', publishing),
      titleLv: cleanText(candidate.titleLv, 160, 'Latvian heading', publishing)
    };
    if (candidate.type === 'text') return {
      id, type: candidate.type,
      bodyEn: cleanText(candidate.bodyEn, 4_000, 'English text', publishing),
      bodyLv: cleanText(candidate.bodyLv, 4_000, 'Latvian text', publishing)
    };
    if (candidate.type === 'contact_email') {
      emailCount += 1;
      if (emailCount > 1) throw new Error('Only one public contact email block is allowed.');
      const email = cleanText(candidate.email, 254, 'Contact email', publishing).toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Contact email is invalid.');
      return {
        id, type: candidate.type, email,
        titleEn: cleanText(candidate.titleEn, 120, 'English email title', publishing),
        titleLv: cleanText(candidate.titleLv, 120, 'Latvian email title', publishing)
      };
    }
    if (candidate.type === 'social_card') {
      const rawUrl = cleanText(candidate.url, 2_048, 'Social card URL', publishing);
      let url = '';
      if (rawUrl) {
        try {
          const parsed = new URL(rawUrl);
          if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error();
          url = parsed.toString();
        } catch {
          throw new Error('Social card URL must be a valid HTTPS URL.');
        }
      }
      if (!contactIcons.has(candidate.icon)) throw new Error('Social card icon is invalid.');
      return {
        id, type: candidate.type, url, icon: candidate.icon,
        titleEn: cleanText(candidate.titleEn, 120, 'English card title', publishing),
        titleLv: cleanText(candidate.titleLv, 120, 'Latvian card title', publishing),
        descriptionEn: cleanText(candidate.descriptionEn, 300, 'English card description', false),
        descriptionLv: cleanText(candidate.descriptionLv, 300, 'Latvian card description', false)
      };
    }
    if (candidate.type === 'divider') return { id, type: candidate.type };
    formCount += 1;
    if (formCount > 1) throw new Error('Only one Contact Form component is allowed.');
    return {
      id, type: candidate.type,
      titleEn: cleanText(candidate.titleEn, 120, 'English form title', publishing),
      titleLv: cleanText(candidate.titleLv, 120, 'Latvian form title', publishing),
      descriptionEn: cleanText(candidate.descriptionEn, 300, 'English form description', false),
      descriptionLv: cleanText(candidate.descriptionLv, 300, 'Latvian form description', false)
    };
  });
  if (formCount !== 1) throw new Error('Contacts must contain one controlled Contact Form component.');
  return { blocks };
};

export class ServiceSectionService {
  private repository = new ServiceSectionRepository();

  parseType(value: string): ServiceSectionType {
    if (!isServiceSectionType(value)) throw new Error('Service section not found.');
    return value;
  }

  private validate(input: ServiceSectionUpdate, publishing = false): ServiceSectionUpdate {
    if (!input || typeof input !== 'object') throw new Error('Invalid service section input.');
    const content = {
      titleEn: String(input.titleEn ?? '').trim(),
      bodyEn: String(input.bodyEn ?? '').trim(),
      titleLv: String(input.titleLv ?? '').trim(),
      bodyLv: String(input.bodyLv ?? '').trim()
    };
    for (const title of [content.titleEn, content.titleLv]) {
      if (title.length > MAX_TITLE_LENGTH) throw new Error(`Titles must be at most ${MAX_TITLE_LENGTH} characters.`);
      if (publishing && !stripRichText(title)) throw new Error('Both localized titles are required before publishing.');
    }
    for (const body of [content.bodyEn, content.bodyLv]) {
      if (body.length > MAX_BODY_LENGTH) throw new Error(`Content must be at most ${MAX_BODY_LENGTH} characters.`);
      if (publishing && !stripRichText(body)) throw new Error('Both localized contents are required before publishing.');
    }
    return {
      ...content,
      enabled: input.enabled !== false,
      showInFooter: input.showInFooter !== false,
      contactConfig: validateContactConfig(input.contactConfig, publishing)
    };
  }

  list() {
    return this.repository.list();
  }

  update(typeValue: string, input: ServiceSectionUpdate) {
    return this.repository.updateDraft(this.parseType(typeValue), this.validate(input));
  }

  publish(typeValue: string, input?: ServiceSectionUpdate) {
    const type = this.parseType(typeValue);
    if (input) this.repository.updateDraft(type, this.validate(input, true));
    else {
      const existing = this.repository.list().find((section) => section.type === type);
      if (!existing) throw new Error('Service section not found.');
      this.validate(existing, true);
    }
    return this.repository.publish(type);
  }

  getPublic(typeValue: string, locale: Locale) {
    return this.repository.getPublic(this.parseType(typeValue), locale);
  }

  getFooterLinks(locale: Locale) {
    return this.repository.getFooterLinks(locale);
  }
}
