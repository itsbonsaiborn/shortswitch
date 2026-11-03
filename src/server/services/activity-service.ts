import type { ActivityPublishValidation, ActivitySettings } from '@/shared/activity-types.js';
import { activitySettingsInputSchema, parseActivityDraftInput, toActivitySlides } from '../domain/activity-domain.js';
import { ActivityRepository } from '../repositories/activity-repository.js';
import { SettingsRepository } from '../repositories/settings-repository.js';
import { buildShortUrl, createSlugGenerator, validateCustomSlug, validateGeneratedSlug } from '../utils.js';

export class ActivityService {
  private readonly activities = new ActivityRepository();
  private readonly settings = new SettingsRepository();

  private resolveSlug(requested?: string) {
    const security = this.settings.getSecuritySettings();
    const manual = requested?.trim();
    const slug = manual || createSlugGenerator(security.slugAllowedChars, security.minSlugLength)();
    const result = manual
      ? validateCustomSlug(slug, { minLength: security.minSlugLength, maxLength: security.maxSlugLength })
      : validateGeneratedSlug(slug, {
          allowedChars: security.slugAllowedChars,
          minLength: security.minSlugLength,
          maxLength: security.maxSlugLength
        });
    if (!result.ok) throw new Error(result.reason);
    return slug;
  }

  private parseSettings(raw: unknown, current?: ActivitySettings): ActivitySettings {
    const parsed = activitySettingsInputSchema.parse(current && raw && typeof raw === 'object'
      ? { ...current, ...(raw as Record<string, unknown>) }
      : raw);
    return {
      ...parsed,
      slug: this.resolveSlug(parsed.slug ?? current?.slug)
    };
  }

  private requireActivity(userId: string, activityId: string) {
    const activity = this.activities.findById(userId, activityId, buildShortUrl);
    if (!activity) throw new Error('Activity not found.');
    return activity;
  }

  list(userId: string) {
    return this.activities.list(userId, buildShortUrl);
  }

  get(userId: string, activityId: string) {
    const activity = this.requireActivity(userId, activityId);
    const draft = this.activities.getDraft(userId, activityId)!;
    return { activity, draft, versions: this.activities.listVersions(userId, activityId) };
  }

