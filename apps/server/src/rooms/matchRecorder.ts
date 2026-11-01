/**
 * Registro da partida para `matches`/`match_players` (bloco 2H).
 *
 * Só eventos do MOTOR em visão pública entram aqui (`publicEvent`): chat, sinais e sfx nunca passam por este
 * módulo. Buffer próprio e INDEPENDENTE do `eventLog` de replay da sala (que descarta os antigos pelo teto):
 * guarda os primeiros eventos até um teto de contagem e de bytes e, se estourar, marca o log como truncado
 * (`logTruncated` e `eventsDropped` em `options`); a gravação acontece uma vez, no fim (idempotente).
 *
 * Tamanho real de uma bo3 (cálculo): um jogo termina em no máximo 23 mãos (11x11 e mais uma); bo3 = 3 jogos =
 * 69 mãos. Uma mão tem no máximo ~26 eventos (início, 12 cartas, 3 vazas, 8 de aposta, fim). Logo
 * <= ~1800 eventos, ~150 B cada = ~270 KB, bem abaixo do CHECK de 2 MiB de `events`. Medido (300 sementes de
 * bo3 só com bots, sem apostas): máximo de 883 eventos e 112 KB. Teto aqui: 6000 eventos
 * e 1,5 MB (3x de folga na contagem; na prática o limite de bytes é o que vale se algo explodir).
 */
import type { PublicGameEvent } from '@trucaco/rules';
import { log } from '../logger';
import { InvalidInputError, PersistenceError } from '../db/types';
import type {
  FinishedMatchInput,
  JsonObject,
  JsonValue,
  MatchEventLogEntry,
  MatchPlayerRecord,
  MatchRepository,
} from '../db/types';
import type { RoomOptions } from '@trucaco/protocol';

export const MATCH_EVENTS_MAX = 6000;
/** Orçamento de bytes do JSON de `events` (o CHECK do banco recusa >= 2 MiB). */
export const MATCH_EVENTS_MAX_BYTES = 1_500_000;
export const MATCH_DEALS_MAX = 200;
export const PERSIST_ATTEMPTS = 3;
export const PERSIST_RETRY_MS = 250;
/** Espera máxima do `onDispose` pela gravação em andamento (nunca trava o fechamento da sala). */
export const DISPOSE_FLUSH_MS = 3000;

export type EndReason = 'finished' | 'cancelled' | 'abandoned';

export interface RecordedEvent {
  readonly seq: number;
  readonly at: number;
  readonly event: PublicGameEvent;
}

export interface RecorderInit {
  readonly options: RoomOptions;
  readonly roomCode: string;
  readonly seed: number;
  readonly startedAt: Date;
}

export interface BuildArgs {
  readonly status: 'finished' | 'cancelled';
  readonly winnerTeam: 0 | 1 | null;
  readonly endReason: EndReason;
  readonly endedAt: Date;
  /** assento -> userId (humanos). Assento ausente = bot desde o início. */
  readonly users: ReadonlyMap<number, string>;
}

export class MatchRecorder {
  private readonly events: MatchEventLogEntry[] = [];
  private readonly deals: JsonValue[] = [];
  private readonly games: JsonValue[] = [];
  private readonly botFrom = new Map<number, number>();
  private bytes = 2;
  private dropped = 0;
  private gameCount = 0;
  private finalized = false;
  private saving: Promise<boolean> | null = null;

  constructor(private readonly init: RecorderInit) {}

  get isFinalized(): boolean {
    return this.finalized;
  }

  get eventCount(): number {
    return this.events.length;
  }

  get truncated(): boolean {
    return this.dropped > 0;
  }

  /** Um evento do motor, em visão pública. Estourou o teto: conta e descarta (não derruba nada). */
  addEvent(e: RecordedEvent): void {
    if (this.finalized) return;
    const entry: MatchEventLogEntry = {
      seq: e.seq,
      at: e.at,
      event: e.event as unknown as JsonValue,
    };
    const size = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
    if (this.events.length >= MATCH_EVENTS_MAX || this.bytes + size > MATCH_EVENTS_MAX_BYTES) {
      this.dropped++;
    } else {
      this.events.push(entry);
      this.bytes += size;
    }
    const ev = e.event;
    if (ev.type === 'gameDecided') {
      this.gameCount++;
      this.games.push({ game: this.gameCount, winnerTeam: ev.winnerTeam, scores: [...ev.scores] });
    }
  }

