/**
 * Composição do app (singleton por processo): sessão, cliente Colyseus, serviço de sala e stores.
 * Nada aqui roda no import: `getApp()` monta tudo na primeira chamada (as telas chamam em efeitos).
 */
import type { SeatReservation } from '@trucaco/protocol';
import { createGameClient } from '../net/colyseus';
import type { GameClient } from '../net/colyseus';
import { createSession } from '../net/session';
import type { Session } from '../net/session';
import { createTokenStorage } from '../net/tokenStorage';
import { createRoomService } from '../room/roomService';
import type { RoomClientLike, RoomLike, RoomService } from '../room/roomService';
import { lobbyStore } from '../store/lobbyStore';
import { roomStore } from '../store/roomStore';
import { bindSession, sessionStore } from '../store/sessionStore';

export interface App {
  readonly session: Session;
  readonly rooms: RoomService;
  gameClient(): GameClient;
}

let app: App | null = null;

export function getApp(): App {
  if (app !== null) return app;
  const session = createSession({ storage: createTokenStorage() });
  bindSession(session);
  let client: GameClient | null = null;
  const gameClient = (): GameClient => (client ??= createGameClient(session));
  const roomClient: RoomClientLike = {
    joinWithReservation: async (r: SeatReservation) =>
      (await gameClient().joinWithReservation(r)) as unknown as RoomLike,
    reconnect: async (src) => (await gameClient().reconnect(src)) as unknown as RoomLike,
  };
  const rooms = createRoomService({ getClient: () => roomClient, store: roomStore });
  // A sessão acabou (logout ou refresh recusado): larga a sala e zera o estado do lobby.
  sessionStore.subscribe((s, prev) => {
    if (s.status === 'signedOut' && prev.status !== 'signedOut') {
      void rooms.leave();
      lobbyStore.getState().reset();
    }
  });
  app = { session, rooms, gameClient };
  return app;
}
