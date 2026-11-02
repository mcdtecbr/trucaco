/**
 * Projeção mínima da sala de espera (apelidos, status, fase). NÃO guarda regra de jogo nem cartas: a mesa
 * jogável (3H) terá a própria projeção. A fonte de verdade continua sendo `room.state`.
 */
import { isValidRoomCode } from '@trucaco/protocol';
import { createStore, useStore } from 'zustand';

export type RoomConnection = 'none' | 'joining' | 'connected' | 'reconnecting' | 'closed';

export interface LobbySeat {
  readonly seat: number;
  readonly nickname: string;
  /** `empty` | `connected` | `away` | `bot`. */
  readonly status: string;
  readonly isBot: boolean;
}

export interface RoomStoreState {
  readonly connection: RoomConnection;
  readonly roomCode: string;
  /** `waiting` | `playing` | `finished` ou `''` antes do primeiro estado. */
  readonly tablePhase: string;
  readonly seats: readonly LobbySeat[];
  /** -1 enquanto o bloco privado não chegou. */
  readonly mySeat: number;
  /** Código de erro de `i18n/errors` quando a conexão terminou mal. */
  readonly errorCode: string | null;
  patch(p: Partial<Omit<RoomStoreState, 'patch' | 'reset'>>): void;
  reset(): void;
}

const INITIAL = {
  connection: 'none' as RoomConnection,
  roomCode: '',
  tablePhase: '',
  seats: [] as readonly LobbySeat[],
  mySeat: -1,
  errorCode: null as string | null,
};

export function createRoomStore() {
  return createStore<RoomStoreState>()((set) => ({
    ...INITIAL,
    patch: (p) => set(p),
    reset: () => set({ ...INITIAL }),
  }));
}

export type RoomStore = ReturnType<typeof createRoomStore>;
export const roomStore: RoomStore = createRoomStore();

export function useRoomStore<T>(selector: (s: RoomStoreState) => T): T {
  return useStore(roomStore, selector);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export interface WaitingProjection {
  readonly roomCode: string;
  readonly tablePhase: string;
  readonly seats: readonly LobbySeat[];
  readonly mySeat: number;
}

/**
 * Lê só o que a sala de espera usa de um `room.state.toJSON()`. Tolerante a campos ausentes (estado
 * parcial no começo): nunca lança.
 */
export function projectWaiting(json: unknown): WaitingProjection {
  if (!isRecord(json)) return { roomCode: '', tablePhase: '', seats: [], mySeat: -1 };
  const players = Array.isArray(json['players']) ? json['players'] : [];
  const seats: LobbySeat[] = [];
  for (const p of players) {
    if (!isRecord(p)) continue;
    const seat = p['seat'];
    if (typeof seat !== 'number') continue;
    seats.push({
      seat,
      nickname: typeof p['nickname'] === 'string' ? p['nickname'] : '',
      status: typeof p['status'] === 'string' ? p['status'] : 'empty',
      isBot: p['isBot'] === true,
    });
  }
  seats.sort((a, b) => a.seat - b.seat);
  // `privates` chega filtrado pela StateView: só o bloco do próprio assento.
  let mySeat = -1;
  const privates = json['privates'];
  if (isRecord(privates)) {
    for (const v of Object.values(privates)) {
      if (isRecord(v) && typeof v['seat'] === 'number') {
        mySeat = v['seat'];
        break;
      }
    }
  }
  return {
    // Código inválido (adulterado ou de servidor diferente) vira '': nunca vai para uma rota.
    roomCode: isValidRoomCode(json['roomCode']) ? json['roomCode'] : '',
    tablePhase: typeof json['phase'] === 'string' ? json['phase'] : '',
    seats,
    mySeat,
  };
}
