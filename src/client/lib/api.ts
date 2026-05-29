export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let csrfTokenPromise: Promise<string> | null = null;

const getCsrfToken = async () => {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch('/api/auth/csrf-token', { credentials: 'include' })
      .then(async (response) => {
        const data = await response.json();
        return data.csrfToken as string;
      })
      .catch((error) => {
        csrfTokenPromise = null;
        throw error;
      });
  }
  return csrfTokenPromise;
};

export const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers ?? {});
  if (init?.method && init.method !== 'GET') {
    headers.set('content-type', 'application/json');
    headers.set('x-csrf-token', await getCsrfToken());
  }

  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers
  });

  if (!response.ok) {
    let message = 'Request failed.';
    try {
      const data = await response.json();
      message = data.message ?? message;
    } catch {
      message = await response.text();
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};
