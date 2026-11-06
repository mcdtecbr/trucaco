/**
 * Observabilidade (7F): request id por requisição HTTP e `GET /metrics` interno.
 *
 * Request id: `X-Request-Id` do cliente só vale se tiver forma de id (8 a 64 de `[A-Za-z0-9_-]`); senão o
 * servidor gera um UUID. Vai na resposta e nos logs da requisição e dos erros. Nunca entra token, corpo,
 * cabeçalho de auth, `userId` nem caminho com parâmetro (o log usa o padrão da rota, não a URL).
 *
 * `/metrics`: JSON agregado, sem PII, `no-store`. Só existe com `METRICS_TOKEN` (Bearer, comparado em tempo
 * constante); sem o token a rota responde 404 como qualquer caminho desconhecido. NÃO exponha esta rota
 * publicamente sem o token (ver README do servidor).
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Application, RequestHandler } from 'express';
import { bearerFromHeader } from '../auth/authService';
import { getLobby } from '../lobby/lobby';
import { log } from '../logger';
import { metrics as processMetrics, type Metrics } from '../metrics';
import { SlidingWindowLimiter, clientKey, type TrustProxy } from '../rateLimit';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const REQUEST_ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;
/** Tamanho mínimo do `METRICS_TOKEN` (validado na subida). */
export const METRICS_TOKEN_MIN_LENGTH = 32;
/** Tentativas de `/metrics` por IP por minuto (qualquer resultado). */
export const METRICS_PER_IP_PER_MIN = 60;
/** Rotas que não geram linha de log por requisição (ruído de sonda e monitor). */
const QUIET_PATHS = new Set(['/health', '/metrics']);

export function resolveRequestId(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_SHAPE.test(header) ? header : randomUUID();
}

export function requestIdOf(locals: unknown): string {
  const id = (locals as { requestId?: unknown } | undefined)?.requestId;
  return typeof id === 'string' ? id : 'none';
}

/**
 * Primeiro middleware do express: define `res.locals.requestId`, o cabeçalho de resposta, conta respostas de
 * erro por `error.code` e loga o fim da requisição (4xx em `info`, 5xx em `warn`; o erro interno detalhado é
 * logado pelo tratador geral, com o mesmo id).
 */
export function installRequestId(app: Application, metrics: Metrics = processMetrics): void {
  app.use((req, res, next) => {
    const id = resolveRequestId(req.headers['x-request-id']);
    res.locals['requestId'] = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    const started = Date.now();
    // Todos os erros da API saem como `res.json({ error: { code } })`: captura o código sem tocar nas rotas.
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const code = (body as { error?: { code?: unknown } } | null | undefined)?.error?.code;
      if (res.statusCode >= 400 && typeof code === 'string') {
        res.locals['errorCounted'] = true;
        metrics.httpError(code);
      }
      return json(body);
    };
    res.on('finish', () => {
      // Erro sem corpo `{ error: { code } }` (ex.: `res.status(x).end()`) entra pelo status.
      if (res.statusCode >= 400 && res.locals['errorCounted'] !== true) {
        metrics.httpError(`HTTP_${res.statusCode}`);
      }
      if (QUIET_PATHS.has(req.path) || res.statusCode < 400) return;
      const route: unknown = (req.route as { path?: unknown } | undefined)?.path;
      const fields = {
        requestId: id,
        method: req.method,
        route: typeof route === 'string' ? route : 'unmatched',
        status: res.statusCode,
        ms: Date.now() - started,
      };
      if (res.statusCode >= 500) log.warn('http: resposta de erro', fields);
      else log.info('http: resposta de erro do cliente', fields);
    });
    next();
  });
}

function sameToken(presented: string, expected: string): boolean {
  // Hash de tamanho fixo: `timingSafeEqual` exige buffers de mesmo tamanho e não vaza o comprimento.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface MetricsRouteOptions {
  /** Ausente ou vazio: a rota fica desligada (404). */
  readonly token?: string | undefined;
  readonly trustProxy: TrustProxy;
  readonly metrics?: Metrics;
}

/** Monta `GET /metrics`. Chamar ANTES do 404 geral. */
export function mountMetrics(app: Application, opts: MetricsRouteOptions): void {
  const metrics = opts.metrics ?? processMetrics;
  const token = opts.token === undefined || opts.token === '' ? null : opts.token;
  if (token === null) return; // sem rota: cai no 404 padrão
  const limiter = new SlidingWindowLimiter(METRICS_PER_IP_PER_MIN, 60_000);
  const handler: RequestHandler = (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!limiter.allow(clientKey(req, opts.trustProxy))) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: { code: 'RATE_LIMITED' } });
      return;
    }
    const presented = bearerFromHeader(req.headers.authorization);
    if (presented === undefined || !sameToken(presented, token)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      return;
    }
    const stats = getLobby()?.stats() ?? { queued: 0, tables: 0, users: 0 };
    res.json(
      metrics.snapshot({
        ...stats,
        byTableSize: getLobby()?.queueByTableSize() ?? {},
      }),
    );
  };
  app.get('/metrics', handler);
}
