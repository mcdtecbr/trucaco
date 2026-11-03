/**
 * Controlador da mesa (sem React): recebe estado, eventos e mensagens do servidor, mantém o
 * `tableStore` e traduz toques em mensagens. É o único lugar que envia ações de jogo, e só envia o que
 * está em `legalActions` do snapshot atual (a UI desabilita o resto; o servidor revalida).
 * Mensagens de sala que não são ação de jogo (`voteCancel`, `chat`) passam pelo protocol.
 */
import { MAX_SIGNAL_DURATION_MS, signalInfo } from '@trucaco/avatar';
import {
  ERROR_CODES,
  QUICK_PHRASES,
  SIGNAL_IDS,
  parseClientMessage,
  parseLegalAction,
} from '@trucaco/protocol';
import type {
  ChatScope,
  ClientMessage,
  ErrorCode,
  PublicGameEvent,
  SignalId,
} from '@trucaco/protocol';
import { PUBLIC_EVENT_TYPES, announcementFor } from '@trucaco/ui';
import type { HandResult } from '@trucaco/ui';
import { messageForAction } from './actionMessage';
import { createClockOffset } from './clockOffset';
import type { ClockOffset } from './clockOffset';
import { isPresenceStatus, presenceText } from './presence';
import { actionSignature, projectTable } from './projectTable';
import type { PlayedView, TableViewModel } from './projectTable';
import type { ChatEntry, LingeringTrick, TableStore, TableStoreState } from './tableStore';

/** Se o estado não reagir à ação em tanto tempo, o botão destrava (mensagem perdida). */
export const BUSY_TIMEOUT_MS = 3000;
export const NOTICE_MS = 3000;
/** Balão de chat sobre o avatar (igual ao `CHAT_BUBBLE_MS` da UI). */
export const BUBBLE_MS = 4000;
export const PRESENCE_NOTE_MS = 5000;
/**
 * Se o avatar não avisar o fim do sinal (desmontou na troca de tela), o controlador libera o assento
 * sozinho: a duração máxima de um sinal mais esta folga.
 */
export const SIGNAL_SAFETY_MS = MAX_SIGNAL_DURATION_MS + 500;
/** Teto do histórico em memória. */
const MAX_HISTORY = 200;
/** Quanto tempo a última vaza fica na mesa depois que o servidor a limpa. */
export const LINGER_MS = 1500;
/** Logo depois de reconectar, evento mais velho que isto é replay (não mede relógio nem é falado). */
export const REPLAY_WINDOW_MS = 2000;
export const REPLAY_MIN_AGE_MS = 2000;
const MAX_HAND_LOG = 40;
const MAX_CHAT = 100;
const MAX_CHAT_TEXT = 280;

/** Erros que uma AÇÃO de jogo pode causar. Só eles destravam `busy` (lista explícita, testada contra o protocol). */
export const ACTION_ERRORS: readonly string[] = [
  'INVALID_SEAT',
  'HAND_FINISHED',
  'NOT_YOUR_TURN',
  'CARD_NOT_IN_HAND',
  'COVERED_NOT_ALLOWED',
  'BLIND_ONLY',
  'NOT_BLIND_HAND',
  'BET_NOT_ALLOWED',
  'BET_PENDING',
  'NO_PENDING_BET',
  'SPECIAL_DECISION_PENDING',
  'NO_SPECIAL_DECISION',
  'GAME_FINISHED',
  'SERIES_FINISHED',
  'NOT_SEATED',
];
/** Podem vir de ação ou de chat: vale o último envio. */
const AMBIGUOUS_ERRORS: readonly string[] = ['RATE_LIMITED', 'INVALID_PAYLOAD'];
const NO_LOG_EVENTS: readonly string[] = [
  'handStarted',
  'handDecided',
  'gameStarted',
  'gameDecided',
  'seriesDecided',
];

type MutablePatch = {
  -readonly [K in keyof Omit<TableStoreState, 'patch' | 'reset'>]?: TableStoreState[K];
};

