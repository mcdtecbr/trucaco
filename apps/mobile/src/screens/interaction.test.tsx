// @vitest-environment jsdom
/**
 * Interação real da UI: react-native-web montado num DOM (jsdom) com o controlador e o store reais.
 * Cliques de verdade nos botões e digitação no campo; as mensagens que saem são as do `send` do
 * controlador (o mesmo caminho que vai ao Colyseus).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { SIGNALS } from '@trucaco/avatar';
import { useStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientMessage } from '@trucaco/protocol';
import { createTableController } from '../table/tableController';
import type { TableController, TableTimers } from '../table/tableController';
import { createTableStore } from '../table/tableStore';
import type { TableStore } from '../table/tableStore';
import { priv, snapshot } from '../table/snapshotFixtures';
import { finishedResult, rematchView } from '../table/tableRoute';
import { FinishedView } from './FinishedView';
import { ChatPanel } from './ChatPanel';
import { buildCodesPanelProps } from './codesPanelProps';
import { GUEST_CODES_NOTE, NO_PARTNER_NOTE } from './CodesPanel';
import { player } from '../table/snapshotFixtures';
import { TableView } from './TableView';
import { WaitingRoomView } from './WaitingRoomView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Relógio manual: o balão de 4 s é testado sem esperar. */
function fakeTimers() {
  let t = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const timers: TableTimers = {
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
  };
  return {
    timers,
    count: () => pending.size,
    advance(ms: number) {
      t += ms;
      for (const [id, p] of [...pending]) {
        if (p.at <= t) {
          pending.delete(id);
          p.fn();
        }
      }
    },
  };
}

interface Harness {
  store: TableStore;
  table: TableController;
  sent: ClientMessage[];
  clock: ReturnType<typeof fakeTimers>;
}

function Screen({ h }: { h: Harness }) {
  const s = useStore(h.store);
  const { table } = h;
  if (s.vm === null) return null;
  const vm = s.vm;
  return (
    <TableView
      vm={vm}
      layout="phone"
      banner={null}
      connected
      busy={s.busy}
      selected={s.selected}
      errorText={null}
      presenceNote={null}
      history={s.history}
      handLog={s.handLog}
      lingering={s.lingering}
      coverMode={s.coverMode}
      probe={false}
      chatUnreadTotal={s.chatUnread.table + s.chatUnread.partner}
      bubbles={s.bubbles}
      signals={s.signals}
      codes={s.codes}
      partnerSignalNote={s.partnerSignalNote}
      codesPanel={buildCodesPanelProps({
        codesOpen: s.codesOpen,
        codes: s.codes,
        codesError: s.codesError,
        seats: vm.seats,
        mySeat: vm.mySeat,
        connected: true,
        guest: true,
        table,
      })}
      reduceMotion={false}
      chatPanel={
        s.chatOpen
          ? {
              tab: s.chatTab,
              chat: s.chat,
              unread: s.chatUnread,
              draft: s.chatDraft[s.chatTab],
              errorText: null,
              connected: true,
              nicknameOf: (seat) => vm.seats[seat]?.nickname ?? '',
              mySeat: vm.mySeat,
              on: {
                setTab: (scope) => table.setChatTab(scope),
                setDraft: (text) => table.setChatDraft(s.chatTab, text),
                send: () => void table.sendChat(s.chatTab, s.chatDraft[s.chatTab]),
                phrase: (id) => void table.sendPhrase(s.chatTab, id),
                close: () => table.setChatOpen(false),
              },
            }
          : null
      }
      deadlineAt={0}
      clockOffsetMs={0}
      leaveConfirm={false}
      on={{
        pressCard: (id) => table.pressCard(id),
        act: (id) => void table.act(id),
        confirmSelected: () => {
          if (s.selected !== null) void table.act(s.selected);
        },
        dismissError: () => table.clearError(),
        toggleCover: () => undefined,
        voteCancel: () => void table.voteCancel(),
        openChat: () => table.setChatOpen(true),
        openCodes: () => table.setCodesOpen(true),
        signalEnd: table.onSignalEnd,
        sendSignal: (id) => table.sendSignal(id),
        askLeave: () => undefined,
        cancelLeave: () => undefined,
        leave: () => undefined,
      }}
    />
  );
}

