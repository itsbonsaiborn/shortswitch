import { config } from '../config.js';
import { boardPublicText, externalLinkText, publicText } from '../public-i18n.js';
import type { Locale } from '../../shared/types.js';
import type { AbuseReason, ServiceContactBlock, ServiceContactConfig, ServiceFooterLink } from '../../shared/types.js';
import { renderRichTextHtml, renderRichTextParagraphs } from '../../shared/rich-text.js';

export const SERVICE_FOOTER_MARKER = '<!--SHORTSWITCH_SERVICE_FOOTER-->';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const appMetaDescription = config.appDescription;
const appOgImage = '/og/app-og.png';

const renderBrandLink = () => `<a href="/" aria-label="${escapeHtml(config.appName)}" style="display:inline-flex;align-items:center;gap:8px;color:var(--text);font-weight:750;letter-spacing:-.01em;text-decoration:none"><img src="/icons/favicon-32.png" alt="" width="22" height="22" style="width:22px;height:22px" /><strong>${escapeHtml(config.appName)}</strong></a>`;
const renderFooterBrand = () => `<span style="display:inline-flex;align-items:center;gap:8px;color:var(--muted)"><img src="/icons/favicon-32.png" alt="" width="22" height="22" style="width:22px;height:22px" />${escapeHtml(config.appName)}</span>`;

export const renderServiceFooterHtml = (links: ServiceFooterLink[]) => `
  <footer data-service-page-footer style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 16px;margin-top:auto;padding-top:24px;border-top:1px solid var(--border);font-size:.86rem;line-height:1.4">
    ${renderFooterBrand()}
    ${links.map((link) => `<a href="${escapeHtml(link.href)}" style="color:var(--accent);text-decoration:none;font-weight:400">${escapeHtml(link.label)}</a>`).join('')}
  </footer>`;

const renderTextContent = (body: string) => renderRichTextParagraphs(body);

const getExternalFaviconUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? `${parsed.origin}/favicon.ico` : null;
  } catch {
    return null;
  }
};

export interface PublicServiceFormState {
  success?: boolean;
  error?: string;
  values?: Record<string, string>;
}

const publicFormText = {
  en: {
    contactEmail: 'Email address', subject: 'Subject', message: 'Message', send: 'Send message',
    contactSuccess: 'Thank you. Your message was received.',
    reportTitle: 'Report abuse',
    reportDescription: 'Report a ShortSwitch link that may be unsafe or violate acceptable use. Reports are reviewed before any action is taken.',
    link: 'ShortSwitch link or identifier', reason: 'Reason', description: 'Description',
    reporterEmail: 'Reporter email (optional)', report: 'Submit report',
    reportSuccess: 'Thank you. Your report was received for review.',
    selectReason: 'Select a reason',
    reasons: { phishing: 'Phishing', malware: 'Malware', spam: 'Spam', harassment: 'Harassment', copyright: 'Copyright', privacy: 'Privacy', other: 'Other' }
  },
  lv: {
    contactEmail: 'E-pasta adrese', subject: 'Temats', message: 'Ziņojums', send: 'Nosūtīt ziņojumu',
    contactSuccess: 'Paldies. Jūsu ziņojums ir saņemts.',
    reportTitle: 'Ziņot par ļaunprātīgu izmantošanu',
    reportDescription: 'Ziņojiet par ShortSwitch saiti, kas var būt nedroša vai pārkāpt pieņemamas lietošanas noteikumus. Pirms jebkādas rīcības ziņojumi tiek pārbaudīti.',
    link: 'ShortSwitch saite vai identifikators', reason: 'Iemesls', description: 'Apraksts',
    reporterEmail: 'Ziņotāja e-pasts (nav obligāts)', report: 'Nosūtīt ziņojumu',
    reportSuccess: 'Paldies. Jūsu ziņojums ir saņemts izskatīšanai.',
    selectReason: 'Izvēlieties iemeslu',
    reasons: { phishing: 'Pikšķerēšana', malware: 'Ļaunprogrammatūra', spam: 'Mēstules', harassment: 'Uzmākšanās', copyright: 'Autortiesības', privacy: 'Privātums', other: 'Cits' }
  }
} as const;

