import type { IncomingMessage } from 'node:http';

/** Janela deslizante em memória: IP -> instantes das requisições recentes. */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Registra uma requisição; `false` se estourou o limite (a requisição NÃO é contada). */
  allow(key: string, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(now);
    return true;
  }

  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

/**
 * Chave de rate limit do cliente. Atrás de proxy reverso o IP do socket é o do proxy. Com
 * `trustProxy`, usa o ÚLTIMO item de `X-Forwarded-For` (o que o proxy confiável acrescentou; os
 * anteriores o cliente forja). Só ligue se TODO tráfego passa por um proxy que define o cabeçalho.
 */
export function clientKey(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : xff;
    const last = raw?.split(',').at(-1)?.trim();
    if (last !== undefined && last !== '') return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