let root: Root | null = null;
let host: HTMLElement;
let h: Harness;

function mount(state: unknown): void {
  const store = createTableStore();
  const clock = fakeTimers();
  const sent: ClientMessage[] = [];
  const table = createTableController({
    store,
    send: (m) => {
      sent.push(m);
      return true;
    },
    timers: clock.timers,
  });
  h = { store, table, sent, clock };
  table.applyState(state);
  const r = createRoot(host);
  root = r;
  act(() => r.render(<Screen h={h} />));
}

const byTestId = (id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);
function must(id: string): HTMLElement {
  const el = byTestId(id);
  if (el === null) throw new Error(`sem elemento ${id}`);
  return el;
}
function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
/** Digita no input: setter nativo + evento `input`, o que o React escuta. */
function type(el: HTMLElement, value: string): void {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  const r = root;
  if (r !== null) act(() => r.unmount());
  root = null;
  host.remove();
});

describe('mesa: interação real', () => {
  it('carta: o toque seleciona e o botão de confirmar envia play', () => {
    mount(snapshot());
    const card = host.querySelector('[aria-label*="três de paus"]');
    expect(card).not.toBeNull();
    click(card as HTMLElement);
    expect(h.sent).toEqual([]);
    expect(h.store.getState().selected).toBe('play:3paus');
    click(must('confirm-play'));
    expect(h.sent).toEqual([{ type: 'play', card: { rank: '3', suit: 'paus' } }]);
  });

  it('carta fora de legalActions não envia nada', () => {
    mount(
      snapshot({
        privates: priv(0, { hand: [{ rank: '3', suit: 'paus' }], legalActions: [] }),
      }),
    );
    const card = host.querySelector('[aria-label*="três de paus"]');
    expect(card).not.toBeNull();
    click(card as HTMLElement);
    click(card as HTMLElement);
    expect(h.store.getState().selected).toBeNull();
    expect(byTestId('confirm-play')).toBeNull();
    expect(h.sent).toEqual([]);
  });

  it('chat da mesa: abrir, digitar, enviar; o campo esvazia', () => {
    mount(snapshot());
    click(must('open-chat'));
    expect(byTestId('chat-panel')).not.toBeNull();
    type(must('chat-input'), 'Boa jogada');
    click(must('chat-send'));
    expect(h.sent).toEqual([{ type: 'chat', scope: 'table', text: 'Boa jogada' }]);
    expect((must('chat-input') as HTMLInputElement).value).toBe('');
  });

  it('chat da dupla: a aba Dupla envia scope partner e mostra a dica de privacidade', () => {
    mount(snapshot());
    click(must('open-chat'));
    click(must('chat-tab-partner'));
    expect(host.textContent).toContain('Só a sua dupla vê esta conversa.');
    type(must('chat-input'), 'tenho zap');
    click(must('chat-send'));
    expect(h.sent).toEqual([{ type: 'chat', scope: 'partner', text: 'tenho zap' }]);
    // Rascunhos separados por aba: a Mesa continua vazia.
    click(must('chat-tab-table'));
    expect((must('chat-input') as HTMLInputElement).value).toBe('');
  });

  it('frase rápida sai como phraseId', () => {
    mount(snapshot());
    click(must('open-chat'));
    click(host.querySelector('[data-testid^="chat-phrase-"]') as HTMLElement);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'chat', scope: 'table' });
    expect(h.sent[0]).toHaveProperty('phraseId');
  });

  it('texto só de espaços não envia', () => {
    mount(snapshot());
    click(must('open-chat'));
    type(must('chat-input'), '   ');
    click(must('chat-send'));
    expect(h.sent).toEqual([]);
  });

  it('voto de cancelar envia voteCancel', () => {
    mount(snapshot());
    click(host.querySelector('[aria-label*="Votar para cancelar"]') as HTMLElement);
    expect(h.sent).toEqual([{ type: 'voteCancel' }]);
  });

  it('já votei: o botão não envia de novo', () => {
    mount(snapshot({ cancelVotes: [0] }));
    const btn = host.querySelector('[aria-label*="já votou"]');
    expect(btn).not.toBeNull();
    click(btn as HTMLElement);
    expect(h.sent).toEqual([]);
  });
});