const honeypotField = `
  <div class="form-honeypot" aria-hidden="true">
    <label>Website<input name="website" type="text" tabindex="-1" autocomplete="off" /></label>
  </div>`;

const renderFormStatus = (state?: PublicServiceFormState) => state?.error
  ? `<div class="form-status form-error" role="alert">${escapeHtml(state.error)}</div>`
  : '';

const renderContactForm = (locale: Locale, state?: PublicServiceFormState) => {
  const text = publicFormText[locale];
  if (state?.success) return `<div class="form-status form-success" role="status">${escapeHtml(text.contactSuccess)}</div>`;
  const values = state?.values ?? {};
  return `<form class="service-form" method="post" action="/service/contacts/submit" novalidate>
    ${renderFormStatus(state)}
    <label><span>${escapeHtml(text.contactEmail)}</span><input name="email" type="email" autocomplete="email" maxlength="254" required value="${escapeHtml(values.email ?? '')}" /></label>
    <label><span>${escapeHtml(text.subject)}</span><input name="subject" type="text" maxlength="160" required value="${escapeHtml(values.subject ?? '')}" /></label>
    <label><span>${escapeHtml(text.message)}</span><textarea name="message" maxlength="5000" rows="7" required>${escapeHtml(values.message ?? '')}</textarea></label>
    ${honeypotField}
    <button type="submit">${escapeHtml(text.send)}</button>
  </form>`;
};

const abuseReasonValues: AbuseReason[] = ['phishing', 'malware', 'spam', 'harassment', 'copyright', 'privacy', 'other'];

const renderReportAbuseForm = (locale: Locale, state?: PublicServiceFormState) => {
  const text = publicFormText[locale];
  if (state?.success) return `<div class="form-status form-success" role="status">${escapeHtml(text.reportSuccess)}</div>`;
  const values = state?.values ?? {};
  return `<form class="service-form" method="post" action="/service/report-abuse/submit" novalidate>
    ${renderFormStatus(state)}
    <label><span>${escapeHtml(text.link)}</span><input name="link" type="text" inputmode="url" maxlength="2048" required value="${escapeHtml(values.link ?? '')}" /></label>
    <label><span>${escapeHtml(text.reason)}</span><select name="reason" required>
      <option value="">${escapeHtml(text.selectReason)}</option>
      ${abuseReasonValues.map((reason) => `<option value="${reason}"${values.reason === reason ? ' selected' : ''}>${escapeHtml(text.reasons[reason])}</option>`).join('')}
    </select></label>
    <label><span>${escapeHtml(text.description)}</span><textarea name="description" maxlength="5000" rows="7" required>${escapeHtml(values.description ?? '')}</textarea></label>
    <label><span>${escapeHtml(text.reporterEmail)}</span><input name="reporterEmail" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(values.reporterEmail ?? '')}" /></label>
    ${honeypotField}
    <button type="submit">${escapeHtml(text.report)}</button>
  </form>`;
};

