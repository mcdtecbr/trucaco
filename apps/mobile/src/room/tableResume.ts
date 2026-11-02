/**
 * Retomada da mesa depois de recarregar a página (web) ou reabrir o app (nativo).
 *
 * - `createResumeRecorder`: grava (token de reconexão, código, dono) enquanto o jogador está numa mesa e
 *   apaga ao sair. Chamado pelo `roomService`; falha de armazenamento nunca derruba a mesa.
 * - `createTableResume`: no carregamento, com sessão válida e registro do MESMO usuário, tenta voltar:
 *   1. `reconnect` pelo token (janela de 60 s do servidor);
 *   2. se o token já não vale (janela fechada, o bot assumiu, ou saída na espera), entra de novo pelo
 *      código com `POST /tables/join`: o servidor devolve o assento ao dono (mesmo `userId`) quando é
 *      mesa privada. Mesa da fila pública não tem esse caminho e cai no erro de mesa indisponível.
 *   Toda falha apaga o registro. Nenhuma regra de jogo aqui: só quem decide é o servidor.
 */
import { isValidRoomCode } from '@trucaco/protocol';
import type { SeatReservation } from '@trucaco/protocol';
import { errorCodeOf } from '../i18n/errors';
import { isValidReconnectionToken } from '../net/resumeStorageCore';
import type { ResumeStorage, TableResume } from '../net/resumeStorageCore';

export interface ResumeRecorder {
  /** Guarda o token vigente da sala atual. Entradas inválidas são ignoradas. */
  save(token: string, code: string, visibility?: 'private' | 'public'): void;
  /** Esquece a mesa (saída de propósito, mesa encerrada, logout, recusa do servidor). */
  clear(): void;
}

/**
 * As operações vão para uma fila única: um `clear` nunca é atropelado por um `save` mais antigo que
 * ainda estava gravando. Valores repetidos não regravam.
 */
export function createResumeRecorder(opts: {
  storage: ResumeStorage;
  getUserId(): string | null;
}): ResumeRecorder {
  let chain: Promise<void> = Promise.resolve();
  let lastKey: string | null = null;
  /** Já apagado desde o último `save`: `clear` repetido (a cada patch de estado) não regrava nada. */
  let cleared = false;
  const enqueue = (job: () => Promise<void>): void => {
    chain = chain.then(job).catch(() => undefined);
  };
  return {
    save(token, code, visibility) {
      const userId = opts.getUserId();
      if (userId === null || !isValidReconnectionToken(token) || !isValidRoomCode(code)) return;
      const key = `${userId}|${code}|${token}|${visibility ?? ''}`;
      if (key === lastKey) return;
      lastKey = key;
      cleared = false;
      enqueue(() =>
        opts.storage.save({
          reconnectionToken: token,
          code,
          userId,
          ...(visibility !== undefined ? { visibility } : {}),
        }),
      );
    },
    clear() {
      lastKey = null;
      if (cleared) return;
      cleared = true;
      enqueue(() => opts.storage.clear());
    },
  };
}

export type ResumeFailure =
  /** A mesa não existe mais, ou o assento não é recuperável. */
  | 'gone'
  /** A sessão acabou (o usuário precisa entrar de novo). */
  | 'session'
  /** Rede ou servidor fora do ar. */
  | 'unavailable';

export type ResumeOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'resumed'; readonly code: string }
  | { readonly kind: 'failed'; readonly reason: ResumeFailure; readonly errorCode: string };

export interface TableResumeDeps {
  storage: Pick<ResumeStorage, 'load'>;
  /** Apaga o registro (passa pelo gravador, que ordena `save` e `clear`). */
  clear(): void;
  getUserId(): string | null;
  /** `rooms.resume`: reconecta pelo token e devolve o código da sala ('' se o estado não chegou). */
  resumeRoom(token: string): Promise<string>;
  /** `POST /tables/join` (resposta já validada). */
  reserveByCode(code: string): Promise<SeatReservation>;
  /** `rooms.enter`: consome a reserva. */
  enter(reservation: SeatReservation): Promise<string>;
  /** Avisa que a retomada começou (a tela mostra "Reconectando à mesa…"). */
  onStart?(): void;
  sleep?(ms: number): Promise<void>;
  /** Tentativas do reconnect por token (a entrada por código é sempre UMA). Padrão 3. */
  rounds?: number;
  /** Espera entre tentativas (o servidor pode demorar a notar o socket antigo morto). Padrão 600 ms. */
  retryDelayMs?: number;
}

