/**
 * Trava dos testes de integração com Redis (`TEST_REDIS_URL`), análoga à do banco: só host local e um
 * DB lógico explícito diferente de 0 (o 0 é o do dev/Colyseus). Sem dependências: também é importado por
 * `vitest.int.config.ts`.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function assertSafeTestRedisUrl(raw: string | undefined): string {
  if (raw === undefined || raw === '') throw new Error('TEST_REDIS_URL não definida.');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_REDIS_URL inválida.');
  }
  if (url.protocol !== 'redis:') throw new Error('TEST_REDIS_URL deve ser redis://.');
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`TEST_REDIS_URL recusada: host "${url.hostname}" não é local.`);
  }
  const db = Number(url.pathname.replace(/^\//, ''));
  if (!Number.isInteger(db) || db < 1 || url.pathname === '' || url.pathname === '/') {
    throw new Error(
      'TEST_REDIS_URL recusada: use um DB lógico explícito diferente de 0 (ex.: /15).',
    );
  }
  return raw;
}
