import { describe, expect, test } from 'vitest';
import en from './en.json';
import lv from './lv.json';

const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return child && typeof child === 'object' && !Array.isArray(child)
    ? keys(child as Record<string, unknown>, path)
    : [path];
});

describe('locale catalogs', () => {
  test('English and Latvian expose the same non-empty keys', () => {
    expect(keys(lv).sort()).toEqual(keys(en).sort());
    expect(keys(lv).every((key) => {
      const value = key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)[part], lv);
      return typeof value === 'string' && value.trim().length > 0;
    })).toBe(true);
  });
});
