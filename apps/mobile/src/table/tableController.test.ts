import { ERROR_CODES } from '@trucaco/protocol';
import type { ClientMessage } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { errorMessage, hasMessage } from '../i18n/errors';
import { snapshot, priv, player } from './snapshotFixtures';
import {
  BUSY_TIMEOUT_MS,
  LINGER_MS,
  PRESENCE_NOTE_MS,
  REPLAY_MIN_AGE_MS,
  ACTION_ERRORS,
  SIGNAL_SAFETY_MS,
  createTableController,
} from './tableController';
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
    for (const t of [...timers]) {
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
    store.getState().patch({ selected: 'play:3paus' });
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

describe('pressCard: um toque joga', () => {
  it('o primeiro toque já envia a jogada; o toque duplo não envia de novo', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(snapshot());
    ctl.pressCard('play:7ouros');
    ctl.pressCard('play:7ouros');
    ctl.pressCard('play:3paus'); // outra carta, ainda em voo: barrada
    expect(sent).toEqual([{ type: 'play', card: { rank: '7', suit: 'ouros' } }]);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().busy).toBe(true);
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
      // CHAT_BLOCKED vai para o erro do chat e CODE_NOT_SAVED para o do combinado, não para o banner da mesa.
      const shown =
        code === 'CHAT_BLOCKED'
          ? store.getState().chatError
          : code === 'CODE_NOT_SAVED'
            ? store.getState().codesError
            : store.getState().errorCode;
      expect(shown).toBe(code);
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
    const { ctl, said } = setup();
    ctl.onEvent({ seq: 1, at: 1, event: { type: 'inventado' } });
    ctl.onEvent({ seq: 2, at: 1, event: { type: 'handDecided' } });
    ctl.onEvent({ seq: 3, at: 1, event: 'x' });
    expect(said).toEqual([]);
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
      { handNumber: 4, winnerTeam: 1, points: 3, reason: 'betRun', scores: [0, 3], details: [] },
    ]);
    ctl.onDesync({ expected: 3, got: 9 });
    expect(store.getState().history).toEqual([]);
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
    const { ctl } = setup();
    ctl.setAnnouncer(null);
    const fn = vi.fn();
    ctl.onEvent({ seq: 1, at: 1, event: { type: 'gameStarted', gameNumber: 1 } });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('3H2: erro correlacionado à ação', () => {
  it('erro de chat não destrava o botão em voo; erro de ação destrava', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    expect(ctl.act('play:3paus')).toBe(true);
    ctl.onServerError({ code: 'CHAT_BLOCKED' });
    expect(store.getState().busy).toBe(true);
    expect(store.getState().chatError).toBe('CHAT_BLOCKED');
    expect(store.getState().errorCode).toBeNull();
    ctl.onServerError({ code: 'INVALID_SIGNAL' });
    expect(store.getState().busy).toBe(true);
    ctl.onServerError({ code: 'NOT_YOUR_TURN' });
    expect(store.getState().busy).toBe(false);
  });

  it('RATE_LIMITED segue o último envio (ação ou chat)', () => {
    const a = setup();
    a.ctl.applyState(snapshot());
    a.ctl.act('play:3paus');
    a.ctl.onServerError({ code: 'RATE_LIMITED' });
    expect(a.store.getState().busy).toBe(false);
    expect(a.store.getState().errorCode).toBe('RATE_LIMITED');
    const c = setup();
    c.ctl.applyState(snapshot());
    c.ctl.sendChat('table', 'oi');
    c.ctl.onServerError({ code: 'RATE_LIMITED' });
    expect(c.store.getState().chatError).toBe('RATE_LIMITED');
    expect(c.store.getState().errorCode).toBeNull();
  });
});

describe('3H2: reconexão e replay', () => {
  it('reconectar destrava o botão e limpa o timer de ocupado', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.act('play:3paus');
    ctl.onReconnected();
    expect(store.getState().busy).toBe(false);
  });

  it('replay logo após reconectar não mede o relógio nem é falado; evento vivo sim', () => {
    const { ctl, store, said, clock } = setup();
    ctl.applyState(snapshot());
    clock.t = 10_000;
    ctl.onReconnected();
    const old = 10_000 - REPLAY_MIN_AGE_MS - 5_000;
    ctl.onEvent({ seq: 1, at: old, event: { type: 'gameStarted', gameNumber: 1 } });
    expect(store.getState().clockOffsetMs).toBe(0);
    expect(said).toEqual([]);
    ctl.onEvent({ seq: 2, at: 10_200, event: { type: 'gameStarted', gameNumber: 2 } });
    expect(store.getState().clockOffsetMs).toBe(200);
    expect(said).toEqual(['Jogo 2 começou.']);
  });
});

