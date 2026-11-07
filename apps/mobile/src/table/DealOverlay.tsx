import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import {
  Card,
  TRICK_TILT,
  cardSizes,
  parseFace,
  placePlays,
  screenPosition,
  trickCardOffset,
} from '@trucaco/ui';
import type { CardSize, PeekDirection, PlayedTrickView, ScreenPosition } from '@trucaco/ui';
import { COLLECT_FLIP_MS, DEAL_FLIGHT_MS, FLIP_MS, dealDecision, dealPlan } from './dealPlan';
import type { DealPlan } from './dealPlan';

/**
 * Embaralhar, distribuir e recolher: camada puramente visual sobre o pano. Sem eventos de toque
 * (`pointerEvents="none"`), fora da árvore de acessibilidade, e nunca retém o jogo: o estado vem do
 * servidor e esta camada só desenha. Um único `Animated.Value` (relógio em ms) guia todas as cartas.
 */

export type DealPhase = 'idle' | 'hold' | 'dealing' | 'vira';

export interface DealSequence {
  readonly phase: DealPhase;
  /** `null` quando não há animação em curso. */
  readonly run: { readonly id: number; readonly plan: DealPlan } | null;
  /** A mão do jogador local fica escondida até as cartas dele chegarem. */
  readonly handHidden: boolean;
  /** A vira aparece depois da distribuição. */
  readonly viraHidden: boolean;
}

/** Pausa do fim da mão: a mão nova já está no estado, mas não aparece nem aceita jogada. */
const HOLD: DealSequence = { phase: 'hold', run: null, handHidden: true, viraHidden: true };
/**
 * Costas das cartas de cada assento durante a sequência: `null` = o estado manda (sem animação); na pausa
 * do fim da mão nenhuma (as cartas estão na mesa); na distribuição, uma por carta já pousada. A carta
 * aparece no leque ao lado do avatar no instante em que a voadora chega, nunca antes.
 */
