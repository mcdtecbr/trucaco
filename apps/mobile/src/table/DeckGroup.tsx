import { StyleSheet, View } from 'react-native';
import { Card, cardName, parseFace } from '@trucaco/ui';
import {
  DECK_GROUP_H,
  DECK_GROUP_W,
  DECK_IN_X,
  VIRA_IN_X,
  VIRA_IN_Y,
  VIRA_ROTATION,
} from './tableGeometry';

export interface DeckGroupProps {
  /** Valores do snapshot (`''` = variante sem vira). */
  viraRank: string;
  viraSuit: string;
  /** Manilha pronta (vem do servidor; o cliente nao a deriva). */
  manilhaLabel?: string | undefined;
  /** A vira aparece so depois de distribuir (e some quando as cartas voltam ao monte). */
  viraHidden: boolean;
}

/**
 * Monte de cartas de costas no canto do pano com a vira saindo por baixo (levemente deslocada e
 * inclinada) (sem texto; a manilha fica no rotulo de acessibilidade). So apresentacao: a vira e a manilha vem do servidor.
 * A animacao de distribuir parte do centro do monte (`DealOverlay`), que fica sob esta camada.
 */
export function DeckGroup(p: DeckGroupProps) {
  const face = parseFace({ rank: p.viraRank, suit: p.viraSuit });
  const showVira = face !== null && !p.viraHidden;
  return (
    <View
      style={styles.box}
      pointerEvents="none"
      testID="deck-group"
      accessible={face !== null}
      accessibilityLabel={
        face !== null
          ? `Vira: ${cardName(face.rank, face.suit)}${p.manilhaLabel !== undefined ? `. Manilha: ${p.manilhaLabel}` : ''}`
          : undefined
      }
    >
      {face !== null ? (
        <View
          style={[
            styles.vira,
            { opacity: showVira ? 1 : 0, transform: [{ rotate: `${VIRA_ROTATION}deg` }] },
          ]}
          testID="vira-card"
        >
          <Card size="sm" rank={face.rank} suit={face.suit} accessibilityLabel="Vira" />
        </View>
      ) : null}
      <View style={styles.deck} testID="deck-stack">
        <View style={[styles.deckCard, { top: -4, left: 3 }]}>
          <Card size="sm" />
        </View>
        <View style={[styles.deckCard, { top: -2, left: 1 }]}>
          <Card size="sm" />
        </View>
        <Card size="sm" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: DECK_GROUP_W, height: DECK_GROUP_H },
  deck: { position: 'absolute', left: DECK_IN_X, top: 0 },
  deckCard: { position: 'absolute' },
  vira: { position: 'absolute', left: VIRA_IN_X, top: VIRA_IN_Y },
});