const renderServiceContactBlocks = (config: ServiceContactConfig, locale: Locale, formState?: PublicServiceFormState, publicContactEmail?: string | null) => config.blocks.map((block: ServiceContactBlock) => {
  if (block.type === 'heading') return `<h2 class="page-heading-block">${renderRichTextHtml(locale === 'lv' ? block.titleLv : block.titleEn)}</h2>`;
  if (block.type === 'text') return `<div class="page-text-block">${renderRichTextHtml(locale === 'lv' ? block.bodyLv : block.bodyEn)}</div>`;
  if (block.type === 'divider') return '<div class="page-divider-block" aria-hidden="true"><span></span></div>';
  if (block.type === 'contact_email') {
    const title = locale === 'lv' ? block.titleLv : block.titleEn;
    return `<a class="page-action page-link-action page-email-action" href="mailto:${escapeHtml(block.email)}"><span class="page-link-icon page-email-icon" aria-hidden="true"><svg viewBox="0 0 32 32" width="20" height="20"><path d="M0 0h32v32H0z" fill="none"/><path fill="currentColor" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-2.2 2L16 14.78L6.2 8ZM4 24V8.91l11.43 7.91a1 1 0 0 0 1.14 0L28 8.91V24Z"/></svg></span><span class="page-link-copy"><span class="page-link-title">${renderRichTextHtml(title || block.email)}</span><span class="page-link-subtitle">${escapeHtml(block.email)}</span></span><svg class="page-action-arrow" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M8 6h10v10"/></svg></a>`;
  }
  if (block.type === 'social_card') {
    const title = locale === 'lv' ? block.titleLv : block.titleEn;
    const description = locale === 'lv' ? block.descriptionLv : block.descriptionEn;
    const faviconUrl = getExternalFaviconUrl(block.url);
    const icon = faviconUrl
      ? `<img class="page-link-favicon" src="${escapeHtml(faviconUrl)}" alt="" referrerpolicy="no-referrer" />`
      : '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M0 0h24v24H0z" fill="none"/><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13.544 10.456a4.37 4.37 0 0 0-6.176 0l-3.089 3.088a4.367 4.367 0 1 0 6.177 6.177L12 18.177"/><path d="M10.456 13.544a4.37 4.37 0 0 0 6.176 0l3.089-3.088a4.367 4.367 0 1 0-6.177-6.177L12 5.823"/></g></svg>';
    return `<a class="page-action page-link-action" href="${escapeHtml(block.url)}" target="_blank" rel="noopener noreferrer external" referrerpolicy="no-referrer"><span class="page-link-icon" aria-hidden="true">${icon}</span><span class="page-link-copy"><span class="page-link-title">${renderRichTextHtml(title)}</span>${description ? `<span class="page-link-subtitle">${renderRichTextHtml(description)}</span>` : ''}</span><svg class="page-action-arrow" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M0 0h24v24H0z" fill="none"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 6L6 18M8 6h10v10"/></svg></a>`;
  }
  const title = locale === 'lv' ? block.titleLv : block.titleEn;
  const description = locale === 'lv' ? block.descriptionLv : block.descriptionEn;
  const publicEmail = publicContactEmail
    ? `<p class="contact-public-email">${locale === 'lv' ? 'Publiskais kontakta e-pasts' : 'Public contact email'}: <a href="mailto:${escapeHtml(publicContactEmail)}">${escapeHtml(publicContactEmail)}</a></p>`
    : '';
  return `<section class="contact-form-component" data-contact-form-component><div class="contact-form-heading"><span class="page-link-icon page-email-icon" aria-hidden="true"><svg viewBox="0 0 32 32" width="20" height="20"><path d="M0 0h32v32H0z" fill="none"/><path fill="currentColor" d="M28 6H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2m-2.2 2L16 14.78L6.2 8ZM4 24V8.91l11.43 7.91a1 1 0 0 0 1.14 0L28 8.91V24Z"/></svg></span><div><strong>${renderRichTextHtml(title)}</strong>${description ? `<p>${renderRichTextHtml(description)}</p>` : ''}${publicEmail}</div></div>${renderContactForm(locale, formState)}</section>`;
}).join('');

const renderCommonHead = (title: string, description: string, image = appOgImage, siteName = config.appName, locale: Locale = 'en') => `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="theme-color" content="#100F0F" />
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate" />
    <meta name="googlebot" content="noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(siteName)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1280" />
    <meta property="og:image:height" content="640" />
    <meta property="og:locale" content="${locale === 'lv' ? 'lv_LV' : 'en_US'}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${image}" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
`;

