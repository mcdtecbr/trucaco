/** Só para testes de integração: sobe o servidor compilado como processo filho e o derruba por PID. */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface RunningServer {
  readonly url: string;
  readonly pid: number;
  stop(): Promise<void>;
}

export async function startServer(extraEnv: Record<string, string> = {}): Promise<RunningServer> {
  const main = resolve(import.meta.dirname, '../../../server/dist/main.js');
  if (!existsSync(main)) {
    throw new Error(
      'apps/server/dist/main.js não existe: rode `pnpm build` na raiz antes do test:int',
    );
  }
  const child: ChildProcess = spawn(process.execPath, [main], {
    env: {
      PATH: process.env['PATH'] ?? '',
      NODE_ENV: 'test',
      PORT: '0',
      TRUCO_SEED: '12345',
      JOIN_MIN_LATENCY_MS: '0',
      ACCESS_TOKEN_TTL_SECONDS: '60',
      AUTH_GUEST_PER_IP_PER_HOUR: '10000',
      AUTH_GUEST_GLOBAL_PER_HOUR: '10000',
      AUTH_REFRESH_PER_IP_PER_MIN: '10000',
      REST_PER_IP_PER_MIN: '100000',
      REST_PER_USER_PER_MIN: '100000',
      MATCHMAKE_RATE_LIMIT_PER_MIN: '10000',
      JOIN_ATTEMPTS_PER_USER_PER_MIN: '1000',
      JOIN_ATTEMPTS_PER_IP_PER_MIN: '1000',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('não foi possível iniciar o servidor');

  // O filho nunca pode sobreviver ao teste: mata por PID (SIGKILL) se o processo de teste sair,
  // se o "listening" estourar o prazo ou se o servidor cair antes de ficar pronto.
  const killChild = (): void => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // já saiu
      }
    }
  };
  process.once('exit', killChild);

  let port: number;
  try {
    port = await waitListening(child);
  } catch (e) {
    killChild();
    process.removeListener('exit', killChild);
    throw e;
  }

  return {
    url: `http://127.0.0.1:${port}`,
    pid,
    stop: () =>
      new Promise<void>((done) => {
        process.removeListener('exit', killChild);
        if (child.exitCode !== null || child.signalCode !== null) return done();
        child.once('exit', () => done());
        process.kill(pid, 'SIGTERM'); // por PID, nunca pkill -f
        setTimeout(killChild, 5000).unref();
      }),
  };
}

function waitListening(child: ChildProcess): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('servidor não ficou pronto em 20 s')), 20_000);
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const m = /"msg":"server listening","port":(\d+)/.exec(buffer);
      if (m?.[1] !== undefined) {
        clearTimeout(timer);
        resolvePort(Number(m[1]));
      }
    });
    let errText = '';
    child.stderr?.on('data', (c: Buffer) => {
      errText = (errText + c.toString('utf8')).slice(-600);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`servidor saiu antes de ficar pronto (código ${String(code)}): ${errText}`));
    });
  });
}