describe('balão de chat sobre o avatar', () => {
  it('aparece no assento que falou, é texto puro e some em 4 s', () => {
    mount(snapshot());
    expect(h.clock.count()).toBe(0);
    act(() =>
      h.table.onChat({ scope: 'table', seat: 1, text: '<img src=x onerror=alert(1)>', at: 1 }),
    );
    const bubble = byTestId('bubble-1');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('img')).toBeNull();
    expect(bubble?.textContent).toContain('<img src=x onerror=alert(1)>');
    act(() => h.clock.advance(3999));
    expect(byTestId('bubble-1')).not.toBeNull();
    act(() => h.clock.advance(1));
    expect(byTestId('bubble-1')).toBeNull();
  });

  it('o balão novo substitui o anterior e reinicia o prazo', () => {
    mount(snapshot());
    act(() => h.table.onChat({ scope: 'table', seat: 2, text: 'primeiro', at: 1 }));
    act(() => h.clock.advance(3000));
    act(() => h.table.onChat({ scope: 'table', seat: 2, text: 'segundo', at: 2 }));
    expect(byTestId('bubble-2')?.textContent).toContain('segundo');
    expect(byTestId('bubble-2')?.textContent).not.toContain('primeiro');
    act(() => h.clock.advance(3000));
    expect(byTestId('bubble-2')).not.toBeNull();
    act(() => h.clock.advance(1000));
    expect(byTestId('bubble-2')).toBeNull();
    expect(h.clock.count()).toBe(0);
  });

  it('assentos diferentes convivem; o meu aparece no rodapé', () => {
    mount(snapshot());
    act(() => {
      h.table.onChat({ scope: 'table', seat: 0, text: 'eu', at: 1 });
      h.table.onChat({ scope: 'table', seat: 3, text: 'outro', at: 2 });
    });
    expect(must('my-seat').querySelector('[data-testid="bubble-0"]')).not.toBeNull();
    expect(byTestId('bubble-3')).not.toBeNull();
    // O balão do outro assento NÃO está no rodapé.
    expect(must('my-seat').querySelector('[data-testid="bubble-3"]')).toBeNull();
    expect(must('table-seat-3').querySelector('[data-testid="bubble-3"]')).not.toBeNull();
  });

  it('chat da dupla: mensagem de adversário é descartada; a da dupla ganha rótulo', () => {
    mount(snapshot());
    act(() => h.table.onChat({ scope: 'partner', seat: 1, text: 'segredo', at: 1 }));
    expect(byTestId('bubble-1')).toBeNull();
    act(() => h.table.onChat({ scope: 'partner', seat: 2, text: 'da dupla', at: 2 }));
    expect(byTestId('bubble-2')?.textContent).toContain('da dupla');
    expect(byTestId('bubble-2')?.textContent).toContain('Dupla');
  });

  it('reset (sair da mesa) limpa os temporizadores e os balões', () => {
    mount(snapshot());
    act(() => h.table.onChat({ scope: 'table', seat: 1, text: 'oi', at: 1 }));
    expect(h.clock.count()).toBe(1);
    act(() => h.table.reset());
    expect(h.clock.count()).toBe(0);
    expect(h.store.getState().bubbles).toEqual({});
  });
});

describe('ChatPanel na sala de espera (só a aba Mesa)', () => {
  it('scopes=[table] esconde a aba Dupla', () => {
    const noop = (): void => undefined;
    const r = createRoot(host);
    root = r;
    act(() =>
      r.render(
        <ChatPanel
          tab="table"
          chat={[]}
          unread={{ table: 0, partner: 0 }}
          draft=""
          errorText={null}
          connected
          nicknameOf={() => ''}
          mySeat={0}
          scopes={['table']}
          on={{ setTab: noop, setDraft: noop, send: noop, phrase: noop, close: noop }}
        />,
      ),
    );
    expect(byTestId('chat-tab-table')).not.toBeNull();
    expect(byTestId('chat-tab-partner')).toBeNull();
  });
});