const pageShell = (locale: Locale, title: string, heading: string, body: string) => `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(`${config.appName} - ${title}`, body, appOgImage, config.appName, locale)}
    <style>
      :root {
        color-scheme: light dark;
        --bg: #fffcf0;
        --bg-alt: #f2f0e5;
        --panel: rgba(255, 252, 240, 0.94);
        --border: #dad8ce;
        --text: #100f0f;
        --muted: #6f6e69;
        --accent: #24837b;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #100f0f;
          --bg-alt: #1c1b1a;
          --panel: rgba(28, 27, 26, 0.94);
          --border: #343331;
          --text: #cecdc3;
          --muted: #878580;
          --accent: #87d3c3;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(90, 189, 172, 0.18), transparent 28%),
          linear-gradient(180deg, var(--bg), var(--bg-alt));
        color: var(--text);
        font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      }
      article {
        display: flex;
        flex-direction: column;
        width: min(100%, 620px);
        border: 1px solid var(--border);
        border-radius: 28px;
        background: var(--panel);
        padding: 32px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
        border-radius: 999px;
        padding: 8px 12px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 12px;
        font-size: clamp(2rem, 4vw, 2.8rem);
        line-height: 1.04;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      a {
        color: var(--accent);
        text-decoration: none;
      }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <article>
      ${renderBrandLink()}
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(body)}</p>
      ${SERVICE_FOOTER_MARKER}
    </article>
  </body>
</html>`;

export const renderProtectedLinkPage = (options?: {
  error?: string;
  title?: string;
  description?: string;
  locale?: Locale;
}) => `<!doctype html>
<html lang="${options?.locale ?? 'en'}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(
  options?.title ?? `${config.appName} - ${publicText(options?.locale ?? 'en', 'protectedLinkTitle')}`,
  options?.description ?? appMetaDescription,
  appOgImage,
  config.appName,
  options?.locale ?? 'en'
)}
    <style>
      :root {
        color-scheme: light dark;
        --bg: #fffcf0;
        --bg-alt: #f2f0e5;
        --panel: rgba(255, 252, 240, 0.94);
        --panel-soft: rgba(242, 240, 229, 0.9);
        --border: #dad8ce;
        --text: #100f0f;
        --muted: #6f6e69;
        --accent: #24837b;
        --accent-hover: #2f968d;
        --danger-bg: #fce8db;
        --danger-text: #af3029;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #100f0f;
          --bg-alt: #1c1b1a;
          --panel: rgba(28, 27, 26, 0.94);
          --panel-soft: rgba(40, 39, 38, 0.92);
          --border: #343331;
          --text: #cecdc3;
          --muted: #878580;
          --accent: #87d3c3;
          --accent-hover: #5abdac;
          --danger-bg: #321f1c;
          --danger-text: #f89a8a;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(90, 189, 172, 0.18), transparent 28%),
          linear-gradient(180deg, var(--bg), var(--bg-alt));
        color: var(--text);
        font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      }
      article {
        display: flex;
        flex-direction: column;
        width: min(100%, 520px);
        border: 1px solid var(--border);
        border-radius: 28px;
        background: var(--panel);
        padding: 32px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
        border-radius: 999px;
        padding: 8px 12px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 10px;
        font-size: clamp(2rem, 4vw, 2.6rem);
        line-height: 1.04;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      form { margin-top: 22px; }
      label { display: block; }
      .label {
        display: block;
        margin-bottom: 8px;
        font-size: 0.95rem;
        font-weight: 600;
      }
      input, button {
        width: 100%;
        border-radius: 18px;
        font: inherit;
      }
      input {
        border: 1px solid var(--border);
        background: var(--panel-soft);
        color: var(--text);
        padding: 14px 16px;
        outline: none;
      }
      input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
      }
      button {
        margin-top: 14px;
        border: 1px solid var(--accent);
        background: var(--accent);
        color: ${'var(--bg)'};
        padding: 14px 16px;
        font-weight: 700;
        cursor: pointer;
      }
      button:hover { background: var(--accent-hover); }
      .error {
        margin-top: 14px;
        border: 1px solid color-mix(in srgb, var(--danger-text) 16%, transparent);
        border-radius: 18px;
        background: var(--danger-bg);
        color: var(--danger-text);
        padding: 12px 14px;
        font-size: 0.92rem;
      }
    </style>
  </head>
  <body>
    <article>
      ${renderBrandLink()}
      <h1>${escapeHtml(publicText(options?.locale ?? 'en', 'enterPassword'))}</h1>
      <p>${escapeHtml(publicText(options?.locale ?? 'en', 'protectedLinkDescription'))}</p>
      <form method="post">
        <label>
          <span class="label">${escapeHtml(publicText(options?.locale ?? 'en', 'password'))}</span>
          <input type="password" name="password" placeholder="${escapeHtml(publicText(options?.locale ?? 'en', 'passwordPlaceholder'))}" required />
        </label>
        <button type="submit">${escapeHtml(publicText(options?.locale ?? 'en', 'continue'))}</button>
        ${options?.error ? `<div class="error">${escapeHtml(options.error)}</div>` : ''}
      </form>
      ${SERVICE_FOOTER_MARKER}
    </article>
  </body>
</html>`;

