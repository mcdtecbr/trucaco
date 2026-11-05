import { StyleSheet, View } from 'react-native';
import Svg, { Image as SvgImage, Rect, Text as SvgText } from 'react-native-svg';
import { AdLink } from './AdLink';
import { DEFAULT_TABLE_AD, safeAdUrl } from './ad';
import type { TableAd } from './ad';

/** Faixa de publicidade do placar: pequena, de baixo contraste, nunca disputa com os números. */
export const SCORE_AD_WIDTH = 116;
export const SCORE_AD_HEIGHT = 16;
/** Opacidade da faixa (bem abaixo da leitura dos números). */
export const SCORE_AD_OPACITY = 0.3;
/** Área tocável de pelo menos 44 px de altura (16 da faixa + 28 abaixo), sem mudar o visual. */
const HIT_SLOP = { top: 0, bottom: 28, left: 0, right: 0 } as const;

export interface ScoreAdProps {
  /** Omitido = arte placeholder do jogo. `null` = sem publicidade (nada é renderizado). */
  readonly ad?: TableAd | null;
  /** Abridor do link (padrão: nova aba no web, `Linking` no nativo). */
  readonly onOpen?: (url: string) => void;
}

/**
 * Decorativa para o leitor de tela (fora da árvore de acessibilidade): o placar é lido pelo próprio
 * rótulo, sem "Publicidade" no meio dos números.
 */
export function ScoreAd(p: ScoreAdProps) {
  const ad = p.ad === undefined ? DEFAULT_TABLE_AD : p.ad;
  if (ad === null) return null;
  const clickable = safeAdUrl(ad.href) !== null;
  return (
    <View
      style={styles.strip}
      // Sem link: decorativa, não captura toque e some para o leitor de tela. Com link: só a faixa
      // (do tamanho da arte) recebe toque, e o `AdLink` expõe o rótulo "Publicidade: ...".
      pointerEvents={clickable ? 'box-none' : 'none'}
      accessible={false}
      {...(clickable
        ? {}
        : { 'aria-hidden': true, importantForAccessibility: 'no-hide-descendants' as const })}
      testID="score-ad"
    >
      <Svg width={SCORE_AD_WIDTH} height={SCORE_AD_HEIGHT} opacity={SCORE_AD_OPACITY}>
        <Rect
          x={0.5}
          y={0.5}
          width={SCORE_AD_WIDTH - 1}
          height={SCORE_AD_HEIGHT - 1}
          rx={4}
          fill="none"
          stroke="#F6E7B4"
        />
        {ad.kind === 'image' ? (
          <SvgImage
            href={{ uri: ad.uri }}
            x={2}
            y={1}
            width={SCORE_AD_WIDTH - 4}
            height={SCORE_AD_HEIGHT - 2}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <SvgText
            x={SCORE_AD_WIDTH / 2}
            y={11.5}
            fontSize={9}
            fontWeight="bold"
            fill="#F6E7B4"
            textAnchor="middle"
          >
            {'\u2663 TRUCAÇO! \u2665'}
          </SvgText>
        )}
      </Svg>
      <AdLink
        ad={ad}
        style={styles.hit}
        hitSlop={HIT_SLOP}
        testID="score-ad-link"
        {...(p.onOpen !== undefined ? { onOpen: p.onOpen } : {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { alignItems: 'center', marginTop: 2, width: SCORE_AD_WIDTH, height: SCORE_AD_HEIGHT },
  hit: { position: 'absolute', left: 0, top: 0, width: SCORE_AD_WIDTH, height: SCORE_AD_HEIGHT },
});
