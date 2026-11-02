/**
 * Fluxos do lobby (criar mesa, entrar por código, fila pública) sem React e sem regra de jogo.
 * Toda requisição passa por aqui para garantir: validação local ANTES da rede, botões desabilitados
 * em voo (`busy`), resposta validada por guard, polling cancelável e mensagem de erro única para
 * mesa inexistente/cheia/fechada.
 */
import { validateRoomOptions } from '@trucaco/protocol';
import type {
  CreateTableRequest,
  QueueRequest,
  SeatReservation,
  VariantId,
} from '@trucaco/protocol';
import { errorCodeOf } from '../i18n/errors';
import { ApiError, isApiError } from '../net/api';
import type { ApiClient } from '../net/api';
import { isCreateTableResponse, isJoinTableResponse, isQueueStatusResponse } from '../net/guards';
import type { LobbyScope, LobbyStore } from '../store/lobbyStore';
import { codeForNetwork } from './codeInput';

export const QUEUE_POLL_MS = 2000;
/** Falhas seguidas de indisponibilidade toleradas no polling antes de desistir. */
export const MAX_POLL_FAILURES = 5;

export type LobbyApi = Pick<
  ApiClient,
  'createTable' | 'joinTable' | 'joinQueue' | 'queueStatus' | 'leaveQueue'
>;

export interface LobbyDeps {
  api: LobbyApi;
  store: LobbyStore;
  /** Consome a reserva (dentro de 15 s) e resolve com o código da sala ('' se ainda desconhecido). */
  enter(reservation: SeatReservation): Promise<string>;
  /** Sentou: a tela navega para `/table/<code>`. */
  onEntered(code: string): void;
  /** Saiu da tela no meio da entrada: larga a sala recém-aberta. */
  abandon?(): void;
  pollMs?: number;
}

export interface TableChoices {
  readonly variant: VariantId;
  readonly format: 'single' | 'bo3';
  readonly ironHand: boolean;
}

export interface QueueChoices {
  readonly variant: VariantId;
  readonly ironHand: boolean;
}

export interface LobbyController {
  createTable(choices: TableChoices): Promise<void>;
  joinByCode(input: string): Promise<void>;
  startQueue(choices: QueueChoices): Promise<void>;
  cancelQueue(): Promise<void>;
  /** Sair da tela: cancela o polling e, se ainda na fila, sai dela (melhor esforço). */
  dispose(): void;
}