export const renderExternalLinkConfirmationPage = (options: {
  targetUrl: string;
  targetHostname: string;
  locale?: Locale;
}) => `<!doctype html>
<html lang="${options.locale ?? 'en'}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(
  `${config.appName} - ${externalLinkText(options.locale ?? 'en', 'title')}`,
  externalLinkText(options.locale ?? 'en', 'metadataDescription'),
  appOgImage,
  config.appName,
  options.locale ?? 'en'
)}
    <style>
      :root {
        color-scheme: light dark;
        --bg: #fffcf0;
        --bg-alt: #f2f0e5;
        --panel: rgba(255, 252, 240, 0.94);
        --border: #dad8ce;
        --text: #100f0f;
        --muted: #6f6e69;
        --accent: #24837b;
        --accent-hover: #2f968d;
        --panel-soft: rgba(242, 240, 229, 0.9);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #100f0f;
          --bg-alt: #1c1b1a;
          --panel: rgba(28, 27, 26, 0.94);
          --border: #343331;
          --text: #cecdc3;
          --muted: #878580;
          --accent: #87d3c3;
          --accent-hover: #5abdac;
          --panel-soft: rgba(40, 39, 38, 0.92);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top left, rgba(90, 189, 172, 0.18), transparent 28%),
          linear-gradient(180deg, var(--bg), var(--bg-alt));
        color: var(--text);
        font-family: "Segoe UI", ui-sans-serif, system-ui, sans-serif;
      }
      article {
        display: flex;
        flex-direction: column;
        width: min(100%, 620px);
        border: 1px solid var(--border);
        border-radius: 28px;
        background: var(--panel);
        padding: 32px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
        border-radius: 999px;
        padding: 8px 12px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 18px 0 10px;
        font-size: clamp(1.8rem, 5vw, 2.5rem);
        line-height: 1.08;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      .destination {
        margin-top: 22px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--panel-soft);
        padding: 16px;
      }
      .destination-label {
        color: var(--muted);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .hostname {
        margin-top: 6px;
        color: var(--text);
        font-size: 1.1rem;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .url {
        display: block;
        margin-top: 10px;
        color: var(--muted);
        font-family: ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace;
        font-size: 0.82rem;
        line-height: 1.5;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      .open-link {
        display: flex;
        width: 100%;
        min-height: 50px;
        align-items: center;
        justify-content: center;
        margin-top: 18px;
        border: 1px solid var(--accent);
        border-radius: 18px;
        background: var(--accent);
        color: var(--bg);
        font-weight: 700;
        text-align: center;
        text-decoration: none;
        transition: background-color 160ms ease, transform 160ms ease;
      }
      .open-link:hover {
        background: var(--accent-hover);
        text-decoration: none;
        transform: translateY(-1px);
      }
      .open-link:focus-visible {
        outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent);
        outline-offset: 3px;
      }
      @media (max-width: 520px) {
        body { padding: 14px; }
        article { border-radius: 22px; padding: 24px 20px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .open-link { transition: none; }
        .open-link:hover { transform: none; }
      }
    </style>
  </head>
  <body>
    <article>
      ${renderBrandLink()}
      <h1>${escapeHtml(externalLinkText(options.locale ?? 'en', 'title'))}</h1>
      <p>${escapeHtml(externalLinkText(options.locale ?? 'en', 'description'))}</p>
      <div class="destination">
        <div class="destination-label">${escapeHtml(externalLinkText(options.locale ?? 'en', 'destination'))}</div>
        <div class="hostname">${escapeHtml(options.targetHostname)}</div>
        <span class="url">${escapeHtml(options.targetUrl)}</span>
      </div>
      <a
        class="open-link"
        href="${escapeHtml(options.targetUrl)}"
        target="_blank"
        rel="noopener noreferrer external"
        referrerpolicy="no-referrer"
      >${escapeHtml(externalLinkText(options.locale ?? 'en', 'openDestination'))}</a>
      ${SERVICE_FOOTER_MARKER}
    </article>
  </body>
</html>`;

