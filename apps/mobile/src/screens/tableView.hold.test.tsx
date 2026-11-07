// @vitest-environment jsdom
/**
 * Pausa do fim da mão na tela: a mão nova já está no estado, mas durante o `hold` não há jogada possível,
 * a mão fica escondida e só a vaza final aparece. Depois da pausa a mão nova volta a valer.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLLECT_MS, HAND_HOLD_MS } from '../table/dealPlan';
import { projectTable } from '../table/projectTable';
import { priv, snapshot } from '../table/snapshotFixtures';
import type { LingeringTrick } from '../table/tableStore';
import { TableView } from './TableView';
import type { TableViewProps } from './TableView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = vi.fn();
const lingering: LingeringTrick = {
  plays: [
    { seat: 0, rank: 'K', suit: 'ouros', covered: false },
    { seat: 1, rank: '4', suit: 'paus', covered: false },
  ],
  winnerSeat: 1,
  ownCovered: null,
  handEnd: true,
};

function props(state: unknown, over: Partial<TableViewProps> = {}): TableViewProps {
  return {
    vm: projectTable(state),
    layout: 'phone',
    banner: null,
    connected: true,
    busy: false,
    selected: null,
    errorText: null,
    presenceNote: null,
    history: [],
    handLog: [],
    lingering: null,
    coverMode: false,
    probe: false,
    chatPanel: null,
    chatUnreadTotal: 0,
    bubbles: {},
    signals: {},
    reduceMotion: false,
    animateDeal: true,
    deadlineAt: 0,
    clockOffsetMs: 0,
    leaveConfirm: false,
    on: {
      pressCard: noop,
      act: noop,
      dismissError: noop,
      toggleCover: noop,
      voteCancel: noop,
      openChat: noop,
      signalEnd: noop,
      sendSignal: () => true,
      askLeave: noop,
      cancelLeave: noop,
      leave: noop,
    },
    ...over,
  } as TableViewProps;
}

const hand1 = snapshot();
const nextHand = (over: Record<string, unknown> = {}) =>
  snapshot({
    game: { handNumber: 2 },
    privates: priv(0, {
      hand: [{ rank: '3', suit: 'paus' }],
      legalActions: ['play:3paus', 'bet'],
    }),
    ...over,
  });

let root: Root;
let host: HTMLElement;
const render = (p: TableViewProps): void => act(() => root.render(<TableView {...p} />));
const advance = (ms: number): void => act(() => void vi.advanceTimersByTime(ms));
const cardDisabled = (): boolean =>
  host.querySelector('[aria-label="três de paus"]')?.getAttribute('aria-disabled') === 'true';

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('TableView: pausa do fim da mão', () => {
  it('durante o hold: sem jogada, sem aposta, vaza final visível; depois a mão nova vale', () => {
    render(props(hand1));
    render(props(nextHand(), { lingering }));
    expect(host.textContent).toContain('Vaza de Bia');
    expect(host.querySelector('[aria-label*="rei de ouros"]')).not.toBeNull();
    expect(cardDisabled()).toBe(true);
    expect(host.textContent).not.toContain('Truco!');
    advance(HAND_HOLD_MS - 1);
    expect(host.textContent).toContain('Vaza de Bia');
    expect(cardDisabled()).toBe(true);
    advance(1);
    expect(host.textContent).not.toContain('Vaza de Bia');
    advance(5000);
    expect(cardDisabled()).toBe(false);
  });

  it('bot que já jogou na mão nova durante o hold: a vaza final segue na mesa e a carta nova espera', () => {
    render(props(hand1));
    render(
      props(
        nextHand({
          hand: { current: [{ seat: 2, rank: '5', suit: 'espadas', covered: false }] },
        }),
        { lingering },
      ),
    );
    expect(host.textContent).toContain('Vaza de Bia');
    expect(host.querySelector('[aria-label*="rei de ouros"]')).not.toBeNull();
    expect(host.querySelector('[aria-label*="cinco de espadas"]')).toBeNull();
  });

  it('na troca de mão as cartas que já estavam na mesa não são remontadas (não deslizam de novo)', () => {
    const t1 = [
      { seat: 0, rank: 'K', suit: 'ouros', covered: false },
      { seat: 1, rank: '4', suit: 'paus', covered: false },
    ];
    render(
      props(
        snapshot({
          hand: { tricks: [], current: t1 },
        }),
      ),
    );
    const before = host.querySelector('[aria-label*="rei de ouros"]');
    expect(before).not.toBeNull();
    render(
      props(nextHand(), {
        lingering: {
          plays: t1,
          winnerSeat: 1,
          ownCovered: null,
          handEnd: true,
        },
      }),
    );
    expect(host.querySelector('[aria-label*="rei de ouros"]')).toBe(before);
  });

  it('durante o hold fica na mesa só a vaza final da mão que acabou (as outras já voltaram ao monte); depois some', () => {
    const t2 = [
      { seat: 1, rank: '5', suit: 'espadas', covered: false },
      { seat: 0, rank: 'A', suit: 'copas', covered: false },
    ];
    render(props(hand1));
    render(
      props(nextHand(), {
        lingering: {
          plays: t2,
          winnerSeat: 0,
          ownCovered: null,
          handEnd: true,
        },
      }),
    );
    for (const c of ['cinco de espadas', 'ás de copas']) {
      expect(host.querySelector(`[aria-label*="${c}"]`), c).not.toBeNull();
    }
    advance(HAND_HOLD_MS + 5000);
    expect(host.querySelector('[aria-label*="ás de copas"]')).toBeNull();
  });

  it('cartas do parceiro (onze/dez) não aparecem durante o hold', () => {
    const special = (): unknown =>
      nextHand({
        hand: { phase: 'specialDecision', special: 'maoDeOnze', specialTeam: 0 },
        privates: priv(0, {
          hand: [{ rank: '3', suit: 'paus' }],
          partnerCards: [{ rank: '7', suit: 'ouros' }],
          legalActions: ['accept', 'run'],
        }),
      });
    render(props(hand1));
    render(props(special(), { lingering }));
    expect(host.querySelector('[data-testid="partner-cards"]')).toBeNull();
    advance(5000);
    expect(host.querySelector('[data-testid="partner-cards"]')).not.toBeNull();
  });

  it('troca de jogo na série com handNumber igual (1 -> 1) também pausa', () => {
    render(props(hand1));
    render(
      props(snapshot({ series: { format: 'bo3', gameNumber: 2, games: [1, 0] } }), { lingering }),
    );
    expect(host.textContent).toContain('Vaza de Bia');
    expect(cardDisabled()).toBe(true);
  });

  it('estado novo sem a vaza final retida (reconexão): sem pausa', () => {
    render(props(hand1));
    render(props(nextHand()));
    expect(host.textContent).not.toContain('Vaza de Bia');
  });

  it('sem animação (E2E): nenhuma pausa', () => {
    render(props(hand1, { animateDeal: false }));
    render(props(nextHand(), { lingering, animateDeal: false }));
    expect(cardDisabled()).toBe(false);
  });
});

describe('TableView: recolher a cada vaza (meio da mão)', () => {
  const mid: LingeringTrick = {
    plays: [
      { seat: 0, rank: 'K', suit: 'ouros', covered: false },
      { seat: 1, rank: '4', suit: 'paus', covered: false },
    ],
    winnerSeat: 1,
    ownCovered: null,
  };
  const inTrick = snapshot({
    hand: { tricks: [], current: mid.plays },
  });
  const closed = snapshot({
    hand: {
      tricks: [{ starter: 0, winnerSeat: 1, winnerTeam: 1, plays: mid.plays }],
      current: [],
    },
  });

  it('a vaza fechada fica legível, depois as cartas voltam ao monte e a mesa fica limpa', () => {
    render(props(inTrick));
    render(props(closed, { lingering: mid }));
    expect(host.textContent).toContain('Vaza de Bia');
    expect(host.querySelector('[aria-label*="rei de ouros"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="deal-overlay"]')).toBeNull();
    // O controlador limpa a retenção: o recolher assume as cartas no lugar.
    render(props(closed, { lingering: null }));
    expect(host.textContent).not.toContain('Vaza de Bia');
    expect(host.querySelector('[data-testid="trick"] [aria-label*="rei de ouros"]')).toBeNull();
    expect(host.querySelector('[data-testid="deal-overlay"]')).not.toBeNull();
    advance(COLLECT_MS + 200);
    expect(host.querySelector('[data-testid="deal-overlay"]')).toBeNull();
  });

  it('jogada que chega durante o recolher só aparece depois dele', () => {
    render(props(inTrick));
    render(props(closed, { lingering: mid }));
    const next = snapshot({
      hand: {
        tricks: [{ starter: 0, winnerSeat: 1, winnerTeam: 1, plays: mid.plays }],
        current: [{ seat: 1, rank: 'A', suit: 'copas', covered: false }],
      },
    });
    render(props(next, { lingering: null }));
    expect(host.querySelector('[data-testid="trick"] [aria-label*="ás de copas"]')).toBeNull();
    advance(COLLECT_MS + 200);
    expect(host.querySelector('[data-testid="trick"] [aria-label*="ás de copas"]')).not.toBeNull();
  });

  it('sem animação (E2E) não há recolher: a retenção só some', () => {
    render(props(inTrick, { animateDeal: false }));
    render(props(closed, { lingering: mid, animateDeal: false }));
    render(props(closed, { lingering: null, animateDeal: false }));
    expect(host.querySelector('[data-testid="deal-overlay"]')).toBeNull();
  });
});

describe('TableView: retenção da vaza e a jogada seguinte', () => {
  const t1 = [
    { seat: 0, rank: 'K', suit: 'ouros', covered: false },
    { seat: 1, rank: '4', suit: 'paus', covered: false },
  ];
  const mid: LingeringTrick = { plays: t1, winnerSeat: 1, ownCovered: null };
  const mineLegal = priv(0, { hand: [{ rank: '3', suit: 'paus' }], legalActions: ['play:3paus'] });
  const closedBy = (current: typeof t1) =>
    snapshot({
      hand: { tricks: [{ starter: 0, winnerSeat: 1, winnerTeam: 1, plays: t1 }], current },
      privates: mineLegal,
    });
  const trickHas = (label: string): boolean =>
    host.querySelector(`[data-testid="trick"] [aria-label*="${label}"]`) !== null;

  it('bot que joga com a retenção ainda ativa: a carta nova espera o recolher e só então desliza para a mesa', () => {
    render(props(snapshot({ hand: { tricks: [], current: t1 }, privates: mineLegal })));
    render(
      props(closedBy([{ seat: 1, rank: 'A', suit: 'copas', covered: false }]), { lingering: mid }),
    );
    expect(trickHas('rei de ouros')).toBe(true);
    expect(trickHas('ás de copas')).toBe(false);
    render(
      props(closedBy([{ seat: 1, rank: 'A', suit: 'copas', covered: false }]), { lingering: null }),
    );
    expect(trickHas('rei de ouros')).toBe(false);
    expect(trickHas('ás de copas')).toBe(false);
    advance(COLLECT_MS + 200);
    expect(trickHas('ás de copas')).toBe(true);
  });

  it('na retenção e no recolher não se joga carta nem aparece "Sua vez"; depois volta ao normal', () => {
    render(props(snapshot({ hand: { tricks: [], current: t1 }, privates: mineLegal })));
    render(props(closedBy([]), { lingering: mid }));
    expect(cardDisabled()).toBe(true);
    expect(host.querySelector('[data-testid="turn-text"]')).toBeNull();
    render(props(closedBy([]), { lingering: null }));
    expect(cardDisabled()).toBe(true);
    expect(host.querySelector('[data-testid="turn-text"]')).toBeNull();
    advance(COLLECT_MS + 200);
    expect(cardDisabled()).toBe(false);
  });

  it('mão que acaba por correr sobre a vaza retida: pausa, recolhe junto e "Vaza de X" não fica sobre a distribuição', () => {
    render(props(snapshot({ hand: { tricks: [], current: t1 } })));
    render(props(closedBy([]), { lingering: mid }));
    const promoted: LingeringTrick = { ...mid, handEnd: true, handNumber: 1 };
    render(props(nextHand(), { lingering: promoted }));
    expect(host.textContent).toContain('Vaza de Bia');
    expect(trickHas('rei de ouros')).toBe(true);
    advance(HAND_HOLD_MS + 50);
    expect(host.querySelector('[data-testid="deal-overlay"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Vaza de Bia');
    expect(trickHas('rei de ouros')).toBe(false);
  });

  it('vaza retida + carta na vaza aberta no fim da mão: as duas ficam na mesa durante a pausa', () => {
    render(props(snapshot({ hand: { tricks: [], current: t1 } })));
    const last: LingeringTrick = {
      plays: [{ seat: 2, rank: 'A', suit: 'copas', covered: false }],
      winnerSeat: -1,
      ownCovered: null,
      handEnd: true,
      handNumber: 1,
      previous: { plays: t1, ownCovered: null },
    };
    render(props(nextHand(), { lingering: last }));
    expect(trickHas('rei de ouros')).toBe(true);
    expect(trickHas('quatro de paus')).toBe(true);
    expect(trickHas('ás de copas')).toBe(true);
  });
});
