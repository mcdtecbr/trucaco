import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import {
  DEFAULT_AVATAR_PARTS,
  parseAvatarParts,
  type AvatarParts,
  type SignalId,
} from '@trucaco/protocol';
import { BG_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS, safeIndex } from './parts';
import { NEUTRAL, POSES, type PoseChannel } from './poses';

/**
 * Avatar vetorial (Views + Animated, sem dependência nova). Desenhado numa caixa de 100x100
 * unidades escalada para `size` px. Todas as animações são transform/opacity.
 */

type Num = number | Animated.AnimatedNode;

export interface AvatarFallbackProps {
  readonly parts: AvatarParts;
  readonly size: number;
  /** Sinal em curso; `null` em repouso. */
  readonly activeId: SignalId | null;
  /** 0 -> 1 durante o sinal. */
  readonly progress: Animated.Value;
  /** Respiração 0 <-> 1 (ocioso). */
  readonly breathe: Animated.Value;
  /** Piscada 0 -> 1 -> 0 (ocioso). */
  readonly blink: Animated.Value;
  /** Destaque estático (modo menos movimento). */
  readonly highlight: boolean;
  readonly accessibilityLabel: string;
  readonly testID?: string | undefined;
}

const INK = '#1E1A1A';
const BLUSH = 'rgba(0,0,0,0.16)';

/** Dimensões do rosto por formato: [largura, altura, raio]. */
const FACES: readonly (readonly [number, number, number])[] = [
  [62, 62, 31],
  [54, 68, 27],
  [60, 58, 14],
  [70, 54, 27],
];
const FACE_CY = 46;

