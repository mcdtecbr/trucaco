/**
 * Serve o estático do web (export do Expo) NA MESMA ORIGEM da API: sem CORS, cookie `SameSite=Strict`
 * direto e um domínio só. Ligado por `WEB_DIST_DIR` (pasta com `index.html`).
 *
 * - Só `GET`/`HEAD`; arquivos reais primeiro (`express.static`, sem listar diretório nem seguir `..`).
 * - Fallback para `index.html` (roteamento do cliente) apenas para caminhos de PÁGINA: fora dos prefixos da
 *   API (`/auth`, `/health`, `/matches`, `/me`, `/users`, `/tables`, `/queue`, `/reports`, `/matchmake`) e
 *   sem extensão no último segmento (um `.js` ou `.png` ausente continua 404, não vira HTML).
 * - Cabeçalhos: o `installBaseMiddleware` trava a API com `default-src 'none'` e `no-store`; aqui, só para
 *   o estático, vale uma CSP própria e cache (hash no nome em `/_expo/` e `/assets/` = imutável; o HTML,
 *   `no-cache`, para o deploy novo valer na hora).
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { isDevLike } from '../auth/config';
import type { Application, NextFunction, Request, Response } from 'express';

/** Prefixos de API: nunca respondem com o `index.html`. */
export const API_PREFIXES = [
  '/auth',
  '/health',
  '/matches',
  '/me',
  '/users',
  '/tables',
  '/queue',
  '/reports',
  '/matchmake',
  '/__matchmake_rate_limited',
] as const;

const IMMUTABLE_PREFIXES = ['/_expo/', '/assets/'];
const HOST_RE = /^[A-Za-z0-9.\-:[\]]{1,255}$/;

export function isApiPath(path: string): boolean {
  return API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** `true` se o último segmento tem extensão (`/x/app.js`), ou seja, é pedido de ARQUIVO. */
function looksLikeFile(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.includes('.');
}

/** CSP do estático. O WebSocket usa o host da própria requisição (Safari antigo não cobre `ws:` com 'self'). */
export function webCsp(host: string | undefined, allowInsecureWs = false): string {
  // Produção: só `wss://`. `ws://` apenas em dev/test (http local).
  const ws =
    host !== undefined && HOST_RE.test(host)
      ? ` ${allowInsecureWs ? `ws://${host} ` : ''}wss://${host}`
      : '';
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src 'self'${ws}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface WebOptions {
  /** Pasta do export (contém `index.html`). */
  readonly dir: string;
  /** Libera `ws://` no `connect-src` (dev/test). Padrão: só com `NODE_ENV` development/test. */
  readonly insecureWs?: boolean;
}

/** Falha cedo se a pasta não existe ou não tem `index.html`. */
export function assertWebDist(dir: string): string {
  const abs = resolve(dir);
  const index = join(abs, 'index.html');
  if (!existsSync(abs) || !statSync(abs).isDirectory() || !existsSync(index)) {
    throw new Error('WEB_DIST_DIR inválida: precisa ser uma pasta com index.html.');
  }
  return abs;
}

/** Monta o estático depois das rotas da API e antes do 404 (`mountFallbacks`). */
export function mountWeb(app: Application, opts: WebOptions): void {
  const dir = assertWebDist(opts.dir);
  const index = join(dir, 'index.html');
  const insecureWs = opts.insecureWs ?? isDevLike(process.env.NODE_ENV);

  const isPageRequest = (req: Request): boolean =>
    (req.method === 'GET' || req.method === 'HEAD') && !isApiPath(req.path);

  /** Troca os cabeçalhos da API pelos do estático (só nas respostas de página/arquivo). */
  const staticHeaders = (req: Request, res: Response, next: NextFunction): void => {
    if (!isPageRequest(req)) {
      next();
      return;
    }
    res.setHeader('Content-Security-Policy', webCsp(req.headers.host, insecureWs));
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  };

  app.use(staticHeaders);
  app.use(
    express.static(dir, {
      index: false,
      redirect: false,
      // O dist só tem o que o export gera; o expo-router emite `/assets/__node_modules/.pnpm/...`. O `send`
      // continua barrando `..` (traversal) com 403/404.
      dotfiles: 'allow',
      fallthrough: true,
      setHeaders: (res, filePath) => {
        const rel = `/${filePath
          .slice(dir.length + 1)
          .split(/[\\/]/)
          .join('/')}`;
        if (rel === '/index.html') return; // `no-cache` já definido
        res.setHeader(
          'Cache-Control',
          IMMUTABLE_PREFIXES.some((p) => rel.startsWith(p))
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=300',
        );
      },
    }),
  );
  app.use((req, res, next) => {
    if (!isPageRequest(req) || looksLikeFile(req.path)) {
      next();
      return;
    }
    res.type('html');
    res.sendFile(index, { dotfiles: 'allow' }, (err) => {
      if (err !== undefined && err !== null && !res.headersSent) next(err);
    });
  });
}