describe('sala de espera com chat da mesa', () => {
  it('botão Chat abre o painel só com a aba Mesa e envia scope table', () => {
    const store = createTableStore();
    const sent: ClientMessage[] = [];
    const table = createTableController({
      store,
      send: (m) => {
        sent.push(m);
        return true;
      },
    });
    function Waiting() {
      const s = useStore(store);
      return (
        <WaitingRoomView
          roomCode="ABCDEFGH"
          seats={[]}
          mySeat={0}
          connection="connected"
          errorCode={null}
          shareLabel="Compartilhar"
          shareDoneText="ok"
          shareFailedText="falhou"
          shareFeedback="idle"
          chatUnreadTotal={s.chatUnread.table}
          chatPanel={
            s.chatOpen
              ? {
                  tab: 'table',
                  chat: s.chat,
                  unread: s.chatUnread,
                  draft: s.chatDraft.table,
                  errorText: null,
                  connected: true,
                  nicknameOf: () => 'Ana',
                  mySeat: 0,
                  scopes: ['table'],
                  on: {
                    setTab: () => undefined,
                    setDraft: (t) => table.setChatDraft('table', t),
                    send: () => void table.sendChat('table', s.chatDraft.table),
                    phrase: (id) => void table.sendPhrase('table', id),
                    close: () => table.setChatOpen(false),
                  },
                }
              : null
          }
          on={{
            share: () => undefined,
            leave: () => undefined,
            openChat: () => table.setChatOpen(true),
          }}
        />
      );
    }
    const r = createRoot(host);
    root = r;
    act(() => r.render(<Waiting />));
    click(must('open-chat'));
    expect(byTestId('chat-tab-partner')).toBeNull();
    type(must('chat-input'), 'Quem falta?');
    click(must('chat-send'));
    expect(sent).toEqual([{ type: 'chat', scope: 'table', text: 'Quem falta?' }]);
    act(() => table.onChat({ scope: 'table', seat: 1, text: 'Já vou', at: 1 }));
    expect(host.textContent).toContain('Já vou');
  });
});

describe('revanche: interação real', () => {
  it('clicar "Jogar de novo" envia voteRematch uma vez e depois mostra a espera', () => {
    const store = createTableStore();
    const sent: ClientMessage[] = [];
    const table = createTableController({
      store,
      send: (m) => {
        sent.push(m);
        return true;
      },
    });
    const state = (votes: number[]) =>
      snapshot({
        phase: 'finished',
        series: { winnerTeam: 0 },
        rematchDeadlineAt: Date.now() + 30_000,
        rematchVotes: votes,
        hand: { phase: 'finished', turn: -1, actingSeat: -1 },
        privates: priv(0),
      });
    table.applyState(state([]));
    function Finished() {
      const s = useStore(store);
      return (
        <FinishedView
          result={finishedResult(s.vm)}
          myTeam={0}
          history={[]}
          onLeave={() => undefined}
          rematch={rematchView(s.vm)}
          onRematch={() => void table.voteRematch()}
        />
      );
    }
    const r = createRoot(host);
    root = r;
    act(() => r.render(<Finished />));
    click(must('rematch'));
    click(must('rematch'));
    expect(sent).toEqual([{ type: 'voteRematch' }]);
    // O servidor reflete o voto: o botão vira espera e não reenvia.
    act(() => table.applyState(state([0])));
    expect(host.textContent).toContain('Aguardando a mesa (1 votou)');
    click(must('rematch'));
    expect(sent).toHaveLength(1);
  });
});

