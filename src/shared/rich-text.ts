const allowedTags = ['b', 'i', 'u', 's', 'sup', 'sub'] as const;
type RichTextTag = (typeof allowedTags)[number];

const htmlTags: Record<RichTextTag, string> = {
  b: 'strong', i: 'em', u: 'u', s: 's', sup: 'sup', sub: 'sub'
};

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const tokenPattern = /\[(\/)?(b|i|u|s|sup|sub)\]/gi;

export const renderRichTextHtml = (value: string, lineBreaks = true) => {
  let output = '';
  let cursor = 0;
  const stack: RichTextTag[] = [];
  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    const text = escapeHtml(value.slice(cursor, index));
    output += lineBreaks ? text.replaceAll('\n', '<br />') : text;
    const tag = match[2]!.toLowerCase() as RichTextTag;
    if (match[1]) {
      if (stack.at(-1) === tag) {
        stack.pop();
        output += `</${htmlTags[tag]}>`;
      } else {
        output += escapeHtml(match[0]);
      }
    } else {
      stack.push(tag);
      output += `<${htmlTags[tag]}>`;
    }
    cursor = index + match[0].length;
  }
  const tail = escapeHtml(value.slice(cursor));
  output += lineBreaks ? tail.replaceAll('\n', '<br />') : tail;
  while (stack.length) output += `</${htmlTags[stack.pop()!]}>`;
  return output;
};

export const renderRichTextParagraphs = (value: string) => value
  .split(/\n{2,}/)
  .map((paragraph) => `<p>${renderRichTextHtml(paragraph)}</p>`)
  .join('');

export const stripRichText = (value: string) => value.replace(tokenPattern, '').trim();
