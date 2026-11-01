import type { IncomingMessage } from 'node:http';
import { isIPv4, isIPv6 } from 'node:net';

/** Teto rígido de chaves por limitador (memória limitada mesmo sob ataque com muitos IPs). */
export const DEFAULT_MAX_KEYS = 50_000;

/**
 * Janela deslizante em memória: chave -> instantes das requisições recentes. O `Map` mantém a ordem de
 * inserção e cada acesso reinsere a chave no fim, então a primeira chave é sempre a menos recente: ao
 * passar do teto, descarta-se a mais antiga em O(1), sem varrer o mapa a cada requisição.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
  ) {}

  /** Registra uma requisição; `false` se estourou o limite (a requisição NÃO é contada). */
  allow(key: string, now: number = Date.now()): boolean {
    let recent = this.hits.get(key) ?? [];
    this.hits.delete(key);
    // Os instantes são crescentes: descarta o prefixo expirado.
    let expired = 0;
    while (expired < recent.length && now - (recent[expired] as number) >= this.windowMs) expired++;
    if (expired > 0) recent = recent.slice(expired);
    const allowed = recent.length < this.max;
    if (allowed) recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done !== true) this.hits.delete(oldest.value);
    }
    return allowed;
  }

  /** Registra um evento SEM checar o limite (contagem de falhas). Mesmo teto de chaves. */
  record(key: string, now: number = Date.now()): void {
    let recent = this.hits.get(key) ?? [];
    this.hits.delete(key);
    let expired = 0;
    while (expired < recent.length && now - (recent[expired] as number) >= this.windowMs) expired++;
    if (expired > 0) recent = recent.slice(expired);
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done !== true) this.hits.delete(oldest.value);
    }
  }

  /** Eventos dentro da janela, sem registrar nem reordenar a chave. */
  count(key: string, now: number = Date.now()): number {
    const recent = this.hits.get(key);
    if (recent === undefined) return 0;
    let n = 0;
    for (const t of recent) if (now - t < this.windowMs) n++;
    return n;
  }

  /** Quantidade de chaves rastreadas (testes). */
  get size(): number {
    return this.hits.size;
  }
}

/**
 * Normaliza o IP do cliente para a chave do limite: IPv4 puro fica como está; IPv4 mapeado em IPv6
 * (`::ffff:1.2.3.4`) vira o IPv4; IPv6 vira o prefixo /64 (um cliente controla um /64 inteiro, então
 * limitar por endereço exato seria trivial de burlar). Lixo que não é IP é truncado.
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone >= 0) ip = ip.slice(0, zone);
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return ip.slice(0, 64);
  const embedded = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (embedded !== null) {
    const [, head, a, b, c, d] = embedded as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const hi = ((Number(a) << 8) | Number(b)).toString(16);
    const lo = ((Number(c) << 8) | Number(d)).toString(16);
    ip = `${head}${hi}:${lo}`;
  }
  const [headPart = '', tailPart] = ip.split('::') as [string?, string?];
  const head = headPart === '' ? [] : headPart.split(':');
  const tail = tailPart === undefined || tailPart === '' ? [] : tailPart.split(':');
  const groups =
    tailPart === undefined
      ? head
      : [...head, ...Array<string>(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  const n = groups.map((g) => Number.parseInt(g, 16));
  const mapped = n.slice(0, 5).every((g) => g === 0) && n[5] === 0xffff;
  if (mapped) {
    const hi = n[6] as number;
    const lo = n[7] as number;
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return `${n
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
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
    if (last !== undefined && last !== '') return normalizeIp(last);
  }
  const addr = req.socket.remoteAddress;
  return addr === undefined ? 'unknown' : normalizeIp(addr);
}
