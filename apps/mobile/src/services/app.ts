/**
 * Composição do app (singleton por processo): sessão, cliente Colyseus, serviço de sala e stores.
 * Nada aqui roda no import: `getApp()` monta tudo na primeira chamada (as telas chamam em efeitos).
 */
import type { SeatReservation } from '@trucaco/protocol';
import { createAudioService } from '../audio/audioService';
import type { AudioService } from '../audio/audioService';
import { createPlatformAudio } from '../audio/platform';
import { createGameClient } from '../net/colyseus';
import type { GameClient } from '../net/colyseus';
import { isJoinTableResponse } from '../net/guards';
import { ApiError } from '../net/api';
import { createResumeStorage } from '../net/resumeStorage';
import { createSession } from '../net/session';
import type { Session } from '../net/session';
import { createTokenStorage } from '../net/tokenStorage';
import { createRoomService } from '../room/roomService';
import type { RoomClientLike, RoomLike, RoomService } from '../room/roomService';
import { createResumeRecorder, createTableResume } from '../room/tableResume';
import type { TableResumeController } from '../room/tableResume';
import { lobbyStore } from '../store/lobbyStore';
import { mutedStore } from '../store/mutedStore';
import { progressStore } from '../store/progressStore';
import { roomStore } from '../store/roomStore';
import { bindSession, sessionStore } from '../store/sessionStore';
import { createTableController } from '../table/tableController';
import type { TableController } from '../table/tableController';
import { tableStore } from '../table/tableStore';

export interface App {
  readonly session: Session;
  readonly rooms: RoomService;
  readonly table: TableController;
  /** Som deste aparelho (vozes, efeitos, preferências locais). */
  readonly audio: AudioService;
  /** Volta à mesa depois de recarregar a página ou reabrir o app (ver `room/tableResume.ts`). */
  readonly resume: TableResumeController;
  gameClient(): GameClient;
}

let app: App | null = null;

export function getApp(): App {
  if (app !== null) return app;
  const session = createSession({ storage: createTokenStorage() });
  bindSession(session);
  // Sessão restaurada não traz o tipo de conta: lê uma vez (o convidado novo já nasce com `guest`).
  session.subscribe((st) => {
    if (st.status === 'authenticated' && st.user !== null && st.user.provider === undefined) {
      void session.loadProvider();
    }
  });
  const resumeStorage = createResumeStorage();
  const recorder = createResumeRecorder({
    storage: resumeStorage,
    getUserId: () => session.getState().user?.id ?? null,
  });
  let client: GameClient | null = null;
  const gameClient = (): GameClient => (client ??= createGameClient(session));
  const roomClient: RoomClientLike = {
    joinWithReservation: async (r: SeatReservation) =>
      (await gameClient().joinWithReservation(r)) as unknown as RoomLike,
    reconnect: async (src) => (await gameClient().reconnect(src)) as unknown as RoomLike,
  };
  // O controlador envia pelo serviço de sala, e o serviço o alimenta: a referência é resolvida na hora do uso.
  let rooms: RoomService | null = null;
  const platformAudio = createPlatformAudio();
  const audio = createAudioService({
    backend: platformAudio.backend,
    sources: platformAudio.sources,
    storage: platformAudio.storage,
    unlocked: platformAudio.unlocked,
  });
  // Web: navegadores só liberam som depois de um gesto do usuário.
  platformAudio.watchFirstGesture(() => audio.unlock());
  void audio.hydrate();
  const table = createTableController({
    store: tableStore,
    audio,
    send: (msg) => rooms?.send(msg) ?? false,
    isMuted: (nickname) => mutedStore.getState().has(nickname),
  });
  void mutedStore.getState().hydrate();
  rooms = createRoomService({
    getClient: () => roomClient,
    store: roomStore,
    table,
    persist: recorder,
    // Mesa encerrada sem revanche aberta (venceu, cancelou, prazo da revanche fechou): nada a retomar.
    isTableOver: () =>
      roomStore.getState().tablePhase === 'finished' &&
      tableStore.getState().vm?.rematchOpen === false,
  });
  const roomsRef = rooms;
  const resume = createTableResume({
    storage: resumeStorage,
    clear: () => recorder.clear(),
    getUserId: () => session.getState().user?.id ?? null,
    resumeRoom: (token) => roomsRef.resume(token),
    reserveByCode: async (code) => {
      const res = await session.api.joinTable(code);
      if (!isJoinTableResponse(res)) {
        throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', kind: 'invalid_response' });
      }
      return res.reservation;
    },
    enter: (reservation) => roomsRef.enter(reservation),
  });
  // A sessão acabou (logout ou refresh recusado) OU o usuário trocou (entrar em conta social, outra aba):
  // larga a sala, esquece a mesa e zera lobby e progresso. Nada de um usuário pode vazar para o outro.
  const resetAccountState = (): void => {
    recorder.clear();
    void roomsRef.leave();
    lobbyStore.getState().reset();
    progressStore.getState().reset();
  };
  sessionStore.subscribe((s, prev) => {
    if (s.status === 'signedOut' && prev.status !== 'signedOut') {
      resetAccountState();
      return;
    }
    const before = prev.user?.id ?? null;
    const now = s.user?.id ?? null;
    if (before !== null && now !== null && before !== now) resetAccountState();
  });
  app = { session, rooms: roomsRef, table, audio, resume, gameClient };
  return app;
}