export interface EventEnvelope {
  readonly seq: number;
  readonly at: number;
  readonly event: unknown;
}

export interface TableTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TableControllerOptions {
  store: TableStore;
  /** Envia ao servidor; `false` = sem sala. */
  send: (msg: ClientMessage) => boolean;
  now?: () => number;
  timers?: TableTimers;
  /** Estimador de offset do relógio (injetável para os testes contarem amostras). */
  clockOffset?: ClockOffset;
}

export interface TableController {
  /** Um `set` por patch de `room.state`. */
  applyState(roomState: unknown): void;
  onEvent(env: EventEnvelope): void;
  /** Salto de `seq`: o histórico derivado não vale mais. O estado é reprojetado por quem chama. */
  onDesync(info: { expected: number; got: number }): void;
  onChat(payload: unknown): void;
  onPresence(payload: unknown): void;
  onTurnTimer(payload: unknown): void;
  onServerError(payload: unknown): void;
  onReconnected(): void;
  /**
   * Sinal (público) de um assento. Anima já se o assento está livre; se está animando, entra na fila de
   * UMA posição; o que passar disso é descartado. O anúncio para o leitor de tela sai sempre.
   */
  onSignal(payload: unknown): void;
  /**
   * O avatar do assento terminou o sinal `key`: libera o assento e começa o da fila, se houver. `key`
   * velho (o controlador já liberou por segurança) é ignorado.
   */
  onSignalEnd(seat: number, key: number): void;
  /** Envia um sinal (mensagem `signal`). `false` = id inválido ou sem sala. */
  sendSignal(signalId: string): boolean;
  /** Toque numa carta: seleciona; no mesmo item selecionado, confirma. */
  pressCard(actionId: string): void;
  /** Envia a ação se (e só se) ela estiver em `legalActions` e não houver outra em voo. */
  act(actionId: string): boolean;
  /** Liga/desliga o modo "jogar coberta" (só liga se houver `playCovered` legal). */
  setCoverMode(on: boolean): void;
  /** Voto para cancelar a mesa (mensagem de sala, não faz parte de `legalActions`). */
  voteCancel(): boolean;
  /** Voto "Jogar de novo": só com a janela de revanche aberta e uma vez por partida. */
  voteRematch(): boolean;
  /** Valida com o protocol e envia. `false` = recusado (erro em `chatError`) ou sem sala. */
  sendChat(scope: ChatScope, text: string): boolean;
  sendPhrase(scope: ChatScope, phraseId: string): boolean;
  setChatOpen(open: boolean): void;
  setChatTab(scope: ChatScope): void;
  setChatDraft(scope: ChatScope, text: string): void;
  clearError(): void;
  setLeaveConfirm(open: boolean): void;
  /** Quem anuncia (leitor de tela). `null` desliga. */
  setAnnouncer(fn: ((message: string) => void) | null): void;
  reset(): void;
}

function isPublicEvent(x: unknown): x is PublicGameEvent {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { type?: unknown }).type;
  return typeof t === 'string' && (PUBLIC_EVENT_TYPES as readonly string[]).includes(t);
}

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === 'string' && (ERROR_CODES as readonly string[]).includes(x);
}

/** A vaza que acabou de fechar (o servidor já limpou `current`), para a tela segurar por um instante. */
export interface ClosedTrick {
  readonly plays: readonly PlayedView[];
  readonly winnerSeat: number;
}