export function createLobbyController(deps: LobbyDeps): LobbyController {
  const { api, store } = deps;
  const pollMs = deps.pollMs ?? QUEUE_POLL_MS;
  /** Sobe a cada início/cancelamento: respostas e timers de uma geração antiga são descartados. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let disposed = false;

  const state = () => store.getState();
  const isFree = (): boolean => state().busy === 'none' && state().queue.status !== 'queued';

  function fail(scope: LobbyScope, e: unknown): void {
    const retry = isApiError(e) ? e.retryAfterSeconds : undefined;
    state().setError({
      scope,
      code: errorCodeOf(e),
      ...(retry !== undefined ? { retryAfterSeconds: retry } : {}),
    });
  }

  function stopPolling(): void {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    failures = 0;
  }

  async function enterReservation(scope: LobbyScope, reservation: SeatReservation): Promise<void> {
    state().setBusy('entering');
    try {
      const code = await deps.enter(reservation);
      state().setQueue({ status: 'idle' });
      if (disposed) deps.abandon?.();
      else deps.onEntered(code);
    } catch (e) {
      state().setQueue({ status: 'idle' });
      fail(scope, e);
    } finally {
      state().setBusy('none');
    }
  }

  /** Aplica uma resposta de fila já validada. */
  async function applyQueue(res: ReturnType<typeof asQueue>, gen: number): Promise<void> {
    if (gen !== generation) return;
    switch (res.status) {
      case 'queued':
        state().setQueue({ status: 'queued', expiresAt: res.expiresAt });
        schedulePoll(gen);
        return;
      case 'matched':
        stopPolling();
        state().setQueue({ status: 'matched' });
        await enterReservation('queue', res.reservation);
        return;
      case 'seated':
        stopPolling();
        state().setQueue({ status: 'seated' });
        return;
      case 'idle':
        // `idle` depois de `queued` = a entrada expirou no servidor.
        if (state().queue.status === 'queued') state().setNotice('queueExpired');
        stopPolling();
        state().setQueue({ status: 'idle' });
        return;
    }
  }

  function asQueue(x: unknown) {
    if (!isQueueStatusResponse(x)) throw invalidResponse();
    return x;
  }

  function schedulePoll(gen: number): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void poll(gen);
    }, pollMs);
  }

  async function poll(gen: number): Promise<void> {
    if (gen !== generation) return;
    try {
      const res = asQueue(await api.queueStatus());
      if (gen !== generation) return;
      failures = 0;
      await applyQueue(res, gen);
    } catch (e) {
      if (gen !== generation) return;
      failures += 1;
      const transient = isApiError(e) && e.isUnavailable;
      if (transient && failures < MAX_POLL_FAILURES) {
        schedulePoll(gen);
        return;
      }
      stopPolling();
      state().setQueue({ status: 'idle' });
      fail('queue', e);
    }
  }

  return {
    async createTable(choices) {
      if (!isFree()) return;
      const request: CreateTableRequest = {
        variant: choices.variant,
        format: choices.format,
        ironHand: choices.ironHand,
        visibility: 'private',
      };
      state().setError(null);
      const valid = validateRoomOptions(request);
      if (!valid.ok) {
        state().setError({ scope: 'create', code: valid.error });
        return;
      }
      state().setBusy('create');
      try {
        const res = await api.createTable(request);
        if (!isCreateTableResponse(res)) throw invalidResponse();
        await enterReservation('create', res.reservation);
      } catch (e) {
        fail('create', e);
        state().setBusy('none');
      }
    },

    async joinByCode(input) {
      if (!isFree()) return;
      state().setError(null);
      // Validação ANTES da rede: formato inválido nunca gera requisição (nem consulta no servidor).
      const code = codeForNetwork(input);
      if (code === null) {
        state().setError({ scope: 'join', code: 'INVALID_CODE' });
        return;
      }
      state().setBusy('join');
      try {
        const res = await api.joinTable(code);
        if (!isJoinTableResponse(res)) throw invalidResponse();
        await enterReservation('join', res.reservation);
      } catch (e) {
        fail('join', e);
        state().setBusy('none');
      }
    },

    async startQueue(choices) {
      if (!isFree()) return;
      const request: QueueRequest = {
        variant: choices.variant,
        format: 'single',
        ironHand: choices.ironHand,
        visibility: 'public',
      };
      state().setError(null);
      state().setNotice(null);
      const valid = validateRoomOptions(request);
      if (!valid.ok) {
        state().setError({ scope: 'queue', code: valid.error });
        return;
      }
      stopPolling();
      const gen = generation;
      state().setBusy('queue');
      try {
        const res = asQueue(await api.joinQueue(request));
        if (gen !== generation) return;
        // Libera o `busy` antes de aplicar: `matched` abre o próprio `entering`.
        state().setBusy('none');
        await applyQueue(res, gen);
      } catch (e) {
        if (gen === generation) {
          fail('queue', e);
        }
      } finally {
        if (state().busy === 'queue') state().setBusy('none');
      }
    },

    async cancelQueue() {
      if (state().queue.status !== 'queued' || state().busy === 'leaving') return;
      stopPolling();
      state().setBusy('leaving');
      try {
        const res = asQueue(await api.leaveQueue());
        state().setBusy('none');
        if (res.status === 'matched') {
          // Casou no instante em que o usuário cancelou: a mesa já o espera.
          await enterReservation('queue', res.reservation);
        } else {
          state().setQueue(res.status === 'seated' ? { status: 'seated' } : { status: 'idle' });
        }
      } catch (e) {
        state().setQueue({ status: 'idle' });
        fail('queue', e);
      } finally {
        if (state().busy === 'leaving') state().setBusy('none');
      }
    },

    dispose() {
      disposed = true;
      const wasQueued = state().queue.status === 'queued';
      stopPolling();
      if (wasQueued) api.leaveQueue().catch(() => undefined);
      state().setQueue({ status: 'idle' });
      state().setBusy('none');
    },
  };
}

function invalidResponse(): ApiError {
  return new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
}
