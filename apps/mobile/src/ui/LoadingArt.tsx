import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useReduceMotion } from '../platform/useReduceMotion';

/**
 * Arte ORIGINAL da tela de carregamento (SVG próprio, sem marcas, logos ou personagens de terceiros):
 * mesa de boteco, logo "TRUCAÇO!" com chamas, 4 de paus (zap), 7 de copas, ás de espadas e balão "POW!".
 * As cores da arte são locais de propósito (ilustração, não tema de interface).
 */
export const LOADING_ART_LABEL = 'Ilustração: mesa de truco com cartas e o logo do jogo';

const W = 360;
const H = 300;

const art = {
  wall: '#3B1E12',
  wallLight: '#5A2E1A',
  lamp: '#FFD27A',
  table: '#7A3F1D',
  tableEdge: '#4A230F',
  felt: '#1E6B45',
  cardFace: '#FBF8EF',
  cardEdge: '#B9B29C',
  red: '#B3261E',
  black: '#1B1B1B',
  flameOuter: '#E8501A',
  flameMid: '#FF8A1F',
  flameInner: '#FFD84A',
  logoFill: '#F6C343',
  logoStroke: '#3A1405',
  pow: '#FFE45C',
  powStroke: '#3A1405',
  powText: '#D2310F',
} as const;

const FLAME = 'M0,0 C-11,-12 -5,-24 0,-44 C9,-28 15,-13 0,0Z';
const FLAME_INNER = 'M0,0 C-6,-7 -3,-14 0,-26 C5,-16 8,-8 0,0Z';
const FLAMES: ReadonlyArray<{ x: number; s: number }> = [
  { x: 62, s: 0.9 },
  { x: 98, s: 1.25 },
  { x: 135, s: 1 },
  { x: 180, s: 1.45 },
  { x: 225, s: 1 },
  { x: 262, s: 1.25 },
  { x: 298, s: 0.9 },
];

