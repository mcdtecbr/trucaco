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
