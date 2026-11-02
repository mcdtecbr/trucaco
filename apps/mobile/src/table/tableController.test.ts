import { ERROR_CODES } from '@trucaco/protocol';
import type { ClientMessage } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { errorMessage, hasMessage } from '../i18n/errors';
import { snapshot, priv } from './snapshotFixtures';
import { BUSY_TIMEOUT_MS, PRESENCE_NOTE_MS, createTableController } from './tableController';
import { createTableStore, effectiveDeadline } from './tableStore';

function setup() {
  const store = createTableStore();
  const sent: ClientMessage[] = [];
  let connected = true;
  const timers: Array<{ fn: () => void; ms: number; id: number; live: boolean }> = [];
  const clock = { t: 1_000_000 };
  const ctl = createTableController({
    store,
    send: (m) => {
      if (!connected) return false;
      sent.push(m);
      return true;
    },
    now: () => clock.t,
    timers: {
      setTimeout: (fn, ms) => {
        const t = { fn, ms, id: timers.length, live: true };
        timers.push(t);
        return t.id;
      },
      clearTimeout: (h) => {
        const t = timers[h as number];
        if (t) t.live = false;
      },
    },
  });
  const fire = (ms: number) => {
    for (const t of timers) {
      if (!t.live || t.ms !== ms) continue;
      t.live = false;
      t.fn();
    }
  };
  const said: string[] = [];
  ctl.setAnnouncer((m) => said.push(m));
  const renders: number[] = [];
  store.subscribe(() => renders.push(1));
  return { store, ctl, sent, said, fire, clock, renders, disconnect: () => (connected = false) };
}

describe('applyState', () => {
  it('um set por patch e projeção completa', () => {
    const { store, ctl, renders } = setup();
    ctl.applyState(snapshot());
    expect(renders).toHaveLength(1);
    expect(store.getState().vm?.legalActions).toContain('play:3paus');
    expect(store.getState().vm?.mySeat).toBe(0);
  });

  it('a carta selecionada some se deixou de ser legal', () => {
    const { store, ctl } = setup();
    ctl.applyState(snapshot());
    ctl.pressCard('play:3paus');
    expect(store.getState().selected).toBe('play:3paus');
    ctl.applyState(snapshot({ hand: { turn: 1 }, privates: priv(0) }));
    expect(store.getState().selected).toBeNull();
  });
});

describe('act: só ações presentes em legalActions', () => {
  it('envia a ação legal e mapeia para a mensagem', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(snapshot());
    expect(ctl.act('play:3paus')).toBe(true);
    expect(sent).toEqual([{ type: 'play', card: { rank: '3', suit: 'paus' } }]);
    expect(store.getState().busy).toBe(true);
  });

  it('NUNCA envia ação fora de legalActions (carta alheia, accept sem aposta, tipo inventado)', () => {
    const { ctl, sent } = setup();
    ctl.applyState(snapshot());
    for (const id of [
      'play:4paus',
      'accept',
      'run',
      'specialPlay',
      'playBlind:0',
      'chat',
      'voteCancel',
      '',
      'play:3paus ',
    ]) {
      expect(ctl.act(id)).toBe(false);
    }
    expect(sent).toEqual([]);
  });

  it('sem estado ou sem sala não envia e não trava', () => {
    const a = setup();
    expect(a.ctl.act('bet')).toBe(false);
    const b = setup();
    b.ctl.applyState(snapshot());
    b.disconnect();
    expect(b.ctl.act('bet')).toBe(false);
    expect(b.store.getState().busy).toBe(false);
  });

  it('anti duplo clique: segundo envio é barrado até o estado reagir', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(snapshot());
    expect(ctl.act('play:3paus')).toBe(true);
    expect(ctl.act('play:3paus')).toBe(false);
    ctl.pressCard('play:7ouros');
    expect(sent).toHaveLength(1);
    // Patch que NÃO reflete a jogada (ex.: presença de outro): continua travado.
    ctl.applyState(snapshot());
    expect(store.getState().busy).toBe(true);
    // Estado novo (vez passou): destrava.
    ctl.applyState(
      snapshot({
        hand: { turn: 1, current: [{ seat: 0, rank: '3', suit: 'paus', covered: false }] },
        privates: priv(0),
      }),
    );
    expect(store.getState().busy).toBe(false);
  });

  it('destrava por erro do servidor e por timeout', () => {
    const { ctl, store, fire } = setup();
    ctl.applyState(snapshot());
    ctl.act('bet');
    ctl.onServerError({ code: 'NOT_YOUR_TURN' });
    expect(store.getState().busy).toBe(false);
    expect(store.getState().errorCode).toBe('NOT_YOUR_TURN');
    expect(ctl.act('bet')).toBe(true);
    fire(BUSY_TIMEOUT_MS);
    expect(store.getState().busy).toBe(false);
  });
});

