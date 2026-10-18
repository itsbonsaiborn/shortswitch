export const chartPalette = {
  teal: '#238B83',
  blue: '#5285C5',
  violet: '#8064BD',
  amber: '#C99522',
  coral: '#D87962',
  gray: '#A3A7AD'
} as const;

const categoryPalette = [
  chartPalette.teal,
  chartPalette.blue,
  chartPalette.violet,
  chartPalette.amber,
  chartPalette.coral
] as const;

const semanticIndexes: Record<string, number> = {
  links: 0,
  desktop: 0,
  chrome: 0,
  googlechrome: 0,
  windows: 0,
  en: 0,
  enus: 0,
  english: 0,

  pages: 1,
  mobile: 1,
  edge: 1,
  microsoftedge: 1,
  linux: 1,
  lv: 1,
  lvlv: 1,
  latvian: 1,
  latviesu: 1,
  latviešu: 1,

  live: 2,
  tablet: 2,
  safari: 2,
  macos: 2,
  macintosh: 2,

  opera: 3,
  android: 3,

  firefox: 4,
  mozillafirefox: 4,
  ios: 4
};

const grayCategories = new Set([
  '',
  'unknown',
  'undefined',
  'unset',
  'null',
  'na',
  'other',
  'others',
  'cits',
  'citi',
  'cita',
  'citas',
  'nezinams',
  'nezināms'
]);

const normalizeCategory = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replaceAll(/[^\p{L}\p{N}]+/gu, '');

const semanticIndex = (normalized: string) => {
  const exact = semanticIndexes[normalized];
  if (exact !== undefined) return exact;
  if (normalized.includes('chrome')) return 0;
  if (normalized.startsWith('edge') || normalized.includes('microsoftedge')) return 1;
  if (normalized.includes('safari')) return 2;
  if (normalized.includes('opera')) return 3;
  if (normalized.includes('firefox')) return 4;
  if (normalized.startsWith('windows')) return 0;
  if (normalized.startsWith('linux')) return 1;
  if (normalized.startsWith('macos') || normalized.startsWith('macintosh')) return 2;
  if (normalized.startsWith('android')) return 3;
  if (normalized.startsWith('ios')) return 4;
  return undefined;
};

const hash = (value: string) => {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

const mutedColor = (color: string, dark: boolean) => {
  const alpha = dark ? 0.46 : 0.34;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const baseColor = (label: string) => {
  const normalized = normalizeCategory(label);
  if (grayCategories.has(normalized)) return chartPalette.gray;
  const index = semanticIndex(normalized) ?? hash(normalized) % categoryPalette.length;
  return categoryPalette[index];
};

export const chartCategoryColor = (label: string, dark: boolean, muted = false) => {
  const color = baseColor(label);
  return muted ? mutedColor(color, dark) : color;
};

export const chartCategoryColors = (
  labels: readonly string[],
  dark: boolean,
  values: readonly number[] = []
) => {
  const normalizedLabels = labels.map(normalizeCategory);
  const assigned = new Map<string, string>();
  const used = new Set<number>();

  for (const normalized of normalizedLabels) {
    if (grayCategories.has(normalized)) {
      assigned.set(normalized, chartPalette.gray);
      continue;
    }
    const index = semanticIndex(normalized);
    if (index === undefined) continue;
    assigned.set(normalized, categoryPalette[index]);
    used.add(index);
  }

  const dynamic = [...new Set(normalizedLabels.filter((label) => !grayCategories.has(label) && semanticIndex(label) === undefined))]
    .sort((left, right) => left.localeCompare(right));
  for (const normalized of dynamic) {
    const preferred = hash(normalized) % categoryPalette.length;
    let selected = preferred;
    for (let offset = 0; offset < categoryPalette.length; offset += 1) {
      const candidate = (preferred + offset) % categoryPalette.length;
      if (!used.has(candidate)) {
        selected = candidate;
        break;
      }
    }
    assigned.set(normalized, categoryPalette[selected]);
    used.add(selected);
  }

  return normalizedLabels.map((normalized, index) => {
    const color = assigned.get(normalized) ?? chartPalette.gray;
    return (values[index] ?? 1) <= 0 ? mutedColor(color, dark) : color;
  });
};

export const chartDonutDividerColor = (dark: boolean) => dark ? '#1C1B1A' : '#FFFCF0';