describe('3H2: histórico detalhado', () => {
  it('lances da mão viram detalhes do histórico; mão repetida substitui', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    const ev = (seq: number, event: unknown) => ctl.onEvent({ seq, at: 1, event });
    ev(1, { type: 'handStarted', handNumber: 1, pe: 0, scores: [0, 0], special: 'normal' });
    ev(2, {
      type: 'cardPlayed',
      seat: 1,
      card: { rank: 'K', suit: 'ouros' },
      covered: false,
      blind: false,
    });
    ev(3, { type: 'betCalled', seat: 0, toLevel: 1, value: 3 });
    expect(store.getState().handLog).toHaveLength(2);
    ev(4, { type: 'handDecided', winnerTeam: 0, points: 1, reason: 'tricks', scores: [1, 0] });
    expect(store.getState().handLog).toEqual([]);
    expect(store.getState().history[0]?.details).toHaveLength(2);
    ev(5, { type: 'handDecided', winnerTeam: 0, points: 1, reason: 'tricks', scores: [1, 0] });
    expect(store.getState().history).toHaveLength(1);
  });

  it('fim de jogo não apaga o histórico (a tela final o mostra); novo jogo sim', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    const ev = (seq: number, event: unknown) => ctl.onEvent({ seq, at: 1, event });
    ev(1, { type: 'handDecided', winnerTeam: 0, points: 1, reason: 'tricks', scores: [12, 0] });
    ev(2, { type: 'gameDecided', winnerTeam: 0, scores: [12, 0] });
    expect(store.getState().history).toHaveLength(1);
    ev(3, { type: 'gameStarted', gameNumber: 2 });
    expect(store.getState().history).toEqual([]);
  });
});

describe('3H2: vaza que fica na mesa', () => {
  const closed = {
    starter: 0,
    winnerSeat: 1,
    winnerTeam: 1,
    plays: [
      { seat: 0, rank: '4', suit: 'paus', covered: false },
      { seat: 1, rank: '3', suit: 'ouros', covered: false },
    ],
  };

  it('quando tricks cresce e current esvazia, a vaza fica LINGER_MS', () => {
    const { ctl, store, fire } = setup();
    ctl.applyState(
      snapshot({ hand: { current: [{ seat: 0, rank: '4', suit: 'paus', covered: false }] } }),
    );
    expect(store.getState().lingering).toBeNull();
    ctl.applyState(snapshot({ hand: { tricks: [closed], current: [] } }));
    expect(store.getState().lingering?.winnerSeat).toBe(1);
    expect(store.getState().lingering?.plays).toHaveLength(2);
    fire(LINGER_MS);
    expect(store.getState().lingering).toBeNull();
  });

  it('sem vaza nova não há retenção', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.applyState(snapshot());
    expect(store.getState().lingering).toBeNull();
  });
});

