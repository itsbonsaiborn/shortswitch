import { describe, expect, test } from 'vitest';
import { renderRichTextHtml, renderRichTextParagraphs, stripRichText } from './rich-text';

describe('safe rich text', () => {
  test('renders only the fixed formatting allowlist', () => {
    const html = renderRichTextHtml('[b]Bold[/b] [sup]2[/sup] <img src=x onerror=alert(1)>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<sup>2</sup>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  test('keeps plain text compatible and strips markup for sorting', () => {
    expect(renderRichTextParagraphs('First\nline\n\nSecond')).toBe('<p>First<br />line</p><p>Second</p>');
    expect(stripRichText('[b]Ābols[/b]')).toBe('Ābols');
  });
});
