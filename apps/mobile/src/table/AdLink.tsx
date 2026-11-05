import { Pressable } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { adAccessibilityLabel, openAd, safeAdUrl } from './ad';
import type { TableAd } from './ad';

export interface AdLinkProps {
  readonly ad: TableAd;
  /** Posição e tamanho da área clicável (só a arte visível recebe toque). */
  readonly style: StyleProp<ViewStyle>;
  /** Abridor injetável; padrão `openAd` (nova aba no web, `Linking` no nativo). */
  readonly onOpen?: (url: string) => void;
  /** Aumenta a área tocável sem mudar o visual. */
  readonly hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
  readonly testID?: string;
}

/**
 * Área clicável do anúncio. Sem `href` https válido não renderiza nada: o anúncio continua decorativo e
 * nenhuma área captura toque. A área é transparente e fica ABAIXO das cartas na ordem de desenho.
 */
export function AdLink(p: AdLinkProps) {
  const url = safeAdUrl(p.ad.href);
  if (url === null) return null;
  const open = p.onOpen ?? openAd;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={adAccessibilityLabel(p.ad)}
      onPress={() => open(url)}
      style={p.style}
      {...(p.hitSlop !== undefined ? { hitSlop: p.hitSlop } : {})}
      {...(p.testID !== undefined ? { testID: p.testID } : {})}
    />
  );
}
