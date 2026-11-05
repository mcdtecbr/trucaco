import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Card, cardSizes, screenPosition } from '@trucaco/ui';
import type { ScreenPosition } from '@trucaco/ui';
import { DEAL_FLIGHT_MS, dealDecision, dealPlan } from './dealPlan';
import type { DealPlan } from './dealPlan';

/**
 * Embaralhar, distribuir e recolher: camada puramente visual sobre o pano. Sem eventos de toque
 * (`pointerEvents="none"`), fora da árvore de acessibilidade, e nunca retém o jogo: o estado vem do
 * servidor e esta camada só desenha. Um único `Animated.Value` (relógio em ms) guia todas as cartas.
 */

export type DealPhase = 'idle' | 'dealing' | 'vira';

export interface DealSequence {
  readonly phase: DealPhase;
  /** `null` quando não há animação em curso. */
  readonly run: { readonly id: number; readonly plan: DealPlan } | null;
  /** A mão do jogador local fica escondida até as cartas dele chegarem. */
  readonly handHidden: boolean;
  /** A vira aparece depois da distribuição. */
  readonly viraHidden: boolean;
}

const IDLE: DealSequence = { phase: 'idle', run: null, handHidden: false, viraHidden: false };

/**
 * Observa a mão em curso (`key` = partida:mão) e dispara a sequência quando ela muda. `enabled` falso
 * (reduzir movimento, testes, E2E) = nunca anima: só o estado final. Os temporizadores se desfazem na
 * troca de mão e na desmontagem: nada fica preso.
 */
