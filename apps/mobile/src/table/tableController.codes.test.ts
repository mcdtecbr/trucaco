import { PARTNER_CODE_MAX_LENGTH } from '@trucaco/protocol';
import type { ClientMessage } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { PRESENCE_NOTE_MS, createTableController, replacedSeats } from './tableController';
import { projectTable } from './projectTable';
import { createTableStore } from './tableStore';
import { player, snapshot } from './snapshotFixtures';

function setup(muted: readonly string[] = []) {
  const store = createTableStore();
  const sent: ClientMessage[] = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const said: string[] = [];
  const ctl = createTableController({
    store,
    send: (m) => {
      sent.push(m);
      return true;
    },
    timers: {
      setTimeout: (fn, ms) => timers.push({ fn, ms, live: true }) - 1,
      clearTimeout: (h) => {
        const t = timers[h as number];
        if (t) t.live = false;
      },
    },
    isMuted: (n) => muted.includes(n.toLowerCase()),
  });
  ctl.setAnnouncer((m) => said.push(m));
  const fire = (ms: number) => {
    for (const t of timers) {
      if (t.live && t.ms === ms) {
        t.live = false;
        t.fn();
      }
    }
  };
  return { store, ctl, sent, said, fire };
}

const waiting = (players = [0, 1, 2, 3].map((i) => player(i))) =>
  snapshot({ phase: 'waiting', players });

describe('5C: onCodes', () => {
  it('guarda o mapa completo, ignora ids fora do catálogo e valores que não são texto', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onCodes({
      codes: { wink: ' tenho zap ', nod: '', tongue: 7, inventado: 'x' },
      by: -1,
      at: 1,
    });
    expect(store.getState().codes).toEqual({ wink: 'tenho zap' });
    // Mapa novo substitui o anterior (é o mapa completo).
    ctl.onCodes({ codes: { smile: 'blefe' }, by: -1, at: 2 });
    expect(store.getState().codes).toEqual({ smile: 'blefe' });
    ctl.onCodes({ codes: {}, by: -1, at: 3 });
    expect(store.getState().codes).toEqual({});
  });

  it('payload inválido não muda nada', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onCodes({ codes: { wink: 'a' }, by: -1, at: 1 });
    for (const bad of [null, 'x', 3, { by: 0 }, { codes: null }, { codes: ['wink'] }]) {
      ctl.onCodes(bad);
    }
    expect(store.getState().codes).toEqual({ wink: 'a' });
  });

  it('edição do parceiro é anunciada; a minha e a que vem do banco (by -1) não', () => {
    const { ctl, said } = setup();
    ctl.applyState(snapshot()); // eu = assento 0, parceiro = Caio (2)
    ctl.onCodes({ codes: { wink: 'zap' }, by: -1, at: 1 });
    ctl.onCodes({ codes: { wink: 'zap2' }, by: 0, at: 2 });
    expect(said).toEqual([]);
    ctl.onCodes({ codes: { wink: 'zap3' }, by: 2, at: 3 });
    expect(said).toEqual(['Caio atualizou o combinado de sinais.']);
  });

  it('editor de outra dupla é mensagem forjada: descartada', () => {
    const { ctl, store, said } = setup();
    ctl.applyState(snapshot());
    ctl.onCodes({ codes: { wink: 'espiao' }, by: 1, at: 1 });
    expect(store.getState().codes).toEqual({});
    expect(said).toEqual([]);
  });

  it('o combinado sobrevive à revanche (novo matchNumber) e some no reset', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onCodes({ codes: { wink: 'zap' }, by: -1, at: 1 });
    ctl.applyState(snapshot({ matchNumber: 2 }));
    expect(store.getState().codes).toEqual({ wink: 'zap' });
    ctl.reset();
    expect(store.getState().codes).toEqual({});
  });
});

