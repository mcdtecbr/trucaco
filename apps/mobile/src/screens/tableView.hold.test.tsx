// @vitest-environment jsdom
/**
 * Pausa do fim da mão na tela: a mão nova já está no estado, mas durante o `hold` não há jogada possível,
 * a mão fica escondida e só a vaza final aparece. Depois da pausa a mão nova volta a valer.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAND_HOLD_MS } from '../table/dealPlan';
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
