import { describe, expect, it } from 'vitest';
import { createLobbyStore, queueRemainingSeconds, retryRemainingSeconds } from './lobbyStore';
import { createRoomStore, projectWaiting } from './roomStore';
import { bindSession, createSessionStore, selectIsReady, selectNickname } from './sessionStore';
import type { Session, SessionState } from '../net/session';

function fakeSession(initial: SessionState) {
  let state = initial;
  const listeners = new Set<(s: SessionState) => void>();
  const session = {
    getState: () => state,
    subscribe: (l: (s: SessionState) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as Session;
  return {
    session,
    emit(next: SessionState) {
      state = next;
      for (const l of [...listeners]) l(next);
    },
    listenerCount: () => listeners.size,
  };
}
const user = { id: 'u1', nickname: 'Zé' };

describe('sessionStore', () => {
  it('espelha a sessão e desliga ao desvincular', () => {
    const store = createSessionStore();
    const fake = fakeSession({ status: 'idle', user: null });
    const off = bindSession(fake.session, store);
    fake.emit({ status: 'authenticated', user });
    expect(selectIsReady(store.getState())).toBe(true);
    expect(selectNickname(store.getState())).toBe('Zé');
    off();
    expect(fake.listenerCount()).toBe(0);
    fake.emit({ status: 'signedOut', user: null });
    expect(store.getState().status).toBe('authenticated'); // não escuta mais
  });

  it('refresh recusado na restauração = sessão anterior perdida, e sobrevive ao convidado novo', () => {
    const store = createSessionStore();
    const fake = fakeSession({ status: 'idle', user: null });
    bindSession(fake.session, store);
    fake.emit({ status: 'restoring', user });
    fake.emit({ status: 'signedOut', user: null });
    fake.emit({ status: 'restoring', user: null });
    fake.emit({ status: 'authenticated', user: { id: 'u2', nickname: 'Novo' } });
    expect(store.getState().lostPrevious).toBe(true);
    store.getState().dismissLost();
    expect(store.getState().lostPrevious).toBe(false);
  });

  it('primeiro acesso (sem sessão guardada) não mostra aviso', () => {
    const store = createSessionStore();
    const fake = fakeSession({ status: 'idle', user: null });
    bindSession(fake.session, store);
    fake.emit({ status: 'restoring', user: null });
    fake.emit({ status: 'authenticated', user });
    expect(store.getState().lostPrevious).toBe(false);
  });

  it('logout do usuário não conta como sessão perdida', () => {
    const store = createSessionStore();
    const fake = fakeSession({ status: 'authenticated', user });
    bindSession(fake.session, store);
    store.getState().beginLogout();
    fake.emit({ status: 'signedOut', user: null });
    expect(store.getState().lostPrevious).toBe(false);
    expect(store.getState().loggingOut).toBe(false);
    // mas um signedOut inesperado depois conta
    fake.emit({ status: 'authenticated', user });
    fake.emit({ status: 'signedOut', user: null });
    expect(store.getState().lostPrevious).toBe(true);
  });

  it('unavailable mantém o usuário e não marca perda', () => {
    const store = createSessionStore();
    const fake = fakeSession({ status: 'idle', user: null });
    bindSession(fake.session, store);
    fake.emit({ status: 'restoring', user });
    fake.emit({ status: 'unavailable', user });
    expect(store.getState().status).toBe('unavailable');
    expect(store.getState().lostPrevious).toBe(false);
    expect(selectIsReady(store.getState())).toBe(false);
  });
});

describe('lobbyStore', () => {
  it('seletores e reset', () => {
    const store = createLobbyStore();
    expect(store.getState().busy).toBe('none');
    store.getState().setBusy('create');
    store.getState().setQueue({ status: 'queued', expiresAt: 10_000 });
    expect(store.getState().busy).toBe('create');
    expect(store.getState().queue.status).toBe('queued');
    store.getState().setError({ scope: 'queue', code: 'QUEUE_COOLDOWN', retryAfterSeconds: 3 });
    store.getState().reset();
    expect(store.getState().busy).toBe('none');
    expect(store.getState().queue).toEqual({ status: 'idle' });
    expect(store.getState().error).toBeNull();
  });

  it('Retry-After: restante a partir de retryUntil', () => {
    const e = {
      scope: 'queue',
      code: 'QUEUE_COOLDOWN',
      retryAfterSeconds: 30,
      retryUntil: 30_000,
    } as const;
    expect(retryRemainingSeconds(e, 0)).toBe(30);
    expect(retryRemainingSeconds(e, 29_100)).toBe(1);
    expect(retryRemainingSeconds(e, 30_000)).toBe(0);
    expect(retryRemainingSeconds({ scope: 'join', code: 'INVALID_CODE' }, 0)).toBe(0);
    expect(retryRemainingSeconds(null, 0)).toBe(0);
  });

  it('tempo restante da fila vem de expiresAt', () => {
    const q = { status: 'queued', expiresAt: 10_000 } as const;
    expect(queueRemainingSeconds(q, 4_500)).toBe(6);
    expect(queueRemainingSeconds(q, 9_999)).toBe(1);
    expect(queueRemainingSeconds(q, 10_000)).toBe(0);
    expect(queueRemainingSeconds(q, 20_000)).toBe(0);
    expect(queueRemainingSeconds({ status: 'idle' }, 0)).toBe(0);
  });
});

describe('roomStore e projeção da espera', () => {
  const json = {
    roomCode: 'ABCDEFGH',
    phase: 'waiting',
    players: [
      { seat: 1, nickname: 'Bia', status: 'connected', isBot: false },
      { seat: 0, nickname: 'Zé', status: 'connected', isBot: false },
      { seat: 2, nickname: '', status: 'empty', isBot: false },
      { seat: 3, nickname: 'Bot', status: 'bot', isBot: true },
    ],
    privates: { '1': { seat: 1, hand: [] } },
  };
  it('projeta assentos ordenados, fase, código e o meu assento', () => {
    const p = projectWaiting(json);
    expect(p.roomCode).toBe('ABCDEFGH');
    expect(p.tablePhase).toBe('waiting');
    expect(p.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    expect(p.mySeat).toBe(1);
  });
  it('roomCode inválido (fora do alfabeto, tamanho, tipo) vira vazio', () => {
    for (const bad of ['abc', 'ABCDEFG0', '../admin', 'ABCDEFGHI', 42, null]) {
      expect(projectWaiting({ ...json, roomCode: bad }).roomCode).toBe('');
    }
  });
  it('é tolerante a lixo e estado parcial', () => {
    expect(projectWaiting(undefined).seats).toEqual([]);
    expect(projectWaiting({ players: [null, 5, { seat: 'x' }] }).seats).toEqual([]);
    expect(projectWaiting({ privates: { a: { seat: 'x' } } }).mySeat).toBe(-1);
  });
  it('conta assentos ocupados e reseta', () => {
    const store = createRoomStore();
    store.getState().patch({ ...projectWaiting(json), connection: 'connected' });
    expect(store.getState().seats.filter((p) => p.status !== 'empty')).toHaveLength(3);
    store.getState().reset();
    expect(store.getState().connection).toBe('none');
    expect(store.getState().seats).toEqual([]);
  });
});