export function useDealSequence(opts: {
  key: string;
  enabled: boolean;
  pe: number;
  mySeat: number;
  /** A mão acabou de começar (sem vazas e sem jogadas); falso em reconexão no meio da mão. */
  fresh?: boolean;
}): DealSequence {
  const { key, enabled, pe, mySeat } = opts;
  const fresh = opts.fresh ?? true;
  const prev = useRef<string | null>(null);
  const runId = useRef(0);
  const [seq, setSeq] = useState<DealSequence>(IDLE);

  useEffect(() => {
    const decision = dealDecision(prev.current, key, enabled, fresh);
    prev.current = key;
    if (!decision.animate || mySeat < 0) {
      setSeq(IDLE);
      return undefined;
    }
    const plan = dealPlan({ pe, mySeat, collect: decision.collect });
    const run = { id: ++runId.current, plan };
    setSeq({ phase: 'dealing', run, handHidden: true, viraHidden: true });
    const t1 = setTimeout(
      () => setSeq({ phase: 'vira', run, handHidden: false, viraHidden: true }),
      plan.selfLandedMs,
    );
    const t2 = setTimeout(() => setSeq(IDLE), plan.endMs + 50);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // `pe` e `mySeat` mudam junto com a mão; a sequência só reinicia quando a mão muda.
  }, [key, enabled]);

  return seq;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const CARD = cardSizes.sm;
const useNative = Platform.OS !== 'web';

/** Centro de cada posição na área do pano (coordenadas locais). */
function targets(w: number, h: number): Record<ScreenPosition, Point> {
  return {
    partner: { x: w / 2, y: CARD.height / 2 + 6 },
    left: { x: CARD.width / 2 + 6, y: h / 2 },
    right: { x: w - CARD.width / 2 - 6, y: h / 2 },
    self: { x: w / 2, y: h - CARD.height / 2 - 6 },
  };
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function DealOverlay({
  runId,
  plan,
  mySeat,
}: {
  runId: number;
  plan: DealPlan;
  mySeat: number;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const clock = useRef(new Animated.Value(0)).current;
  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  };

  useEffect(() => {
    clock.setValue(0);
    const anim = Animated.timing(clock, {
      toValue: plan.endMs,
      duration: plan.endMs,
      easing: Easing.linear,
      useNativeDriver: useNative,
    });
    anim.start();
    return () => anim.stop();
  }, [clock, runId, plan.endMs]);

  const deck: Point = useMemo(() => ({ x: CARD.width / 2 + 6, y: CARD.height / 2 + 6 }), []);
  const tg = useMemo(() => targets(box.w, box.h), [box.w, box.h]);

  const place = (
    anchor: Point,
    dx: Animated.AnimatedInterpolation<number> | number,
    dy: Animated.AnimatedInterpolation<number> | number,
    rot: Animated.AnimatedInterpolation<string> | string,
    opacity?: Animated.AnimatedInterpolation<number>,
  ) => ({
    position: 'absolute' as const,
    left: anchor.x - CARD.width / 2,
    top: anchor.y - CARD.height / 2,
    ...(opacity !== undefined ? { opacity } : {}),
    transform: [{ translateX: dx }, { translateY: dy }, { rotate: rot }],
  });

  const ready = box.w > 0 && box.h > 0;
  const shuffleStart = plan.collectMs;
  const shuffleEnd = plan.collectMs + plan.shuffleMs;

  // Monte: aparece quando as cartas voltam (ou de início), some quando a última sai.
  const deckOpacity = clock.interpolate({
    inputRange: [0, Math.max(1, plan.collectMs * 0.6), plan.endMs - 60, plan.endMs],
    outputRange: [plan.collectMs > 0 ? 0 : 1, 1, 1, 0],
    extrapolate: 'clamp',
  });
  // Embaralhar: duas metades do monte se afastam e se cruzam, três vezes.
  const swing = (sign: number) => {
    const n = 6;
    const input = [0, shuffleStart];
    const out = [0, 0];
    for (let i = 1; i <= n; i++) {
      input.push(shuffleStart + (plan.shuffleMs * i) / n);
      out.push(i % 2 === 1 ? 22 * sign : -4 * sign);
    }
    input.push(shuffleEnd + 1, Math.max(shuffleEnd + 2, plan.endMs));
    out.push(0, 0);
    return clock.interpolate({ inputRange: input, outputRange: out, extrapolate: 'clamp' });
  };

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={onLayout}
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      testID="deal-overlay"
    >
      {ready ? (
        <>
          {/* Monte com três cartas; as duas de cima abrem na embaralhada. */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: deckOpacity }]}>
            <Animated.View style={place(deck, 0, 0, '0deg')}>
              <Card size="sm" />
            </Animated.View>
            <Animated.View style={place(deck, swing(-1), -2, '-3deg')}>
              <Card size="sm" />
            </Animated.View>
            <Animated.View style={place(deck, swing(1), -4, '3deg')}>
              <Card size="sm" />
            </Animated.View>
          </Animated.View>
          {plan.collectMs > 0
            ? (['partner', 'left', 'self', 'right'] as const).map((pos, i) => {
                const from = tg[pos];
                const s = i * 40;
                const e = Math.max(s + 1, plan.collectMs - 20);
                const input = [0, s, e, plan.collectMs];
                const dx = clock.interpolate({
                  inputRange: input,
                  outputRange: [from.x - deck.x, from.x - deck.x, 0, 0],
                  extrapolate: 'clamp',
                });
                const dy = clock.interpolate({
                  inputRange: input,
                  outputRange: [from.y - deck.y, from.y - deck.y, 0, 0],
                  extrapolate: 'clamp',
                });
                const op = clock.interpolate({
                  inputRange: [0, s, e, plan.collectMs],
                  outputRange: [1, 1, 1, 0],
                  extrapolate: 'clamp',
                });
                const rot = clock.interpolate({
                  inputRange: input,
                  outputRange: ['0deg', '0deg', '12deg', '12deg'],
                  extrapolate: 'clamp',
                });
                return (
                  <Animated.View key={`collect-${pos}`} style={place(deck, dx, dy, rot, op)}>
                    <Card size="sm" />
                  </Animated.View>
                );
              })
            : null}
          {plan.cards.map((c, i) => {
            const to = tg[screenPosition(mySeat, c.seat)];
            // Cartas do mesmo assento pousam levemente deslocadas (leque) para não se esconderem.
            const spread = (c.round - 1) * 14;
            const horizontal = screenPosition(mySeat, c.seat);
            const endX =
              to.x - deck.x + (horizontal === 'left' || horizontal === 'right' ? 0 : spread);
            const endY =
              to.y - deck.y + (horizontal === 'left' || horizontal === 'right' ? spread : 0);
            const start = c.startMs;
            const land = start + DEAL_FLIGHT_MS;
            const fade = start + DEAL_FLIGHT_MS * 0.7;
            const dx = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: [0, 0, endX],
              extrapolate: 'clamp',
            });
            const dy = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: [0, 0, endY],
              extrapolate: 'clamp',
            });
            const op = clock.interpolate({
              inputRange: [0, Math.max(0, start - 1), start, fade, land],
              outputRange: [0, 0, 1, 1, 0],
              extrapolate: 'clamp',
            });
            const rot = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: ['0deg', '0deg', `${clamp(endX, -1, 1) * 10 + (c.round - 1) * 6}deg`],
              extrapolate: 'clamp',
            });
            return (
              <Animated.View key={i} style={place(deck, dx, dy, rot, op)}>
                <Card size="sm" />
              </Animated.View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}
