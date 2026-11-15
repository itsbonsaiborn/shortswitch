import { describe, expect, test } from 'vitest';
import {
  parseDisplayPreferences,
  resolveDisplayLocale,
  resolveDisplayTheme
} from './display-preferences';

describe('display preferences', () => {
  test.each([
    ['auto', 'lv-LV', 'lv'],
    ['auto', 'en-US', 'en'],
    ['auto', 'ru-RU', 'en'],
    ['en', 'lv-LV', 'en'],
    ['lv', 'en-US', 'lv']
  ] as const)('resolves %s with %s as %s', (preference, language, expected) => {
    expect(resolveDisplayLocale(preference, language)).toBe(expected);
  });

  test.each([
    ['system', false, 'light'],
    ['system', true, 'dark'],
    ['light', true, 'light'],
    ['dark', false, 'dark']
  ] as const)('resolves %s appearance', (preference, systemDark, expected) => {
    expect(resolveDisplayTheme(preference, systemDark)).toBe(expected);
  });

  test('falls back safely for invalid stored values', () => {
    expect(parseDisplayPreferences({ language: 'de', appearance: 'sepia' })).toEqual({
      language: 'auto', appearance: 'system'
    });
  });

  test.each(
    (['auto', 'en', 'lv'] as const).flatMap((language) =>
      (['system', 'light', 'dark'] as const).map((appearance) => [language, appearance] as const)
    )
  )('accepts the %s / %s combination', (language, appearance) => {
    expect(parseDisplayPreferences({ language, appearance })).toEqual({ language, appearance });
  });
});