describe('3H2: cobrir, votar e chat', () => {
  const covered = () =>
    snapshot({
      privates: priv(0, {
        hand: [{ rank: '3', suit: 'paus' }],
        legalActions: ['play:3paus', 'playCovered:3paus'],
      }),
    });

  it('modo cobrir só liga com playCovered legal, seleciona a coberta e envia coberta', () => {
    const { ctl, store, sent } = setup();
    ctl.applyState(snapshot());
    ctl.setCoverMode(true);
    expect(store.getState().coverMode).toBe(false);
    ctl.applyState(covered());
    ctl.setCoverMode(true);
    expect(store.getState().coverMode).toBe(true);
    ctl.pressCard('playCovered:3paus');
    expect(sent).toEqual([{ type: 'play', card: { rank: '3', suit: 'paus' }, covered: true }]);
    expect(store.getState().coverMode).toBe(false);
  });

  it('o modo cobrir desliga sozinho quando a coberta deixa de ser legal', () => {
    const { ctl, store } = setup();
    ctl.applyState(covered());
    ctl.setCoverMode(true);
    ctl.applyState(snapshot());
    expect(store.getState().coverMode).toBe(false);
  });

  it('voteCancel envia uma vez só e só com a mesa em andamento', () => {
    const { ctl, sent } = setup();
    expect(ctl.voteCancel()).toBe(false);
    ctl.applyState(snapshot());
    expect(ctl.voteCancel()).toBe(true);
    ctl.applyState(snapshot({ cancelVotes: [0] }));
    expect(ctl.voteCancel()).toBe(false);
    expect(sent).toEqual([{ type: 'voteCancel' }]);
  });

  it('sendChat valida pelo protocol: texto bloqueado nem sai; válido limpa o rascunho', () => {
    const { ctl, store, sent } = setup();
    ctl.applyState(snapshot());
    ctl.setChatDraft('table', 'oi gente');
    expect(ctl.sendChat('table', 'a\u200db')).toBe(false);
    expect(store.getState().chatError).toBe('CHAT_BLOCKED');
    expect(ctl.sendChat('table', '   ')).toBe(false);
    expect(sent).toEqual([]);
    expect(ctl.sendChat('table', 'oi gente')).toBe(true);
    expect(sent).toEqual([{ type: 'chat', scope: 'table', text: 'oi gente' }]);
    expect(store.getState().chatDraft.table).toBe('');
    expect(store.getState().chatError).toBeNull();
    expect(ctl.sendPhrase('table', 'good_luck')).toBe(true);
    expect(ctl.sendPhrase('table', 'inventada')).toBe(false);
    expect(sent[1]).toEqual({ type: 'chat', scope: 'table', phraseId: 'good_luck' });
    // Em jogo não existe chat da dupla: nada sai com scope partner.
    expect(ctl.sendChat('partner', 'oi')).toBe(false);
    expect(ctl.sendPhrase('partner', 'good_luck')).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it('onChat guarda texto e frase rápida; ignora lixo; conta não lidas por aba', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onChat({ scope: 'table', seat: 1, text: 'oi', at: 5 });
    ctl.onChat({ scope: 'partner', seat: 2, phraseId: 'thanks', at: 6 });
    ctl.onChat({ scope: 'partner', seat: 9, text: 'x' });
    ctl.onChat({ scope: 'outro', seat: 1, text: 'x' });
    ctl.onChat({ scope: 'table', seat: 1, phraseId: 'nao_existe' });
    ctl.onChat(null);
    expect(store.getState().chat.map((c) => c.text)).toEqual(['oi', 'Valeu!']);
    // Em jogo a mensagem da dupla (servidor antigo) é guardada, mas não conta como não lida.
    expect(store.getState().chatUnread).toEqual({ table: 1, partner: 0 });
    ctl.setChatOpen(true);
    expect(store.getState().chatUnread).toEqual({ table: 0, partner: 0 });
    ctl.onChat({ scope: 'table', seat: 1, text: 'de novo' });
    expect(store.getState().chatUnread.table).toBe(0);
    ctl.setChatTab('partner');
    expect(store.getState().chatUnread.partner).toBe(0);
  });
});

describe('rodada de correção 3H2', () => {
  it('ACTION_ERRORS só tem códigos que existem no protocol', () => {
    for (const c of ACTION_ERRORS) expect(ERROR_CODES as readonly string[]).toContain(c);
    expect(new Set(ACTION_ERRORS).size).toBe(ACTION_ERRORS.length);
  });

  it('voto alheio não libera a ação em voo (assinatura ignora cancelVotes)', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.act('play:3paus');
    ctl.applyState(snapshot({ cancelVotes: [1] }));
    expect(store.getState().busy).toBe(true);
  });

  it('erro depois de voteCancel não destrava ação em voo; RATE_LIMITED de jogada não vira chatError', () => {
    const a = setup();
    a.ctl.applyState(snapshot());
    a.ctl.act('play:3paus');
    a.ctl.voteCancel();
    a.ctl.onServerError({ code: 'NOT_YOUR_TURN' });
    expect(a.store.getState().busy).toBe(true);
    const b = setup();
    b.ctl.applyState(snapshot());
    b.ctl.act('play:3paus');
    b.ctl.onServerError({ code: 'INVALID_PAYLOAD' });
    expect(b.store.getState().chatError).toBeNull();
    expect(b.store.getState().errorCode).toBe('INVALID_PAYLOAD');
    expect(b.store.getState().busy).toBe(false);
  });

  it('chat da dupla de assento adversário é descartado; da mesa passa', () => {
    const { ctl, store } = setup();
    ctl.onChat({ scope: 'partner', seat: 0, text: 'sem estado' });
    ctl.applyState(snapshot());
    ctl.onChat({ scope: 'partner', seat: 1, text: 'adversário' });
    ctl.onChat({ scope: 'partner', seat: 2, text: 'parceiro' });
    ctl.onChat({ scope: 'table', seat: 1, text: 'mesa' });
    expect(store.getState().chat.map((c) => c.text)).toEqual(['parceiro', 'mesa']);
  });
});

