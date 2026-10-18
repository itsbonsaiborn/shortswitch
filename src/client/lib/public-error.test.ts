import { describe, expect, test } from 'vitest';
import { ApiError } from './api';
import { localizePublicError } from './public-error';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('public error localization', () => {
  test('maps known Live validation messages without exposing raw server text', () => {
    expect(localizePublicError(new Error('This activity is closed.'), t, 'live')).toBe('public.activityClosed');
    expect(localizePublicError(new Error('Answer must contain between 1 and 500 characters.'), t, 'live'))
      .toBe('public.answerLength:{"max":500}');
  });

  test('uses resource-safe fallbacks for unknown HTTP errors', () => {
    expect(localizePublicError(new ApiError('Internal detail', 404), t, 'page')).toBe('public.pageUnavailable');
    expect(localizePublicError(new ApiError('Internal detail', 404), t, 'presentation')).toBe('public.presentationUnavailable');
    expect(localizePublicError(new ApiError('Internal detail', 429), t, 'live')).toBe('public.tooManyRequests');
  });
});
