/**
 * Contadores e medidores leves, em memória do processo (sem dependência). Alimentam `GET /metrics`
 * (`http/observability.ts`). Regra: nada de PII. Só contagens agregadas; nunca `userId`, apelido, código de
 * sala, `roomId`, carta nem texto. Reinicia com o processo (uma instância só, como o resto do estado).
 */
import { PROTOCOL_VERSION } from '@trucaco/protocol';

export type CounterName =
  | 'reconnections'
  | 'matchesSaved'
  | 'matchesSaveFailed'
  | 'progressionApplied'
  | 'progressionDuplicate'
  | 'progressionInvalid'
  | 'progressionNotScored'
  | 'progressionFailed';

/** Foto de uma sala, devolvida pela sonda que ela registra. Sem identificadores. */
export interface RoomProbe {
  readonly visibility: 'private' | 'public';
  /** Assentos com dono (conectado, na janela de reconexão ou com bot de ausência). */
  readonly seatsOccupied: number;
  /** Humanos com socket vivo. */
  readonly playersConnected: number;
}

/** Teto de códigos de erro distintos contados (defesa contra cardinalidade ilimitada). */
export const MAX_ERROR_CODES = 64;
const ERROR_CODE_SHAPE = /^[A-Z][A-Z0-9_]{0,39}$/;
export const OTHER_ERROR_CODE = 'OTHER';

export class Metrics {
  readonly startedAt: number;
  private readonly counters = new Map<CounterName, number>();
  private readonly httpErrors = new Map<string, number>();
  private readonly probes = new Map<string, () => RoomProbe>();

  constructor(private readonly clock: () => number = Date.now) {
    this.startedAt = clock();
  }

  inc(name: CounterName, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  /** Conta uma resposta HTTP de erro pelo `error.code` estável. Forma inesperada ou excesso viram `OTHER`. */
  httpError(code: string): void {
    let key = ERROR_CODE_SHAPE.test(code) ? code : OTHER_ERROR_CODE;
    if (!this.httpErrors.has(key) && this.httpErrors.size >= MAX_ERROR_CODES) {
      key = OTHER_ERROR_CODE;
    }
    this.httpErrors.set(key, (this.httpErrors.get(key) ?? 0) + 1);
  }

  /** Registra uma sala viva; devolve a função que a remove (chamar no `onDispose`). */
  registerRoom(id: string, probe: () => RoomProbe): () => void {
    this.probes.set(id, probe);
    return () => {
      this.probes.delete(id);
    };
  }

  count(name: CounterName): number {
    return this.counters.get(name) ?? 0;
  }

  snapshot(lobby: {
    queued: number;
    tables: number;
    users: number;
    byTableSize: Readonly<Record<string, number>>;
  }): MetricsSnapshot {
    let privateRooms = 0;
    let publicRooms = 0;
    let seatsOccupied = 0;
    let playersConnected = 0;
    for (const probe of this.probes.values()) {
      const p = probe();
      if (p.visibility === 'private') privateRooms++;
      else publicRooms++;
      seatsOccupied += p.seatsOccupied;
      playersConnected += p.playersConnected;
    }
    const sortedErrors = Object.fromEntries(
      [...this.httpErrors.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    return {
      protocolVersion: PROTOCOL_VERSION,
      uptimeSeconds: Math.floor((this.clock() - this.startedAt) / 1000),
      rooms: {
        active: privateRooms + publicRooms,
        private: privateRooms,
        public: publicRooms,
        seatsOccupied,
        playersConnected,
      },
      queue: { queued: lobby.queued, byTableSize: lobby.byTableSize },
      lobby: { tables: lobby.tables, boundUsers: lobby.users },
      reconnections: this.count('reconnections'),
      httpErrorsByCode: sortedErrors,
      matches: {
        saved: this.count('matchesSaved'),
        saveFailed: this.count('matchesSaveFailed'),
      },
      progression: {
        applied: this.count('progressionApplied'),
        duplicate: this.count('progressionDuplicate'),
        invalid: this.count('progressionInvalid'),
        notScored: this.count('progressionNotScored'),
        failed: this.count('progressionFailed'),
      },
    };
  }
}

export interface MetricsSnapshot {
  readonly protocolVersion: number;
  readonly uptimeSeconds: number;
  readonly rooms: {
    readonly active: number;
    readonly private: number;
    readonly public: number;
    readonly seatsOccupied: number;
    readonly playersConnected: number;
  };
  readonly queue: {
    readonly queued: number;
    readonly byTableSize: Readonly<Record<string, number>>;
  };
  readonly lobby: { readonly tables: number; readonly boundUsers: number };
  readonly reconnections: number;
  readonly httpErrorsByCode: Readonly<Record<string, number>>;
  readonly matches: { readonly saved: number; readonly saveFailed: number };
  readonly progression: {
    readonly applied: number;
    readonly duplicate: number;
    readonly invalid: number;
    readonly notScored: number;
    readonly failed: number;
  };
}

/** Instância do processo (um servidor por processo, como o lobby). */
export const metrics = new Metrics();
