import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import type { SignalId } from '@trucaco/protocol';
import { signalInfo } from './signals';

/** Duração do destaque estático quando o usuário pede menos movimento. */
export const REDUCED_MOTION_HIGHLIGHT_MS = 1000;

/** Folga do temporizador de segurança sobre a duração (cobre quadro perdido). */
const SAFETY_MARGIN_MS = 100;

export interface SignalRun {
  readonly id: SignalId;
  readonly reduceMotion: boolean;
  /** 0 -> 1 durante o sinal. */
  readonly progress: Animated.Value;
  /** Chamado uma vez quando o sinal termina (nunca se for cancelado). */
  readonly onEnd: () => void;
}

/**
 * Dispara UM sinal: no modo normal anima `progress` de 0 a 1 em `durationMs` (transform/opacity, com
 * driver nativo fora da web); com `reduceMotion` só espera 1 s (destaque estático). Um temporizador
 * de segurança garante o fim mesmo se o callback da animação não vier. Devolve o cancelamento.
 */
export function runSignal(run: SignalRun): () => void {
  let ended = false;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (): void => {
    if (ended || cancelled) return;
    ended = true;
    if (timer !== undefined) clearTimeout(timer);
    run.progress.setValue(0);
    run.onEnd();
  };
  if (run.reduceMotion) {
    timer = setTimeout(finish, REDUCED_MOTION_HIGHLIGHT_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }
  const duration = signalInfo(run.id).durationMs;
  run.progress.setValue(0);
  const anim = Animated.timing(run.progress, {
    toValue: 1,
    duration,
    easing: Easing.linear,
    useNativeDriver: Platform.OS !== 'web',
  });
  timer = setTimeout(finish, duration + SAFETY_MARGIN_MS);
  anim.start(({ finished }) => {
    if (finished) finish();
  });
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    anim.stop();
  };
}

export interface SignalAnimationInput {
  readonly signal: { readonly id: SignalId; readonly key: number } | null | undefined;
  readonly reduceMotion: boolean;
  readonly onSignalEnd?: (() => void) | undefined;
}

export interface SignalAnimationState {
  readonly progress: Animated.Value;
  /** Sinal em curso (ou `null` em repouso). */
  readonly activeId: SignalId | null;
  /** `true` durante o destaque estático de `reduceMotion`. */
  readonly highlight: boolean;
}

/**
 * Liga `signal` (muda a cada sinal por `key`, então o mesmo id duas vezes anima duas vezes) à
 * animação. Ao terminar volta ao ocioso e chama `onSignalEnd`. Sinal novo no meio de outro substitui
 * o anterior (a fila de 1 posição fica no cliente da mesa, não aqui).
 */
export function useSignalAnimation(input: SignalAnimationInput): SignalAnimationState {
  const progress = useRef(new Animated.Value(0)).current;
  const [activeId, setActiveId] = useState<SignalId | null>(null);
  const endRef = useRef(input.onSignalEnd);
  endRef.current = input.onSignalEnd;
  const id = input.signal?.id ?? null;
  const key = input.signal?.key ?? null;
  const reduce = input.reduceMotion;

  useEffect(() => {
    if (id === null) return undefined;
    setActiveId(id);
    const cancel = runSignal({
      id,
      reduceMotion: reduce,
      progress,
      onEnd: () => {
        setActiveId(null);
        endRef.current?.();
      },
    });
    return () => {
      cancel();
      setActiveId(null);
    };
  }, [id, key, reduce, progress]);

  return { progress, activeId, highlight: reduce && activeId !== null };
}

/** Duração de um ciclo de boca aberta e fechada (30 quadros a 60 fps, igual ao `speak_loop` do rig). */
export const SPEAK_CYCLE_MS = 500;

/**
 * Ciclo de fala 0 -> 1 em loop enquanto `speaking`. Devolve `null` quando não fala ou com menos
 * movimento (a boca fica parada; o balão já mostra o texto).
 */
export function useSpeakingAnimation(
  speaking: boolean,
  reduceMotion: boolean,
): Animated.Value | null {
  const talk = useRef(new Animated.Value(0)).current;
  const enabled = speaking && !reduceMotion;
  useEffect(() => {
    if (!enabled) return undefined;
    talk.setValue(0);
    const loop = Animated.loop(
      Animated.timing(talk, {
        toValue: 1,
        duration: SPEAK_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      talk.setValue(0);
    };
  }, [enabled, talk]);
  return enabled ? talk : null;
}

/** Respiração contínua + piscada aleatória a cada 3-7 s (ociosos locais; nunca passam pelo servidor). */
export function useIdleAnimation(enabled: boolean): {
  readonly breathe: Animated.Value;
  readonly blink: Animated.Value;
} {
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return undefined;
    const native = Platform.OS !== 'web';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: native,
        }),
      ]),
    );
    loop.start();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = (): void => {
      timer = setTimeout(
        () => {
          if (stopped) return;
          Animated.sequence([
            Animated.timing(blink, { toValue: 1, duration: 70, useNativeDriver: native }),
            Animated.timing(blink, { toValue: 0, duration: 90, useNativeDriver: native }),
          ]).start(() => {
            if (!stopped) schedule();
          });
        },
        3000 + Math.random() * 4000,
      );
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      loop.stop();
      blink.stopAnimation();
      blink.setValue(0);
    };
  }, [enabled, breathe, blink]);
  return { breathe, blink };
}