export function lingeringFor(
  prev: TableViewModel | null,
  next: TableViewModel,
  closed: ClosedTrick | null = null,
): LingeringTrick | null {
  if (prev === null || next.current.length > 0) return null;
  const newHand =
    prev.handNumber !== next.handNumber || prev.series.gameNumber !== next.series.gameNumber;
  if (newHand) {
    // O servidor fecha a mão e abre a seguinte no MESMO patch: a vaza final não está em `tricks` nem
    // completa em `prev.current` (falta a última carta). Os eventos cardPlayed/trickDecided a trazem inteira.
    if (closed !== null && closed.plays.length >= prev.current.length && closed.plays.length > 0) {
      return {
        plays: closed.plays,
        winnerSeat: closed.winnerSeat,
        ownCovered: prev.ownCoveredCurrent,
      };
    }
    return prev.current.length > 0
      ? { plays: prev.current, winnerSeat: -1, ownCovered: prev.ownCoveredCurrent }
      : null;
  }
  if (next.tricks.length <= prev.tricks.length) return null;
  const idx = next.tricks.length - 1;
  const t = next.tricks[idx];
  if (t === undefined || t.plays.length === 0) return null;
  const own = next.ownCoveredByTrick.find((c) => c.trick === idx);
  return {
    plays: t.plays,
    winnerSeat: t.winnerSeat,
    ownCovered: own === undefined ? null : { rank: own.rank, suit: own.suit },
  };
}

