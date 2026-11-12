import { z } from 'zod';
import type { BoardCardInput, BoardInput, BoardSettings } from '@/shared/board-types.js';

const stableId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const optionalText = (maximum: number) => z.string().trim().max(maximum).default('');
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const unsafePlainTextControls = /[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const safeOptionalText = (maximum: number) => optionalText(maximum)
  .refine((value) => !unsafePlainTextControls.test(value), 'Text contains unsupported characters.');
const safeRequiredText = (maximum: number) => requiredText(maximum)
  .refine((value) => !unsafePlainTextControls.test(value), 'Text contains unsupported characters.');
const cardTitle = z.string().trim().max(300)
  .refine((value) => !value.includes('\n') && !value.includes('\r'), 'Board card titles must use one line.')
  .refine((value) => !unsafePlainTextControls.test(value), 'Board card title contains unsupported characters.')
  .default('');
const cardBody = z.string()
  .transform((value) => value.replace(/\r\n?/g, '\n').trim())
  .pipe(z.string().min(1).max(20000).refine((value) => !unsafePlainTextControls.test(value), 'Board card text contains unsupported characters.'));
const optionalNullableText = (maximum: number) => z.preprocess(
  (value) => typeof value === 'string' && !value.trim() ? null : value,
  z.string().trim().min(1).max(maximum)
    .refine((value) => !value.includes('\n') && !value.includes('\r'))
    .refine((value) => !unsafePlainTextControls.test(value), 'Text contains unsupported characters.')
    .nullable()
);

export const boardSettingsSchema = z.object({
  themeId: stableId.default('board_theme_minimal_light'),
  layout: z.literal('grid').default('grid'),
  visualStyle: z.enum(['classic', 'minimal', 'soft', 'bold']).default('classic'),
  backgroundPattern: z.enum(['none', 'dots', 'grid', 'soft_glow', 'crosses']).default('none'),
  patternIntensity: z.number().int().min(0).max(100).default(35),
  readOnly: z.boolean().default(false),
  locked: z.boolean().default(false),
  submissionsExpiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  requireParticipantName: z.boolean().default(false),
  moderationMode: z.enum(['auto_approve', 'review_all']).default('review_all'),
  maxCardsTotal: z.number().int().min(1).max(5000).default(500),
  maxCardsPerParticipant: z.number().int().min(1).max(100).default(10),
  maxTitleLength: z.number().int().min(1).max(300).default(160),
  maxBodyLength: z.number().int().min(1).max(20000).default(5000),
  allowImageUrls: z.boolean().default(true),
  participantCanEdit: z.boolean().default(true),
  participantCanDelete: z.boolean().default(true),
  requireCardTitle: z.boolean().default(true)
}).strict();

export const boardInputSchema = z.object({
  title: safeRequiredText(160),
  description: safeOptionalText(2000),
  slug: z.string().trim().max(128).optional(),
  status: z.enum(['draft', 'published', 'disabled']).default('draft'),
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  settings: boardSettingsSchema.default(() => boardSettingsSchema.parse({}))
}).strict();

const externalImageUrl = z.string().trim().url().max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Board card images must use HTTPS.')
  .refine((value) => {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  }, 'Board card image URL is invalid.');

export const boardCardInputSchema = z.object({
  title: cardTitle,
  body: cardBody,
  imageUrl: z.preprocess((value) => value === '' ? null : value, externalImageUrl.nullable()).default(null),
  authorDisplayName: optionalNullableText(120).default(null),
  // `compact` remains accepted for backwards compatibility with existing
  // clients and persisted cards, but is no longer offered by the UI.
  layout: z.enum(['text', 'image_text', 'compact']).default('text')
}).strict();

export const boardCardPositionInputSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000),
  y: z.number().finite().min(-1_000_000).max(1_000_000),
  width: z.number().finite().min(160).max(1200).default(280),
  height: z.number().finite().min(100).max(1600).default(180),
  zIndex: z.number().int().min(0).max(2_147_483_647).default(0),
  expectedRevision: z.number().int().min(0).optional()
}).strict();

export const boardOpaqueTokenHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const boardCredentialHashesSchema = z.object({
  ownerTokenHash: boardOpaqueTokenHashSchema,
  recoveryPinHash: z.string().min(32).max(1024).regex(/^\$argon2(?:id|i|d)\$/).nullable().default(null)
}).strict();

export const parseBoardInput = (input: unknown): BoardInput => boardInputSchema.parse(input) as BoardInput;

export const parseBoardSettings = (input: unknown): BoardSettings => boardSettingsSchema.parse(input) as BoardSettings;

export const parseBoardCardInput = (
  input: unknown,
  settings: Pick<BoardSettings, 'maxTitleLength' | 'maxBodyLength' | 'allowImageUrls' | 'requireParticipantName' | 'requireCardTitle'>
): BoardCardInput => {
  const parsed = boardCardInputSchema.parse(input) as BoardCardInput;
  if (parsed.title.length > settings.maxTitleLength) throw new Error('Board card title is too long.');
  if (settings.requireCardTitle && !parsed.title) throw new Error('Board card title is required.');
  if (parsed.body.length > settings.maxBodyLength) throw new Error('Board card body is too long.');
  if (parsed.imageUrl && !settings.allowImageUrls) throw new Error('Image URLs are disabled for this board.');
  if (settings.requireParticipantName && !parsed.authorDisplayName) throw new Error('Participant name is required.');
  if (parsed.layout === 'image_text' && !parsed.imageUrl) throw new Error('Image and text cards require an image URL.');
  if (parsed.layout !== 'image_text' && parsed.imageUrl) throw new Error('The selected card layout does not support an image.');
  return parsed;
};