describe('pressCard: selecionar e confirmar', () => {
  it('primeiro toque seleciona, segundo toque na mesma carta joga', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(snapshot());
    ctl.pressCard('play:3paus');
    expect(sent).toEqual([]);
    expect(store.getState().selected).toBe('play:3paus');
    ctl.pressCard('play:7ouros'); // troca a seleção
    expect(store.getState().selected).toBe('play:7ouros');
    ctl.pressCard('play:7ouros');
    expect(sent).toEqual([{ type: 'play', card: { rank: '7', suit: 'ouros' } }]);
    expect(store.getState().selected).toBeNull();
  });

  it('carta ilegal não é nem selecionada', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.pressCard('play:4paus');
    expect(store.getState().selected).toBeNull();
  });
});

describe('erros do servidor (i18n)', () => {
  it('todo código do protocol vira errorCode e tem texto pt-BR', () => {
    for (const code of ERROR_CODES) {
      const { ctl, store } = setup();
      ctl.onServerError({ code });
      expect(store.getState().errorCode).toBe(code);
      expect(hasMessage(code)).toBe(true);
      expect(errorMessage(code).length).toBeGreaterThan(5);
    }
  });

  it('códigos de jogo têm texto próprio quando o jogador pode agir sobre eles', () => {
    for (const code of [
      'RATE_LIMITED',
      'NOT_YOUR_TURN',
      'CARD_NOT_IN_HAND',
      'BET_NOT_ALLOWED',
      'BET_PENDING',
    ]) {
      expect(errorMessage(code)).not.toBe(errorMessage('UNKNOWN'));
    }
  });

  it('payload malformado ou código desconhecido vira UNKNOWN sem eco', () => {
    const { ctl, store } = setup();
    ctl.onServerError({ code: 'ALGO_NOVO' });
    expect(store.getState().errorCode).toBe('UNKNOWN');
    ctl.onServerError(null);
    expect(store.getState().errorCode).toBe('UNKNOWN');
    ctl.clearError();
    expect(store.getState().errorCode).toBeNull();
  });
});

describe('eventos', () => {
  it('registra seq, calcula offset a partir do at e anuncia', () => {
    const { ctl, store, said, clock } = setup();
    ctl.applyState(snapshot());
    clock.t = 5_000;
    ctl.onEvent({ seq: 1, at: 5_300, event: { type: 'gameStarted', gameNumber: 1 } });
    expect(store.getState().lastSeq).toBe(1);
    expect(store.getState().clockOffsetMs).toBe(300);
    expect(said).toEqual(['Jogo 1 começou.']);
  });

  it('anuncia com apelido do estado e "Você" para o próprio assento', () => {
    const { ctl, said } = setup();
    ctl.applyState(snapshot());
    ctl.onEvent({
      seq: 1,
      at: 1,
      event: {
        type: 'cardPlayed',
        seat: 1,
        card: { rank: 'K', suit: 'ouros' },
        covered: false,
        blind: false,
      },
    });
    ctl.onEvent({ seq: 2, at: 1, event: { type: 'betCalled', seat: 0, toLevel: 1, value: 3 } });
    expect(said[0]).toContain('Bia');
    expect(said[1]).toContain('Você pediu truco');
  });

  it('evento malformado ou de tipo desconhecido não quebra nem anuncia', () => {
    const { ctl, said, store } = setup();
    ctl.onEvent({ seq: 1, at: 1, event: { type: 'inventado' } });
    ctl.onEvent({ seq: 2, at: 1, event: { type: 'handDecided' } });
    ctl.onEvent({ seq: 3, at: 1, event: 'x' });
    expect(said).toEqual([]);
    expect(store.getState().lastSeq).toBe(3);
  });

  it('handDecided alimenta o histórico; salto de seq o descarta', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onEvent({
      seq: 1,
      at: 1,
      event: { type: 'handStarted', handNumber: 4, pe: 0, scores: [0, 0], special: 'normal' },
    });
    ctl.onEvent({
      seq: 2,
      at: 1,
      event: { type: 'handDecided', winnerTeam: 1, points: 3, reason: 'betRun', scores: [0, 3] },
    });
    expect(store.getState().history).toEqual([
      { handNumber: 4, winnerTeam: 1, points: 3, reason: 'betRun', scores: [0, 3] },
    ]);
    ctl.onDesync({ expected: 3, got: 9 });
    expect(store.getState().history).toEqual([]);
    expect(store.getState().desynced).toBe(true);
    ctl.acknowledgeResync();
    expect(store.getState().desynced).toBe(false);
  });
});