export function createTableController(opts: TableControllerOptions): TableController {
  const { store } = opts;
  const now = opts.now ?? Date.now;
  const timers: TableTimers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const offset = opts.clockOffset ?? createClockOffset();
  let announce: ((message: string) => void) | null = null;
  let busySignature = '';
  let busyTimer: unknown = null;
  let noticeTimer: unknown = null;
  let presenceTimer: unknown = null;
  let lingerTimer: unknown = null;
  let handNumber = 0;
  let replayUntil = 0;
  let lastSend: 'action' | 'chat' | 'rematch' | 'other' = 'other';
  /** Partida (`matchNumber`) para a qual já enviei `voteRematch`: barra o duplo clique antes do estado refletir. */
  let rematchSentFor = 0;
  /** "Nova partida começou." já foi dita pelo evento `gameStarted` (que chega antes do patch de estado). */
  let matchAnnounced = false;
  /** Cartas da vaza em curso, montadas dos eventos; e a última vaza fechada (para a retenção). */
  let trickPlays: PlayedView[] = [];
  let closedTrick: ClosedTrick | null = null;
  let chatId = 0;
  const bubbleTimers = new Map<number, unknown>();
  let signalKey = 0;
  /** Fila de 1 posição por assento (sinal recebido durante a animação). */
  const queuedSignals = new Map<number, SignalId>();
  const signalTimers = new Map<number, unknown>();

  function clearSignals(): void {
    for (const h of signalTimers.values()) timers.clearTimeout(h);
    signalTimers.clear();
    queuedSignals.clear();
  }

  function startSignal(seat: number, id: SignalId): void {
    const prev = signalTimers.get(seat);
    if (prev !== undefined) timers.clearTimeout(prev);
    signalTimers.set(
      seat,
      timers.setTimeout(() => endSignal(seat), SIGNAL_SAFETY_MS),
    );
    const cur = store.getState();
    cur.patch({ signals: { ...cur.signals, [seat]: { id, key: ++signalKey } } });
  }

  function seatName(seat: number): string {
    const vm = store.getState().vm;
    if (vm !== null && seat === vm.mySeat) return 'Você';
    const n = vm?.seats[seat]?.nickname;
    return n !== undefined && n !== '' ? n : `Jogador ${seat + 1}`;
  }

  function endSignal(seat: number): void {
    const t = signalTimers.get(seat);
    if (t !== undefined) timers.clearTimeout(t);
    signalTimers.delete(seat);
    const next = queuedSignals.get(seat);
    queuedSignals.delete(seat);
    if (next !== undefined) {
      startSignal(seat, next);
      return;
    }
    const cur = store.getState();
    if (cur.signals[seat] === undefined) return;
    const rest = { ...cur.signals };
    delete rest[seat];
    cur.patch({ signals: rest });
  }

  const clear = (h: unknown): void => {
    if (h !== null) timers.clearTimeout(h);
  };
  const unlock = (): void => {
    clear(busyTimer);
    busyTimer = null;
    if (store.getState().busy) store.getState().patch({ busy: false });
  };

  function say(text: string): void {
    announce?.(text);
  }

  function applyState(roomState: unknown): void {
    const vm = projectTable(roomState);
    const cur = store.getState();
    const selected =
      cur.selected !== null && (vm.legalActions as readonly string[]).includes(cur.selected)
        ? cur.selected
        : null;
    // Revanche iniciada (ou reconexão numa partida nova): `matchNumber` mudou. Não é resync (seq segue).
    const newMatch = cur.vm !== null && vm.matchNumber !== cur.vm.matchNumber;
    if (newMatch) {
      clear(busyTimer);
      clear(lingerTimer);
      busyTimer = lingerTimer = null;
      for (const h of bubbleTimers.values()) timers.clearTimeout(h);
      bubbleTimers.clear();
      clearSignals();
      trickPlays = [];
      closedTrick = null;
      if (!matchAnnounced) say('Nova partida começou.');
      matchAnnounced = false;
    } else if (cur.vm !== null) {
      // O servidor poda o voto de quem reconectou: o voto local deixa de valer.
      if (cur.vm.iVotedRematch && !vm.iVotedRematch) rematchSentFor = 0;
      for (const seat of vm.rematchVotes) {
        if (cur.vm.rematchVotes.includes(seat) || seat === vm.mySeat) continue;
        const nick = vm.seats[seat]?.nickname ?? '';
        say(`${nick === '' ? 'Um jogador' : nick} quer jogar de novo.`);
      }
    }
    // Um RATE_LIMITED sobrando da última jogada não deve aparecer na tela final.
    const enteredFinished =
      cur.vm !== null && cur.vm.phase !== 'finished' && vm.phase === 'finished';
    const release = !newMatch && cur.busy && actionSignature(vm) !== busySignature;
    if (release) {
      clear(busyTimer);
      busyTimer = null;
    }
    const canCover = vm.legalActions.some((id) => parseLegalAction(id)?.kind === 'playCovered');
    const ling = newMatch ? null : lingeringFor(cur.vm, vm, closedTrick);
    if (ling !== null) {
      clear(lingerTimer);
      lingerTimer = timers.setTimeout(() => {
        lingerTimer = null;
        store.getState().patch({ lingering: null });
      }, LINGER_MS);
    }
    // Um único `set` por patch do servidor.
    cur.patch({
      vm,
      selected,
      ...(enteredFinished ? { errorCode: null } : {}),
      ...(newMatch
        ? {
            history: [],
            handLog: [],
            lingering: null,
            bubbles: {},
            signals: {},
            busy: false,
            coverMode: false,
            errorCode: null,
            selected: null,
          }
        : {}),
      ...(release ? { busy: false } : {}),
      ...(cur.coverMode && !canCover ? { coverMode: false } : {}),
      ...(ling !== null ? { lingering: ling } : {}),
    });
  }

  function handResultOf(e: Extract<PublicGameEvent, { type: 'handDecided' }>): HandResult {
    return {
      handNumber: handNumber > 0 ? handNumber : (store.getState().vm?.handNumber ?? 0),
      winnerTeam: e.winnerTeam,
      points: e.points,
      reason: e.reason,
      scores: e.scores,
    };
  }

  function act(actionId: string): boolean {
    const s = store.getState();
    const vm = s.vm;
    if (s.busy || vm === null) return false;
    // Nenhuma ação sai se não estiver em `legalActions` do snapshot atual.
    if (!(vm.legalActions as readonly string[]).includes(actionId)) return false;
    const msg = messageForAction(actionId);
    if (msg === null) return false;
    if (!opts.send(msg)) return false;
    lastSend = 'action';
    busySignature = actionSignature(vm);
    s.patch({ busy: true, selected: null, errorCode: null, coverMode: false });
    clear(busyTimer);
    busyTimer = timers.setTimeout(unlock, BUSY_TIMEOUT_MS);
    return true;
  }

  function sendParsed(message: unknown): boolean {
    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      store.getState().patch({ chatError: parsed.code });
      return false;
    }
    if (!opts.send(parsed.message)) return false;
    lastSend = 'chat';
    return true;
  }

  return {
    applyState,
    act,

    onEvent(env) {
      const clientNow = now();
      const cur = store.getState();
      // Replay logo depois de reconectar: evento velho NÃO mede relógio nem é falado de novo.
      const age = clientNow + offset.get() - env.at;
      const replay = clientNow < replayUntil && env.at > 0 && age > REPLAY_MIN_AGE_MS;
      const patch: MutablePatch = {};
      if (!replay) patch.clockOffsetMs = offset.add(env.at, clientNow);
      const e = env.event;
      if (isPublicEvent(e)) {
        if (e.type === 'handStarted') {
          handNumber = e.handNumber;
          patch.handLog = [];
        }
        if (e.type === 'gameStarted') {
          patch.history = [];
          // Revanche: o evento pode chegar antes do patch com o novo `matchNumber`. Série decidida + novo
          // jogo = nova partida; fala antes de "Jogo 1 começou" e o patch não repete.
          if (
            !replay &&
            cur.vm !== null &&
            cur.vm.phase === 'finished' &&
            cur.vm.series.winnerTeam >= 0
          ) {
            matchAnnounced = true;
            say('Nova partida começou.');
          }
        }
        if (e.type === 'handStarted') {
          trickPlays = [];
          closedTrick = null;
        }
        if (e.type === 'cardPlayed') {
          if (trickPlays.length === 0) closedTrick = null;
          trickPlays = [
            ...trickPlays.filter((x) => x.seat !== e.seat),
            {
              seat: e.seat,
              rank: e.card?.rank ?? '',
              suit: e.card?.suit ?? '',
              covered: e.covered,
            },
          ];
        }
        if (e.type === 'trickDecided') {
          closedTrick = { plays: trickPlays, winnerSeat: e.winnerSeat ?? -1 };
          trickPlays = [];
          // O patch pode ter chegado antes do evento: completa a vaza já retida.
          if (cur.lingering !== null && closedTrick.plays.length >= cur.lingering.plays.length) {
            patch.lingering = {
              ...cur.lingering,
              plays: closedTrick.plays,
              winnerSeat: closedTrick.winnerSeat,
            };
          }
        }
        const vm = cur.vm;
        let text: string | null = null;
        try {
          text = announcementFor(e, {
            mySeat: vm?.mySeat ?? -1,
            nicknameOf: (seat) => {
              const n = vm?.seats[seat]?.nickname;
              return n === undefined || n === '' ? undefined : n;
            },
            ...(vm !== undefined && vm !== null ? { variant: vm.variant } : {}),
          });
        } catch {
          // Evento malformado: o estado (fonte de verdade) segue valendo.
        }
        if (e.type === 'handDecided') {
          const result: HandResult = { ...handResultOf(e), details: cur.handLog };
          patch.history = [
            ...(patch.history ?? cur.history).filter((h) => h.handNumber !== result.handNumber),
            result,
          ].slice(-MAX_HISTORY);
          patch.handLog = [];
        } else if (text !== null && !NO_LOG_EVENTS.includes(e.type)) {
          patch.handLog = [...(patch.handLog ?? cur.handLog), text].slice(-MAX_HAND_LOG);
        }
        if (text !== null && !replay) say(text);
      }
      cur.patch(patch);
    },

    onDesync() {
      handNumber = 0;
      store.getState().patch({ history: [], handLog: [] });
    },

    onChat(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const m = payload as Record<string, unknown>;
      const scope = m['scope'];
      const seat = m['seat'];
      if (scope !== 'table' && scope !== 'partner') return;
      if (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat > 3) return;
      let text: string | null = null;
      if (typeof m['text'] === 'string') text = m['text'].slice(0, MAX_CHAT_TEXT);
      else if (typeof m['phraseId'] === 'string') {
        text = QUICK_PHRASES.find((q) => q.id === m['phraseId'])?.label ?? null;
      }
      if (text === null || text === '') return;
      const cur = store.getState();
      // Segunda barreira: o servidor só entrega o chat da dupla à dupla; aqui também se confere.
      if (scope === 'partner' && (cur.vm === null || seat % 2 !== cur.vm.myTeam)) return;
      const entry: ChatEntry = {
        id: ++chatId,
        scope,
        seat,
        text,
        at: typeof m['at'] === 'number' ? m['at'] : 0,
      };
      const seen = cur.chatOpen && cur.chatTab === scope;
      // Balão: um por assento; o novo substitui o anterior e reinicia os 4 s.
      const prevTimer = bubbleTimers.get(seat);
      if (prevTimer !== undefined) timers.clearTimeout(prevTimer);
      bubbleTimers.set(
        seat,
        timers.setTimeout(() => {
          bubbleTimers.delete(seat);
          const rest = { ...store.getState().bubbles };
          delete rest[seat];
          store.getState().patch({ bubbles: rest });
        }, BUBBLE_MS),
      );
      cur.patch({
        bubbles: { ...cur.bubbles, [seat]: { id: entry.id, scope, text } },
        chat: [...cur.chat, entry].slice(-MAX_CHAT),
        chatUnread: seen
          ? cur.chatUnread
          : { ...cur.chatUnread, [scope]: cur.chatUnread[scope] + 1 },
      });
    },

    onPresence(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const { seat, status } = payload as { seat?: unknown; status?: unknown };
      if (typeof seat !== 'number' || !isPresenceStatus(status)) return;
      const vm = store.getState().vm;
      const player = vm?.seats[seat];
      if (vm === null || player === undefined) return;
      const text = presenceText(player.nickname, seat === vm.mySeat, status);
      say(text);
      clear(presenceTimer);
      store.getState().patch({ presenceNote: text });
      presenceTimer = timers.setTimeout(() => {
        presenceTimer = null;
        store.getState().patch({ presenceNote: null });
      }, PRESENCE_NOTE_MS);
    },

    onTurnTimer(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const { seat, deadlineAt } = payload as { seat?: unknown; deadlineAt?: unknown };
      if (typeof seat !== 'number' || typeof deadlineAt !== 'number') return;
      store.getState().patch({ timer: { seat, deadlineAt } });
    },

    onServerError(payload) {
      const raw = (payload as { code?: unknown } | null)?.code;
      const code = isErrorCode(raw) ? raw : 'UNKNOWN';
      const ambiguous = AMBIGUOUS_ERRORS.includes(code);
      // Voto recusado: a janela pode estar errada para mim; permite tentar de novo se o estado reabrir.
      if (code === 'REMATCH_NOT_AVAILABLE' || lastSend === 'rematch') rematchSentFor = 0;
      if (code === 'CHAT_BLOCKED' || (ambiguous && lastSend === 'chat')) {
        store.getState().patch({ chatError: code });
        return;
      }
      // O erro não traz correlação: só destrava o botão em voo se o ÚLTIMO envio foi uma ação de jogo
      // (erro vindo de voteCancel ou de chat não é da jogada em voo) e o código é de ação.
      if (lastSend === 'action' && (ACTION_ERRORS.includes(code) || ambiguous)) unlock();
      store.getState().patch({ errorCode: code, selected: null });
    },

    onSignal(payload) {
      if (typeof payload !== 'object' || payload === null) return;
      const { seat, signalId } = payload as { seat?: unknown; signalId?: unknown };
      if (typeof seat !== 'number' || !Number.isInteger(seat) || seat < 0 || seat > 3) return;
      if (typeof signalId !== 'string' || !(SIGNAL_IDS as readonly string[]).includes(signalId)) {
        return;
      }
      const id = signalId as SignalId;
      say(`${seatName(seat)}: ${signalInfo(id).name}`);
      if (store.getState().signals[seat] === undefined) {
        startSignal(seat, id);
        return;
      }
      // Animando: 1 na fila; se a fila já tem um, este é descartado.
      if (!queuedSignals.has(seat)) queuedSignals.set(seat, id);
    },

    onSignalEnd(seat, key) {
      if (store.getState().signals[seat]?.key !== key) return;
      endSignal(seat);
    },

    sendSignal(signalId) {
      const parsed = parseClientMessage({ type: 'signal', signalId });
      if (!parsed.ok) return false;
      if (!opts.send(parsed.message)) return false;
      lastSend = 'other';
      return true;
    },

    onReconnected() {
      clear(noticeTimer);
      replayUntil = now() + REPLAY_WINDOW_MS;
      // O servidor poda o voto de quem caiu: o próximo estado diz se ainda vale; até lá permite reenviar.
      rematchSentFor = 0;
      unlock();
      store.getState().patch({ notice: 'reconnected' });
      noticeTimer = timers.setTimeout(() => {
        noticeTimer = null;
        store.getState().patch({ notice: null });
      }, NOTICE_MS);
    },

    pressCard(actionId) {
      const s = store.getState();
      if (s.busy || s.vm === null) return;
      if (!(s.vm.legalActions as readonly string[]).includes(actionId)) return;
      if (s.selected === actionId) {
        act(actionId);
        return;
      }
      s.patch({ selected: actionId, errorCode: null });
    },

    setCoverMode(on) {
      const s = store.getState();
      const can = s.vm?.legalActions.some((id) => parseLegalAction(id)?.kind === 'playCovered');
      if (on && can !== true) return;
      s.patch({ coverMode: on, selected: null });
    },

    voteCancel() {
      const vm = store.getState().vm;
      if (vm === null || vm.phase !== 'playing' || vm.iVotedCancel) return false;
      if (!opts.send({ type: 'voteCancel' })) return false;
      lastSend = 'other';
      return true;
    },

    voteRematch() {
      const vm = store.getState().vm;
      // Só com a janela aberta publicada pelo servidor (servidor antigo nunca publica prazo > 0).
      if (vm === null || !vm.rematchOpen || vm.iVotedRematch || vm.mySeat < 0) return false;
      if (rematchSentFor === vm.matchNumber) return false;
      if (!opts.send({ type: 'voteRematch' })) return false;
      rematchSentFor = vm.matchNumber;
      store.getState().patch({ errorCode: null });
      lastSend = 'rematch';
      return true;
    },

    sendChat(scope, text) {
      if (!sendParsed({ type: 'chat', scope, text })) return false;
      const s = store.getState();
      s.patch({ chatError: null, chatDraft: { ...s.chatDraft, [scope]: '' } });
      return true;
    },

    sendPhrase(scope, phraseId) {
      if (!sendParsed({ type: 'chat', scope, phraseId })) return false;
      store.getState().patch({ chatError: null });
      return true;
    },

    setChatOpen(open) {
      const s = store.getState();
      s.patch({
        chatOpen: open,
        chatError: null,
        ...(open ? { chatUnread: { ...s.chatUnread, [s.chatTab]: 0 } } : {}),
      });
    },

    setChatTab(scope) {
      const s = store.getState();
      s.patch({ chatTab: scope, chatError: null, chatUnread: { ...s.chatUnread, [scope]: 0 } });
    },

    setChatDraft(scope, text) {
      const s = store.getState();
      s.patch({ chatDraft: { ...s.chatDraft, [scope]: text } });
    },

    clearError() {
      if (store.getState().errorCode !== null) store.getState().patch({ errorCode: null });
    },

    setLeaveConfirm(open) {
      store.getState().patch({ leaveConfirm: open });
    },

    setAnnouncer(fn) {
      announce = fn;
    },

    reset() {
      clear(busyTimer);
      clear(noticeTimer);
      clear(presenceTimer);
      clear(lingerTimer);
      busyTimer = noticeTimer = presenceTimer = lingerTimer = null;
      for (const h of bubbleTimers.values()) timers.clearTimeout(h);
      bubbleTimers.clear();
      clearSignals();
      busySignature = '';
      handNumber = 0;
      replayUntil = 0;
      lastSend = 'other';
      rematchSentFor = 0;
      trickPlays = [];
      closedTrick = null;
      matchAnnounced = false;
      offset.reset();
      store.getState().reset();
    },
  };
}
