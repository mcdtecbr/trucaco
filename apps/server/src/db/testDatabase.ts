/**
 * Trava dos testes de integração (`pnpm test:int`), que fazem `TRUNCATE ... CASCADE`. Só aceita
 * `TEST_DATABASE_URL` (nunca `DATABASE_URL`) apontando para a máquina local e para um banco
 * descartável pelo nome. Falha ANTES de qualquer conexão ou escrita. Sem dependências: também é
 * importado por `vitest.int.config.ts`.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const DISPOSABLE_NAME = /test|verif/i;

export function assertSafeTestDatabaseUrl(raw: string | undefined): string {
  if (raw === undefined || raw === '') {
    throw new Error('TEST_DATABASE_URL não definida: o test:int não usa DATABASE_URL.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL inválida.');
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('TEST_DATABASE_URL deve ser postgresql://.');
  }
  // `?host=` / `?hostaddr=` redirecionam a conexão (inclusive para socket) e driblariam o host.
  if (url.searchParams.has('host') || url.searchParams.has('hostaddr')) {
    throw new Error('TEST_DATABASE_URL não pode usar os parâmetros host/hostaddr.');
  }
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`TEST_DATABASE_URL recusada: host "${url.hostname}" não é local.`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!DISPOSABLE_NAME.test(database)) {
    throw new Error(
      `TEST_DATABASE_URL recusada: o banco "${database}" precisa conter "test" ou "verif" no nome.`,
    );
  }
  return raw;
}
