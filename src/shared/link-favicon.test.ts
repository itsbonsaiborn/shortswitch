import { describe, expect, test } from 'vitest';
import { getLinkFaviconCandidates } from './link-favicon.js';

describe('getLinkFaviconCandidates', () => {
  test('returns stable candidates from the stored target origin', () => {
    expect(getLinkFaviconCandidates('https://example.com/path?q=1')).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/favicon.png',
      'https://example.com/odbfavicon.ico'
    ]);
  });

  test('keeps the SharePoint candidate order used by Links cards', () => {
    expect(getLinkFaviconCandidates('https://school.sharepoint.com/sites/class')).toEqual([
      'https://school.sharepoint.com/_layouts/15/images/odbfavicon.ico',
      'https://school.sharepoint.com/favicon.ico',
      'https://school.sharepoint.com/favicon.png',
      'https://school.sharepoint.com/odbfavicon.ico'
    ]);
  });

  test('rejects malformed and non-web destinations', () => {
    expect(getLinkFaviconCandidates('not a url')).toEqual([]);
    expect(getLinkFaviconCandidates('javascript:alert(1)')).toEqual([]);
  });
});
