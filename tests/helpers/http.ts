import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export const TEST_ORIGIN = 'http://localhost';

export interface HttpResult<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
}

/**
 * Klien uji per "browser": menyimpan cookie sesi sendiri dan mengirim Origin
 * yang sama dengan host, seperti browser pada halaman aplikasi.
 */
export class TestClient {
  cookie: string | undefined;

  constructor(
    private readonly app: NestFastifyApplication,
    private readonly origin: string | null = TEST_ORIGIN,
  ) {}

  async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { host: 'localhost', ...extraHeaders };
    if (this.origin) headers.origin = this.origin;
    if (this.cookie) headers.cookie = this.cookie;
    const res = await this.app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
    const setCookie = res.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (typeof first === 'string') {
      const pair = first.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? undefined : pair;
    }
    const text = res.body;
    return { status: res.statusCode, headers: res.headers, body: (text ? JSON.parse(text) : undefined) as T };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, payload?: unknown) {
    return this.request<T>('POST', url, payload ?? {});
  }
  put<T = any>(url: string, payload?: unknown) {
    return this.request<T>('PUT', url, payload ?? {});
  }
  delete<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }
}
