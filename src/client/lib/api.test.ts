// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api request headers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not advertise JSON for an empty DELETE request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');

    await api('/api/example', { method: 'DELETE' });

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = request.headers as Headers;
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('x-csrf-token')).toBe('csrf-token');
  });

  it('keeps JSON content type when a request body is present', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');

    await api('/api/example', { method: 'POST', body: '{}' });

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = request.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
  });
});
