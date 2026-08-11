import { getToken, clearToken } from './token';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let data: { error?: string; message?: string } = {};
    try {
      data = (await res.json()) as { error?: string; message?: string };
    } catch {
      // ignore parse errors
    }
    if (res.status === 401 && auth) {
      clearToken();
    }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  return (await res.json()) as T;
}
