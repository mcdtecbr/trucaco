import type { ReactNode } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  DEFAULT_AVATAR_PARTS,
  parseAvatarParts,
  type AvatarParts,
  type SignalId,
} from '@trucaco/protocol';
import { groupParts, resolveFill, type ArtGroup } from './art';
import { BG_COLORS, safeIndex } from './parts';
import { NEUTRAL, POSES, type PoseChannel } from './poses';

/**
 * Avatar de reserva: desenha os MESMOS paths do rig `avatar.riv` (`art.ts`, viewBox 512x512) com
 * react-native-svg, então fallback e Rive mostram o mesmo avatar (ADR 0003). Um `<Svg>` por grupo
 * animado, cada um dentro de um `Animated.View`; as animações são só transform/opacity dos Views
 * (nenhuma prop SVG é animada). Sobreposições de sinal (bochechas, sorriso, dentes) são Views.
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
const LIP = '#B4443A';
const BLUSH = 'rgba(0,0,0,0.16)';

/** Região (unidades do viewBox 512) de cada grupo recortado: a escala/rotação sai do centro certo. */
type Region = readonly [x: number, y: number, w: number, h: number];
const FULL: Region = [0, 0, 512, 512];
const REGIONS = {
  nose: [216, 230, 80, 66],
  eyeL: [160, 189, 96, 90],
  eyeR: [256, 189, 96, 90],
  browL: [172, 178, 80, 44],
  browR: [260, 178, 80, 44],
  mouth: [200, 296, 112, 72],
  mouthOpen: [196, 300, 120, 72],
  tongueCenter: [230, 330, 52, 56],
  tongueSide: [248, 326, 72, 52],
} as const satisfies Partial<Record<ArtGroup, Region>>;

