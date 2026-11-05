import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Preferência "reduzir movimento" do sistema (iOS/Android: `AccessibilityInfo`; web: o
 * `prefers-reduced-motion` que o react-native-web expõe pela mesma API). Falso até a primeira leitura.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduce(on);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      if (alive) setReduce(on);
    });
    return () => {
      alive = false;
      (sub as { remove?: () => void } | undefined)?.remove?.(); // react-native-web antigo devolve undefined
    };
  }, []);
  return reduce;
}