describe('rodada de correção 3H2: última vaza da mão', () => {
  const play = (seat: number, rank: string, suit: string) => ({
    type: 'cardPlayed',
    seat,
    card: { rank, suit },
    covered: false,
    blind: false,
  });
  const three = [
    { seat: 0, rank: '4', suit: 'paus', covered: false },
    { seat: 1, rank: '5', suit: 'ouros', covered: false },
    { seat: 2, rank: '6', suit: 'copas', covered: false },
  ];

  function driveLastCard(extra: Record<string, unknown>, nextState: Record<string, unknown>) {
    const h = setup();
    h.ctl.applyState(snapshot({ hand: { current: three }, ...extra }));
    let seq = 0;
    const ev = (event: unknown) => h.ctl.onEvent({ seq: ++seq, at: 1, event });
    ev({ type: 'handStarted', handNumber: 1, pe: 0, scores: [0, 0], special: 'normal' });
    ev(play(0, '4', 'paus'));
    ev(play(1, '5', 'ouros'));
    ev(play(2, '6', 'copas'));
    ev(play(3, '7', 'ouros'));
    ev({ type: 'trickDecided', index: 1, winnerSeat: 3, winnerTeam: 1 });
    h.ctl.applyState(snapshot(nextState));
    return h;
  }

  it('mão decidida na vaza: o novo patch já é da mão seguinte, e a vaza sai com 4 cartas e vencedor', () => {
    const { store } = driveLastCard({}, { game: { handNumber: 2 }, hand: { current: [] } });
    const l = store.getState().lingering;
    expect(l?.plays).toHaveLength(4);
    expect(l?.winnerSeat).toBe(3);
  });

  it('troca de jogo no bo3 (mesmo número de mão) também retém a vaza completa', () => {
    const { store } = driveLastCard(
      { game: { handNumber: 2 }, series: { format: 'bo3', gameNumber: 1 } },
      { game: { handNumber: 2 }, series: { format: 'bo3', gameNumber: 2 }, hand: { current: [] } },
    );
    expect(store.getState().lingering?.plays).toHaveLength(4);
    expect(store.getState().lingering?.winnerSeat).toBe(3);
  });

  it('patch antes do evento: a vaza retida é completada quando trickDecided chega', () => {
    const h = setup();
    h.ctl.applyState(snapshot({ hand: { current: three } }));
    h.ctl.applyState(snapshot({ game: { handNumber: 2 }, hand: { current: [] } }));
    expect(h.store.getState().lingering?.plays).toHaveLength(3);
    const ev = (seq: number, event: unknown) => h.ctl.onEvent({ seq, at: 1, event });
    ev(1, play(0, '4', 'paus'));
    ev(2, play(1, '5', 'ouros'));
    ev(3, play(2, '6', 'copas'));
    ev(4, play(3, '7', 'ouros'));
    ev(5, { type: 'trickDecided', index: 2, winnerSeat: 1, winnerTeam: 1 });
    expect(h.store.getState().lingering?.plays).toHaveLength(4);
    expect(h.store.getState().lingering?.winnerSeat).toBe(1);
  });
});

