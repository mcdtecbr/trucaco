/**
 * Endereços do ambiente E2E. O servidor tem porta FIXA porque a URL dele vai para dentro do bundle web
 * (`EXPO_PUBLIC_SERVER_URL`). Ambas são sobrescrevíveis por variável de ambiente quando houver conflito.
 * Sempre `127.0.0.1` (e não `localhost`): é um host permitido em build de produção sem https
 * (`getServerUrl`) e evita a resolução IPv6 de `localhost` no Node.
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`${name} inválida: ${raw}`);
  return n;
}

export const SERVER_PORT = port('E2E_SERVER_PORT', 2587);
export const WEB_PORT = port('E2E_WEB_PORT', 8087);
export const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
/**
 * Segundo servidor que serve o próprio web (`WEB_DIST_DIR`): a MESMA ORIGEM do beta (página e API no mesmo
 * host:porta, sem CORS). O bundle dele aponta `EXPO_PUBLIC_SERVER_URL` para ele mesmo.
 */
export const SAME_PORT = port('E2E_SAME_PORT', 2588);
export const SAME_URL = `http://127.0.0.1:${SAME_PORT}`;
export const SAME_DIST_DIR = 'dist-e2e-same';
/** Pasta do build web do E2E, relativa a `apps/mobile` (separada de `dist/`, que é o build normal). */
export const WEB_DIST_DIR = 'dist-e2e';