export function useDealLanded(seq: DealSequence): Readonly<Record<number, number>> | null {
  const runId = seq.run?.id ?? 0;
  const [state, setState] = useState<{ id: number; counts: Readonly<Record<number, number>> }>({
    id: 0,
    counts: {},
  });
  const plan = seq.run?.plan;
  useEffect(() => {
    if (plan === undefined) return undefined;
    const timers = plan.cards.map((c) =>
      setTimeout(
        () =>
          setState((cur) => ({
            id: runId,
            counts: {
              ...(cur.id === runId ? cur.counts : {}),
              [c.seat]: ((cur.id === runId ? cur.counts[c.seat] : 0) ?? 0) + 1,
            },
          })),
        c.startMs + DEAL_FLIGHT_MS - LAND_FADE_LEAD_MS,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [runId, plan]);
  if (seq.phase === 'hold') return {};
  if (seq.run === null) return null;
  return state.id === runId ? state.counts : {};
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
  /**
   * Pausa, em ms, antes de recolher quando a mão troca por outra (o fim da mão fica legível na mesa).
   * 0 (padrão) = sem pausa. Vale mesmo com `enabled` falso (reduzir movimento): só não anima depois.
   */
  holdMs?: number;
}): DealSequence {
  const { key, enabled, pe, mySeat } = opts;
  const holdMs = opts.holdMs ?? 0;
  const fresh = opts.fresh ?? true;
  const prev = useRef<string | null>(null);
  const runId = useRef(0);
  const [seq, setSeq] = useState<DealSequence>(IDLE);

  // Layout effect: a mão nova nunca chega a ser pintada antes da pausa.
  useLayoutEffect(() => {
    const changed = prev.current !== null && prev.current !== key;
    const decision = dealDecision(prev.current, key, enabled, fresh);
    prev.current = key;
    const hold = changed && holdMs > 0 ? holdMs : 0;
    if (!decision.animate && hold === 0) {
      setSeq(IDLE);
      return undefined;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const begin = (): void => {
      if (!decision.animate || mySeat < 0) {
        setSeq(IDLE);
        return;
      }
      const plan = dealPlan({ pe, mySeat, collect: decision.collect });
      const run = { id: ++runId.current, plan };
      setSeq({ phase: 'dealing', run, handHidden: true, viraHidden: true });
      timers.push(
        setTimeout(
          () => setSeq({ phase: 'vira', run, handHidden: false, viraHidden: true }),
          plan.selfLandedMs,
        ),
        setTimeout(() => setSeq(IDLE), plan.endMs + 50),
      );
    };
    if (hold > 0) {
      setSeq(HOLD);
      timers.push(setTimeout(begin, hold));
    } else {
      begin();
    }
    return () => timers.forEach(clearTimeout);
    // `pe` e `mySeat` mudam junto com a mão; a sequência só reinicia quando a mão muda.
  }, [key, enabled]);

  // No render da troca de mão (antes do layout effect ligar a pausa) a pausa já vale: senão as cartas retidas
  // da mão que acabou seriam desmontadas por um instante e remontadas deslizando de novo.
  const changing = prev.current !== null && prev.current !== key && holdMs > 0;
  return changing ? HOLD : seq;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const CARD = cardSizes.sm;
const useNative = Platform.OS !== 'web';

/** Margem do pano (madeira + folga) até a arena onde ficam os assentos. */
export const FELT_INSET = 10;
/** Raio da borda do avatar somada ao anel de time. */
const RING = 3;

/**
 * Centro de cada posição na área do pano (coordenadas locais): os adversários e o parceiro nas
 * bordas, onde estão os avatares (`avatarSize`), e eu embaixo, em direção à mão na dock.
 */
export function dealTargets(
  w: number,
  h: number,
  avatarSize: number,
  deck?: Point,
): Record<ScreenPosition, Point> & { deck: Point } {
  const half = avatarSize / 2 + RING;
  return {
    partner: { x: w / 2, y: FELT_INSET + half },
    left: { x: FELT_INSET + half, y: h / 2 },
    right: { x: w - FELT_INSET - half, y: h / 2 },
    self: { x: w / 2, y: h - CARD.height / 2 - 6 },
    deck: deck ?? { x: CARD.width / 2 + 6, y: CARD.height / 2 + 6 },
  };
}

/** A carta voadora começa a sumir (e a do leque a aparecer) este tanto antes de pousar. */
const LAND_FADE_LEAD_MS = 60;
const LAND_FADE_MS = 120;
/** Folga entre a carta que pousa e a borda do avatar. */
const LAND_GAP = 2;

/**
 * Onde a carta de um adversário pousa: AO LADO do avatar, do lado em que o leque aparece (`peek`), com a
 * carta inteira fora do rosto. Devolve o centro da carta.
 */
export function sideLanding(avatarCenter: Point, avatarSize: number, dir: PeekDirection): Point {
  const half = avatarSize / 2 + RING + LAND_GAP;
  if (dir === 'down') return { x: avatarCenter.x, y: avatarCenter.y + half + CARD.height / 2 };
  const dx = half + CARD.width / 2;
  return { x: avatarCenter.x + (dir === 'right' ? dx : -dx), y: avatarCenter.y };
}

/** Easing contínuo: sai do monte já em movimento e só desacelera ao chegar. */
const FLIGHT_EASING = Easing.out(Easing.quad);

const DEFAULT_DEAL_AVATAR = 76;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function DealOverlay({
  runId,
  plan,
  mySeat,
  avatarSize = DEFAULT_DEAL_AVATAR,
  deckAt,
  collectTricks,
  trickSize = 'sm',
  trickRow = false,
  trickCenter,
  trickScale = 1,
  feltSize,
  handCenter,
  handSize = 'md',
  peek,
}: {
  /** Lado do leque de costas de cada assento: as cartas pousam ao lado do avatar, nunca sobre ele. */
  peek?: Readonly<Record<'partner' | 'left' | 'right', PeekDirection>>;
  /** Vaza em fileira (celular deitado): o recolher parte da fileira, não da cruz. */
  trickRow?: boolean;
  /** Centro da grade da vaza real (coordenadas do overlay); omitido = centro do pano. */
  trickCenter?: Point;
  /** Escala aplicada à vaza real (telas baixas encolhem a cruz). */
  trickScale?: number;
  /** Tamanho do pano já medido: evita um quadro sem cartas antes do `onLayout`. */
  feltSize?: { w: number; h: number };
  /** Centro da mão real (coordenadas do overlay): as minhas cartas pousam nela. */
  handCenter?: Point;
  /** Tamanho das cartas da minha mão. */
  handSize?: CardSize;
  /** Todas as vazas da mão que acabou (para virar ao recolher); ausentes = nada a recolher. */
  collectTricks?: readonly PlayedTrickView[];
  /** Tamanho das cartas da vaza na mesa (as cartas recolhidas partem dele). */
  trickSize?: CardSize;
  runId: number;
  plan: DealPlan;
  mySeat: number;
  /** Lado do avatar dos assentos (px): as cartas voam até o avatar de cada um. */
  avatarSize?: number;
  /** Centro do monte (coordenadas do overlay). Omitido = canto superior esquerdo. */
  deckAt?: Point;
}) {
  const [box, setBox] = useState({ w: feltSize?.w ?? 0, h: feltSize?.h ?? 0 });
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

  const tg = useMemo(
    () => dealTargets(box.w, box.h, avatarSize, deckAt),
    [box.w, box.h, avatarSize, deckAt?.x, deckAt?.y],
  );

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

  const deck = tg.deck;
  const ready = box.w > 0 && box.h > 0;
  const TRICK = cardSizes[trickSize];
  // Uma entrada por carta jogada na mão (até 12), cada uma na posição real do leque da mesa.
  const collectCards = (collectTricks ?? []).flatMap((t, k) => {
    const { byPosition, order } = placePlays(t.plays, mySeat);
    return order.flatMap((pos) => {
      const play = byPosition[pos];
      return play === undefined ? [] : [{ k, pos, play, own: t.ownCovered ?? null }];
    });
  });
  const collectN = collectCards.length;
  const pileGap = collectN > 4 ? 1.2 : 2;
  const HAND = cardSizes[handSize];
  const shuffleStart = plan.shuffleStartMs;
  const shuffleEnd = plan.shuffleStartMs + plan.shuffleMs;
  const lastStart = plan.cards[plan.cards.length - 1]?.startMs ?? plan.endMs;

  // Monte: aparece quando as cartas voltam (ou de início), some quando a última sai.
  const deckOpacity = clock.interpolate({
    inputRange: [0, Math.max(1, plan.collectMs * 0.85), lastStart + 60, lastStart + 160],
    outputRange: [plan.collectMs > 0 ? 0 : 1, 1, 1, 0],
    extrapolate: 'clamp',
  });
  // Embaralhar: duas metades do monte se afastam e se cruzam, três vezes.
  const swing = (sign: number) => {
    const n = 4;
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
            ? collectCards.map(({ k, pos, play, own }, i) => {
                // Parte EXATAMENTE da carta real da vaza (posição, tamanho e inclinação), vira para o
                // verso ao se juntar numa pilha no centro e já desliza ao monte (movimentos somados: sem
                // parar na pilha), encolhendo até o tamanho do monte.
                // Só recolhe cartas que estavam na mesa: nunca inventa uma carta onde não havia. A coberta
                // dos outros sai só com o verso; a minha mostra a face (que só eu conheço) antes de virar.
                const face = !play.covered
                  ? parseFace(play)
                  : play.seat === mySeat && own !== null
                    ? parseFace(own)
                    : null;
                const off = trickCardOffset(trickSize, trickRow ? 'row' : 'cross', pos, k);
                const center = trickCenter ?? { x: box.w / 2, y: box.h / 2 };
                const mid = (collectN - 1) / 2;
                const stack = { x: (i - mid) * pileGap, y: (i - mid) * -pileGap };
                const flipEnd = COLLECT_FLIP_MS;
                const flipMid = COLLECT_FLIP_MS / 2;
                const pileStart = COLLECT_FLIP_MS - 200;
                const pileEnd = plan.collectMs;
                const fromX = center.x + off.x * trickScale - deck.x;
                const fromY = center.y + off.y * trickScale - deck.y;
                const toX = center.x + stack.x - deck.x;
                const toY = center.y + stack.y - deck.y;
                const g = [0, flipEnd];
                const sl = [pileStart, pileEnd];
                const easing = Easing.inOut(Easing.quad);
                const clampOut = { extrapolate: 'clamp' as const };
                const dx = Animated.add(
                  clock.interpolate({
                    inputRange: g,
                    outputRange: [fromX, toX],
                    easing,
                    ...clampOut,
                  }),
                  clock.interpolate({
                    inputRange: sl,
                    outputRange: [0, -toX],
                    easing,
                    ...clampOut,
                  }),
                );
                const dy = Animated.add(
                  clock.interpolate({
                    inputRange: g,
                    outputRange: [fromY, toY],
                    easing,
                    ...clampOut,
                  }),
                  clock.interpolate({
                    inputRange: sl,
                    outputRange: [0, -toY],
                    easing,
                    ...clampOut,
                  }),
                );
                const rot = clock.interpolate({
                  inputRange: [0, flipEnd, pileEnd],
                  outputRange: [
                    `${TRICK_TILT[pos]}deg`,
                    `${clamp((i - mid) * 3, -12, 12)}deg`,
                    '0deg',
                  ],
                  ...clampOut,
                });
                const scale = clock.interpolate({
                  inputRange: [0, pileStart, pileEnd],
                  outputRange: [trickScale, trickScale, CARD.width / TRICK.width],
                  ...clampOut,
                });
                const flip = clock.interpolate({
                  inputRange: [0, flipMid, flipEnd],
                  outputRange: [1, 0.02, 1],
                  ...clampOut,
                });
                const faceOp = clock.interpolate({
                  inputRange: [0, flipMid - 1, flipMid],
                  outputRange: [1, 1, 0],
                  ...clampOut,
                });
                const backOp = clock.interpolate({
                  inputRange: [0, flipMid - 1, flipMid],
                  outputRange: [0, 0, 1],
                  ...clampOut,
                });
                const gone = clock.interpolate({
                  inputRange: [0, pileEnd - 40, pileEnd],
                  outputRange: [1, 1, 0],
                  ...clampOut,
                });
                return (
                  <Animated.View
                    key={`collect-${k}-${pos}`}
                    style={{
                      position: 'absolute',
                      left: deck.x - TRICK.width / 2,
                      top: deck.y - TRICK.height / 2,
                      opacity: gone,
                      zIndex: i + 1,
                      transform: [
                        { translateX: dx },
                        { translateY: dy },
                        { rotate: rot },
                        { scale },
                        { scaleX: flip },
                      ],
                    }}
                  >
                    <Animated.View style={{ opacity: backOp }}>
                      <Card size={trickSize} />
                    </Animated.View>
                    <Animated.View style={[StyleSheet.absoluteFill, { opacity: faceOp }]}>
                      {face !== null ? (
                        <Card size={trickSize} rank={face.rank} suit={face.suit} />
                      ) : (
                        <Card size={trickSize} />
                      )}
                    </Animated.View>
                  </Animated.View>
                );
              })
            : null}
          {plan.cards.map((c, i) => {
            const pos = screenPosition(mySeat, c.seat);
            const mine = pos === 'self';
            // Minhas cartas pousam no leque da mão real e viram para a face; as dos outros ficam na pilha
            // ao lado do avatar. Cartas do mesmo assento pousam levemente deslocadas.
            const dir = pos === 'self' ? undefined : peek?.[pos];
            const to =
              mine && handCenter !== undefined
                ? handCenter
                : dir !== undefined
                  ? sideLanding(tg[pos], avatarSize, dir)
                  : tg[pos];
            const sideways = pos === 'left' || pos === 'right';
            const spread = mine ? (c.round - 1) * HAND.width * 0.7 : (c.round - 1) * 14;
            const endX = to.x - deck.x + (sideways ? 0 : spread);
            const endY = to.y - deck.y + (sideways ? spread : 0);
            const start = c.startMs;
            const land = start + DEAL_FLIGHT_MS;
            const flipStart = plan.selfLandedMs;
            const flipHalf = flipStart + FLIP_MS / 2;
            const fly = { easing: FLIGHT_EASING, extrapolate: 'clamp' as const };
            const dx = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: [0, 0, endX],
              ...fly,
            });
            const dy = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: [0, 0, endY],
              ...fly,
            });
            // Minhas: ficam até o flip; a mão real "vira" por cima (FlipReveal). Dos outros: ficam.
            const op = mine
              ? clock.interpolate({
                  inputRange: [0, Math.max(0, start - 1), start, flipHalf - 1, flipHalf],
                  outputRange: [0, 0, 1, 1, 0],
                  extrapolate: 'clamp',
                })
              : // Dos outros: voa até o lado do avatar e some ao pousar (o leque de costas do assento
                // ganha a carta nesse instante), sem nunca cobrir o rosto.
                clock.interpolate({
                  inputRange: [
                    0,
                    Math.max(0, start - 1),
                    start,
                    land - LAND_FADE_LEAD_MS,
                    land - LAND_FADE_LEAD_MS + LAND_FADE_MS,
                  ],
                  outputRange: [0, 0, 1, 1, 0],
                  extrapolate: 'clamp',
                });
            const sx = mine
              ? clock.interpolate({
                  inputRange: [0, flipStart, flipHalf],
                  outputRange: [1, 1, 0.02],
                  extrapolate: 'clamp',
                })
              : 1;
            const scale = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: [1, 1, mine ? HAND.width / CARD.width : 1],
              ...fly,
            });
            const finalRot = mine ? 0 : clamp(endX, -1, 1) * 10 + (c.round - 1) * 6;
            const rot = clock.interpolate({
              inputRange: [0, start, land],
              outputRange: ['0deg', '0deg', `${finalRot}deg`],
              ...fly,
            });
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  left: deck.x - CARD.width / 2,
                  top: deck.y - CARD.height / 2,
                  opacity: op,
                  transform: [
                    { translateX: dx },
                    { translateY: dy },
                    { rotate: rot },
                    { scale },
                    { scaleX: sx },
                  ],
                }}
              >
                <Card size="sm" />
              </Animated.View>
            );
          })}
        </>
      ) : null}
    </View>
  );
}