describe('revanche', () => {
  const finished = (over: Record<string, unknown> = {}) =>
    snapshot({
      phase: 'finished',
      series: { winnerTeam: 0 },
      rematchDeadlineAt: 2_000_000,
      hand: { phase: 'finished', turn: -1, actingSeat: -1 },
      privates: priv(0),
      ...over,
    });

  it('voteRematch só com a janela aberta e uma vez só', () => {
    const { ctl, sent } = setup();
    expect(ctl.voteRematch()).toBe(false);
    ctl.applyState(snapshot());
    expect(ctl.voteRematch()).toBe(false);
    // Servidor antigo: finished com vencedor, mas sem prazo publicado.
    ctl.applyState(finished({ rematchDeadlineAt: 0 }));
    expect(ctl.voteRematch()).toBe(false);
    ctl.applyState(finished({ series: { winnerTeam: -1 } }));
    expect(ctl.voteRematch()).toBe(false);
    expect(sent).toEqual([]);
    ctl.applyState(finished());
    expect(ctl.voteRematch()).toBe(true);
    ctl.applyState(finished({ rematchVotes: [0] }));
    expect(ctl.voteRematch()).toBe(false);
    expect(sent).toEqual([{ type: 'voteRematch' }]);
  });

  it('com poucos humanos o cliente ainda envia: o servidor decide e devolve REMATCH_NOT_AVAILABLE', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(
      finished({
        players: [
          player(0),
          player(1, { isBot: true }),
          player(2, { isBot: true }),
          player(3, { isBot: true }),
        ],
      }),
    );
    expect(ctl.voteRematch()).toBe(true);
    expect(sent).toEqual([{ type: 'voteRematch' }]);
    ctl.onServerError({ code: 'REMATCH_NOT_AVAILABLE' });
    expect(store.getState().errorCode).toBe('REMATCH_NOT_AVAILABLE');
  });

  it('voto, queda, reconexão e estado sem o voto: novo clique reenvia', () => {
    const { ctl, sent } = setup();
    ctl.applyState(finished());
    expect(ctl.voteRematch()).toBe(true);
    ctl.applyState(finished({ rematchVotes: [0] }));
    expect(ctl.voteRematch()).toBe(false);
    ctl.onReconnected();
    ctl.applyState(finished({ rematchVotes: [] }));
    expect(ctl.voteRematch()).toBe(true);
    // Só o estado (sem reconexão): voto refletido que some libera de novo.
    ctl.applyState(finished({ rematchVotes: [0] }));
    ctl.applyState(finished({ rematchVotes: [] }));
    expect(ctl.voteRematch()).toBe(true);
    expect(sent).toHaveLength(3);
  });

  it('o voto limpa erro antigo, e entrar em finished limpa RATE_LIMITED da última jogada', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    store.getState().patch({ errorCode: 'RATE_LIMITED' });
    ctl.applyState(finished());
    expect(store.getState().errorCode).toBeNull();
    store.getState().patch({ errorCode: 'RATE_LIMITED' });
    ctl.voteRematch();
    expect(store.getState().errorCode).toBeNull();
  });

  it('gameStarted antes do patch: fala "Nova partida começou." uma vez, antes de "Jogo 1"', () => {
    const { ctl, said } = setup();
    ctl.applyState(finished());
    ctl.onEvent({ seq: 5, at: 1_000_000, event: { type: 'gameStarted', gameNumber: 1 } });
    expect(said[0]).toBe('Nova partida começou.');
    ctl.applyState(snapshot({ matchNumber: 2 }));
    expect(said.filter((m) => m === 'Nova partida começou.')).toHaveLength(1);
    // Jogo seguinte da série (fase playing): não é nova partida.
    ctl.onEvent({ seq: 6, at: 1_000_000, event: { type: 'gameStarted', gameNumber: 2 } });
    expect(said.filter((m) => m === 'Nova partida começou.')).toHaveLength(1);
  });

  it('REMATCH_NOT_AVAILABLE guarda o erro e não destrava a ação em voo', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.act('play:3paus');
    ctl.applyState(finished());
    store.getState().patch({ busy: true });
    ctl.voteRematch();
    ctl.onServerError({ code: 'REMATCH_NOT_AVAILABLE' });
    expect(store.getState().errorCode).toBe('REMATCH_NOT_AVAILABLE');
    expect(store.getState().busy).toBe(true);
    expect(store.getState().chatError).toBeNull();
    expect((ACTION_ERRORS as readonly string[]).includes('REMATCH_NOT_AVAILABLE')).toBe(false);
  });

  it('anuncia o voto de outro jogador, não o meu', () => {
    const { ctl, said } = setup();
    ctl.applyState(finished());
    ctl.applyState(finished({ rematchVotes: [1] }));
    ctl.applyState(finished({ rematchVotes: [0, 1] }));
    expect(said).toEqual(['Bia quer jogar de novo.']);
  });

  it('matchNumber novo zera histórico, vaza retida, balões e anuncia; seq não é resync', () => {
    const { ctl, store, said } = setup();
    ctl.applyState(snapshot());
    ctl.onEvent({ seq: 1, at: 1_000_000, event: { type: 'gameStarted' } });
    ctl.onChat({ scope: 'table', seat: 1, text: 'gg' });
    store.getState().patch({
      history: [{ handNumber: 1, winnerTeam: 0, points: 1, reason: 'tricks', scores: [1, 0] }],
      handLog: ['x'],
      lingering: { plays: [], winnerSeat: 0, ownCovered: null },
      busy: true,
      selected: 'play:3paus',
      errorCode: 'REMATCH_NOT_AVAILABLE',
    });
    ctl.applyState(finished({ rematchVotes: [0, 1, 2, 3] }));
    expect(store.getState().history).toHaveLength(1);
    ctl.applyState(snapshot({ matchNumber: 2 }));
    const s = store.getState();
    expect(s.history).toEqual([]);
    expect(s.handLog).toEqual([]);
    expect(s.lingering).toBeNull();
    expect(s.bubbles).toEqual({});
    expect(s.busy).toBe(false);
    expect(s.selected).toBeNull();
    expect(s.errorCode).toBeNull();
    expect(s.vm?.matchNumber).toBe(2);
    expect(said).toContain('Nova partida começou.');
    // Mesmo matchNumber: nada de novo é anunciado.
    const before = said.length;
    ctl.applyState(snapshot({ matchNumber: 2 }));
    expect(said).toHaveLength(before);
    // `seq` continua (sem resync): os eventos seguintes da nova partida entram no histórico zerado.
    ctl.onEvent({ seq: 2, at: 1_000_000, event: { type: 'handStarted', handNumber: 1 } });
    ctl.onEvent({
      seq: 3,
      at: 1_000_000,
      event: { type: 'handDecided', winnerTeam: 0, points: 1, reason: 'tricks', scores: [1, 0] },
    });
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().history[0]).toMatchObject({ handNumber: 1, winnerTeam: 0 });
  });
});

