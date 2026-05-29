import { config } from '../config.js';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const appMetaDescription = config.appDescription;
const appOgImage = '/og/app-og.png';

const renderCommonHead = (title: string, description: string, image = appOgImage, siteName = config.appName) => `
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
    <meta property="og:locale" content="en_US" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${image}" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
`;

const pageShell = (title: string, heading: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(`${config.appName} - ${title}`, body)}
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
        width: min(100%, 540px);
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
      <div class="badge">${escapeHtml(config.appName)}</div>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(body)}</p>
    </article>
  </body>
</html>`;

export const renderProtectedLinkPage = (options?: {
  error?: string;
  title?: string;
  description?: string;
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(
  options?.title ?? `${config.appName} - Protected link`,
  options?.description ?? appMetaDescription
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
        width: min(100%, 460px);
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
      <div class="badge">${escapeHtml(config.appName)}</div>
      <h1>Enter password</h1>
      <p>This short link is protected. Enter the password to continue to the destination.</p>
      <form method="post">
        <label>
          <span class="label">Password</span>
          <input type="password" name="password" placeholder="Enter link password" required />
        </label>
        <button type="submit">Continue</button>
        ${options?.error ? `<div class="error">${escapeHtml(options.error)}</div>` : ''}
      </form>
    </article>
  </body>
</html>`;

export const renderShortLinkPreviewPage = (options: {
  title: string;
  description: string;
  shortUrl: string;
  targetUrl?: string;
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${renderCommonHead(options.title, options.description)}
    <meta property="og:url" content="${escapeHtml(options.shortUrl)}" />
    ${options.targetUrl ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(options.targetUrl)}" />` : ''}
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
        width: min(100%, 540px);
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
        font-size: clamp(1.7rem, 4vw, 2.4rem);
        line-height: 1.08;
      }
      p {
        margin: 0;
        color: var(--muted);
        font-size: 1rem;
        line-height: 1.65;
      }
      .url {
        margin-top: 18px;
        font-size: 0.96rem;
        color: var(--accent);
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <article>
      <div class="badge">${escapeHtml(config.appName)}</div>
      <h1>${escapeHtml(options.title)}</h1>
      <p>${escapeHtml(options.description)}</p>
      <div class="url">${escapeHtml(options.shortUrl)}</div>
    </article>
  </body>
</html>`;

export const renderLinkExpiredPage = () =>
  pageShell('Link expired', 'Link expired', 'This short link is no longer active because its expiration time has passed.');

export const renderLinkDisabledPage = () =>
  pageShell('Link disabled', 'Link disabled', 'This short link has been disabled by its owner and is currently unavailable.');

export const renderLinkNotFoundPage = () =>
  pageShell('Link not found', 'Link not found', 'This short link does not exist, or the address was entered incorrectly.');
