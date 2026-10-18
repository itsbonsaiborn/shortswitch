import { describe, expect, test } from 'vitest';
import { isPublicClientPath, resolvePublicLocale } from './public-locale';

describe('public locale resolution', () => {
  test.each([
    ['lv', 'lv'],
    ['lv-LV', 'lv'],
    ['lv-US', 'lv'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['ru-RU', 'en'],
    ['zz-ZZ', 'en'],
    ['', 'en'],
    [undefined, 'en']
  ])('maps %s to %s', (language, expected) => {
    expect(resolvePublicLocale(language)).toBe(expected);
  });

  test('uses only the first Accept-Language entry', () => {
    expect(resolvePublicLocale('ru-RU,lv-LV;q=0.9,en;q=0.8')).toBe('en');
    expect(resolvePublicLocale('lv-LV;q=0.7,en-US;q=1')).toBe('lv');
  });

  test('recognizes only Vue public routes', () => {
    expect(isPublicClientPath('/class-survey')).toBe(true);
    expect(isPublicClientPath('/present/class-survey')).toBe(true);
    expect(isPublicClientPath('/login')).toBe(false);
    expect(isPublicClientPath('/app/live')).toBe(false);
    expect(isPublicClientPath('/')).toBe(false);
  });
});