export interface TableResumeController {
  /** Registro guardado deste usuário, ou `null`. Registro de outro usuário é apagado. */
  pending(): Promise<TableResume | null>;
  /** Tenta voltar à mesa. Chamadas simultâneas compartilham a mesma tentativa. */
  run(): Promise<ResumeOutcome>;
}

export const RESUME_ROUNDS = 3;
export const RESUME_RETRY_DELAY_MS = 600;

const SESSION_CODES = new Set([
  'SESSION_REQUIRED',
  'TOKEN_EXPIRED',
  'UNAUTHORIZED',
  'INVALID_REFRESH_TOKEN',
]);
/** Recusas do servidor à entrada pelo código: a mesa não é recuperável por este caminho. */
const JOIN_REFUSED_CODES = new Set([
  'TABLE_UNAVAILABLE',
  'ALREADY_IN_TABLE',
  'ALREADY_SEATED',
  'ROOM_FULL',
  'JOIN_FAILED',
]);

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createTableResume(deps: TableResumeDeps): TableResumeController {
  const rounds = deps.rounds ?? RESUME_ROUNDS;
  const delay = deps.retryDelayMs ?? RESUME_RETRY_DELAY_MS;
  const sleep = deps.sleep ?? defaultSleep;
  let inflight: Promise<ResumeOutcome> | null = null;

  async function safeLoad(): Promise<TableResume | null> {
    try {
      return await deps.storage.load();
    } catch {
      return null;
    }
  }

  async function pending(): Promise<TableResume | null> {
    const rec = await safeLoad();
    if (rec === null) return null;
    const userId = deps.getUserId();
    if (userId === null || rec.userId !== userId) {
      deps.clear(); // gravado por outro usuário: nunca usado
      return null;
    }
    return rec;
  }

  async function attempt(rec: TableResume): Promise<ResumeOutcome> {
    deps.onStart?.();
    let gone: ResumeOutcome = { kind: 'failed', reason: 'gone', errorCode: 'ROOM_NOT_FOUND' };
    // 1. O token (janela de reconexão aberta). Repete só ELE: o servidor pode demorar a notar o socket
    // antigo morto, e essa chamada não alimenta o freio de força bruta do lobby.
    for (let round = 0; round < rounds; round += 1) {
      if (round > 0) await sleep(delay);
      try {
        const code = await deps.resumeRoom(rec.reconnectionToken);
        return { kind: 'resumed', code: isValidRoomCode(code) ? code : rec.code };
      } catch (e) {
        const errorCode = errorCodeOf(e);
        if (SESSION_CODES.has(errorCode)) return { kind: 'failed', reason: 'session', errorCode };
        if (errorCode !== 'ROOM_NOT_FOUND') {
          return { kind: 'failed', reason: 'unavailable', errorCode };
        }
        gone = { kind: 'failed', reason: 'gone', errorCode };
      }
    }
    // 2. Token recusado: UMA tentativa pelo código (cada falha conta no `JoinGuard` do servidor). Mesa
    // pública (fila) nunca volta por código: pula, sem gastar tentativa.
    if (rec.visibility === 'public') return gone;
    try {
      const reservation = await deps.reserveByCode(rec.code);
      const code = await deps.enter(reservation);
      return { kind: 'resumed', code: isValidRoomCode(code) ? code : rec.code };
    } catch (e) {
      const errorCode = errorCodeOf(e);
      if (SESSION_CODES.has(errorCode)) return { kind: 'failed', reason: 'session', errorCode };
      if (JOIN_REFUSED_CODES.has(errorCode) || errorCode === 'RATE_LIMITED') {
        return { kind: 'failed', reason: 'gone', errorCode };
      }
      return { kind: 'failed', reason: 'unavailable', errorCode };
    }
  }

  async function execute(): Promise<ResumeOutcome> {
    const rec = await pending();
    if (rec === null) return { kind: 'none' };
    let outcome: ResumeOutcome;
    try {
      outcome = await attempt(rec);
    } catch (e) {
      outcome = { kind: 'failed', reason: 'unavailable', errorCode: errorCodeOf(e) };
    }
    // Falha definitiva: o registro morre (token inválido, mesa inexistente, sessão perdida). Sucesso: o
    // `roomService` já gravou o token novo da sala retomada.
    // Rede ou servidor fora (`unavailable`) NÃO apaga: um novo reload ainda pode retomar.
    if (outcome.kind === 'failed' && outcome.reason !== 'unavailable') deps.clear();
    return outcome;
  }

  return {
    pending,
    run() {
      inflight ??= execute().finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}
