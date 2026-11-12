// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  boardCardPositionInputSchema,
  boardCredentialHashesSchema,
  parseBoardCardInput,
  parseBoardInput,
  parseBoardSettings
} from './board-domain.js';

describe('Boards domain validation', () => {
  test('applies conservative board defaults', () => {
    const board = parseBoardInput({ title: 'Class board' });

    expect(board).toMatchObject({
      title: 'Class board',
      description: '',
      status: 'draft',
      settings: {
        themeId: 'board_theme_minimal_light',
        layout: 'grid',
        visualStyle: 'classic',
        backgroundPattern: 'none',
        patternIntensity: 35,
        readOnly: false,
        locked: false,
        submissionsExpiresAt: null,
        moderationMode: 'review_all',
        requireCardTitle: true,
        maxCardsTotal: 500,
        maxCardsPerParticipant: 10
      }
    });
  });

  test('validates Board design settings shared with Activities', () => {
    expect(parseBoardSettings({
      visualStyle: 'soft', backgroundPattern: 'dots', patternIntensity: 70
    })).toMatchObject({ visualStyle: 'soft', backgroundPattern: 'dots', patternIntensity: 70 });
    expect(() => parseBoardSettings({ backgroundPattern: 'animated_waves' })).toThrow();
    expect(() => parseBoardSettings({ patternIntensity: 101 })).toThrow();
  });

  test('enforces board-specific card limits and participant names', () => {
    const settings = parseBoardSettings({
      maxTitleLength: 5,
      maxBodyLength: 10,
      requireParticipantName: true,
      allowImageUrls: false
    });

    expect(() => parseBoardCardInput({ title: 'Longer', body: 'Text', authorDisplayName: 'Anna' }, settings))
      .toThrow('Board card title is too long.');
    expect(() => parseBoardCardInput({ title: 'Title', body: 'Text' }, settings))
      .toThrow('Participant name is required.');
    expect(() => parseBoardCardInput({
      title: 'Title', body: 'Text', authorDisplayName: 'Anna', imageUrl: 'https://example.com/image.png'
    }, settings)).toThrow('Image URLs are disabled for this board.');
  });

  test('accepts only HTTPS card images and preserves bounded legacy positions', () => {
    const settings = parseBoardSettings({});

    expect(() => parseBoardCardInput({
      title: 'Title', body: 'Text', imageUrl: 'http://example.com/image.png'
    }, settings)).toThrow('Board card images must use HTTPS.');
    expect(() => parseBoardCardInput({
      title: 'Title', body: 'Text', imageUrl: 'javascript:alert(1)'
    }, settings)).toThrow();
    expect(boardCardPositionInputSchema.parse({ x: 12.5, y: -4 })).toMatchObject({
      x: 12.5, y: -4, width: 280, height: 180, zIndex: 0
    });
    expect(() => boardCardPositionInputSchema.parse({ x: Number.POSITIVE_INFINITY, y: 0 })).toThrow();
  });

  test('rejects unsafe control characters in board and participant text fields', () => {
    expect(() => parseBoardInput({ title: 'Unsafe\u0000 title' })).toThrow('unsupported characters');
    expect(() => parseBoardInput({ title: 'Board', description: 'Unsafe\u0007 description' })).toThrow('unsupported characters');
    expect(() => parseBoardCardInput(
      { title: 'Card', body: 'Body', authorDisplayName: 'Unsafe\u0001 name' },
      parseBoardSettings({})
    )).toThrow('unsupported characters');
  });

  test('supports optional titles and validates the selected card layout', () => {
    const optionalTitle = parseBoardSettings({ requireCardTitle: false });
    expect(parseBoardCardInput({ title: '', body: 'Plain text', layout: 'text' }, optionalTitle))
      .toMatchObject({ title: '', layout: 'text' });
    expect(() => parseBoardCardInput({ title: '', body: 'Missing title' }, parseBoardSettings({ requireCardTitle: true })))
      .toThrow('Board card title is required.');
    expect(() => parseBoardCardInput({ title: 'Picture', body: 'No URL', layout: 'image_text' }, optionalTitle))
      .toThrow('Image and text cards require an image URL.');
    expect(parseBoardCardInput({ title: 'Legacy compact', body: 'Compact', layout: 'compact' }, optionalTitle))
      .toMatchObject({ title: 'Legacy compact', layout: 'compact' });
  });

  test('accepts hashes, not plaintext ownership credentials', () => {
    expect(() => boardCredentialHashesSchema.parse({ ownerTokenHash: 'plaintext-token' })).toThrow();
    expect(() => boardCredentialHashesSchema.parse({
      ownerTokenHash: 'a'.repeat(64), recoveryPinHash: 'this-is-still-a-plaintext-recovery-pin'
    })).toThrow();
    expect(boardCredentialHashesSchema.parse({ ownerTokenHash: 'a'.repeat(64) })).toEqual({
      ownerTokenHash: 'a'.repeat(64),
      recoveryPinHash: null
    });
  });
});