describe('4E: sinais na mesa', () => {
  /** Registra cada valor de `signals` (o avatar do jsdom pode terminar o sinal já dentro do `act`). */
  function recordSignals(): Array<Record<number, { id: string }>> {
    const seen: Array<Record<number, { id: string }>> = [];
    h.store.subscribe((s, prev) => {
      if (s.signals !== prev.signals) seen.push(s.signals);
    });
    return seen;
  }

  it('o sinal recebido chega ao avatar do assento e o fim do sinal libera o assento', () => {
    mount(snapshot());
    expect(byTestId('avatar-1')).not.toBeNull();
    expect(byTestId('avatar-1-signal-wink')).toBeNull();
    const seen = recordSignals();
    act(() => h.table.onSignal({ seat: 1, signalId: 'wink', at: 1 }));
    expect(seen[0]?.[1]?.id).toBe('wink');
    expect(seen[0]?.[2]).toBeUndefined(); // só o assento que sinalizou
    // O avatar avisou o fim (onSignalEnd -> controlador): o assento ficou livre.
    expect(h.store.getState().signals[1]).toBeUndefined();
  });

  it('o meu próprio sinal também é entregue ao meu avatar (público para os 4)', () => {
    mount(snapshot());
    const me = h.store.getState().vm?.mySeat ?? -1;
    const seen = recordSignals();
    act(() => h.table.onSignal({ seat: me, signalId: 'nod', at: 1 }));
    expect(seen[0]?.[me]?.id).toBe('nod');
  });

  it('painel: abrir mostra os 12 sinais com nome; toque rápido NÃO envia', () => {
    mount(snapshot());
    expect(byTestId('signal-grid')).toBeNull();
    click(must('signal-toggle'));
    expect(byTestId('signal-grid')).not.toBeNull();
    for (const s of SIGNALS) {
      const b = must(`signal-${s.id}`);
      expect(b.textContent).toBe(s.name);
      expect(b.getAttribute('aria-label')).toBe(s.name);
    }
    expect(h.sent).toEqual([]);
  });

  it('painel: clique sem toque prévio (leitor de tela) envia e inicia o cooldown visual', () => {
    mount(snapshot());
    click(must('signal-toggle'));
    click(must('signal-nod'));
    expect(h.sent).toEqual([{ type: 'signal', signalId: 'nod' }]);
    // Fechou e entrou em cooldown: não envia outro até acabar.
    expect(byTestId('signal-grid')).toBeNull();
    expect(must('signal-toggle').textContent).toContain('aguarde');
    click(must('signal-toggle'));
    click(must('signal-wink'));
    expect(h.sent).toHaveLength(1);
  });
});

