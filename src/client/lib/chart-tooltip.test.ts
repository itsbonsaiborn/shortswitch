import { describe, expect, test } from 'vitest';
import { createDonutTooltip } from './chart-tooltip';

describe('createDonutTooltip', () => {
  test('renders a value and percentage without trusting analytics labels or colors', () => {
    const tooltip = createDonutTooltip(
      [{ label: '<img src=x onerror=alert(1)>', value: 3 }, { label: 'Safe', value: 1 }],
      ['red;position:fixed', '#ad8301']
    );
    const html = tooltip({ series: [3, 1], seriesIndex: 0 });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('<strong>3</strong>');
    expect(html).toContain('75.0%');
    expect(html).toContain('--ss-tooltip-color:#24837b');
  });
});
