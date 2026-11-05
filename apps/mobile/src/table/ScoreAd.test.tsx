import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreAd } from './ScoreAd';

describe('ScoreAd', () => {
  it('padrão: arte placeholder do jogo, decorativa para o leitor de tela', () => {
    const html = renderToStaticMarkup(<ScoreAd />);
    expect(html).toContain('score-ad');
    expect(html).toContain('TRUCAÇO!');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-label');
  });

  it('imagem por URL', () => {
    const html = renderToStaticMarkup(
      <ScoreAd ad={{ kind: 'image', uri: 'https://x.test/a.png' }} />,
    );
    expect(html).toContain('score-ad');
    expect(html).not.toContain('TRUCAÇO!');
  });

  it('null remove a publicidade', () => {
    expect(renderToStaticMarkup(<ScoreAd ad={null} />)).toBe('');
  });
});
