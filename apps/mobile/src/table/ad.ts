import { Linking, Platform } from 'react-native';

/**
 * Fonte da publicidade (pano da mesa e faixa do placar): arte própria (padrão) ou imagem por URL,
 * com link opcional. O link só vale se for `https:` (ver `safeAdUrl`); sem link o anúncio é decorativo.
 */
export type TableAd =
  | { readonly kind: 'placeholder'; readonly href?: string; readonly label?: string }
  | {
      readonly kind: 'image';
      readonly uri: string;
      readonly href?: string;
      readonly label?: string;
    };

export const DEFAULT_TABLE_AD: TableAd = { kind: 'placeholder' };

/** Texto lido pelo leitor de tela quando o anúncio tem link e não traz `label`. */
export const DEFAULT_AD_LABEL = 'Publicidade';

/**
 * Devolve a URL normalizada se for `https:` válida; senão `null` (o anúncio segue, sem link). Recusa
 * `http:`, `javascript:`, `data:`, relativas e credenciais embutidas (`https://user:senha@...`).
 */
export function safeAdUrl(href: string | undefined): string | null {
  if (href === undefined || href.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  return url.toString();
}

/** Rótulo de acessibilidade do anúncio clicável. */
export function adAccessibilityLabel(ad: TableAd): string {
  const l = ad.label?.trim();
  return l !== undefined && l !== '' ? `Publicidade: ${l}` : DEFAULT_AD_LABEL;
}

/**
 * Abre o anúncio SEM sair da partida: no web, nova aba com `noopener,noreferrer` (nunca a própria aba,
 * que derrubaria o WebSocket); no nativo, `Linking.openURL`. Injetável nos componentes, para teste.
 */
export function openAd(url: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(url).catch(() => undefined);
}