function evenly(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

/** Estilo absoluto de uma caixa centrada em (cx, cy), em unidades de 100. */
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
  const k = props.size / 512;
  const cfg: AvatarParts = {
    ...parsed,
    face_shape: safeIndex('face_shape', parsed.face_shape),
    skin: safeIndex('skin', parsed.skin),
    hair: safeIndex('hair', parsed.hair),
    eyes: safeIndex('eyes', parsed.eyes),
    mouth: safeIndex('mouth', parsed.mouth),
    outfit: safeIndex('outfit', parsed.outfit),
    accessory: safeIndex('accessory', parsed.accessory),
    bg_color: safeIndex('bg_color', parsed.bg_color),
    hair_color: safeIndex('hair_color', parsed.hair_color),
    eye_color: safeIndex('eye_color', parsed.eye_color),
    outfit_color: safeIndex('outfit_color', parsed.outfit_color),
    brows: safeIndex('brows', parsed.brows),
    nose: safeIndex('nose', parsed.nose),
    beard: safeIndex('beard', parsed.beard),
    hat: safeIndex('hat', parsed.hat),
  };
  const bg = BG_COLORS[cfg.bg_color] ?? BG_COLORS[0]!;
  const skin = resolveFill('skin', cfg);

  const pose = props.activeId === null ? undefined : POSES[props.activeId];
  const has = (name: PoseChannel): boolean => pose?.[name] !== undefined;
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
  const eyeRScale = Animated.multiply(blinkScale, ch('winkRScaleY'));
  const pupilX = ch('pupilX', u);
  const smileOp = ch('smileOpacity');
  // boca escolhida: esmaece com o sorriso e some enquanto a boca aberta dos sinais aparece
  const smileMouthOp: Num = has('smileOpacity') ? Animated.subtract(1, smileOp) : 1;
  const baseMouthOp: Num = has('mouthOpacity')
    ? Animated.multiply(smileMouthOp, ch('mouthOpacity'))
    : smileMouthOp;

  /** Um `<Svg>` com os paths de um grupo, recortado em `region`. */
  const layer = (group: ArtGroup, region: Region, withHidden = false): ReactNode => {
    const [x, y, w, h] = region;
    return (
      <Svg width={w * k} height={h * k} viewBox={`${x} ${y} ${w} ${h}`}>
        {groupParts(group, cfg, withHidden).map((p) => (
          <Path
            key={p.name}
            d={p.d}
            fill={resolveFill(p.fill, cfg)}
            {...(p.evenodd === true ? { fillRule: 'evenodd' as const } : {})}
            {...(p.opacity !== undefined ? { fillOpacity: p.opacity } : {})}
            {...(p.mirror === true ? { transform: 'matrix(-1 0 0 1 512 0)' } : {})}
          />
        ))}
      </Svg>
    );
  };
  const at = (region: Region): ViewStyle => ({
    position: 'absolute',
    left: region[0] * k,
    top: region[1] * k,
    width: region[2] * k,
    height: region[3] * k,
  });

  const eye = (group: 'eyeL' | 'eyeR', scaleY: Num) => (
    <Animated.View
      key={group}
      style={[
        at(REGIONS[group]),
        { transform: [{ translateX: pupilX as number }, { scaleY: scaleY as number }] },
      ]}
    >
      {layer(group, REGIONS[group])}
    </Animated.View>
  );
  const brow = (group: 'browL' | 'browR') => (
    <Animated.View
      key={group}
      style={[
        at(REGIONS[group]),
        {
          transform: [
            { translateY: ch('browY', u) as number },
            { scaleX: ch('browScale') as number },
          ],
        },
      ]}
    >
      {layer(group, REGIONS[group])}
    </Animated.View>
  );
  const puff = (cx: number) => (
    <Animated.View
      key={cx}
      style={[
        box(u, cx, 58.5, 13, 13),
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

  const headStyle = [
    StyleSheet.absoluteFill,
    {
      transform: [
        { translateX: ch('headX', u) as number },
        { translateY: ch('headY', u) as number },
        { rotate: rot('headRot') as string },
      ],
    },
  ];

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
      {/* cabelo de trás e orelhas: acompanham a cabeça, mas ficam atrás do pescoço e da roupa */}
      <Animated.View style={headStyle}>
        <View style={at(FULL)}>{layer('headBack', FULL)}</View>
      </Animated.View>

      {/* pescoço, ombros e roupa (o fundo é a cor do círculo) */}
      <Animated.View
        style={[at(FULL), { transform: [{ translateY: shoulderY as unknown as number }] }]}
      >
        {layer('body', FULL)}
      </Animated.View>

      {/* cabeça e tudo que acompanha o rosto */}
      <Animated.View style={headStyle}>
        <View style={at(FULL)}>{layer('head', FULL)}</View>
        <Animated.View
          style={[
            at(REGIONS.nose),
            {
              transform: [
                { translateX: ch('noseX', u) as number },
                { scaleX: ch('noseScale') as number },
              ],
            },
          ]}
        >
          {layer('nose', REGIONS.nose)}
        </Animated.View>
        {has('puffOpacity') ? (
          <>
            {puff(34)}
            {puff(66)}
          </>
        ) : null}
        {eye('eyeL', eyeLScale)}
        {eye('eyeR', eyeRScale)}
        {brow('browL')}
        {brow('browR')}
        {/* boca: gira em torno do próprio centro; esmaece quando o sorriso entra */}
        <Animated.View
          style={[
            at(REGIONS.mouth),
            {
              opacity: baseMouthOp as number,
              transform: [{ rotate: rot('mouthRot') as string }],
            },
          ]}
        >
          {layer('mouth', REGIONS.mouth)}
        </Animated.View>
        {has('smileOpacity') ? (
          <Animated.View
            pointerEvents="none"
            style={[
              box(u, 50, 63.5, 18, 9),
              {
                opacity: smileOp as number,
                borderBottomLeftRadius: 9 * u,
                borderBottomRightRadius: 9 * u,
                borderBottomWidth: 3 * u,
                borderLeftWidth: 3 * u,
                borderRightWidth: 3 * u,
                borderColor: LIP,
              },
            ]}
          />
        ) : null}
        {has('biteOpacity') ? (
          <Animated.View
            style={[
              box(u, 50, 64, 12, 4),
              {
                opacity: ch('biteOpacity') as number,
                backgroundColor: '#F5F1E6',
                borderRadius: 2 * u,
                borderWidth: 0.8 * u,
                borderColor: INK,
              },
            ]}
          />
        ) : null}
        {/* boca aberta (lábios, interior e dentes) e línguas: ocultas no rig, só aparecem nos sinais
            `mouth_open` (língua centrada) e `tongue` (língua de lado) */}
        {has('mouthOpenOpacity') ? (
          <Animated.View
            style={[at(REGIONS.mouthOpen), { opacity: ch('mouthOpenOpacity') as number }]}
          >
            {layer('mouthOpen', REGIONS.mouthOpen, true)}
          </Animated.View>
        ) : null}
        {has('tongueCenterOpacity') ? (
          <Animated.View
            style={[
              at(REGIONS.tongueCenter),
              {
                opacity: ch('tongueCenterOpacity') as number,
                transform: [{ translateY: ch('tongueY', u) as number }],
              },
            ]}
          >
            {layer('tongueCenter', REGIONS.tongueCenter, true)}
          </Animated.View>
        ) : null}
        {has('tongueSideOpacity') ? (
          <Animated.View
            style={[
              at(REGIONS.tongueSide),
              {
                opacity: ch('tongueSideOpacity') as number,
                transform: [{ translateY: ch('tongueY', u) as number }],
              },
            ]}
          >
            {layer('tongueSide', REGIONS.tongueSide, true)}
          </Animated.View>
        ) : null}
        <View style={at(FULL)}>{layer('front', FULL)}</View>
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
  marker: { position: 'absolute', width: 0, height: 0 } as ViewStyle,
};
