import { memo, useCallback } from 'react';
import { View } from 'react-native';
import { Avatar } from '@trucaco/avatar';
import type { AvatarParts } from '@trucaco/protocol';
import type { ActiveSignal } from '../table/tableStore';

/** Lado do avatar nos assentos (px). */
export const SEAT_AVATAR_SIZE = 56;

export interface SeatAvatarProps {
  readonly seat: number;
  readonly parts: AvatarParts;
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
        size={SEAT_AVATAR_SIZE}
        signal={signal}
        onSignalEnd={end}
        reduceMotion={p.reduceMotion}
        testID={`avatar-${seat}`}
      />
    </View>
  );
});
