import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const baseUrl = String(process.argv[2] ?? '').replace(/\/$/, '');
const email = process.argv[3];
const password = process.argv[4];
if (!baseUrl || !email || !password) {
  throw new Error('Usage: node scripts/pages-http-smoke.mjs <base-url> <admin-email> <admin-password>');
}

const cookiesFrom = (response) => response.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
let pageId;
let adminHeaders;
try {
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf-token`);
  assert.equal(csrfResponse.status, 200);
  const csrf = await csrfResponse.json();
  const csrfCookies = cookiesFrom(csrfResponse);
  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: csrfCookies, 'x-csrf-token': csrf.csrfToken },
    body: JSON.stringify({ email, password })
  });
  assert.equal(loginResponse.status, 200);
  const cookies = `${csrfCookies}; ${cookiesFrom(loginResponse)}`;
  adminHeaders = { 'content-type': 'application/json', cookie: cookies, 'x-csrf-token': csrf.csrfToken };
  const slug = `docker-page-${Date.now()}`;
  const createResponse = await fetch(`${baseUrl}/api/pages`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({
      title: 'Docker Pages smoke', slug, description: 'Ephemeral container verification', emoji: '🐳',
      theme: 'ocean_blue', layout: 'soft', status: 'published',
      blocks: [{ type: 'link', visible: true, config: { title: 'Example', url: 'https://example.com', openInNewTab: true } }]
    })
  });
  assert.equal(createResponse.status, 200);
  const page = await createResponse.json();
  pageId = page.id;
  const htmlResponse = await fetch(`${baseUrl}/${slug}`, { headers: { 'accept-encoding': 'br' } });
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.headers.get('cache-control'), 'no-cache');
  assert.match(await htmlResponse.text(), /shortswitch-resource-type" content="page"/);
  const apiResponse = await fetch(`${baseUrl}/api/pages/public/${slug}`);
  assert.equal(apiResponse.status, 200);
  assert.equal(apiResponse.headers.get('cache-control'), 'no-store');
  const publicPage = await apiResponse.json();
  assert.equal(publicPage.blocks.length, 1);
  const clickResponse = await fetch(`${baseUrl}/api/pages/public/${slug}/clicks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blockId: publicPage.blocks[0].id, eventId: randomUUID().replaceAll('-', '') })
  });
  assert.equal(clickResponse.status, 202);
  console.log(JSON.stringify({ status: 'passed', slug, html: 'no-cache', publicApi: 'no-store' }));
} finally {
  if (pageId && adminHeaders) {
    await fetch(`${baseUrl}/api/pages/${pageId}`, { method: 'DELETE', headers: adminHeaders, body: '{}' }).catch(() => undefined);
  }
}