describe('revanche: duplo clique', () => {
  it('segundo voteRematch antes do estado refletir não reenvia; o erro libera nova tentativa', () => {
    const { ctl, sent } = setup();
    ctl.applyState(
      snapshot({
        phase: 'finished',
        series: { winnerTeam: 0 },
        rematchDeadlineAt: 2_000_000,
        hand: { phase: 'finished', turn: -1, actingSeat: -1 },
        privates: priv(0),
      }),
    );
    expect(ctl.voteRematch()).toBe(true);
    expect(ctl.voteRematch()).toBe(false);
    ctl.onServerError({ code: 'REMATCH_NOT_AVAILABLE' });
    expect(ctl.voteRematch()).toBe(true);
    expect(sent).toHaveLength(2);
  });
});

describe('revanche: RATE_LIMITED', () => {
  it('voto recusado por ritmo libera nova tentativa', () => {
    const { ctl, sent } = setup();
    ctl.applyState(
      snapshot({
        phase: 'finished',
        series: { winnerTeam: 0 },
        rematchDeadlineAt: 2_000_000,
        hand: { phase: 'finished', turn: -1, actingSeat: -1 },
        privates: priv(0),
      }),
    );
    expect(ctl.voteRematch()).toBe(true);
    ctl.onServerError({ code: 'RATE_LIMITED' });
    expect(ctl.voteRematch()).toBe(true);
    expect(sent).toHaveLength(2);
  });
});

