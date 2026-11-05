import { StyleSheet, View } from 'react-native';
import { Card } from './Card';
import { cardSizes } from './tokens';

/** Lado para onde as costas das cartas saem de trás do avatar. */
export type PeekDirection = 'down' | 'left' | 'right';

export interface CardBacksProps {
  /** Cartas na mão do jogador (0 a 3); 0 não desenha nada. */
  readonly count: number;
  readonly direction: PeekDirection;
  /** Lado do avatar (px): as cartas ficam escondidas atrás dele e só uma parte aparece. */
  readonly avatarSize: number;
}

/** Quanto de cada carta fica à vista fora do avatar (px). */
export const PEEK_PX = 24;

/**
 * Costas das cartas de um adversário ou do parceiro, saindo por trás do avatar. Só decoração: sai da
 * árvore de acessibilidade (a contagem já vai no rótulo do assento) e não recebe toque.
 */
export function CardBacks({ count, direction, avatarSize }: CardBacksProps) {
  const n = Math.max(0, Math.min(3, Math.floor(count)));
  if (n === 0) return null;
  const dim = cardSizes.sm;
  const mid = (n - 1) / 2;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      testID="card-backs"
    >
      {Array.from({ length: n }, (_, i) => {
        const k = i - mid;
        const vertical = direction === 'down';
        // Posição do canto da carta: centrada no eixo transversal, saindo PEEK_PX além da borda.
        const across = (avatarSize - (vertical ? dim.width : dim.height)) / 2 + k * 14;
        const along = avatarSize + PEEK_PX - (vertical ? dim.height : dim.width);
        const left = vertical ? across : direction === 'right' ? along : -PEEK_PX;
        const top = vertical ? along : across;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left,
              top,
              transform: [{ rotate: `${k * 7}deg` }],
            }}
          >
            <Card size="sm" />
          </View>
        );
      })}
    </View>
  );
}
