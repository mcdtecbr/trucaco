/**
 * Interação sem renderer: percorre a árvore de elementos React e chama `props.onPress`.
 * (Sem jsdom/react-test-renderer: nenhuma dependência nova. Efeitos são testados nas funções
 * puras que os hooks usam: `startCountdown` e `createAnnouncerBinding`.)
 */
import type { ReactElement, ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BetButtons } from './BetButtons';
import { Card } from './Card';
import { HandFan } from './HandFan';
import { createAnnouncerBinding } from './useAnnouncer';
import { startCountdown } from './turn';

type AnyEl = ReactElement<{ onPress?: () => void; children?: ReactNode; disabled?: boolean }>;

function findPressable(node: ReactNode, out: AnyEl[] = []): AnyEl[] {
  Children.forEach(node, (c) => {
    if (!isValidElement(c)) return;
    const el = c as AnyEl;
    if (typeof el.props.onPress === 'function') out.push(el);
    findPressable(el.props.children, out);
  });
  return out;
}

describe('HandFan onPress', () => {
  const hand = [
    { rank: '3', suit: 'paus' },
    { rank: '7', suit: 'copas' },
    { rank: 'Q', suit: 'ouros' },
  ];

  it('chama onPress com o id exato da ação legal; carta ilegal fica desabilitada', () => {
    const onPress = vi.fn();
    const tree = HandFan({ hand, legalActions: ['play:7copas', 'playCovered:7copas'], onPress });
    const cards = findPressable(tree);
    expect(cards.filter((c) => c.type === Card)).toHaveLength(3);
    for (const c of cards) c.props.onPress?.();
    expect(onPress.mock.calls).toEqual([['play:7copas']]);
    expect(cards.map((c) => c.props.disabled)).toEqual([true, false, true]);
  });

  it('modo coberta e mão de ferro emitem playCovered e playBlind:<i>', () => {
    const a = vi.fn();
    findPressable(
      HandFan({
        hand,
        legalActions: ['play:7copas', 'playCovered:7copas'],
        coverMode: true,
        onPress: a,
      }),
    ).forEach((c) => c.props.onPress?.());
    expect(a.mock.calls).toEqual([['playCovered:7copas']]);
    const b = vi.fn();
    findPressable(
      HandFan({ hand: [], blindCount: 3, legalActions: ['playBlind:1'], onPress: b }),
    ).forEach((c) => c.props.onPress?.());
    expect(b.mock.calls).toEqual([['playBlind:1']]);
  });
});

describe('BetButtons onPress', () => {
  it('cada botão repassa o seu id', () => {
    const onPress = vi.fn();
    const tree = BetButtons({ legalActions: ['accept', 'bet', 'run'], raising: true, onPress });
    const btns = findPressable(tree);
    expect(btns).toHaveLength(3);
    btns.forEach((b) => b.props.onPress?.());
    expect(onPress.mock.calls.map((c) => c[0])).toEqual(['accept', 'bet', 'run']);
  });
});

describe('startCountdown', () => {
  function timers() {
    const set = vi.fn(() => 'h');
    const clear = vi.fn();
    return { set, clear, t: { setInterval: set, clearInterval: clear } };
  }

  it('para sozinho ao chegar a zero, depois do último tick', () => {
    let clock = 0;
    const tm = timers();
    const onTick = vi.fn();
    startCountdown({ deadlineAt: 1000, now: () => clock, onTick, timers: tm.t });
    const tick = (tm.set.mock.calls[0] as unknown as [() => void])[0];
    clock = 500;
    tick();
    expect(tm.clear).not.toHaveBeenCalled();
    clock = 1200;
    tick();
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(tm.clear).toHaveBeenCalledWith('h');
    tick();
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('sem prazo ou já expirado não liga o timer; cleanup antes do fim desliga uma vez', () => {
    const a = timers();
    startCountdown({ deadlineAt: 0, onTick: vi.fn(), timers: a.t });
    startCountdown({ deadlineAt: 100, now: () => 500, onTick: vi.fn(), timers: a.t });
    expect(a.set).not.toHaveBeenCalled();
    const stop = startCountdown({ deadlineAt: 9999, now: () => 0, onTick: vi.fn(), timers: a.t });
    stop();
    stop();
    expect(a.clear).toHaveBeenCalledTimes(1);
  });

  it('novo prazo religa (outro startCountdown) e o offset do servidor entra na conta', () => {
    const tm = timers();
    // cliente em 0, servidor 5000 à frente: prazo 5500 do servidor = 500 ms restantes.
    const onTick = vi.fn();
    startCountdown({ deadlineAt: 5500, now: () => 0, clockOffsetMs: 5000, onTick, timers: tm.t });
    startCountdown({ deadlineAt: 5500, now: () => 0, clockOffsetMs: 0, onTick, timers: tm.t });
    expect(tm.set).toHaveBeenCalledTimes(2);
    // com offset que já passou do prazo, não liga.
    const none = timers();
    startCountdown({ deadlineAt: 5500, now: () => 0, clockOffsetMs: 6000, onTick, timers: none.t });
    expect(none.set).not.toHaveBeenCalled();
  });
});

describe('createAnnouncerBinding (StrictMode)', () => {
  it('mount, unmount, mount: a fila nova entrega', () => {
    const b = createAnnouncerBinding({ gapMs: 10 });
    const deliver = vi.fn();
    b.announce('antes');
    const off1 = b.attach(deliver);
    b.announce('um');
    off1();
    b.announce('ignorado');
    const off2 = b.attach(deliver);
    b.announce('dois');
    expect(deliver.mock.calls.map((c) => c[0])).toEqual(['um', 'dois']);
    off2();
    b.announce('fim');
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('cleanup antigo não derruba a fila nova', () => {
    const b = createAnnouncerBinding();
    const deliver = vi.fn();
    const off1 = b.attach(deliver);
    const off2 = b.attach(deliver);
    off1();
    b.announce('x');
    expect(deliver).toHaveBeenCalledWith('x');
    off2();
  });
});
