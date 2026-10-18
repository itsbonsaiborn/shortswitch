const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const safeColor = (value: string | undefined) =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#24837b';

export const createDonutTooltip = (
  items: Array<{ label: string; value: number }>,
  colors: string[],
  locale = 'en'
) => ({ series, seriesIndex }: { series: number[]; seriesIndex: number }) => {
  const value = Number(series[seriesIndex] ?? items[seriesIndex]?.value ?? 0);
  const total = series.reduce((sum, entry) => sum + Number(entry || 0), 0);
  const percent = total > 0 ? (value / total) * 100 : 0;
  const label = escapeHtml(items[seriesIndex]?.label ?? 'Unknown');
  const color = safeColor(colors[seriesIndex]);
  const numberFormatter = new Intl.NumberFormat(locale);
  const percentFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  return `
    <div class="ss-donut-tooltip" role="presentation">
      <span class="ss-donut-tooltip__marker" style="--ss-tooltip-color:${color}"></span>
      <div class="ss-donut-tooltip__content">
        <span class="ss-donut-tooltip__label">${label}</span>
        <span class="ss-donut-tooltip__metrics">
          <strong>${numberFormatter.format(Math.round(value))}</strong>
          <span>${percentFormatter.format(percent)}%</span>
        </span>
      </div>
    </div>`;
};
