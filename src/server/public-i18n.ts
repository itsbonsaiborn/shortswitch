import en from '../client/locales/en.json' with { type: 'json' };
import lv from '../client/locales/lv.json' with { type: 'json' };
import type { Locale } from '../shared/types.js';

export type PublicMessageKey = keyof typeof en.public;

export const publicText = (
  locale: Locale,
  key: PublicMessageKey,
  params: Record<string, string | number> = {}
) => {
  const localized = locale === 'lv' ? lv.public[key] : en.public[key];
  const template = localized || en.public[key];
  return Object.entries(params).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template
  );
};