  create(userId: string, rawSettings: unknown) {
    const settings = this.parseSettings(rawSettings);
    try {
      const activityId = this.activities.create(userId, settings);
      return this.get(userId, activityId);
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) throw new Error('This slug is already in use.');
      throw error;
    }
  }

  update(userId: string, activityId: string, raw: { expectedRevision?: unknown; settings?: unknown } | undefined) {
    const current = this.requireActivity(userId, activityId);
    const body = raw ?? {};
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new Error('A valid draft revision is required.');
    const settings = this.parseSettings(body.settings, current.settings);
    try {
      this.activities.updateSettings(userId, activityId, settings, Number(body.expectedRevision));
      return this.get(userId, activityId);
    } catch (error) {
      if (String((error as Error).message).includes('UNIQUE constraint failed')) throw new Error('This slug is already in use.');
      throw error;
    }
  }

  getDraft(userId: string, activityId: string) {
    this.requireActivity(userId, activityId);
    return this.activities.getDraft(userId, activityId)!;
  }

  replaceDraft(userId: string, activityId: string, raw: unknown) {
    this.requireActivity(userId, activityId);
    const draft = parseActivityDraftInput(raw);
    this.activities.replaceDraft(userId, activityId, draft.expectedRevision, draft.slides);
    return this.activities.getDraft(userId, activityId)!;
  }

  addSlide(userId: string, activityId: string, raw: { expectedRevision?: unknown; position?: unknown; slide?: unknown } | undefined) {
    const current = this.getDraft(userId, activityId);
    const body = raw ?? {};
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) !== current.revision) throw new Error('Activity draft has changed.');
    const requestedPosition = Number.isInteger(body.position) ? Number(body.position) : current.slides.length;
    const position = Math.min(current.slides.length, Math.max(0, requestedPosition));
    const slides = current.slides.map((slide) => ({ id: slide.id, title: slide.title, description: slide.description, blocks: slide.blocks }));
    slides.splice(position, 0, body.slide as typeof slides[number]);
    return this.replaceDraft(userId, activityId, { expectedRevision: current.revision, slides });
  }

  updateSlide(
    userId: string,
    activityId: string,
    slideId: string,
    raw: { expectedRevision?: unknown; position?: unknown; slide?: unknown } | undefined
  ) {
    const current = this.getDraft(userId, activityId);
    const body = raw ?? {};
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) !== current.revision) throw new Error('Activity draft has changed.');
    const sourceIndex = current.slides.findIndex((slide) => slide.id === slideId);
    if (sourceIndex < 0) throw new Error('Activity slide not found.');
    const slides = current.slides.map((slide) => ({ id: slide.id, title: slide.title, description: slide.description, blocks: slide.blocks }));
    const existing = slides.splice(sourceIndex, 1)[0];
    const replacement = { ...existing, ...(body.slide as Record<string, unknown>), id: slideId } as typeof existing;
    const requestedPosition = Number.isInteger(body.position) ? Number(body.position) : sourceIndex;
    const position = Math.min(slides.length, Math.max(0, requestedPosition));
    slides.splice(position, 0, replacement);
    return this.replaceDraft(userId, activityId, { expectedRevision: current.revision, slides });
  }

  deleteSlide(userId: string, activityId: string, slideId: string, expectedRevision: unknown) {
    const current = this.getDraft(userId, activityId);
    if (!Number.isInteger(expectedRevision) || Number(expectedRevision) !== current.revision) throw new Error('Activity draft has changed.');
    const slides = current.slides
      .filter((slide) => slide.id !== slideId)
      .map((slide) => ({ id: slide.id, title: slide.title, description: slide.description, blocks: slide.blocks }));
    if (slides.length === current.slides.length) throw new Error('Activity slide not found.');
    return this.replaceDraft(userId, activityId, { expectedRevision: current.revision, slides });
  }

  publish(userId: string, activityId: string, expectedRevision: unknown) {
    const activity = this.requireActivity(userId, activityId);
    const currentDraft = this.activities.getDraft(userId, activityId)!;
    if (!Number.isInteger(expectedRevision) || Number(expectedRevision) !== currentDraft.revision) throw new Error('Activity draft has changed.');
    const validation = this.validatePublish(userId, activityId);
    if (!validation.valid) throw new Error(validation.items.filter((item) => !item.valid).map((item) => item.message).join(' '));
    const normalized = parseActivityDraftInput({
      expectedRevision: currentDraft.revision,
      slides: currentDraft.slides.map((slide) => ({ id: slide.id, title: slide.title, description: slide.description, blocks: slide.blocks }))
    });
    const safeSlides = toActivitySlides(normalized);
    const published = this.activities.publish(userId, activity, currentDraft, safeSlides, currentDraft.revision);
    return this.activities.getPublishedVersion(userId, activityId, published.versionId)!;
  }

  validatePublish(userId: string, activityId: string): ActivityPublishValidation {
    const activity = this.requireActivity(userId, activityId);
    const draft = this.activities.getDraft(userId, activityId)!;
    let contentValid = true;
    let contentMessage = 'All slide blocks are valid.';
    try {
      parseActivityDraftInput({
        expectedRevision: draft.revision,
        slides: draft.slides.map((slide) => ({ id: slide.id, title: slide.title, description: slide.description, blocks: slide.blocks }))
      });
    } catch (error) {
      contentValid = false;
      contentMessage = error instanceof Error ? error.message : 'Slide content is invalid.';
    }
    const availabilityValid = !(activity.settings.availabilityStartAt && activity.settings.submissionDeadlineAt)
      || Date.parse(activity.settings.availabilityStartAt) < Date.parse(activity.settings.submissionDeadlineAt);
    const items: ActivityPublishValidation['items'] = [
      { code: 'title', valid: Boolean(activity.settings.title.trim()), message: activity.settings.title.trim() ? 'Activity title is set.' : 'Activity title is required.' },
      { code: 'slides', valid: draft.slides.length > 0, message: draft.slides.length > 0 ? 'At least one slide is ready.' : 'An Activity must contain at least one slide before publishing.' },
      { code: 'content', valid: contentValid, message: contentMessage },
      { code: 'availability', valid: availabilityValid, message: availabilityValid ? 'Availability window is valid.' : 'Availability start must be before the global submission deadline.' },
      { code: 'access', valid: activity.lifecycleState !== 'archived', message: activity.lifecycleState === 'archived' ? 'Restore the Activity before publishing.' : 'Activity is not archived.' }
    ];
    return { valid: items.every((item) => item.valid), items };
  }

  duplicate(userId: string, activityId: string) {
    const source = this.requireActivity(userId, activityId);
    const sourceDraft = this.activities.getDraft(userId, activityId)!;
    const settings = this.parseSettings({
      ...source.settings,
      title: `${source.settings.title} copy`,
      slug: undefined,
      status: 'closed'
    });
    const duplicateId = this.activities.create(userId, settings);
    try {
      this.activities.replaceDraft(userId, duplicateId, 0, parseActivityDraftInput({
        expectedRevision: 0,
        slides: sourceDraft.slides.map((slide) => ({
          title: slide.title,
          description: slide.description,
          blocks: slide.blocks.map(({ id: _id, ...block }) => block)
        }))
      }).slides);
      return this.get(userId, duplicateId);
    } catch (error) {
      this.activities.delete(userId, duplicateId);
      throw error;
    }
  }

  setArchived(userId: string, activityId: string, archived: boolean) {
    this.requireActivity(userId, activityId);
    this.activities.setArchived(userId, activityId, archived);
    return this.get(userId, activityId);
  }

  listVersions(userId: string, activityId: string) {
    this.requireActivity(userId, activityId);
    return this.activities.listVersions(userId, activityId);
  }

  getPublishedVersion(userId: string, activityId: string, versionId: string) {
    this.requireActivity(userId, activityId);
    const version = this.activities.getPublishedVersion(userId, activityId, versionId);
    if (!version) throw new Error('Published Activity version not found.');
    return version;
  }

  delete(userId: string, activityId: string) {
    this.requireActivity(userId, activityId);
    this.activities.delete(userId, activityId);
  }

  clearResults(userId: string, activityId: string) {
    this.requireActivity(userId, activityId);
    return this.activities.clearResults(userId, activityId);
  }
}
