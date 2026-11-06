import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Image as SvgImage,
  LinearGradient,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { ReactNode } from 'react';
import { DEFAULT_TABLE_AD } from './ad';
import type { TableAd } from './ad';

/**
 * Pano da mesa: feltro verde com textura leve, vinheta, dobras, brilho e borda de madeira, tudo em SVG
 * (sem imagem, sem dependência nova). A publicidade é impressa NO pano, com baixa opacidade e sob as
 * cartas: nunca disputa a leitura. Não é clicável (ficaria sob a vaza em cruz; só o anúncio do placar tem link). As cores são da ilustração, não do tema de interface.
 */

export type { TableAd } from './ad';
export { DEFAULT_TABLE_AD } from './ad';

/** Opacidade da publicidade impressa no pano (discreta, abaixo das cartas e dos textos). */
export const AD_OPACITY = 0.2;

const art = {
  woodLight: '#8A5A33',
  woodDark: '#4A2A14',
  feltLight: '#2F8A5B',
  feltMid: '#1F6B45',
  feltDark: '#0F3B27',
  adInk: '#F6E7B4',
} as const;

const WOOD = 8;

export interface TableFeltProps {
  readonly children?: ReactNode;
  /** Publicidade no pano. Omitido = arte placeholder do jogo. `null` = sem publicidade. */
  readonly ad?: TableAd | null;
  readonly style?: StyleProp<ViewStyle>;
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function TableFelt(p: TableFeltProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };
  const ad = p.ad === undefined ? DEFAULT_TABLE_AD : p.ad;
  return (
    <View style={[styles.wrap, p.style]} onLayout={onLayout} testID={p.testID}>
      {size.w > 0 ? (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessible={false}
          aria-hidden
          importantForAccessibility="no-hide-descendants"
        >
          <FeltArt w={size.w} h={size.h} ad={ad} />
        </View>
      ) : null}
      <View style={[styles.content, p.contentStyle]} pointerEvents="box-none">
        {p.children}
      </View>
    </View>
  );
}

function FeltArt({ w, h, ad }: { w: number; h: number; ad: TableAd | null }) {
  const r = Math.min(72, Math.min(w, h) / 3);
  const iw = w - WOOD * 2;
  const ih = h - WOOD * 2;
  const ir = Math.max(0, r - WOOD / 2);
  const cx = w / 2;
  const cy = h / 2;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={art.woodLight} />
          <Stop offset="1" stopColor={art.woodDark} />
        </LinearGradient>
        <RadialGradient id="felt" cx="50%" cy="45%" rx="70%" ry="70%">
          <Stop offset="0" stopColor={art.feltLight} />
          <Stop offset="0.6" stopColor={art.feltMid} />
          <Stop offset="1" stopColor={art.feltDark} />
        </RadialGradient>
        <RadialGradient id="vignette" cx="50%" cy="50%" rx="75%" ry="75%">
          <Stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <Stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </RadialGradient>
        <LinearGradient id="folds" x1="0" y1="0" x2="1" y2="0.35">
          <Stop offset="0" stopColor="#fff" stopOpacity="0.06" />
          <Stop offset="0.18" stopColor="#000" stopOpacity="0.1" />
          <Stop offset="0.34" stopColor="#fff" stopOpacity="0.04" />
          <Stop offset="0.55" stopColor="#000" stopOpacity="0.08" />
          <Stop offset="0.78" stopColor="#fff" stopOpacity="0.07" />
          <Stop offset="1" stopColor="#000" stopOpacity="0.1" />
        </LinearGradient>
        <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <Stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </LinearGradient>
        <Pattern id="weave" width="4" height="4" patternUnits="userSpaceOnUse">
          <Rect width="4" height="4" fill="#000" fillOpacity="0" />
          <Circle cx="1" cy="1" r="0.7" fill="#fff" fillOpacity="0.07" />
          <Circle cx="3" cy="3" r="0.7" fill="#000" fillOpacity="0.1" />
        </Pattern>
      </Defs>
      {/* Madeira e sombra da borda. */}
      <Rect x={0} y={0} width={w} height={h} rx={r} fill="url(#wood)" />
      <Rect
        x={1}
        y={1}
        width={w - 2}
        height={h - 2}
        rx={r}
        fill="none"
        stroke="#000"
        strokeOpacity={0.35}
      />
      {/* Feltro. */}
      <G x={WOOD} y={WOOD}>
        <Rect width={iw} height={ih} rx={ir} fill="url(#felt)" />
        <Rect width={iw} height={ih} rx={ir} fill="url(#weave)" />
        <Rect width={iw} height={ih} rx={ir} fill="url(#folds)" />
        <Ellipse cx={iw * 0.3} cy={ih * 0.2} rx={iw * 0.4} ry={ih * 0.22} fill="url(#sheen)" />
      </G>
      {ad !== null ? <AdArt ad={ad} cx={cx} cy={cy} w={iw} h={ih} /> : null}
      {/* Vinheta e sombra interna da madeira por cima de tudo. */}
      <G x={WOOD} y={WOOD}>
        <Rect width={iw} height={ih} rx={ir} fill="url(#vignette)" />
        <Rect
          x={0.5}
          y={0.5}
          width={iw - 1}
          height={ih - 1}
          rx={ir}
          fill="none"
          stroke="#000"
          strokeOpacity={0.45}
          strokeWidth={2}
        />
      </G>
    </Svg>
  );
}

function AdArt({
  ad,
  cx,
  cy,
  w,
  h,
}: {
  ad: TableAd;
  cx: number;
  cy: number;
  w: number;
  h: number;
}) {
  const boxW = Math.min(w * 0.7, 260);
  const boxH = Math.min(h * 0.45, 110);
  if (ad.kind === 'image') {
    return (
      <SvgImage
        href={{ uri: ad.uri }}
        x={cx - boxW / 2}
        y={cy - boxH / 2}
        width={boxW}
        height={boxH}
        preserveAspectRatio="xMidYMid meet"
        opacity={AD_OPACITY}
      />
    );
  }
  // Placeholder: logo do próprio jogo "impresso" no feltro, levemente girado, com naipes.
  const fs = Math.max(18, boxH * 0.42);
  return (
    <G opacity={AD_OPACITY} rotation={-5} origin={`${cx}, ${cy}`}>
      <Rect
        x={cx - boxW / 2}
        y={cy - boxH / 2}
        width={boxW}
        height={boxH}
        rx={14}
        fill="none"
        stroke={art.adInk}
        strokeWidth={2}
      />
      <SvgText
        x={cx}
        y={cy + fs * 0.1}
        fontSize={fs}
        fontWeight="900"
        fill={art.adInk}
        textAnchor="middle"
      >
        TRUCAÇO!
      </SvgText>
      <SvgText
        x={cx}
        y={cy + fs * 0.85}
        fontSize={Math.max(10, fs * 0.38)}
        fill={art.adInk}
        textAnchor="middle"
      >
        {'♣  ♥  ♠  ♦  seu anúncio aqui'}
      </SvgText>
    </G>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  content: { padding: WOOD + 2 },
});
