/**
 * Retomada da mesa depois de recarregar a página, contra o servidor REAL (`apps/server/dist/main.js`) e o
 * SDK Colyseus real. "Reload" = objetos novos (sessão, cliente, serviço de sala, retomada) sobre o MESMO
 * armazenamento do refresh token e do registro de retomada, depois de o socket antigo cair sem consentimento.
 * Rode com `pnpm --filter @trucaco/mobile test:int` (precisa de `pnpm build` antes).
 */
import { CloseCode } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameClient } from '../net/colyseus';
import { startServer } from '../net/integrationServer';
import type { RunningServer } from '../net/integrationServer';
import { createMemoryResumeStorage } from '../net/resumeStorageCore';
import type { ResumeStorage } from '../net/resumeStorageCore';
import { createSession } from '../net/session';
import type { Session } from '../net/session';
import { createMemoryTokenStorage } from '../net/tokenStorageCore';
import type { TokenStorage } from '../net/tokenStorageCore';
import { decideBoot } from '../screens/bootResume';
import { createRoomStore } from '../store/roomStore';
import type { RoomStore } from '../store/roomStore';
import { createRoomService } from './roomService';
import type { RoomLike, RoomService } from './roomService';
import { createResumeRecorder, createTableResume } from './tableResume';
import type { TableResumeController } from './tableResume';

interface Life {
  session: Session;
  rooms: RoomService;
  roomStore: RoomStore;
  resume: TableResumeController;
  /** A página morreu: o serviço antigo não reconecta sozinho (no navegador não existe mais). */
  kill(): void;
  dispose(): void;
}

interface Player {
  tokens: TokenStorage;
  resumeStorage: ResumeStorage;
  life: Life;
}

let server: RunningServer;
let players: Player[] = [];

/** Um "carregamento do app": tudo novo em memória; o armazenamento é o que sobrevive ao reload. */
async function boot(tokens: TokenStorage, resumeStorage: ResumeStorage): Promise<Life> {
  const session = createSession({ storage: tokens, baseUrl: server.url });
  expect((await session.start()).status).toBe('authenticated');
  let dead = false;
  const gameClient = createGameClient(session, { serverUrl: server.url });
  const roomStore = createRoomStore();
  const recorder = createResumeRecorder({
    storage: resumeStorage,
    getUserId: () => session.getState().user?.id ?? null,
  });
  const rooms = createRoomService({
    store: roomStore,
    persist: recorder,
    getClient: () => ({
      joinWithReservation: async (r) =>
        (await gameClient.joinWithReservation(r)) as unknown as RoomLike,
      reconnect: async (s) => {
        if (dead) throw new Error('página morta');
        return (await gameClient.reconnect(s)) as unknown as RoomLike;
      },
    }),
  });
  const resume = createTableResume({
    storage: resumeStorage,
    clear: () => recorder.clear(),
    getUserId: () => session.getState().user?.id ?? null,
    resumeRoom: (token) => rooms.resume(token),
    reserveByCode: async (code) => (await session.api.joinTable(code)).reservation,
    enter: (r) => rooms.enter(r),
    retryDelayMs: 300,
  });
  return {
    session,
    rooms,
    roomStore,
    resume,
    kill: () => {
      dead = true;
    },
    dispose: () => {
      gameClient.dispose();
      session.dispose();
    },
  };
}

