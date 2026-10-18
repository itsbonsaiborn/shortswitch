// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { chartCategoryColor, chartCategoryColors, chartPalette } from './chart-colors';

describe('chart category colors', () => {
  it('uses the fixed semantic palette in every theme', () => {
    expect(chartCategoryColor('Desktop', false)).toBe(chartPalette.teal);
    expect(chartCategoryColor('Mobile', true)).toBe(chartPalette.blue);
    expect(chartCategoryColor('Safari', false)).toBe(chartPalette.violet);
    expect(chartCategoryColor('Android', true)).toBe(chartPalette.amber);
    expect(chartCategoryColor('Firefox', false)).toBe(chartPalette.coral);
    expect(chartCategoryColor('Mobile Safari', true)).toBe(chartPalette.violet);
    expect(chartCategoryColor('Windows 10', false)).toBe(chartPalette.teal);
    expect(chartCategoryColor('Mac OS 10.15', true)).toBe(chartPalette.violet);
  });

  it('keeps semantic and dynamic category colors stable when the data order changes', () => {
    const labels = ['Custom alpha', 'Custom beta', 'Custom gamma', 'Other'];
    const original = chartCategoryColors(labels, false);
    const reorderedLabels = ['Other', 'Custom gamma', 'Custom alpha', 'Custom beta'];
    const reordered = chartCategoryColors(reorderedLabels, false);
    const originalByLabel = new Map(labels.map((label, index) => [label, original[index]]));

    expect(reordered).toEqual(reorderedLabels.map((label) => originalByLabel.get(label)));
    expect(new Set(original.slice(0, 3)).size).toBe(3);
  });

  it('always renders unknown and aggregate categories in gray', () => {
    expect(chartCategoryColor('Unknown', false)).toBe(chartPalette.gray);
    expect(chartCategoryColor('Nezināms', true)).toBe(chartPalette.gray);
    expect(chartCategoryColor('Other', false)).toBe(chartPalette.gray);
    expect(chartCategoryColor('Cits', true)).toBe(chartPalette.gray);
  });

  it('mutes zero-value legend colors without changing non-zero assignments', () => {
    const colors = chartCategoryColors(['Desktop', 'Mobile'], false, [0, 4]);
    expect(colors[0]).toBe('rgba(35, 139, 131, 0.34)');
    expect(colors[1]).toBe(chartPalette.blue);
  });
});
