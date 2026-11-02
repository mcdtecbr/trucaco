/**
 * Sobe o servidor REAL (`apps/server/dist/main.js`) como processo filho para o E2E e o derruba por PID.
 * Porta fixa (a URL vai no bundle web). Sem `DATABASE_URL`/`REDIS_URL` o servidor usa repositório e
 * refresh tokens em memória (permitido só em `NODE_ENV=test`); com `TEST_DATABASE_URL` e/ou
 * `TEST_REDIS_URL` usa Postgres e Redis de verdade (o CI faz isso).
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ServerHandle {
  stop(): Promise<void>;
}

/** Recusa URL de banco/Redis que não seja da máquina local: o E2E cria usuários e partidas. */
function localOnly(name: string, raw: string): string {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error(`${name} inválida`);
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    throw new Error(`${name}: o E2E só aceita banco/Redis locais (host ${host} recusado)`);
  }
  return raw;
}

export async function startGameServer(options: {
  port: number;
  corsOrigin: string;
}): Promise<ServerHandle> {
  const main = resolve(__dirname, '../../../server/dist/main.js');
  if (!existsSync(main)) {
    throw new Error('apps/server/dist/main.js não existe: rode `pnpm build` na raiz antes do E2E');
  }
  const db = process.env['TEST_DATABASE_URL'];
  const redis = process.env['TEST_REDIS_URL'];
  const child: ChildProcess = spawn(process.execPath, [main], {
    env: {
      PATH: process.env['PATH'] ?? '',
      // Windows: o Node precisa disto para resolver rede/DNS.
      ...(process.env['SystemRoot'] !== undefined ? { SystemRoot: process.env['SystemRoot'] } : {}),
      NODE_ENV: 'test',
      PORT: String(options.port),
      CORS_ORIGINS: options.corsOrigin,
      // Baralho fixo (só dev/test) e limites frouxos: 4 convidados do mesmo IP jogando em sequência.
      TRUCO_SEED: '12345',
      JOIN_MIN_LATENCY_MS: '0',
      ACCESS_TOKEN_TTL_SECONDS: '900',
      AUTH_GUEST_PER_IP_PER_HOUR: '10000',
      AUTH_GUEST_GLOBAL_PER_HOUR: '10000',
      AUTH_REFRESH_PER_IP_PER_MIN: '10000',
      REST_PER_IP_PER_MIN: '100000',
      REST_PER_USER_PER_MIN: '100000',
      MATCHMAKE_RATE_LIMIT_PER_MIN: '10000',
      JOIN_ATTEMPTS_PER_USER_PER_MIN: '1000',
      JOIN_ATTEMPTS_PER_IP_PER_MIN: '1000',
      ...(db !== undefined && db !== ''
        ? { DATABASE_URL: localOnly('TEST_DATABASE_URL', db) }
        : {}),
      ...(redis !== undefined && redis !== ''
        ? { REDIS_URL: localOnly('TEST_REDIS_URL', redis) }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('não foi possível iniciar o servidor do E2E');

  const kill = (): void => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // já saiu
      }
    }
  };
  // O filho nunca sobrevive ao runner: mesmo se o teardown não rodar, 'exit' mata por PID.
  process.once('exit', kill);

  try {
    await waitListening(child);
  } catch (e) {
    kill();
    process.removeListener('exit', kill);
    throw e;
  }

  return {
    stop: () =>
      new Promise<void>((done) => {
        process.removeListener('exit', kill);
        if (child.exitCode !== null || child.signalCode !== null) return done();
        child.once('exit', () => done());
        try {
          process.kill(pid, 'SIGTERM'); // por PID, nunca pkill -f
        } catch {
          return done();
        }
        setTimeout(kill, 5000).unref();
      }),
  };
}

function waitListening(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('servidor não ficou pronto em 30 s')), 30_000);
    let ready = false;
    let out = '';
    // Os canais continuam sendo lidos depois do "ready" (pipe cheio travaria o log do servidor), mas
    // sem acumular nada: antes do ready guarda só o fim do texto.
    child.stdout?.on('data', (chunk: Buffer) => {
      if (ready) return;
      out = (out + chunk.toString('utf8')).slice(-4000);
      if (/"msg":"server listening"/.test(out)) {
        ready = true;
        out = '';
        clearTimeout(timer);
        resolveReady();
      }
    });
    let err = '';
    child.stderr?.on('data', (c: Buffer) => {
      if (ready) return;
      err = (err + c.toString('utf8')).slice(-800);
    });
    child.once('exit', (code) => {
      if (ready) return;
      clearTimeout(timer);
      reject(new Error(`servidor saiu antes de ficar pronto (código ${String(code)}): ${err}`));
    });
  });
}
