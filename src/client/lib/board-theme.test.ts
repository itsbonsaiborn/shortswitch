// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import type { BoardThemeReference } from '@/shared/board-types';
import { boardSurfaceClasses, boardSurfaceStyle, resolveBoardThemeSurface } from './board-theme';

const theme = (surface: unknown): BoardThemeReference => ({
  id: 'theme', name: 'Theme', config: { surface }, system: true
});

describe('Board theme compatibility', () => {
  test('reuses compatible Activities themes and design classes', () => {
    expect(resolveBoardThemeSurface(theme('forest_dark'))).toBe('forest_dark');
    expect(boardSurfaceClasses(theme('ocean_blue'), { visualStyle: 'soft', backgroundPattern: 'grid' }))
      .toEqual(expect.arrayContaining(['activity-theme-ocean_blue', 'activity-layout-soft', 'activity-pattern-grid']));
  });

  test('falls back safely for missing or incompatible theme config', () => {
    expect(resolveBoardThemeSurface(null)).toBe('minimal_light');
    expect(resolveBoardThemeSurface(theme('unsupported'))).toBe('minimal_light');
    expect(boardSurfaceStyle(150)).toEqual({ '--activity-pattern-opacity': '1' });
    expect(boardSurfaceStyle(-10)).toEqual({ '--activity-pattern-opacity': '0' });
  });
});