describe('4E: sinais', () => {
  it('3 sinais em 100 ms no mesmo assento: 2 animam (1 na fila) e o terceiro é descartado', () => {
    const { ctl, store, said } = setup();
    ctl.applyState(snapshot());
    ctl.onSignal({ seat: 1, signalId: 'wink', at: 1 });
    const first = store.getState().signals[1];
    expect(first?.id).toBe('wink');
    ctl.onSignal({ seat: 1, signalId: 'nod', at: 2 }); // fila
    ctl.onSignal({ seat: 1, signalId: 'smile', at: 3 }); // descartado
    expect(store.getState().signals[1]).toEqual(first); // ainda o primeiro
    // O avatar termina o primeiro: entra o da fila, com `key` novo.
    ctl.onSignalEnd(1, first?.key ?? -1);
    const second = store.getState().signals[1];
    expect(second?.id).toBe('nod');
    expect(second?.key).not.toBe(first?.key);
    // Termina o segundo: nada mais na fila (o 'smile' não volta).
    ctl.onSignalEnd(1, second?.key ?? -1);
    expect(store.getState().signals[1]).toBeUndefined();
    // O anúncio sai para os três.
    expect(said).toEqual([
      'Bia: Piscar um olho',
      'Bia: Acenar com a cabeça',
      'Bia: Sorriso contido',
    ]);
  });

  it('assentos têm filas independentes; "key" velho ou sem sinal é ignorado', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onSignal({ seat: 0, signalId: 'wink' });
    ctl.onSignal({ seat: 2, signalId: 'wink' });
    const s0 = store.getState().signals[0];
    expect(s0).toBeDefined();
    expect(store.getState().signals[2]).toBeDefined();
    ctl.onSignalEnd(0, (s0?.key ?? 0) + 99); // key de outro sinal
    expect(store.getState().signals[0]).toEqual(s0);
    ctl.onSignalEnd(3, 1); // assento sem sinal
    expect(store.getState().signals[3]).toBeUndefined();
  });

  it('o mesmo id duas vezes anima duas vezes (key novo)', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onSignal({ seat: 1, signalId: 'wink' });
    const a = store.getState().signals[1];
    ctl.onSignal({ seat: 1, signalId: 'wink' });
    ctl.onSignalEnd(1, a?.key ?? -1);
    expect(store.getState().signals[1]?.id).toBe('wink');
    expect(store.getState().signals[1]?.key).not.toBe(a?.key);
  });

  it('ignora payload inválido; anuncia "Você" para o próprio assento', () => {
    const { ctl, store, said } = setup();
    ctl.applyState(snapshot());
    ctl.onSignal(null);
    ctl.onSignal({ seat: 9, signalId: 'wink' });
    ctl.onSignal({ seat: 1.5, signalId: 'wink' });
    ctl.onSignal({ seat: 1, signalId: 'inventado' });
    ctl.onSignal({ seat: 1 });
    expect(store.getState().signals).toEqual({});
    expect(said).toEqual([]);
    const me = store.getState().vm?.mySeat ?? -1;
    ctl.onSignal({ seat: me, signalId: 'shrug' });
    expect(said).toEqual(['Você: Encolher os ombros']);
  });

  it('segurança: se o avatar nunca avisar o fim, o controlador libera o assento', () => {
    const { ctl, store, fire } = setup();
    ctl.applyState(snapshot());
    ctl.onSignal({ seat: 1, signalId: 'wink' });
    const old = store.getState().signals[1];
    ctl.onSignal({ seat: 1, signalId: 'nod' });
    fire(SIGNAL_SAFETY_MS); // libera o primeiro e começa o da fila
    expect(store.getState().signals[1]?.id).toBe('nod');
    // O fim tardio do primeiro (avatar lento) não derruba o segundo.
    ctl.onSignalEnd(1, old?.key ?? -1);
    expect(store.getState().signals[1]?.id).toBe('nod');
    fire(SIGNAL_SAFETY_MS);
    expect(store.getState().signals[1]).toBeUndefined();
  });

  it('reset e nova partida limpam sinais e fila', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onSignal({ seat: 1, signalId: 'wink' });
    ctl.onSignal({ seat: 1, signalId: 'nod' });
    ctl.reset();
    expect(store.getState().signals).toEqual({});
    ctl.applyState(snapshot());
    ctl.onSignal({ seat: 1, signalId: 'smile' });
    expect(store.getState().signals[1]?.id).toBe('smile'); // a fila antiga não voltou
  });

  it('sendSignal valida pelo protocol e envia { type: signal }', () => {
    const { ctl, sent, disconnect } = setup();
    ctl.applyState(snapshot());
    expect(ctl.sendSignal('wink')).toBe(true);
    expect(sent).toEqual([{ type: 'signal', signalId: 'wink' }]);
    expect(ctl.sendSignal('inventado')).toBe(false);
    expect(sent).toHaveLength(1);
    disconnect();
    expect(ctl.sendSignal('nod')).toBe(false);
  });
});
