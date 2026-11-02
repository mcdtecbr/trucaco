import type { PublicGameEvent } from '@trucaco/protocol';
import { betCry } from '@trucaco/protocol';
import { cardName, parseFace } from './cardInfo';
import { defaultTeamNames, pointsText, specialText } from './score';

export interface AnnounceContext {
  readonly mySeat: number;
  /** Apelido por assento; falta = "Jogador N". */
  readonly nicknameOf: (seat: number) => string | undefined;
  /** Nomes por dupla (índice = dupla). Padrão "Nós"/"Eles" da perspectiva de `mySeat`. */
  readonly teamNames?: readonly [string, string];
  readonly variant?: string;
}

function who(seat: number, ctx: AnnounceContext): string {
  if (seat === ctx.mySeat) return 'Você';
  return ctx.nicknameOf(seat) ?? `Jogador ${seat + 1}`;
}

function team(t: number, ctx: AnnounceContext): string {
  const names = ctx.teamNames ?? defaultTeamNames(ctx.mySeat % 2);
  return names[t === 1 ? 1 : 0];
}

function cry(value: number): string {
  const c = betCry(value);
  return c ?? `${value}`;
}

function score(scores: readonly [number, number], ctx: AnnounceContext): string {
  return `${team(0, ctx)} ${scores[0]}, ${team(1, ctx)} ${scores[1]}`;
}

function assertNever(x: never): never {
  throw new Error(`Evento público desconhecido: ${JSON.stringify(x)}`);
}

/**
 * Frase pt-BR para o leitor de tela a partir de um evento público do servidor. Exaustiva por tipo
 * (o `never` abaixo quebra o typecheck se o protocolo ganhar um evento novo).
 */
export function announcementFor(event: PublicGameEvent, ctx: AnnounceContext): string {
  switch (event.type) {
    case 'gameStarted':
      return `Jogo ${event.gameNumber} começou.`;
    case 'handStarted': {
      const sp = specialText(event.special, ctx.variant);
      return `Mão ${event.handNumber} começou${sp !== null ? `: ${sp}` : ''}. Placar: ${score(event.scores, ctx)}.`;
    }
    case 'cardPlayed': {
      const face = event.card === null ? null : parseFace(event.card);
      if (event.covered && face === null) return `${who(event.seat, ctx)} jogou uma carta coberta.`;
      const name = face === null ? 'uma carta' : cardName(face.rank, face.suit);
      return `${who(event.seat, ctx)} jogou ${name}${event.blind ? ' às cegas' : ''}.`;
    }
    case 'trickDecided':
      return event.winnerSeat === null
        ? `Vaza ${event.index + 1} empatada.`
        : `Vaza ${event.index + 1}: ${who(event.winnerSeat, ctx)} levou.`;
    case 'betCalled':
      return `${who(event.seat, ctx)} pediu ${cry(event.value)}. A mão passa a valer ${event.value} se aceitar.`;
    case 'betAccepted':
      return `${who(event.seat, ctx)} aceitou. A mão vale ${event.value}.`;
    case 'betRaised':
      return `${who(event.seat, ctx)} aumentou para ${cry(event.value)}. A mão passa a valer ${event.value} se aceitar.`;
    case 'betRun':
      return `${who(event.seat, ctx)} correu. ${team(event.winnerTeam, ctx)} ganha ${pointsText(event.points)}.`;
    case 'specialDecided': {
      const sp = specialText('maoDeOnze', ctx.variant)?.toLowerCase() ?? 'mão especial';
      return event.decision === 'play'
        ? `${who(event.seat, ctx)} decidiu jogar a ${sp}.`
        : `${who(event.seat, ctx)} correu da ${sp}.`;
    }
    case 'handDecided':
      return event.winnerTeam === null
        ? `Fim da mão: empate, ninguém pontua. Placar: ${score(event.scores, ctx)}.`
        : `Fim da mão: ${team(event.winnerTeam, ctx)} ganha ${pointsText(event.points)}. Placar: ${score(event.scores, ctx)}.`;
    case 'gameDecided':
      return `Fim de jogo: ${team(event.winnerTeam, ctx)} venceu por ${event.scores[event.winnerTeam]} a ${event.scores[event.winnerTeam === 0 ? 1 : 0]}.`;
    case 'seriesDecided':
      return `Fim da série: ${team(event.winnerTeam, ctx)} venceu por ${event.games[event.winnerTeam]} a ${event.games[event.winnerTeam === 0 ? 1 : 0]}.`;
    case 'seriesCancelled':
      return 'A série foi cancelada.';
    default:
      return assertNever(event);
  }
}

/** Todos os tipos de `PublicGameEvent` (o teste exaustivo itera esta lista). */
export const PUBLIC_EVENT_TYPES = [
  'gameStarted',
  'handStarted',
  'cardPlayed',
  'trickDecided',
  'betCalled',
  'betAccepted',
  'betRaised',
  'betRun',
  'specialDecided',
  'handDecided',
  'gameDecided',
  'seriesDecided',
  'seriesCancelled',
] as const satisfies readonly PublicGameEvent['type'][];

// Garante em tempo de compilação que a lista acima cobre a união inteira.
type Missing = Exclude<PublicGameEvent['type'], (typeof PUBLIC_EVENT_TYPES)[number]>;
const _complete: [Missing] extends [never] ? true : never = true;
void _complete;

// ---------------------------------------------------------------- fila de anúncios

export interface AnnounceTimers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface AnnouncementQueue {
  enqueue(message: string): void;
  dispose(): void;
  /** Mensagens aguardando a vez (para teste). */
  readonly size: number;
}

export interface AnnouncementQueueOptions {
  /** Entrega efetiva (AccessibilityInfo no nativo, região aria-live no web). */
  readonly deliver: (message: string) => void;
  /** Pausa entre anúncios para o leitor terminar de falar. */
  readonly gapMs?: number;
  /** Teto de pendentes: acima disso descarta os mais antigos (o jogo anda mais rápido que a fala). */
  readonly maxPending?: number;
  readonly timers?: AnnounceTimers;
}

export const ANNOUNCE_GAP_MS = 1500;
export const ANNOUNCE_MAX_PENDING = 4;

/**
 * Fila para não atropelar o leitor: o primeiro anúncio sai na hora, os seguintes esperam `gapMs`.
 * Repetição imediata da mesma frase é ignorada; estourou `maxPending`, descarta os mais antigos.
 */
export function createAnnouncementQueue(opts: AnnouncementQueueOptions): AnnouncementQueue {
  const gap = opts.gapMs ?? ANNOUNCE_GAP_MS;
  const max = opts.maxPending ?? ANNOUNCE_MAX_PENDING;
  const timers: AnnounceTimers = opts.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const pending: string[] = [];
  let handle: unknown = null;
  let busy = false;
  let last: string | null = null;
  let disposed = false;

  const next = (): void => {
    handle = null;
    const msg = pending.shift();
    if (msg === undefined) {
      busy = false;
      last = null;
      return;
    }
    opts.deliver(msg);
    handle = timers.setTimeout(next, gap);
  };

  return {
    enqueue(message) {
      if (disposed || message === '') return;
      const tail = pending.length > 0 ? pending[pending.length - 1] : last;
      if (tail === message) return;
      last = message;
      pending.push(message);
      while (pending.length > max) pending.shift();
      if (!busy) {
        busy = true;
        next();
      }
    },
    dispose() {
      disposed = true;
      pending.length = 0;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      busy = false;
    },
    get size() {
      return pending.length;
    },
  };
}