describe('presença, timer e reconexão', () => {
  it('presence anuncia e mostra aviso transitório', () => {
    const { ctl, store, said, fire } = setup();
    ctl.applyState(snapshot());
    ctl.onPresence({ seat: 2, status: 'away' });
    expect(said).toEqual(['Caio está ausente.']);
    expect(store.getState().presenceNote).toBe('Caio está ausente.');
    fire(PRESENCE_NOTE_MS);
    expect(store.getState().presenceNote).toBeNull();
    ctl.onPresence({ seat: 3, status: 'bot' });
    expect(said[1]).toBe('Davi agora é jogado por um bot.');
    ctl.onPresence({ seat: 9, status: 'bot' });
    ctl.onPresence({ seat: 1, status: 'hackeado' });
    ctl.onPresence(null);
    expect(said).toHaveLength(2);
  });

  it('turnTimer vira reserva do prazo quando o estado não traz', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot({ turnDeadlineAt: 0 }));
    expect(effectiveDeadline(store.getState())).toBe(0);
    ctl.onTurnTimer({ seat: 0, deadlineAt: 9_999 });
    expect(effectiveDeadline(store.getState())).toBe(9_999);
    ctl.onTurnTimer({ seat: 1, deadlineAt: 7_777 }); // outro assento: não vale para a vez atual
    expect(effectiveDeadline(store.getState())).toBe(0);
    ctl.applyState(snapshot({ turnDeadlineAt: 5_000 }));
    expect(effectiveDeadline(store.getState())).toBe(5_000);
    ctl.onTurnTimer('x');
  });

  it('reconexão mostra "voltou" por um tempo e libera a ação', () => {
    const { ctl, store, fire } = setup();
    ctl.applyState(snapshot());
    ctl.act('bet');
    ctl.onReconnected();
    expect(store.getState().notice).toBe('reconnected');
    expect(store.getState().busy).toBe(false);
    fire(3000);
    expect(store.getState().notice).toBeNull();
  });

  it('reset zera tudo e para os timers', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onEvent({ seq: 1, at: 1_001_000, event: { type: 'gameStarted', gameNumber: 1 } });
    ctl.reset();
    expect(store.getState().vm).toBeNull();
    expect(store.getState().lastSeq).toBeNull();
    expect(store.getState().clockOffsetMs).toBe(0);
  });

  it('confirmação de sair da mesa é estado local', () => {
    const { ctl, store } = setup();
    ctl.setLeaveConfirm(true);
    expect(store.getState().leaveConfirm).toBe(true);
    ctl.setLeaveConfirm(false);
    expect(store.getState().leaveConfirm).toBe(false);
  });
});

describe('sem anunciante', () => {
  it('descartar o anunciante não quebra eventos', () => {
    const { ctl, store } = setup();
    ctl.setAnnouncer(null);
    const fn = vi.fn();
    ctl.onEvent({ seq: 1, at: 1, event: { type: 'gameStarted', gameNumber: 1 } });
    expect(fn).not.toHaveBeenCalled();
    expect(store.getState().lastSeq).toBe(1);
  });
});
