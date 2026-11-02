import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGNAL_IDS } from '@trucaco/protocol';
import { MAX_SIGNAL_DURATION_MS, signalInfo } from './signals';

// O Animated do react-native-web vira um mock instantâneo quando NODE_ENV === 'test'. Para exercitar
// o temporizador real, recarregamos os módulos com NODE_ENV diferente.
type RN = typeof import('react-native');
type Mod = typeof import('./useSignalAnimation');
let Animated: RN['Animated'];
let mod: Mod;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.resetModules();
  Animated = (await import('react-native')).Animated;
  mod = await import('./useSignalAnimation');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runSignal (ciclo de animação)', () => {
  it.each(SIGNAL_IDS)('%s termina e volta ao ocioso em até 1,2 s, sem aviso no console', (id) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const progress = new Animated.Value(0);
    const onEnd = vi.fn();
    mod.runSignal({ id, reduceMotion: false, progress, onEnd });
    vi.advanceTimersByTime(signalInfo(id).durationMs - 100);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MAX_SIGNAL_DURATION_MS - signalInfo(id).durationMs + 100);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('o mesmo sinal duas vezes seguidas anima duas vezes', () => {
    const progress = new Animated.Value(0);
    const onEnd = vi.fn();
    mod.runSignal({ id: 'wink', reduceMotion: false, progress, onEnd });
    vi.advanceTimersByTime(MAX_SIGNAL_DURATION_MS);
    mod.runSignal({ id: 'wink', reduceMotion: false, progress, onEnd });
    vi.advanceTimersByTime(MAX_SIGNAL_DURATION_MS);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('cancelar impede o onEnd', () => {
    const onEnd = vi.fn();
    const cancel = mod.runSignal({
      id: 'nod',
      reduceMotion: false,
      progress: new Animated.Value(0),
      onEnd,
    });
    vi.advanceTimersByTime(300);
    cancel();
    vi.advanceTimersByTime(3000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('reduceMotion: destaque estático de 1 s sem animar', () => {
    const timing = vi.spyOn(Animated, 'timing');
    const onEnd = vi.fn();
    mod.runSignal({ id: 'smile', reduceMotion: true, progress: new Animated.Value(0), onEnd });
    expect(timing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(mod.REDUCED_MOTION_HIGHLIGHT_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    timing.mockRestore();
  });
});
