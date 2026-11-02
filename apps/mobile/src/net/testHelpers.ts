/** Utilitários só de teste (sem rede): fetch roteirizado. */
import type { FetchLike } from './api';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeReply {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export type Handler = (req: RecordedRequest) => FakeReply | Promise<FakeReply> | 'throw' | 'hang';

export function fakeFetch(handler: Handler): { fetch: FetchLike; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const req: RecordedRequest = {
      method: init.method,
      path: u.pathname,
      headers: init.headers,
      body: init.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
    };
    calls.push(req);
    const out = await handler(req);
    if (out === 'throw') throw new TypeError('fetch failed');
    if (out === 'hang') {
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
      });
    }
    const headers = out.headers ?? {};
    return {
      status: out.status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      text: () =>
        Promise.resolve(out.text ?? (out.json === undefined ? '' : JSON.stringify(out.json))),
    };
  };
  return { fetch, calls };
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