describe('5C: sendCode', () => {
  it('valida pelo protocol e envia setCode', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(waiting());
    expect(ctl.sendCode('wink', '  tenho zap  ')).toBe(true);
    expect(sent).toEqual([{ type: 'setCode', signalId: 'wink', meaning: 'tenho zap' }]);
    expect(store.getState().codesError).toBeNull();
  });

  it('vazio apaga (envia meaning vazio) quando havia combinado', () => {
    const { ctl, sent } = setup();
    ctl.applyState(waiting());
    ctl.onCodes({ codes: { wink: 'zap' }, by: -1, at: 1 });
    expect(ctl.sendCode('wink', '   ')).toBe(true);
    expect(sent).toEqual([{ type: 'setCode', signalId: 'wink', meaning: '' }]);
  });

  it('sem mudança não envia (não gasta o intervalo de 1 s do servidor)', () => {
    const { ctl, sent } = setup();
    ctl.applyState(waiting());
    ctl.onCodes({ codes: { wink: 'zap' }, by: -1, at: 1 });
    expect(ctl.sendCode('wink', 'zap')).toBe(true);
    expect(ctl.sendCode('nod', '')).toBe(true);
    expect(sent).toEqual([]);
  });

  it('o que o servidor recusaria nem sai: texto longo, ZWJ, controle e id fora do catálogo', () => {
    const { ctl, sent, store } = setup();
    ctl.applyState(waiting());
    expect(ctl.sendCode('wink', 'a'.repeat(PARTNER_CODE_MAX_LENGTH + 1))).toBe(false);
    expect(store.getState().codesError).toBe('CHAT_BLOCKED');
    expect(ctl.sendCode('wink', 'a‍b')).toBe(false);
    expect(ctl.sendCode('wink', 'a\u0007b')).toBe(false);
    expect(ctl.sendCode('inventado', 'x')).toBe(false);
    expect(store.getState().codesError).toBe('INVALID_PAYLOAD');
    expect(sent).toEqual([]);
    // 60 caracteres cabem.
    expect(ctl.sendCode('wink', 'a'.repeat(PARTNER_CODE_MAX_LENGTH))).toBe(true);
  });

  it('erros do servidor do setCode vão para codesError, não para o chat nem para a ação', () => {
    const { ctl, store } = setup();
    ctl.applyState(waiting());
    ctl.sendCode('wink', 'zap');
    ctl.onServerError({ code: 'RATE_LIMITED' });
    expect(store.getState().codesError).toBe('RATE_LIMITED');
    expect(store.getState().chatError).toBeNull();
    expect(store.getState().errorCode).toBeNull();
    ctl.sendCode('nod', 'x');
    ctl.onServerError({ code: 'CHAT_BLOCKED' });
    expect(store.getState().codesError).toBe('CHAT_BLOCKED');
    expect(store.getState().chatError).toBeNull();
  });

  it('abrir o painel e clearCodesError limpam o erro', () => {
    const { ctl, store } = setup();
    ctl.applyState(waiting());
    ctl.sendCode('wink', 'a'.repeat(99));
    expect(store.getState().codesError).not.toBeNull();
    ctl.setCodesOpen(true);
    expect(store.getState().codesOpen).toBe(true);
    expect(store.getState().codesError).toBeNull();
    ctl.sendCode('wink', 'a'.repeat(99));
    ctl.clearCodesError();
    expect(store.getState().codesError).toBeNull();
  });
});

describe('5C: sinal do parceiro com combinado', () => {
  it('anuncia e mostra o aviso só para o sinal do PARCEIRO, e o aviso some em 5 s', () => {
    const { ctl, store, said, fire } = setup();
    ctl.applyState(snapshot()); // eu = 0, parceiro = Caio (2)
    ctl.onCodes({ codes: { wink: 'tenho o zap' }, by: -1, at: 1 });
    ctl.onSignal({ seat: 2, signalId: 'wink', at: 2 });
    expect(said).toEqual(['Caio: Piscar um olho (combinado: tenho o zap)']);
    expect(store.getState().partnerSignalNote).toBe('Caio: Piscar um olho = tenho o zap');
    fire(PRESENCE_NOTE_MS);
    expect(store.getState().partnerSignalNote).toBeNull();
  });

  it('adversário e eu mesmo não revelam o combinado; sinal sem combinado fica como antes', () => {
    const { ctl, store, said } = setup();
    ctl.applyState(snapshot());
    ctl.onCodes({ codes: { wink: 'tenho o zap' }, by: -1, at: 1 });
    ctl.onSignal({ seat: 1, signalId: 'wink', at: 2 }); // adversário
    ctl.onSignal({ seat: 0, signalId: 'wink', at: 3 }); // eu
    ctl.onSignal({ seat: 2, signalId: 'nod', at: 4 }); // parceiro, sem combinado
    expect(said).toEqual([
      'Bia: Piscar um olho',
      'Você: Piscar um olho',
      'Caio: Acenar com a cabeça',
    ]);
    expect(store.getState().partnerSignalNote).toBeNull();
  });
});