function evenly(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** Estilo absoluto de uma caixa centrada em (cx, cy), em unidades. */
function box(u: number, cx: number, cy: number, w: number, h: number): ViewStyle {
  return {
    position: 'absolute',
    left: (cx - w / 2) * u,
    top: (cy - h / 2) * u,
    width: w * u,
    height: h * u,
  };
}

export function AvatarFallback(props: AvatarFallbackProps) {
  const parsed = parseAvatarParts(props.parts) ?? DEFAULT_AVATAR_PARTS;
  const u = props.size / 100;
  const face = FACES[safeIndex('face_shape', parsed.face_shape)] ?? FACES[0]!;
  const [fw, fh, fr] = face;
  const faceTop = FACE_CY - fh / 2;
  const skin = SKIN_COLORS[safeIndex('skin', parsed.skin)] ?? SKIN_COLORS[0]!;
  const hairIdx = safeIndex('hair', parsed.hair);
  const hairColor = HAIR_COLORS[hairIdx] ?? INK;
  const eyesIdx = safeIndex('eyes', parsed.eyes);
  const mouthIdx = safeIndex('mouth', parsed.mouth);
  const outfitIdx = safeIndex('outfit', parsed.outfit);
  const accIdx = safeIndex('accessory', parsed.accessory);
  const bg = BG_COLORS[safeIndex('bg_color', parsed.bg_color)] ?? BG_COLORS[0]!;
  const outfit = OUTFIT_COLORS[outfitIdx] ?? OUTFIT_COLORS[0]!;

  const pose = props.activeId === null ? undefined : POSES[props.activeId];
  const ch = (name: PoseChannel, mult = 1): Num => {
    const values = pose?.[name];
    if (values === undefined) return NEUTRAL[name] * mult;
    return props.progress.interpolate({
      inputRange: evenly(values.length),
      outputRange: values.map((v) => v * mult),
    });
  };
  const rot = (name: PoseChannel): string | Animated.AnimatedNode => {
    const values = pose?.[name];
    if (values === undefined) return '0deg';
    return props.progress.interpolate({
      inputRange: evenly(values.length),
      outputRange: values.map((v) => `${v}deg`),
    });
  };

  const blinkScale = props.blink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.1] });
  const breatheY = props.breathe.interpolate({ inputRange: [0, 1], outputRange: [0, -1.4 * u] });
  const shoulderY = Animated.add(ch('shoulderY', u), breatheY);
  const eyeLScale = Animated.multiply(blinkScale, ch('winkScaleY'));
  const pupilX = ch('pupilX', u);
  const smileOp = ch('smileOpacity');
  const eyeCx = [37, 63] as const;
  const eyeCy = 44;

  const eyeNode = (cx: number, scaleY: Num, key: string) => (
    <Animated.View
      key={key}
      style={[
        box(u, cx, eyeCy, 16, 14),
        styles.center,
        { transform: [{ translateX: pupilX as number }, { scaleY: scaleY as number }] },
      ]}
    >
      {eyesIdx === 0 ? (
        <View style={styles.dot(7 * u)} />
      ) : eyesIdx === 1 ? (
        <View style={styles.white(13 * u, 11 * u)}>
          <View style={styles.pupil(6 * u)}>
            <View style={styles.glint(2 * u)} />
          </View>
        </View>
      ) : eyesIdx === 2 ? (
        <View style={styles.slit(11 * u, 3.5 * u)} />
      ) : (
        <View style={styles.arc(11 * u, 6 * u, 2.5 * u)} />
      )}
    </Animated.View>
  );

  const browStyle = (cx: number, tilt: number): ViewStyle => ({
    ...box(u, cx, 34, 13, 3),
    backgroundColor: hairIdx === 0 ? INK : hairColor,
    borderRadius: 2 * u,
    transform: [
      { translateY: ch('browY', u) as number },
      { scaleX: ch('browScale') as number },
      { rotate: `${tilt}deg` },
    ],
  });

  const hairBack = (() => {
    switch (hairIdx) {
      case 4:
        return (
          <>
            <View
              style={[
                box(u, 50, FACE_CY + 4, fw + 16, fh + 10),
                { backgroundColor: hairColor, borderRadius: ((fw + 16) / 2) * u },
              ]}
            />
            <View
              style={[
                box(u, 50 - fw / 2 - 3, faceTop + 36, 14, 46),
                { backgroundColor: hairColor, borderRadius: 7 * u },
              ]}
            />
            <View
              style={[
                box(u, 50 + fw / 2 + 3, faceTop + 36, 14, 46),
                { backgroundColor: hairColor, borderRadius: 7 * u },
              ]}
            />
          </>
        );
      case 6:
        return (
          <View
            style={[box(u, 50, 36, 78, 70), { backgroundColor: hairColor, borderRadius: 39 * u }]}
          />
        );
      default:
        return null;
    }
  })();

  const cap = (h: number) => (
    <View
      style={[
        box(u, 50, faceTop - 4 + h / 2, fw + 4, h),
        {
          backgroundColor: hairColor,
          borderTopLeftRadius: ((fw + 4) / 2) * u,
          borderTopRightRadius: ((fw + 4) / 2) * u,
          borderBottomLeftRadius: 4 * u,
          borderBottomRightRadius: 4 * u,
        },
      ]}
    />
  );

  const hairFront = (() => {
    switch (hairIdx) {
      case 1:
        return cap(15);
      case 2:
        return (
          <>
            {cap(15)}
            <View
              style={[
                box(u, 42, faceTop + 13, 32, 10),
                {
                  backgroundColor: hairColor,
                  borderRadius: 5 * u,
                  transform: [{ rotate: '-10deg' }],
                },
              ]}
            />
          </>
        );
      case 3:
        return (
          <View
            style={[
              box(u, 50, faceTop + 2, fw - 4, 14),
              { backgroundColor: hairColor, borderRadius: 3 * u },
            ]}
          />
        );
      case 4:
      case 6:
        return cap(14);
      case 5:
        return (
          <>
            {cap(14)}
            <View
              style={[
                box(u, 50, faceTop - 9, 18, 18),
                { backgroundColor: hairColor, borderRadius: 9 * u },
              ]}
            />
          </>
        );
      case 7:
        return (
          <View
            style={[
              box(u, 50, faceTop - 2, 11, 28),
              { backgroundColor: hairColor, borderRadius: 5.5 * u },
            ]}
          />
        );
      default:
        return null;
    }
  })();

  const mouthBase = (() => {
    switch (mouthIdx) {
      case 1:
        return <View style={[box(u, 50, 62, 16, 3), styles.ink(1.5 * u)]} />;
      case 2:
        return (
          <View
            style={[box(u, 50, 62, 12, 13), { backgroundColor: '#5A1E1E', borderRadius: 7 * u }]}
          />
        );
      case 3:
        return (
          <View
            style={[
              box(u, 52, 62, 16, 8),
              styles.smileArc(8 * u, 3 * u),
              { transform: [{ rotate: '-12deg' }] },
            ]}
          />
        );
      default:
        return <View style={[box(u, 50, 61, 20, 10), styles.smileArc(10 * u, 3 * u)]} />;
    }
  })();

  const outfitDetail = (() => {
    switch (outfitIdx) {
      case 1:
        return (
          <View
            style={{
              ...box(u, 38, -2, 15, 15),
              backgroundColor: skin,
              transform: [{ rotate: '45deg' }],
            }}
          />
        );
      case 2:
        return (
          <>
            <View style={[box(u, 38, 12, 76, 4), styles.stripe]} />
            <View style={[box(u, 38, 21, 76, 4), styles.stripe]} />
          </>
        );
      case 3:
        return (
          <>
            <View
              style={[
                box(u, 38, 1, 28, 14),
                { borderWidth: 4 * u, borderColor: 'rgba(0,0,0,0.25)', borderRadius: 10 * u },
              ]}
            />
            <View style={[box(u, 32, 14, 2, 9), styles.cord]} />
            <View style={[box(u, 44, 14, 2, 9), styles.cord]} />
          </>
        );
      case 4:
        return (
          <>
            <View
              style={{
                ...box(u, 38, -1, 18, 18),
                backgroundColor: '#F5F1E6',
                transform: [{ rotate: '45deg' }],
              }}
            />
            <View
              style={[box(u, 38, 12, 5, 16), { backgroundColor: '#B3261E', borderRadius: 1.5 * u }]}
            />
          </>
        );
      case 5:
        return (
          <View
            style={[
              box(u, 22, 14, 9, 9),
              {
                backgroundColor: '#F5F1E6',
                borderRadius: 4.5 * u,
                borderWidth: 2 * u,
                borderColor: '#F2C14E',
              },
            ]}
          />
        );
      default:
        return null;
    }
  })();

  const glassesRing = (cx: number) => (
    <View
      key={cx}
      style={[
        box(u, cx, eyeCy, 16, 16),
        { borderRadius: 8 * u, borderWidth: 2 * u, borderColor: INK },
      ]}
    />
  );
  const sunLens = (cx: number) => (
    <View
      key={cx}
      style={[
        box(u, cx, eyeCy, 18, 12),
        { backgroundColor: INK, opacity: 0.62, borderRadius: 5 * u },
      ]}
    />
  );

  const accessory = (() => {
    switch (accIdx) {
      case 1:
        return (
          <>
            {eyeCx.map(glassesRing)}
            <View style={[box(u, 50, eyeCy, 6, 2), styles.ink(u)]} />
          </>
        );
      case 2:
        return (
          <>
            {eyeCx.map(sunLens)}
            <View style={[box(u, 50, eyeCy - 1, 6, 2.5), styles.ink(u)]} />
          </>
        );
      case 3:
        return (
          <>
            <View
              style={[
                box(u, 50, faceTop + 3, fw + 6, 24),
                {
                  backgroundColor: '#2B4A8A',
                  borderTopLeftRadius: ((fw + 6) / 2) * u,
                  borderTopRightRadius: ((fw + 6) / 2) * u,
                },
              ]}
            />
            <View
              style={[
                box(u, 50, faceTop + 15, fw + 18, 5),
                { backgroundColor: '#1F3566', borderRadius: 3 * u },
              ]}
            />
          </>
        );
      case 4:
        return (
          <View
            style={[
              box(u, 50, 56.5, 22, 6),
              { backgroundColor: hairIdx === 0 ? INK : hairColor, borderRadius: 3 * u },
            ]}
          />
        );
      default:
        return null;
    }
  })();

  const puff = (cx: number) => (
    <Animated.View
      key={cx}
      style={[
        box(u, cx, 59, 13, 13),
        {
          backgroundColor: skin,
          borderRadius: 6.5 * u,
          borderWidth: u,
          borderColor: BLUSH,
          opacity: ch('puffOpacity') as number,
          transform: [{ scale: ch('puffScale') as number }],
        },
      ]}
    />
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={props.accessibilityLabel}
      {...(props.testID !== undefined ? { testID: props.testID } : {})}
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.size / 2,
        backgroundColor: bg,
        overflow: 'hidden',
      }}
    >
      {/* ombros e roupa */}
      <Animated.View
        style={[
          box(u, 50, 91, 76, 36),
          { transform: [{ translateY: shoulderY as unknown as number }] },
        ]}
      >
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: outfit,
              borderTopLeftRadius: 30 * u,
              borderTopRightRadius: 30 * u,
              overflow: 'hidden',
            },
          ]}
        >
          <View
            style={[
              box(u, 38, 0, 24, 12),
              {
                backgroundColor: skin,
                borderBottomLeftRadius: 12 * u,
                borderBottomRightRadius: 12 * u,
              },
            ]}
          />
          {outfitDetail}
        </View>
      </Animated.View>

      {/* cabeça */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [
              { translateX: ch('headX', u) as number },
              { translateY: ch('headY', u) as number },
              { rotate: rot('headRot') as string },
            ],
          },
        ]}
      >
        {hairBack}
        <View style={[box(u, 50, 70, 14, 14), { backgroundColor: skin }]} />
        <View
          style={[box(u, 50, FACE_CY, fw, fh), { backgroundColor: skin, borderRadius: fr * u }]}
        />
        {hairFront}
        <Animated.View style={browStyle(eyeCx[0], -4)} />
        <Animated.View style={browStyle(eyeCx[1], 4)} />
        {eyeNode(eyeCx[0], eyeLScale, 'l')}
        {eyeNode(eyeCx[1], blinkScale, 'r')}
        <Animated.View
          style={[
            box(u, 50, 52, 7, 6),
            {
              backgroundColor: BLUSH,
              borderRadius: 3 * u,
              transform: [
                { translateX: ch('noseX', u) as number },
                { scaleX: ch('noseScale') as number },
              ],
            },
          ]}
        />
        {puff(50 - fw / 2 + 2)}
        {puff(50 + fw / 2 - 2)}
        {mouthBase}
        {/* sorriso por cima da boca base (com fundo da cor da pele) */}
        <Animated.View style={[box(u, 50, 62, 28, 16), { opacity: smileOp as number }]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: skin }]} />
          <View style={[box(u, 14, 7, 20, 10), styles.smileArc(10 * u, 3.2 * u)]} />
        </Animated.View>
        <Animated.View
          style={[
            box(u, 50, 64.5, 12, 4),
            {
              opacity: ch('biteOpacity') as number,
              backgroundColor: '#F5F1E6',
              borderRadius: 2 * u,
              borderWidth: 0.8 * u,
              borderColor: INK,
            },
          ]}
        />
        <Animated.View
          style={[
            box(u, 50, 68, 9, 10),
            {
              backgroundColor: '#E56F86',
              borderBottomLeftRadius: 5 * u,
              borderBottomRightRadius: 5 * u,
              opacity: ch('tongueOpacity') as number,
              transform: [{ translateY: ch('tongueY', u) as number }],
            },
          ]}
        />
        {accessory}
      </Animated.View>

      {props.activeId !== null ? (
        <View
          pointerEvents="none"
          {...(props.testID !== undefined
            ? { testID: `${props.testID}-signal-${props.activeId}` }
            : {})}
          style={styles.marker}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: props.size / 2,
            borderWidth: Math.max(2, 4 * u),
            borderColor: props.highlight ? '#FFFFFF' : 'transparent',
          },
        ]}
      />
    </View>
  );
}

