/**
 * Lógica dos containers (HomeScreen, WaitingRoomScreen, SettingsScreen) extraída para funções puras
 * e testada em Vitest/node. Sem `@testing-library/react`+jsdom: o que os containers fazem além disso é
 * ligar hooks a estas funções (cobertura de interação fica para o E2E do 3I).
 */
import { describe, expect, it, vi } from 'vitest';
import { outcomeFromShareAction } from '../platform/shareOutcome';
import { performLogout } from '../lobby/logout';
import { prefillCode, startHome } from '../lobby/homeLifecycle';
import { createLobbyStore } from '../store/lobbyStore';
import { decideWaitingRoute, exitTable } from './waitingRoute';

describe('HomeScreen: ciclo de vida e deep link', () => {
  it('ao montar limpa erro/aviso e o cleanup faz dispose (sai da fila)', () => {
    const store = createLobbyStore();
    store.getState().setError({ scope: 'join', code: 'INVALID_CODE' });
    store.getState().setNotice('queueExpired');
    const controller = { dispose: vi.fn() } as never;
    const cleanup = startHome(controller, store);
    expect(store.getState().error).toBeNull();
    expect(store.getState().notice).toBeNull();
    expect((controller as { dispose: () => void }).dispose).not.toHaveBeenCalled();
    cleanup();
    expect((controller as { dispose: () => void }).dispose).toHaveBeenCalledTimes(1);
  });

  it('deep link só preenche o campo: normaliza e nunca chama a rede', () => {
    expect(prefillCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(prefillCode(undefined)).toBe('');
    expect(prefillCode(['x'])).toBe('');
    expect(prefillCode('<script>alert(1)</script>')).toBe('SCRIPTALE'.slice(0, 8));
  });
});

describe('WaitingRoomScreen: decisão da rota', () => {
  it('sem sala: volta ao início com o código da URL (normalizado) para preencher', () => {
    expect(
      decideWaitingRoute({ connection: 'none', paramCode: 'abcd-efgh', roomCode: '' }),
    ).toEqual({
      kind: 'toHome',
      code: 'ABCDEFGH',
    });
    expect(decideWaitingRoute({ connection: 'none', paramCode: undefined, roomCode: '' })).toEqual({
      kind: 'toHome',
      code: '',
    });
  });

  it('sala de OUTRO código: redireciona para a atual, sem montar a tela que faz leave()', () => {
    expect(
      decideWaitingRoute({ connection: 'connected', paramCode: 'ZZZZZZZZ', roomCode: 'ABCDEFGH' }),
    ).toEqual({ kind: 'toCurrent', code: 'ABCDEFGH' });
  });

  it('mesma sala (ou ainda sem código projetado) mostra a espera', () => {
    expect(
      decideWaitingRoute({ connection: 'connected', paramCode: 'abcdefgh', roomCode: 'ABCDEFGH' }),
    ).toEqual({ kind: 'show' });
    expect(
      decideWaitingRoute({ connection: 'joining', paramCode: 'ABCDEFGH', roomCode: '' }),
    ).toEqual({
      kind: 'show',
    });
    expect(
      decideWaitingRoute({
        connection: 'reconnecting',
        paramCode: 'ABCDEFGH',
        roomCode: 'ABCDEFGH',
      }),
    ).toEqual({ kind: 'show' });
  });

  it('sair da mesa: leave consentido e back() quando há pilha; replace quando não', () => {
    const rooms = { leave: vi.fn(() => Promise.resolve()) };
    const router = { canGoBack: vi.fn(() => true), back: vi.fn(), replace: vi.fn() };
    exitTable(rooms, router);
    expect(rooms.leave).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    exitTable(rooms, router);
    expect(router.replace).toHaveBeenCalledWith('/home');
  });
});

describe('compartilhar o código (nativo)', () => {
  it('dismissedAction não é sucesso nem erro', () => {
    expect(outcomeFromShareAction('sharedAction')).toBe('done');
    expect(outcomeFromShareAction('dismissedAction')).toBe('dismissed');
    expect(outcomeFromShareAction(undefined)).toBe('failed');
  });
});

describe('SettingsScreen: logout', () => {
  function deps(order: string[], leaveFails = false) {
    return {
      beginLogout: () => void order.push('begin'),
      leaveQueue: () => {
        order.push('leaveQueue');
        return leaveFails ? Promise.reject(new Error('rede')) : Promise.resolve({ status: 'idle' });
      },
      logout: () => {
        order.push('logout');
        return Promise.resolve();
      },
      resetLobby: () => void order.push('reset'),
    };
  }
  it('sai da fila ANTES do logout (token ainda válido) e só então zera os stores', async () => {
    const order: string[] = [];
    await performLogout(deps(order));
    expect(order).toEqual(['begin', 'leaveQueue', 'logout', 'reset']);
  });
  it('falha no leaveQueue não impede o logout', async () => {
    const order: string[] = [];
    await performLogout(deps(order, true));
    expect(order).toEqual(['begin', 'leaveQueue', 'logout', 'reset']);
  });
  it('mesmo se o logout falhar, os stores são zerados', async () => {
    const order: string[] = [];
    const d = deps(order);
    d.logout = () => Promise.reject(new Error('x'));
    await expect(performLogout(d)).rejects.toThrow();
    expect(order).toContain('reset');
  });
});
