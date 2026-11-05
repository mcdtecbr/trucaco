import type { IncomingMessage } from 'node:http';
import { isIP, isIPv4, isIPv6 } from 'node:net';
import { log } from './logger';

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
 * Proxy confiável. `false`: ignora cabeçalhos e usa o IP do socket. `true`: ÚLTIMO item de
 * `X-Forwarded-For`. `{ header }`: o valor do cabeçalho NOMEADO, que o proxy define sozinho (ex.:
 * `Fly-Client-IP` na Fly.io; nome em minúsculas). Só ligue se TODO tráfego passa pelo proxy: senão o
 * cliente forja o cabeçalho.
 */
export type TrustProxy = boolean | { readonly header: string };

const FORWARDED_FOR = 'x-forwarded-for';

/** IP anunciado pelo proxy confiável nos cabeçalhos (`undefined` se não houver ou `trust` desligado). */
function proxyIp(get: (name: string) => string | undefined, trust: TrustProxy): string | undefined {
  if (trust === false) return undefined;
  const name = trust === true ? FORWARDED_FOR : trust.header.toLowerCase();
  const raw = get(name);
  if (raw === undefined) return undefined;
  // `X-Forwarded-For` (lista): só o último item vale. Cabeçalho próprio do proxy: o valor inteiro.
  const value = name === FORWARDED_FOR ? raw.split(',').at(-1) : raw;
  const ip = value?.trim();
  if (ip === undefined || ip === '') return undefined;
  // Só IP de verdade vale como chave: lixo no cabeçalho (proxy mal configurado ou tráfego fora do proxy)
  // cai no IP do socket, e o aviso (sem o valor) avisa quem opera. Um aviso por minuto no máximo.
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (!isIP(bare.split('%')[0] ?? '')) {
    const now = Date.now();
    if (now - lastBadHeaderWarn > 60_000) {
      lastBadHeaderWarn = now;
      log.warn('rateLimit: cabeçalho do TRUST_PROXY sem IP válido, usando o IP do socket', {
        header: name,
      });
    }
    return undefined;
  }
  return normalizeIp(ip);
}

let lastBadHeaderWarn = 0;

/**
 * Chave de rate limit do cliente. Atrás de proxy reverso o IP do socket é o do proxy; com
 * `trustProxy` (ver `TrustProxy`) vale o IP que o proxy confiável anunciou, e sem ele cai no do socket.
 */
export function clientKey(req: IncomingMessage, trustProxy: TrustProxy): string {
  const ip = proxyIp((name) => {
    const v = req.headers[name];
    return Array.isArray(v) ? v.join(',') : v;
  }, trustProxy);
  if (ip !== undefined) return ip;
  const addr = req.socket.remoteAddress;
  return addr === undefined ? 'unknown' : normalizeIp(addr);
}

/** Como `clientKey`, para cabeçalhos no formato `Headers` (matchmaker). `null` sem proxy confiável/cabeçalho. */
export function trustedIpFromHeaders(
  headers: Headers | undefined,
  trustProxy: TrustProxy,
): string | null {
  return proxyIp((name) => headers?.get(name) ?? undefined, trustProxy) ?? null;
}