describe('5D: combinar sinais', () => {
  it('abre pela mesa com os 12 sinais, sugestão como placeholder e contador 0/60', () => {
    mount(snapshot());
    expect(byTestId('codes-panel')).toBeNull();
    click(must('open-codes'));
    expect(byTestId('codes-panel')).not.toBeNull();
    for (const s of SIGNALS) {
      const input = must(`code-input-${s.id}`) as HTMLInputElement;
      expect(input.value).toBe('');
      expect(input.placeholder).toBe(`Ex.: ${s.meaning}`);
      expect(must(`code-count-${s.id}`).textContent).toBe('0/60');
    }
    expect(must('codes-partner').textContent).toBe('Parceiro: Caio');
    expect(must('codes-guest').textContent).toBe(GUEST_CODES_NOTE);
    expect(must('codes-privacy').textContent).toContain('adversários veem o sinal');
    click(must('codes-close'));
    expect(byTestId('codes-panel')).toBeNull();
  });

  it('digitar atualiza o contador; Salvar só habilita com mudança e envia setCode', () => {
    mount(snapshot());
    click(must('open-codes'));
    const save = () => must('code-save-wink') as HTMLButtonElement;
    expect(save().getAttribute('aria-disabled')).toBe('true');
    type(must('code-input-wink'), 'tenho o zap');
    expect(must('code-count-wink').textContent).toBe('11/60');
    expect(save().getAttribute('aria-disabled')).not.toBe('true');
    click(save());
    expect(h.sent).toEqual([{ type: 'setCode', signalId: 'wink', meaning: 'tenho o zap' }]);
    // O servidor ecoa o mapa: o campo segue o servidor e o botão volta a desabilitar.
    act(() => h.table.onCodes({ codes: { wink: 'tenho o zap' }, by: 0, at: 1 }));
    expect((must('code-input-wink') as HTMLInputElement).value).toBe('tenho o zap');
    expect(save().getAttribute('aria-disabled')).toBe('true');
  });

  it('apagar: campo esvaziado vira "Apagar" e envia meaning vazio', () => {
    mount(snapshot());
    act(() => h.table.onCodes({ codes: { nod: 'sim' }, by: -1, at: 1 }));
    click(must('open-codes'));
    type(must('code-input-nod'), '');
    expect(must('code-save-nod').textContent).toBe('Apagar');
    click(must('code-save-nod'));
    expect(h.sent).toEqual([{ type: 'setCode', signalId: 'nod', meaning: '' }]);
  });

  it('a edição do parceiro aparece ao vivo no campo (sem rascunho local)', () => {
    mount(snapshot());
    click(must('open-codes'));
    act(() => h.table.onCodes({ codes: { smile: 'blefe' }, by: 2, at: 1 }));
    expect((must('code-input-smile') as HTMLInputElement).value).toBe('blefe');
  });

  it('texto recusado mostra o erro em pt-BR e nada é enviado', () => {
    mount(snapshot());
    click(must('open-codes'));
    type(must('code-input-wink'), 'a‍b');
    click(must('code-save-wink'));
    expect(h.sent).toEqual([]);
    expect(must('codes-error').textContent).toContain('Texto não aceito');
  });

  it('erro RATE_LIMITED do servidor aparece no painel', () => {
    mount(snapshot());
    click(must('open-codes'));
    type(must('code-input-wink'), 'zap');
    click(must('code-save-wink'));
    act(() => h.table.onServerError({ code: 'RATE_LIMITED' }));
    expect(must('codes-error').textContent).toContain('Aguarde um segundo');
  });

  it('sem parceiro humano: aviso, campos desabilitados e nada é enviado', () => {
    mount(
      snapshot({
        players: [0, 1, 2, 3].map((i) =>
          i === 2 ? player(2, { nickname: '', status: 'empty' }) : player(i),
        ),
      }),
    );
    click(must('open-codes'));
    expect(must('codes-no-partner').textContent).toBe(NO_PARTNER_NOTE);
    expect((must('code-input-wink') as HTMLInputElement).readOnly).toBe(true);
    click(must('code-save-wink'));
    expect(h.sent).toEqual([]);
  });

  it('o combinado aparece sob cada sinal no painel de sinais e no rótulo de acessibilidade', () => {
    mount(snapshot());
    act(() => h.table.onCodes({ codes: { wink: 'tenho o zap' }, by: -1, at: 1 }));
    click(must('signal-toggle'));
    expect(must('signal-meaning-wink').textContent).toBe('tenho o zap');
    expect(must('signal-wink').getAttribute('aria-label')).toBe(
      'Piscar um olho, combinado: tenho o zap',
    );
    expect(byTestId('signal-meaning-nod')).toBeNull();
    expect(must('signal-nod').getAttribute('aria-label')).toBe('Acenar com a cabeça');
  });

  it('sinal do parceiro mostra o combinado na mesa; o do adversário não; some em 5 s', () => {
    mount(snapshot());
    act(() => h.table.onCodes({ codes: { wink: 'tenho o zap' }, by: -1, at: 1 }));
    act(() => h.table.onSignal({ seat: 1, signalId: 'wink', at: 2 }));
    expect(byTestId('partner-signal-note')).toBeNull();
    act(() => h.table.onSignal({ seat: 2, signalId: 'wink', at: 3 }));
    expect(must('partner-signal-note').textContent).toBe('Caio: Piscar um olho = tenho o zap');
    act(() => h.clock.advance(5000));
    expect(byTestId('partner-signal-note')).toBeNull();
  });

  it('o significado é sempre texto puro (nunca HTML)', () => {
    mount(snapshot());
    act(() => h.table.onCodes({ codes: { wink: '<img src=x onerror=alert(1)>' }, by: -1, at: 1 }));
    click(must('signal-toggle'));
    expect(host.querySelector('img[src="x"]')).toBeNull();
    expect(must('signal-meaning-wink').textContent).toBe('<img src=x onerror=alert(1)>');
    click(must('open-codes'));
    expect((must('code-input-wink') as HTMLInputElement).value).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('adversário (assento 1) sem codes: painel vazio e nenhum significado no painel de sinais', () => {
    mount(snapshot({ privates: priv(1) }));
    click(must('signal-toggle'));
    expect(host.querySelector('[data-testid^="signal-meaning-"]')).toBeNull();
    click(must('open-codes'));
    expect((must('code-input-wink') as HTMLInputElement).value).toBe('');
  });
});

describe('5D: silenciar e chat da dupla na espera', () => {
  function chatPanel(over: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
    const noop = (): void => undefined;
    const calls: number[] = [];
    const r = createRoot(host);
    root = r;
    act(() =>
      r.render(
        <ChatPanel
          tab="table"
          chat={[
            { id: 1, scope: 'table', seat: 1, text: 'spam da Bia', at: 1 },
            { id: 2, scope: 'table', seat: 3, text: 'oi do Davi', at: 2 },
          ]}
          unread={{ table: 0, partner: 0 }}
          draft=""
          errorText={null}
          connected
          nicknameOf={(s) => ['Ana', 'Bia', 'Caio', 'Davi'][s] ?? ''}
          mySeat={0}
          mutes={[
            { seat: 1, name: 'Bia', muted: true },
            { seat: 2, name: 'Caio', muted: false },
          ]}
          on={{
            toggleMute: (seat) => calls.push(seat),
            setTab: noop,
            setDraft: noop,
            send: noop,
            phrase: noop,
            close: noop,
          }}
          {...over}
        />,
      ),
    );
    return calls;
  }

  it('o chat de quem está silenciado some da lista; os botões alternam silenciar e reativar', () => {
    const calls = chatPanel();
    expect(host.textContent).not.toContain('spam da Bia');
    expect(host.textContent).toContain('oi do Davi');
    expect(must('chat-mute-1').textContent).toBe('Reativar Bia');
    expect(must('chat-mute-2').textContent).toBe('Silenciar Caio');
    expect(must('chat-mute-2').getAttribute('aria-label')).toContain('Só neste aparelho');
    click(must('chat-mute-2'));
    expect(calls).toEqual([2]);
  });

  it('com scopes mesa e dupla (sala de espera), a aba Dupla existe', () => {
    chatPanel({ scopes: ['table', 'partner'] });
    expect(byTestId('chat-tab-partner')).not.toBeNull();
  });
});

describe('5D: sala de espera', () => {
  it('Combinar sinais abre o painel; sem assento o botão não aparece', () => {
    const store = createTableStore();
    const table = createTableController({ store, send: () => true });
    function Waiting({ mySeat }: { mySeat: number }) {
      const s = useStore(store);
      const seats = [0, 1, 2, 3].map((i) => ({
        seat: i,
        nickname: ['Ana', 'Bia', 'Caio', 'Davi'][i] ?? '',
        status: 'connected',
        isBot: false,
      }));
      return (
        <WaitingRoomView
          roomCode="ABCDEFGH"
          seats={[]}
          mySeat={mySeat}
          connection="connected"
          errorCode={null}
          shareLabel="Compartilhar"
          shareDoneText="ok"
          shareFailedText="falhou"
          shareFeedback="idle"
          codesPanel={buildCodesPanelProps({
            codesOpen: s.codesOpen,
            codes: s.codes,
            codesError: s.codesError,
            seats,
            mySeat,
            connected: true,
            guest: true,
            table,
          })}
          on={{
            share: () => undefined,
            leave: () => undefined,
            openCodes: () => table.setCodesOpen(true),
          }}
        />
      );
    }
    const r = createRoot(host);
    root = r;
    act(() => r.render(<Waiting mySeat={0} />));
    click(must('open-codes'));
    expect(byTestId('codes-panel')).not.toBeNull();
    expect(must('codes-partner').textContent).toBe('Parceiro: Caio');
    act(() => table.onCodes({ codes: { wink: 'zap' }, by: -1, at: 1 }));
    expect((must('code-input-wink') as HTMLInputElement).value).toBe('zap');
    act(() => r.render(<Waiting mySeat={-1} />));
    expect(byTestId('open-codes')).toBeNull();
    expect(byTestId('codes-panel')).toBeNull();
  });
});