const styles = {
  center: { alignItems: 'center', justifyContent: 'center' } as ViewStyle,
  marker: { position: 'absolute', width: 0, height: 0 } as ViewStyle,
  stripe: { backgroundColor: 'rgba(255,255,255,0.4)' } as ViewStyle,
  cord: { backgroundColor: '#F5F1E6', borderRadius: 1 } as ViewStyle,
  dot: (d: number): ViewStyle => ({
    width: d,
    height: d,
    borderRadius: d / 2,
    backgroundColor: INK,
  }),
  white: (w: number, h: number): ViewStyle => ({
    width: w,
    height: h,
    borderRadius: h / 2,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  pupil: (d: number): ViewStyle => ({
    width: d,
    height: d,
    borderRadius: d / 2,
    backgroundColor: INK,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  }),
  glint: (d: number): ViewStyle => ({
    width: d,
    height: d,
    borderRadius: d / 2,
    backgroundColor: '#FFFFFF',
  }),
  slit: (w: number, h: number): ViewStyle => ({
    width: w,
    height: h,
    borderRadius: h / 2,
    backgroundColor: INK,
  }),
  arc: (w: number, h: number, t: number): ViewStyle => ({
    width: w,
    height: h,
    borderTopLeftRadius: h,
    borderTopRightRadius: h,
    borderTopWidth: t,
    borderLeftWidth: t,
    borderRightWidth: t,
    borderColor: INK,
  }),
  ink: (r: number): ViewStyle => ({ backgroundColor: INK, borderRadius: r }),
  smileArc: (r: number, t: number): ViewStyle => ({
    borderBottomLeftRadius: r,
    borderBottomRightRadius: r,
    borderBottomWidth: t,
    borderLeftWidth: t,
    borderRightWidth: t,
    borderColor: INK,
  }),
};
