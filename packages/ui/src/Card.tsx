import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Rank, Suit } from '@trucaco/protocol';
import { SUIT_SYMBOL, cardName, isRedSuit } from './cardInfo';
import { MIN_TOUCH, cardColors, cardSizes, fontWeight, radius, shadows } from './tokens';
import type { CardSize } from './tokens';

export interface CardProps {
  /** Face voltada para cima. Sem `rank`/`suit` a carta mostra o verso. */
  readonly rank?: Rank;
  readonly suit?: Suit;
  readonly size?: CardSize;
  /** Verso com "?" (mão de ferro: carta às cegas). */
  readonly unknown?: boolean;
  /** Carta coberta. Com `rank`/`suit` é a própria coberta (verso + miniatura); sem eles, coberta alheia. */
  readonly covered?: boolean;
  /** Destaque de manilha (informação vinda do servidor/estado, nunca calculada aqui). */
  readonly manilha?: boolean;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Presente = carta interativa (botão, alvo >= 44 pt). */
  readonly onPress?: () => void;
  /** Substitui o rótulo de acessibilidade calculado. */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/** Rótulo de acessibilidade da carta, em pt-BR. */
export function cardLabel(
  p: Pick<CardProps, 'rank' | 'suit' | 'covered' | 'unknown' | 'manilha'>,
): string {
  const face = p.rank !== undefined && p.suit !== undefined ? cardName(p.rank, p.suit) : null;
  if (p.unknown === true) return 'Carta virada, às cegas';
  if (p.covered === true) return face !== null ? `Sua carta coberta: ${face}` : 'Carta coberta';
  if (face === null) return 'Carta virada';
  return p.manilha === true ? `${face}, manilha` : face;
}

type CardDim = (typeof cardSizes)[CardSize];

export function Card(props: CardProps) {
  const size = props.size ?? 'md';
  const dim = cardSizes[size];
  const faceUp =
    props.rank !== undefined &&
    props.suit !== undefined &&
    props.covered !== true &&
    props.unknown !== true;
  const baseLabel = props.accessibilityLabel ?? cardLabel(props);
  const label = props.selected === true ? `${baseLabel}, selecionada` : baseLabel;
  const interactive = props.onPress !== undefined;
  const disabled = props.disabled === true;
  const selected = props.selected === true;

  const body = faceUp ? (
    <FaceBody rank={props.rank as Rank} suit={props.suit as Suit} dim={dim} />
  ) : (
    <BackBody
      dim={dim}
      unknown={props.unknown === true}
      mini={props.covered === true ? { rank: props.rank, suit: props.suit } : null}
    />
  );

  const box = [
    styles.card,
    { width: dim.width, height: dim.height },
    faceUp ? styles.face : styles.back,
    faceUp && disabled && styles.faceDisabled,
    props.manilha === true && styles.manilha,
    selected && styles.selected,
    disabled && styles.disabled,
  ];

  if (!interactive) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        {...(props.testID !== undefined ? { testID: props.testID } : {})}
        style={box}
      >
        {body}
      </View>
    );
  }

  // Área de toque >= 44 pt mesmo se a carta for menor (hitSlop compensa o que faltar).
  const slopX = Math.max(0, Math.ceil((MIN_TOUCH - dim.width) / 2));
  const slopY = Math.max(0, Math.ceil((MIN_TOUCH - dim.height) / 2));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      {...selectedProps(selected)}
      disabled={disabled}
      hitSlop={{ top: slopY, bottom: slopY, left: slopX, right: slopX }}
      onPress={props.onPress}
      {...(props.testID !== undefined ? { testID: props.testID } : {})}
      style={box}
    >
      {body}
    </Pressable>
  );
}

/**
 * Estado "selecionada" por plataforma. Web: `aria-pressed` (aria-selected não vale para role=button;
 * o RNW 0.21 o repassa ao DOM). Nativo: o RN 0.88 não tem `aria-pressed` em View/Pressable; a via
 * é `aria-selected`, que vira `accessibilityState.selected` (View.js/Pressable.js).
 */
export function selectedProps(selected: boolean): {
  'aria-pressed'?: boolean;
  'aria-selected'?: boolean;
} {
  return Platform.select({
    web: { 'aria-pressed': selected },
    default: { 'aria-selected': selected },
  });
}

function FaceBody({ rank, suit, dim }: { rank: Rank; suit: Suit; dim: CardDim }) {
  const color = isRedSuit(suit) ? cardColors.red : cardColors.black;
  return (
    <View style={styles.fill} importantForAccessibility="no-hide-descendants">
      <Text style={[styles.corner, { color, fontSize: dim.rank }]}>{rank}</Text>
      <Text style={[styles.cornerSuit, { color, fontSize: dim.suit }]}>{SUIT_SYMBOL[suit]}</Text>
      <Text style={[styles.center, { color, fontSize: dim.center }]}>{SUIT_SYMBOL[suit]}</Text>
    </View>
  );
}

function BackBody({
  dim,
  unknown,
  mini,
}: {
  dim: CardDim;
  unknown: boolean;
  mini: { rank: Rank | undefined; suit: Suit | undefined } | null;
}) {
  const miniOk = mini !== null && mini.rank !== undefined && mini.suit !== undefined;
  return (
    <View style={[styles.fill, styles.backInner]} importantForAccessibility="no-hide-descendants">
      {unknown ? <Text style={[styles.question, { fontSize: dim.question }]}>?</Text> : null}
      {miniOk ? (
        <View style={styles.mini}>
          <Text
            style={[
              styles.miniText,
              {
                fontSize: dim.mini,
                color: isRedSuit(mini.suit as Suit) ? cardColors.red : cardColors.black,
              },
            ]}
          >
            {mini.rank}
            {SUIT_SYMBOL[mini.suit as Suit]}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.sm,
    borderWidth: 2,
    overflow: 'hidden',
    ...shadows.card,
  },
  face: { backgroundColor: cardColors.face, borderColor: cardColors.faceBorder },
  back: { backgroundColor: cardColors.back, borderColor: cardColors.backBorder },
  manilha: { borderColor: cardColors.manilha, borderWidth: 3 },
  selected: { borderColor: cardColors.selected, transform: [{ translateY: -10 }] },
  disabled: { opacity: 0.85, borderStyle: 'dashed', shadowOpacity: 0, elevation: 0 },
  faceDisabled: { backgroundColor: cardColors.faceDisabled },
  fill: { flex: 1 },
  backInner: {
    margin: 4,
    borderWidth: 1,
    borderRadius: radius.sm / 2,
    borderColor: cardColors.backPattern,
    alignItems: 'center',
    justifyContent: 'center',
  },
  question: { color: cardColors.backBorder, fontWeight: fontWeight.heavy },
  mini: {
    position: 'absolute',
    bottom: 3,
    right: 3,
    backgroundColor: cardColors.face,
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: cardColors.faceBorder,
  },
  miniText: { fontWeight: fontWeight.bold },
  corner: { position: 'absolute', top: 2, left: 4, fontWeight: fontWeight.heavy },
  cornerSuit: { position: 'absolute', top: 20, left: 4 },
  center: { position: 'absolute', bottom: 4, right: 6 },
});
