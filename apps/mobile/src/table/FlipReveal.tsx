import { useLayoutEffect, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import type { ViewHandle } from '@trucaco/ui';

const useNative = Platform.OS !== 'web';
const MIN_SCALE = 0.02;

export interface FlipRevealProps extends Omit<ViewProps, 'style' | 'children'> {
  /** Aparece (falso -> verdadeiro) com um flip curto, se `animate`. */
  readonly shown: boolean;
  readonly animate: boolean;
  /** Espera antes do flip (a carta do overlay vira para o verso primeiro). */
  readonly delayMs?: number;
  readonly ms: number;
  readonly style?: StyleProp<ViewStyle>;
  /** Vista medida pelo chamador (posição na tela). */
  readonly containerRef?: Ref<ViewHandle>;
  readonly children: ReactNode;
}

/**
 * Faz o conteúdo "virar" (escala horizontal 0 -> 1) quando passa de escondido a visível. Só apresentação:
 * nunca decide se algo está ativo, só como aparece. Layout effect para não piscar um quadro inteiro antes.
 */
export function FlipReveal({
  shown,
  animate,
  delayMs = 0,
  ms,
  style,
  containerRef,
  children,
  ...rest
}: FlipRevealProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const prev = useRef(shown);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = shown;
    if (!shown || was || !animate) return undefined;
    scale.setValue(MIN_SCALE);
    const anim = Animated.sequence([
      Animated.delay(delayMs),
      Animated.timing(scale, {
        toValue: 1,
        duration: ms,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }),
    ]);
    anim.start();
    return () => {
      anim.stop();
      scale.setValue(1);
    };
  }, [shown, animate, delayMs, ms, scale]);
  return (
    <Animated.View
      {...rest}
      ref={containerRef as never}
      collapsable={false}
      style={[style, { transform: [{ scaleX: scale }] }]}
    >
      {children}
    </Animated.View>
  );
}