/** Estrela de quadrinhos: pontas alternadas entre raio externo e interno. */
function burstPoints(cx: number, cy: number, outer: number, inner: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function Heart() {
  return <Path d="M0,14 C-26,-4 -14,-22 0,-10 C14,-22 26,-4 0,14Z" fill={art.red} />;
}
function Spade() {
  return (
    <Path
      d="M0,-18 C-26,4 -14,18 -2,10 C-2,16 -4,20 -9,23 L9,23 C4,20 2,16 2,10 C14,18 26,4 0,-18Z"
      fill={art.black}
    />
  );
}
function Club() {
  return (
    <G fill={art.black}>
      <Circle cx={0} cy={-8} r={9} />
      <Circle cx={-10} cy={6} r={9} />
      <Circle cx={10} cy={6} r={9} />
      <Path d="M0,4 L-5,23 L5,23Z" />
    </G>
  );
}

function PlayingCard({
  x,
  y,
  rot,
  rank,
  color,
  children,
}: {
  x: number;
  y: number;
  rot: number;
  rank: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${rot})`}>
      <Rect
        x={-36}
        y={-52}
        width={72}
        height={104}
        rx={7}
        fill={art.cardFace}
        stroke={art.cardEdge}
        strokeWidth={2}
      />
      <SvgText x={-31} y={-27} fontSize={24} fontWeight="800" fill={color}>
        {rank}
      </SvgText>
      <G transform="scale(1.3)">{children}</G>
    </G>
  );
}

function Backdrop() {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <Defs>
        <LinearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={art.wall} />
          <Stop offset="1" stopColor={art.wallLight} />
        </LinearGradient>
        <LinearGradient id="cone" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={art.lamp} stopOpacity="0.38" />
          <Stop offset="1" stopColor={art.lamp} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} rx={16} fill="url(#wall)" />
      {/* ripas de madeira da parede */}
      {[48, 96, 144, 192].map((y) => (
        <Rect key={y} x={0} y={y} width={W} height={2} fill={art.tableEdge} opacity={0.35} />
      ))}
      {/* lampada pendente e cone de luz */}
      <Rect x={178} y={0} width={4} height={18} fill={art.tableEdge} />
      <Path d="M165,30 L195,30 L186,18 L174,18Z" fill={art.lamp} />
      <Polygon points="168,30 192,30 330,260 30,260" fill="url(#cone)" />
      {/* mesa: borda de madeira e feltro */}
      <Path d="M0,238 H360 V284 A16,16 0 0 1 344,300 H16 A16,16 0 0 1 0,284 Z" fill={art.table} />
      <Rect x={0} y={238} width={W} height={6} fill={art.tableEdge} />
      <Ellipse cx={180} cy={272} rx={150} ry={20} fill={art.felt} opacity={0.9} />
    </Svg>
  );
}

function Flames() {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      {FLAMES.map((f) => (
        <G key={f.x} transform={`translate(${f.x} 98) scale(${f.s})`}>
          <Path d={FLAME} fill={art.flameOuter} />
          <Path d={FLAME} fill={art.flameMid} transform="scale(0.78)" />
          <Path d={FLAME_INNER} fill={art.flameInner} />
        </G>
      ))}
    </Svg>
  );
}

function Logo() {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <SvgText
        x={W / 2}
        y={142}
        fontSize={56}
        fontWeight="900"
        textAnchor="middle"
        fill={art.logoStroke}
        stroke={art.logoStroke}
        strokeWidth={14}
        strokeLinejoin="round"
      >
        TRUCAÇO!
      </SvgText>
      <SvgText
        x={W / 2}
        y={142}
        fontSize={56}
        fontWeight="900"
        textAnchor="middle"
        fill={art.logoFill}
        stroke={art.flameOuter}
        strokeWidth={2}
      >
        TRUCAÇO!
      </SvgText>
    </Svg>
  );
}

function Cards() {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <PlayingCard x={118} y={216} rot={-16} rank="4" color={art.black}>
        <Club />
      </PlayingCard>
      <PlayingCard x={242} y={216} rot={16} rank="A" color={art.black}>
        <Spade />
      </PlayingCard>
      <PlayingCard x={180} y={208} rot={0} rank="7" color={art.red}>
        <Heart />
      </PlayingCard>
    </Svg>
  );
}

function Pow() {
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
      <Polygon
        points={burstPoints(305, 196, 46, 25, 10)}
        fill={art.pow}
        stroke={art.powStroke}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <SvgText
        x={305}
        y={203}
        fontSize={21}
        fontWeight="900"
        textAnchor="middle"
        fill={art.powText}
      >
        POW!
      </SvgText>
    </Svg>
  );
}

const native = Platform.OS !== 'web';

function useLoop(value: Animated.Value, on: boolean, ms: number): void {
  useEffect(() => {
    if (!on) {
      value.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: ms,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: native,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: ms,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: native,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [value, on, ms]);
}

/**
 * Cena de carregamento. `animated` força ligar/desligar o movimento (testes e prévia); sem ele, respeita
 * a preferência "reduzir movimento" do sistema (chamas e balão ficam parados, cartas já no lugar).
 */
export function LoadingArt({ animated }: { animated?: boolean }) {
  const reduce = useReduceMotion();
  const moving = animated ?? !reduce;
  const pulse = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(moving ? 0 : 1)).current;
  useLoop(pulse, moving, 420);
  useLoop(pop, moving, 700);
  useEffect(() => {
    if (!moving) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: native,
    }).start();
  }, [enter, moving]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={LOADING_ART_LABEL}
      testID="loading-art"
      style={styles.box}
    >
      <View style={styles.layer}>
        <Backdrop />
      </View>
      <Animated.View
        style={[
          styles.layer,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
            transform: [
              { scaleY: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
            ],
          },
        ]}
      >
        <Flames />
      </Animated.View>
      <View style={styles.layer}>
        <Logo />
      </View>
      <Animated.View
        style={[
          styles.layer,
          {
            opacity: enter,
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) },
            ],
          },
        ]}
      >
        <Cards />
      </Animated.View>
      <Animated.View
        style={[
          styles.layer,
          {
            opacity: enter,
            transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
          },
        ]}
      >
        <Pow />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', maxWidth: 420, aspectRatio: W / H, alignSelf: 'center' },
  layer: StyleSheet.absoluteFill,
});