export const renderServiceSectionPage = (options: {
  locale: Locale;
  title: string;
  body: string;
  footerLinks: ServiceFooterLink[];
  contactConfig?: ServiceContactConfig;
  publicContactEmail?: string | null;
  contactFormState?: PublicServiceFormState;
  systemContentHtml?: string;
}) => `<!doctype html>
<html lang="${options.locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(`${config.appName} - ${options.title}`, options.body.slice(0, 180), appOgImage, config.appName, options.locale)}
    <style>
      :root { color-scheme: light dark; --bg:#fffcf0; --bg-alt:#f2f0e5; --panel:rgba(255,252,240,.95); --card:#fffaf0; --border:#dad8ce; --text:#100f0f; --muted:#6f6e69; --accent:#24837b; }
      @media (prefers-color-scheme:dark) { :root { --bg:#100f0f; --bg-alt:#1c1b1a; --panel:rgba(28,27,26,.95); --card:#242321; --border:#343331; --text:#cecdc3; --muted:#878580; --accent:#87d3c3; } }
      * { box-sizing:border-box; }
      body { margin:0; min-height:100vh; padding:24px; background:radial-gradient(circle at top left,rgba(90,189,172,.18),transparent 28%),linear-gradient(180deg,var(--bg),var(--bg-alt)); color:var(--text); font-family:"Segoe UI",ui-sans-serif,system-ui,sans-serif; }
      main { display:flex; flex-direction:column; width:min(100%,820px); min-height:min(680px,calc(100dvh - 80px)); margin:40px auto; border:1px solid var(--border); border-radius:28px; background:var(--panel); padding:clamp(24px,5vw,48px); }
      .badge { display:inline-flex; border:1px solid color-mix(in srgb,var(--accent) 28%,transparent); border-radius:999px; padding:8px 12px; color:var(--accent); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
      h1 { margin:20px 0 24px; font-size:clamp(2rem,5vw,3.2rem); line-height:1.05; }
      .content { flex:1; color:var(--muted); }
      .content p { margin:0 0 1.15em; font-size:1rem; line-height:1.75; white-space:normal; overflow-wrap:anywhere; }
      .contact-blocks { display:grid; gap:12px; --page-text:var(--text); --page-muted:var(--muted); --page-accent:var(--accent); --page-border:var(--border); --page-card:var(--card); --page-radius:1rem; --page-shadow:0 5px 16px rgba(0,0,0,.045); color:var(--page-text); font-family:Inter,"Segoe UI",ui-sans-serif,system-ui,sans-serif; }
      .page-heading-block { margin:0; padding-top:16px; color:var(--page-text); font-size:1.5rem; font-weight:600; line-height:1.25; overflow-wrap:anywhere; }
      .page-text-block { color:var(--page-text); font-size:.875rem; line-height:1.5rem; white-space:pre-line; overflow-wrap:anywhere; word-break:break-word; }
      .page-divider-block { display:flex; height:28px; align-items:center; }
      .page-divider-block span { width:100%; border-top:1px solid var(--page-border); }
      .page-action { border:1px solid var(--page-border); border-radius:var(--page-radius); background:var(--page-card); color:var(--page-text); box-shadow:var(--page-shadow); transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease; }
      .page-action:hover { transform:translateY(-1px); border-color:var(--page-accent); text-decoration:none; }
      .page-action:focus-visible { outline:3px solid color-mix(in srgb,var(--page-accent) 42%,transparent); outline-offset:2px; }
      .page-link-action { display:flex; width:100%; min-height:56px; align-items:center; gap:12px; padding:12px 16px; text-align:left; }
      .page-link-icon { display:flex; width:32px; height:32px; flex:0 0 32px; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--page-border); border-radius:8px; background:rgba(255,255,255,.85); color:#28211b; }
      .page-link-favicon { display:block; width:20px; height:20px; object-fit:contain; }
      .page-link-copy { min-width:0; flex:1; }
      .page-link-title,.page-link-subtitle { display:block; overflow-wrap:anywhere; }
      .page-link-title { font-weight:600; }
      .page-link-subtitle { margin-top:2px; color:var(--page-muted); font-size:.75rem; }
      .page-email-icon { color:#28211b; }
      .page-action-arrow { display:block; width:20px; height:20px; flex:none; opacity:.55; transition:transform 150ms cubic-bezier(.4,0,.2,1); }
      .page-action:hover .page-action-arrow { transform:translate(.125rem,-.125rem); }
      .contact-form-component { padding:18px; border:0; border-radius:var(--page-radius); background:var(--page-card); box-shadow:var(--page-shadow); }
      .contact-form-heading { display:flex; gap:12px; align-items:flex-start; }
      .contact-form-heading strong { display:block; color:var(--text); }
      .contact-form-heading p { margin:2px 0 0; color:var(--page-muted); font-size:.75rem; line-height:1.4; }
      .service-form { position:relative; display:grid; gap:14px; margin-top:18px; }
      .service-form label { display:grid; gap:7px; color:var(--text); font-size:.88rem; font-weight:650; }
      .service-form input,.service-form textarea,.service-form select { width:100%; border:1px solid var(--border); border-radius:13px; background:var(--panel); color:var(--text); padding:11px 13px; font:inherit; font-weight:400; line-height:1.4; }
      .service-form textarea { min-height:130px; resize:vertical; }
      .service-form input:focus-visible,.service-form textarea:focus-visible,.service-form select:focus-visible { outline:3px solid color-mix(in srgb,var(--accent) 32%,transparent); outline-offset:2px; border-color:var(--accent); }
      .service-form button { justify-self:start; min-height:44px; border:0; border-radius:13px; background:var(--accent); color:var(--bg); padding:11px 18px; font:inherit; font-weight:750; cursor:pointer; }
      .service-form button:hover { filter:brightness(1.06); }
      .service-form button:focus-visible { outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent); outline-offset:3px; }
      .form-status { border:1px solid var(--border); border-radius:14px; padding:13px 14px; color:var(--text); font-size:.92rem; line-height:1.5; }
      .form-success { border-color:color-mix(in srgb,var(--accent) 45%,var(--border)); background:color-mix(in srgb,var(--accent) 12%,transparent); }
      .form-error { border-color:#c45b4d; background:color-mix(in srgb,#c45b4d 12%,transparent); }
      .form-honeypot { position:absolute!important; left:-10000px!important; width:1px!important; height:1px!important; overflow:hidden!important; }
      a { color:var(--accent); text-decoration:none; }
      a:hover { text-decoration:underline; }
      a:focus-visible { outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent); outline-offset:3px; border-radius:4px; }
      @media (max-width:520px) { body{padding:14px} main{margin:14px auto;border-radius:22px;padding:24px 20px} }
    </style>
  </head>
  <body>
    <main>
      ${renderBrandLink()}
      <h1>${escapeHtml(options.title)}</h1>
      <div class="content">${options.systemContentHtml ?? (options.contactConfig ? `<div class="contact-blocks">${renderServiceContactBlocks(options.contactConfig, options.locale, options.contactFormState, options.publicContactEmail)}</div>` : renderTextContent(options.body))}</div>
      ${renderServiceFooterHtml(options.footerLinks)}
    </main>
  </body>
</html>`;

