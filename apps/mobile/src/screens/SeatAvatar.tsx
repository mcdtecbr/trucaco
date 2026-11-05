import { memo, useCallback } from 'react';
import { View } from 'react-native';
import { Avatar, SQUARE_RADIUS } from '@trucaco/avatar';
import type { AvatarParts } from '@trucaco/protocol';
import type { ActiveSignal } from '../table/tableStore';

/**
 * Lado do avatar nos assentos (px): quadrado de cantos arredondados, grande o bastante para os sinais
 * (olho, boca) serem vistos. Celular em retrato 76; deitado 72 (falta altura); web largo 112.
 */
export const SEAT_AVATAR_SIZE = { phone: 76, landscape: 72, wide: 112 } as const;

/** Raio do anel de time (borda de 3 px) que contorna o quadrado do avatar sem folga nos cantos. */
export function seatRingRadius(size: number): number {
  return Math.round(size * SQUARE_RADIUS) + 3;
}

export interface SeatAvatarProps {
  readonly seat: number;
  /** Lado em px (`SEAT_AVATAR_SIZE` por layout). */
  readonly size?: number;
  readonly parts: AvatarParts;
  /** `square` (padrão, mesa) ou `circle` (sala de espera). */
  readonly shape?: 'circle' | 'square';
  /** Sinal em animação neste assento (objeto estável até mudar) ou null. */
  readonly signal: ActiveSignal | null;
  readonly reduceMotion: boolean;
  /** Estável (método do controlador). */
  readonly onSignalEnd: (seat: number, key: number) => void;
}

/**
 * Avatar de um assento. Memoizado: só re-renderiza se partes, sinal ou preferência de movimento mudarem
 * (o resto do estado da mesa muda a cada patch e não deve tocar nos 4 avatares).
 */
export const SeatAvatar = memo(function SeatAvatar(p: SeatAvatarProps) {
  const { seat, signal, onSignalEnd } = p;
  const end = useCallback(() => {
    if (signal !== null) onSignalEnd(seat, signal.key);
  }, [seat, signal, onSignalEnd]);
  // O assento já tem nome acessível (apelido e status no `AvatarPlaceholder`): o desenho sai da
  // árvore de acessibilidade para o leitor de tela não repetir "Avatar" quatro vezes.
  return (
    <View accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
      <Avatar
        parts={p.parts}
        size={p.size ?? 56}
        shape={p.shape ?? 'square'}
        signal={signal}
        onSignalEnd={end}
        reduceMotion={p.reduceMotion}
        testID={`avatar-${seat}`}
      />
    </View>
  );
});