async function waitFor(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const handOf = (life: Life): string =>
  JSON.stringify(
    Object.values(
      ((
        life.rooms.current()?.state as { toJSON(): { privates?: Record<string, unknown> } }
      ).toJSON().privates ?? {}) as Record<string, { hand?: unknown }>,
    ).map((p) => p.hand),
  );

/** 4 convidados numa mesa privada, partida em andamento. */
async function seatedAndPlaying(): Promise<string> {
  players = [];
  for (let i = 0; i < 4; i++) {
    const tokens = createMemoryTokenStorage();
    const resumeStorage = createMemoryResumeStorage();
    players.push({ tokens, resumeStorage, life: await boot(tokens, resumeStorage) });
  }
  const owner = players[0]!.life;
  const created = await owner.session.api.createTable({
    variant: 'paulista',
    format: 'single',
    ironHand: true,
    visibility: 'private',
  });
  const code = await owner.rooms.enter(created.reservation);
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  for (const p of players.slice(1)) {
    const joined = await p.life.session.api.joinTable(code);
    await p.life.rooms.enter(joined.reservation);
  }
  await waitFor(
    () => players.every((p) => p.life.roomStore.getState().tablePhase === 'playing'),
    'partida em andamento',
  );
  await waitFor(
    () => players.every((p) => p.life.roomStore.getState().mySeat >= 0),
    'todos com assento',
  );
  return code;
}

/** Derruba o socket sem consentimento (o que o navegador faz ao recarregar) e espera o servidor notar. */
async function dropWithoutConsent(life: Life, others: Life[]): Promise<void> {
  life.kill();
  const room = life.rooms.current() as unknown as Room;
  const seat = life.roomStore.getState().mySeat;
  room.reconnection.enabled = false;
  const left = new Promise<void>((r) => room.onLeave(() => r()));
  room.connection.close(CloseCode.MAY_TRY_RECONNECT);
  await left;
  await waitFor(
    () => others.every((o) => o.roomStore.getState().seats[seat]?.status === 'away'),
    'servidor registrou a queda',
  );
}

/**
 * A página antiga morre de verdade: aqui o objeto velho ainda pode terminar uma renovação de refresh em
 * segundo plano (disparada pela queda). Espera ela assentar para a página nova ler o refresh vigente.
 */
const pageGone = (): Promise<void> => new Promise((r) => setTimeout(r, 600));

beforeAll(async () => {
  server = await startServer();
}, 30_000);

afterEach(async () => {
  for (const p of players) {
    await p.life.rooms.leave().catch(() => undefined);
    p.life.dispose();
  }
  players = [];
});

afterAll(async () => {
  await server?.stop();
});

describe('retomada da mesa contra o servidor real', () => {
  it('reload dentro da janela: o token guardado devolve o MESMO assento e a MESMA mão', async () => {
    const code = await seatedAndPlaying();
    const victim = players[2]!;
    const seat = victim.life.roomStore.getState().mySeat;
    const handBefore = handOf(victim.life);
    expect(JSON.parse(handBefore)[0]).toHaveLength(3);
    await waitFor(async () => (await victim.resumeStorage.load()) !== null, 'registro gravado');
    const saved = await victim.resumeStorage.load();
    expect(saved?.code).toBe(code);

    await dropWithoutConsent(
      victim.life,
      players.filter((_, i) => i !== 2).map((p) => p.life),
    );
    victim.life.dispose(); // a página antiga morreu
    await pageGone();

    const reborn = await boot(victim.tokens, victim.resumeStorage);
    victim.life = reborn;
    expect(await reborn.resume.pending()).not.toBeNull();
    let showed = 0;
    const decision = await decideBoot(reborn.resume, { onResuming: () => (showed += 1) });
    expect(showed).toBe(1);
    expect(decision).toEqual({ kind: 'table', code });
    expect(reborn.roomStore.getState().connection).toBe('connected');
    expect(reborn.roomStore.getState().mySeat).toBe(seat);
    expect(handOf(reborn)).toBe(handBefore);
    // O servidor trocou o token: o novo está guardado para o próximo reload.
    await waitFor(async () => {
      const now = await victim.resumeStorage.load();
      return now !== null && now.reconnectionToken !== saved?.reconnectionToken;
    }, 'token novo gravado');
    // E os outros veem o assento de volta.
    await waitFor(
      () => players.every((p) => p.life.roomStore.getState().seats[seat]?.status === 'connected'),
      'assento de volta para todos',
    );
  });

  it('o bot já assumiu (janela fechada): o dono volta pelo código ao mesmo assento', async () => {
    const code = await seatedAndPlaying();
    const victim = players[3]!;
    const seat = victim.life.roomStore.getState().mySeat;
    await waitFor(async () => (await victim.resumeStorage.load()) !== null, 'registro gravado');

    // O bot assume o assento (como na janela expirada com a página morta). O serviço antigo apaga o
    // registro ao ver a saída consentida; a página real já teria morrido, então o registro volta.
    const saved = await victim.resumeStorage.load();
    await (victim.life.rooms.current() as unknown as Room).leave(true);
    await waitFor(
      () =>
        players
          .filter((_, i) => i !== 3)
          .every((p) => p.life.roomStore.getState().seats[seat]?.isBot === true),
      'bot assumiu o assento',
    );
    await waitFor(async () => (await victim.resumeStorage.load()) === null, 'registro apagado');
    if (saved === null) throw new Error('sem registro');
    await victim.resumeStorage.save(saved);
    victim.life.dispose();
    await pageGone();

    const reborn = await boot(victim.tokens, victim.resumeStorage);
    victim.life = reborn;
    const decision = await decideBoot(reborn.resume, { onResuming: () => undefined });
    expect(decision).toEqual({ kind: 'table', code });
    expect(reborn.roomStore.getState().mySeat).toBe(seat);
    await waitFor(
      () =>
        players
          .filter((_, i) => i !== 3)
          .every((p) => p.life.roomStore.getState().seats[seat]?.isBot === false),
      'bot devolveu o assento',
    );
  });

  it('mesa inexistente: registro apagado e aviso de mesa perdida', async () => {
    const tokens = createMemoryTokenStorage();
    const resumeStorage = createMemoryResumeStorage();
    const first = await boot(tokens, resumeStorage);
    const victim: Player = { tokens, resumeStorage, life: first };
    players = [victim];
    // Registro de uma mesa que não existe (sala e código desconhecidos do servidor).
    await resumeStorage.save({
      reconnectionToken: 'zzzzzzzz:yyyyyyyy',
      code: 'ABCDEFGH',
      userId: first.session.getState().user?.id ?? '',
    });
    first.dispose();
    await pageGone();

    const reborn = await boot(victim.tokens, victim.resumeStorage);
    victim.life = reborn;
    const decision = await decideBoot(reborn.resume, { onResuming: () => undefined });
    expect(decision).toEqual({ kind: 'home', notice: 'tableLost', code: 'ABCDEFGH' });
    await waitFor(async () => (await victim.resumeStorage.load()) === null, 'registro apagado');
  });
});