export const renderReportAbusePage = (options: {
  locale: Locale;
  footerLinks: ServiceFooterLink[];
  state?: PublicServiceFormState;
}) => {
  const text = publicFormText[options.locale];
  return renderServiceSectionPage({
    locale: options.locale,
    title: text.reportTitle,
    body: text.reportDescription,
    footerLinks: options.footerLinks,
    systemContentHtml: `${renderTextContent(text.reportDescription)}${renderReportAbuseForm(options.locale, options.state)}`
  });
};

export const renderLinkExpiredPage = (locale: Locale = 'en', resource: 'link' | 'live' | 'board' = 'link') => {
  if (resource === 'board') return pageShell(locale, boardPublicText(locale, 'expiredTitle'), boardPublicText(locale, 'expiredTitle'), boardPublicText(locale, 'expiredDescription'));
  const titleKey = resource === 'link' ? 'linkExpiredTitle' : 'activityExpiredTitle';
  const descriptionKey = resource === 'link' ? 'linkExpiredDescription' : 'activityExpiredDescription';
  return pageShell(locale, publicText(locale, titleKey), publicText(locale, titleKey), publicText(locale, descriptionKey));
};

export const renderLinkDisabledPage = (locale: Locale = 'en', resource: 'link' | 'page' | 'board' = 'link') => {
  if (resource === 'board') return pageShell(locale, boardPublicText(locale, 'disabledTitle'), boardPublicText(locale, 'disabledTitle'), boardPublicText(locale, 'disabledDescription'));
  const titleKey = resource === 'link' ? 'linkDisabledTitle' : 'pageDisabledTitle';
  const descriptionKey = resource === 'link' ? 'linkDisabledDescription' : 'pageDisabledDescription';
  return pageShell(locale, publicText(locale, titleKey), publicText(locale, titleKey), publicText(locale, descriptionKey));
};

export const renderLinkNotFoundPage = (locale: Locale = 'en') =>
  pageShell(
    locale,
    publicText(locale, 'addressNotFoundTitle'),
    publicText(locale, 'addressNotFoundTitle'),
    publicText(locale, 'addressNotFoundDescription')
  );

export const renderInvalidLinkDestinationPage = (locale: Locale = 'en') =>
  pageShell(
    locale,
    externalLinkText(locale, 'invalidTitle'),
    externalLinkText(locale, 'invalidTitle'),
    externalLinkText(locale, 'invalidDescription')
  );

export const renderPublicServiceUnavailablePage = (locale: Locale = 'en') =>
  pageShell(
    locale,
    publicText(locale, 'serviceUnavailableTitle'),
    publicText(locale, 'serviceUnavailableTitle'),
    publicText(locale, 'serviceUnavailableDescription')
  );
