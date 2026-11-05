import { memo } from 'react';
import {
  DEFAULT_AVATAR_PARTS,
  parseAvatarParts,
  type AvatarParts,
  type SignalId,
} from '@trucaco/protocol';
import { AvatarFallback } from './AvatarFallback';
import { useIdleAnimation, useSignalAnimation } from './useSignalAnimation';

/**
 * Renderizadores disponíveis. Hoje só o vetorial; `rive` entra nos blocos 4G/4H quando o
 * `assets/rive/avatar.riv` existir. Ponto de extensão: `pickRenderer` decide, `Avatar` não muda.
 */
export type AvatarRendererId = 'fallback';

export function pickRenderer(requested?: AvatarRendererId): AvatarRendererId {
  void requested;
  return 'fallback';
}

export interface AvatarProps {
  /** Partes do avatar. Inválidas (fora do catálogo) caem em `DEFAULT_AVATAR_PARTS`. */
  readonly parts: AvatarParts;
  /** `key` muda a cada sinal recebido (o mesmo id duas vezes seguidas anima duas vezes). */
  readonly signal?: { readonly id: SignalId; readonly key: number } | null;
  /** Chamado quando o sinal termina e o avatar voltou ao ocioso. */
  readonly onSignalEnd?: () => void;
  /** Lado em px (padrão 64). */
  readonly size?: number;
  /** Menos movimento: troca a animação por um destaque estático de 1 s. */
  readonly reduceMotion?: boolean;
  /** Rótulo falado; genérico, sem informação do jogo (padrão "Avatar"). */
  readonly accessibilityLabel?: string;
  readonly renderer?: AvatarRendererId;
  /** `circle` (padrão) ou `square` (quadrado arredondado, rosto ampliado). */
  readonly shape?: 'circle' | 'square';
  readonly testID?: string;
}

export const DEFAULT_AVATAR_SIZE = 64;

function AvatarImpl(props: AvatarProps) {
  const reduceMotion = props.reduceMotion === true;
  const parts = parseAvatarParts(props.parts) ?? DEFAULT_AVATAR_PARTS;
  const { progress, activeId, highlight } = useSignalAnimation({
    signal: props.signal,
    reduceMotion,
    onSignalEnd: props.onSignalEnd,
  });
  const { breathe, blink } = useIdleAnimation(!reduceMotion);
  pickRenderer(props.renderer);
  return (
    <AvatarFallback
      parts={parts}
      size={props.size ?? DEFAULT_AVATAR_SIZE}
      activeId={reduceMotion ? null : activeId}
      progress={progress}
      breathe={breathe}
      blink={blink}
      highlight={highlight}
      shape={props.shape}
      accessibilityLabel={props.accessibilityLabel ?? 'Avatar'}
      testID={props.testID}
    />
  );
}

/** Avatar do jogador. API única; o renderizador (vetorial hoje, Rive depois) é detalhe interno. */
export const Avatar = memo(AvatarImpl);
