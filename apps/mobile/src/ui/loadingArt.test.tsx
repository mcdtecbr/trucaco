import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BootView, LOADING_TEXT } from '../screens/BootView';
import { LoadingArt, LOADING_ART_LABEL } from './LoadingArt';

const noop = (): void => undefined;
// Termos de terceiros que nunca podem aparecer na arte (marcas, clubes, seleções).
const FORBIDDEN = /nike|adidas|cbf|fifa|brasil|flamengo|corinthians|coca|pepsi|skol|brahma/i;

describe('LoadingArt', () => {
  it('é uma imagem acessível com rótulo e a marca do jogo com cedilha', () => {
    for (const animated of [true, false]) {
      const html = renderToStaticMarkup(<LoadingArt animated={animated} />);
      expect(html).toContain('data-testid="loading-art"');
      expect(html).toContain('role="img"');
      expect(html).toContain(`aria-label="${LOADING_ART_LABEL}"`);
      expect(html).toContain('TRUCAÇO!');
      expect(html).toContain('POW!');
    }
  });

  it('não contém marcas de terceiros', () => {
    expect(renderToStaticMarkup(<LoadingArt animated={false} />)).not.toMatch(FORBIDDEN);
  });
});

describe('BootView com a arte', () => {
  it('carregando mostra a arte e o texto acessível, sem links legais (o boot redireciona)', () => {
    const html = renderToStaticMarkup(
      <BootView phase="loading" onRetry={noop} legal={{ onTerms: noop, onPrivacy: noop }} />,
    );
    expect(html).toContain('data-testid="loading-art"');
    expect(html).toContain(LOADING_TEXT);
    expect(html).toContain('aria-label="Carregando…"');
    expect(html).not.toContain('Termos de uso');
  });

  it('servidor indisponível mostra os links legais', () => {
    const html = renderToStaticMarkup(
      <BootView phase="unavailable" onRetry={noop} legal={{ onTerms: noop, onPrivacy: noop }} />,
    );
    expect(html).toContain('Termos de uso');
    expect(html).toContain('Política de Privacidade');
  });

  it('sem legal, não mostra os links', () => {
    expect(renderToStaticMarkup(<BootView phase="loading" onRetry={noop} />)).not.toContain(
      'Termos de uso',
    );
  });
});
