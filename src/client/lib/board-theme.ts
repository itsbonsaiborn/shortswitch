import type { ActivityBackgroundPattern, ActivityLayout, ActivityTheme } from '@/shared/activity-types';
import type { BoardSettings, BoardThemeReference } from '@/shared/board-types';

const activityThemes = new Set<ActivityTheme>([
  'classic_cream',
  'forest_dark',
  'soft_lavender',
  'ocean_blue',
  'minimal_light'
]);

export const boardThemeCatalog: Array<{
  surface: ActivityTheme;
  labelKey: string;
  colors: [string, string, string];
}> = [
  { surface: 'classic_cream', labelKey: 'activityDesign.themes.classicCream', colors: ['#f7f0df', '#c7662e', '#28211b'] },
  { surface: 'forest_dark', labelKey: 'activityDesign.themes.forestDark', colors: ['#14211b', '#9db55f', '#f0f4e8'] },
  { surface: 'soft_lavender', labelKey: 'activityDesign.themes.softLavender', colors: ['#f1edfa', '#8067b1', '#302842'] },
  { surface: 'ocean_blue', labelKey: 'activityDesign.themes.oceanBlue', colors: ['#eaf5f8', '#287d91', '#18333c'] },
  { surface: 'minimal_light', labelKey: 'activityDesign.themes.minimalLight', colors: ['#f8f8f6', '#2f6f62', '#1f1f1d'] }
];

export const boardVisualStyles: Array<{ value: ActivityLayout; labelKey: string }> = [
  { value: 'classic', labelKey: 'activityDesign.layouts.classic' },
  { value: 'minimal', labelKey: 'activityDesign.layouts.minimal' },
  { value: 'soft', labelKey: 'activityDesign.layouts.soft' },
  { value: 'bold', labelKey: 'activityDesign.layouts.bold' }
];

export const boardPatterns: Array<{ value: ActivityBackgroundPattern; labelKey: string }> = [
  { value: 'none', labelKey: 'pages.patternNone' },
  { value: 'dots', labelKey: 'pages.patternDots' },
  { value: 'grid', labelKey: 'pages.patternGrid' },
  { value: 'soft_glow', labelKey: 'pages.patternSoftGlow' },
  { value: 'crosses', labelKey: 'pages.patternCrosses' }
];

export const resolveBoardThemeSurface = (theme?: BoardThemeReference | null): ActivityTheme => {
  const candidate = theme?.config?.surface;
  return typeof candidate === 'string' && activityThemes.has(candidate as ActivityTheme)
    ? candidate as ActivityTheme
    : 'minimal_light';
};

export const boardSurfaceClasses = (
  theme: BoardThemeReference | null | undefined,
  settings: Pick<BoardSettings, 'visualStyle' | 'backgroundPattern'>
) => [
  'activity-surface',
  'board-surface',
  `activity-theme-${resolveBoardThemeSurface(theme)}`,
  `activity-layout-${settings.visualStyle}`,
  `activity-pattern-${settings.backgroundPattern}`
];

export const boardSurfaceStyle = (patternIntensity: number) => ({
  '--activity-pattern-opacity': String(Math.max(0, Math.min(100, patternIntensity)) / 100)
});

