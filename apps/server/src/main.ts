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

async function main(): Promise<void> {
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
