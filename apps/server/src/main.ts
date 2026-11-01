import { createServer } from './server';

const DEFAULT_PORT = 2567;

function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT inválida: ${raw}`);
  }
  return port;
}

/**
 * Modo de desenvolvimento por opt-in EXPLÍCITO (`--dev`), portátil entre shells. Sem o argumento e sem
 * `NODE_ENV=development|test`, a auth temporária da sala (TODO 2G) rejeita todas as entradas. O Docker
 * nunca passa `--dev` e define `NODE_ENV=production`.
 */
function applyDevFlag(): void {
  if (process.argv.includes('--dev') && process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = 'development';
  }
}

async function main(): Promise<void> {
  applyDevFlag();
  const server = await createServer({ port: resolvePort(process.env.PORT) });
  console.log(JSON.stringify({ level: 'info', msg: 'server listening', port: server.port }));

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', msg: 'shutting down', signal }));
    server.close().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(JSON.stringify({ level: 'error', msg: 'shutdown failed', err: String(err) }));
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'startup failed', err: String(err) }));
  process.exit(1);
});