  /** Cartas de todos no início da mão. SÓ auditoria (`deals`): nunca sai por REST nem para o cliente. */
  addDeal(deal: JsonValue): void {
    if (!this.finalized && this.deals.length < MATCH_DEALS_MAX) this.deals.push(deal);
  }

  /** O bot assumiu o assento no `seq` dado (a primeira vez vale: o dono esteve ausente). */
  noteBot(seat: number, seq: number): void {
    if (!this.botFrom.has(seat)) this.botFrom.set(seat, seq);
  }

  /** Monta o registro e fecha o recorder (nenhum evento depois). Idempotente: só a 1ª chamada devolve. */
  finalize(args: BuildArgs): FinishedMatchInput | null {
    if (this.finalized) return null;
    this.finalized = true;
    const options: JsonObject = {
      ...this.init.options,
      endReason: args.endReason,
      ...(this.dropped > 0 ? { logTruncated: true, eventsDropped: this.dropped } : {}),
    };
    const players: MatchPlayerRecord[] = [];
    for (let seat = 0; seat < 4; seat++) {
      const userId = args.users.get(seat) ?? null;
      players.push({
        seat,
        userId,
        team: (seat % 2) as 0 | 1,
        botFrom: this.botFrom.get(seat) ?? null,
      });
    }
    return {
      variant: this.init.options.variant,
      format: this.init.options.format,
      ironHand: this.init.options.ironHand,
      visibility: this.init.options.visibility,
      roomCode: this.init.roomCode,
      seed: this.init.seed,
      options,
      events: this.events,
      deals: this.deals,
      winnerTeam: args.winnerTeam,
      games: this.games,
      status: args.status,
      startedAt: this.init.startedAt,
      endedAt:
        args.endedAt.getTime() < this.init.startedAt.getTime() ? this.init.startedAt : args.endedAt,
      players,
    };
  }

  /**
   * Grava com tentativas limitadas. NUNCA lança: falha vira `false` e log sem PII (só nome do erro e código
   * Prisma/constraint). Idempotente: chamar duas vezes devolve a mesma promessa.
   */
  save(repo: MatchRepository, input: FinishedMatchInput, roomId: string): Promise<boolean> {
    this.saving ??= persistWithRetry(repo, input, roomId);
    return this.saving;
  }

  /** Promessa da gravação em curso (ou `null` se nunca começou). */
  get pending(): Promise<boolean> | null {
    return this.saving;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });

export async function persistWithRetry(
  repo: MatchRepository,
  input: FinishedMatchInput,
  roomId: string,
  attempts: number = PERSIST_ATTEMPTS,
  retryMs: number = PERSIST_RETRY_MS,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await repo.saveMatch(input);
      log.info('truco: partida gravada', { room: roomId, status: input.status });
      return true;
    } catch (err) {
      // Só nome e código (o erro bruto do Prisma pode carregar a linha inteira, inclusive `deals`).
      const name = err instanceof Error ? err.name : 'unknown';
      const code = err instanceof PersistenceError ? err.code : null;
      const constraint = err instanceof PersistenceError ? err.constraint : null;
      // Entrada que o banco recusaria não melhora com nova tentativa.
      const final = attempt === attempts || err instanceof InvalidInputError;
      log.error('truco: falha ao gravar partida', {
        room: roomId,
        attempt,
        name,
        code,
        constraint,
      });
      if (final) return false;
      await sleep(retryMs * attempt);
    }
  }
  return false;
}

/** Espera até `ms` pela gravação, sem nunca lançar. */
export async function flushWithin(pending: Promise<boolean> | null, ms: number): Promise<void> {
  if (pending === null) return;
  await Promise.race([pending.catch(() => false), sleep(ms)]);
}
