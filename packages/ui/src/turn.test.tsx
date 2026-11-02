import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TurnTimer } from './TurnTimer';
import { startTicker, timerState } from './turn';

describe('timerState', () => {
  it('sem prazo (0, negativo, NaN) fica inativo', () => {
    for (const d of [0, -5, Number.NaN]) expect(timerState(d, 1000).active).toBe(false);
  });

  it('calcula restante, fração, segundos (teto) e urgência com relógio falso', () => {
    const s = timerState(30_000, 20_000, 20_000);
    expect(s).toMatchObject({
      active: true,
      remainingMs: 10_000,
      fraction: 0.5,
      seconds: 10,
      urgent: false,
    });
    expect(timerState(30_000, 25_500, 20_000)).toMatchObject({ seconds: 5, urgent: true });
    expect(timerState(30_000, 29_999, 20_000).seconds).toBe(1);
  });

  it('expirado trava em zero; fração não passa de 1', () => {
    expect(timerState(1000, 5000)).toMatchObject({
      remainingMs: 0,
      fraction: 0,
      seconds: 0,
      urgent: true,
    });
    expect(timerState(100_000, 0, 20_000).fraction).toBe(1);
    expect(timerState(100, 0, 0).fraction).toBe(0);
  });
});

describe('startTicker', () => {
  it('liga com 250 ms por padrão e desliga ao parar', () => {
    const set = vi.fn(() => 'h');
    const clear = vi.fn();
    const stop = startTicker(() => {}, undefined, { setInterval: set, clearInterval: clear });
    expect(set).toHaveBeenCalledWith(expect.any(Function), 250);
    stop();
    expect(clear).toHaveBeenCalledWith('h');
  });

  it('usa os timers globais quando não injetados', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const stop = startTicker(tick);
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });
});

describe('TurnTimer', () => {
  it('renderiza papel timer com segundos restantes (relógio injetado)', () => {
    const html = renderToStaticMarkup(<TurnTimer deadlineAt={13_000} now={() => 10_000} />);
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-label="Tempo restante: 3 segundos"');
    expect(html).toContain('3 s');
  });

  it('singular e ausência de prazo', () => {
    expect(renderToStaticMarkup(<TurnTimer deadlineAt={10_500} now={() => 10_000} />)).toContain(
      'Tempo restante: 1 segundo"',
    );
    expect(renderToStaticMarkup(<TurnTimer deadlineAt={0} />)).toBe('');
  });
});