describe('5C: troca de ocupante na espera', () => {
  const full = () => waiting();
  const swapPartner = () =>
    waiting([0, 1, 2, 3].map((i) => (i === 2 ? player(2, { nickname: 'Novo' }) : player(i))));

  it('replacedSeats só vale entre dois estados de espera e ignora o meu assento', () => {
    const a = projectTable(full());
    const b = projectTable(swapPartner());
    expect(replacedSeats(a, b)).toEqual([2]);
    expect(replacedSeats(null, b)).toEqual([]);
    expect(replacedSeats(projectTable(snapshot()), b)).toEqual([]); // partida em andamento
    expect(replacedSeats(a, projectTable(snapshot()))).toEqual([]);
    const emptied = projectTable(
      waiting(
        [0, 1, 2, 3].map((i) =>
          i === 1 ? player(1, { nickname: '', status: 'empty' }) : player(i),
        ),
      ),
    );
    expect(replacedSeats(a, emptied)).toEqual([1]);
  });

  it('limpa o chat do assento e o chat da dupla, o balão e o não lido quando o parceiro muda', () => {
    const { ctl, store } = setup();
    ctl.applyState(full());
    ctl.onChat({ scope: 'partner', seat: 2, text: 'oi parceiro', at: 1 });
    ctl.onChat({ scope: 'partner', seat: 0, text: 'oi', at: 2 });
    ctl.onChat({ scope: 'table', seat: 2, text: 'oi mesa', at: 3 });
    ctl.onChat({ scope: 'table', seat: 1, text: 'adversário', at: 4 });
    expect(store.getState().chat).toHaveLength(4);
    ctl.applyState(swapPartner());
    // Só a conversa do adversário que ficou permanece.
    expect(store.getState().chat.map((c) => c.text)).toEqual(['adversário']);
    expect(store.getState().bubbles[2]).toBeUndefined();
    expect(store.getState().bubbles[1]).toBeDefined();
    expect(store.getState().chatUnread.partner).toBe(0);
  });

  it('troca de adversário NÃO apaga o chat da dupla', () => {
    const { ctl, store } = setup();
    ctl.applyState(full());
    ctl.onChat({ scope: 'partner', seat: 2, text: 'segredo', at: 1 });
    ctl.onChat({ scope: 'table', seat: 3, text: 'saindo', at: 2 });
    ctl.applyState(
      waiting([0, 1, 2, 3].map((i) => (i === 3 ? player(3, { nickname: 'Outro' }) : player(i)))),
    );
    expect(store.getState().chat.map((c) => c.text)).toEqual(['segredo']);
  });

  it('com a partida em andamento nada é apagado (bot de ausência herda o lugar)', () => {
    const { ctl, store } = setup();
    ctl.applyState(snapshot());
    ctl.onChat({ scope: 'table', seat: 2, text: 'oi', at: 1 });
    ctl.applyState(
      snapshot({
        players: [0, 1, 2, 3].map((i) => (i === 2 ? player(2, { nickname: 'Bot' }) : player(i))),
      }),
    );
    expect(store.getState().chat).toHaveLength(1);
  });
});

describe('5C: silenciar', () => {
  it('chat e balão de quem está silenciado não entram; os outros e o meu seguem', () => {
    const { ctl, store } = setup(['bia']);
    ctl.applyState(snapshot());
    ctl.onChat({ scope: 'table', seat: 1, text: 'spam', at: 1 });
    ctl.onChat({ scope: 'table', seat: 3, text: 'oi', at: 2 });
    ctl.onChat({ scope: 'table', seat: 0, text: 'meu', at: 3 });
    expect(store.getState().chat.map((c) => c.text)).toEqual(['oi', 'meu']);
    expect(store.getState().bubbles[1]).toBeUndefined();
    expect(store.getState().chatUnread.table).toBe(2);
  });

  it('o parceiro também pode ser silenciado no chat da dupla', () => {
    const { ctl, store } = setup(['caio']);
    ctl.applyState(snapshot());
    ctl.onChat({ scope: 'partner', seat: 2, text: 'oi', at: 1 });
    expect(store.getState().chat).toEqual([]);
  });
});
