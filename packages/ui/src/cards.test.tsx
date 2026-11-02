import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Card, cardLabel } from './Card';
import { asRank, asSuit, cardName, isRedSuit, parseFace } from './cardInfo';

describe('cardInfo', () => {
  it('nomes em pt-BR e parse estrito', () => {
    expect(cardName('3', 'paus')).toBe('três de paus');
    expect(cardName('Q', 'copas')).toBe('dama de copas');
    expect(cardName('A', 'espadas')).toBe('ás de espadas');
    expect(parseFace({ rank: '7', suit: 'ouros' })).toEqual({ rank: '7', suit: 'ouros' });
    expect(parseFace({ rank: '', suit: '' })).toBeNull();
    expect(parseFace({ rank: '9', suit: 'paus' })).toBeNull();
    expect(asRank('K')).toBe('K');
    expect(asRank('k')).toBeNull();
    expect(asSuit('paus ')).toBeNull();
    expect(isRedSuit('copas')).toBe(true);
    expect(isRedSuit('paus')).toBe(false);
  });
});

describe('cardLabel', () => {
  it('face, manilha, verso, coberta própria e alheia, às cegas', () => {
    expect(cardLabel({ rank: '3', suit: 'paus' })).toBe('três de paus');
    expect(cardLabel({ rank: '3', suit: 'paus', manilha: true })).toBe('três de paus, manilha');
    expect(cardLabel({})).toBe('Carta virada');
    expect(cardLabel({ covered: true })).toBe('Carta coberta');
    expect(cardLabel({ covered: true, rank: '4', suit: 'ouros' })).toBe(
      'Sua carta coberta: quatro de ouros',
    );
    expect(cardLabel({ unknown: true })).toBe('Carta virada, às cegas');
  });
});

describe('Card', () => {
  it('face: papel imagem, rótulo e texto de rank/naipe', () => {
    const html = renderToStaticMarkup(<Card rank="3" suit="paus" manilha />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="três de paus, manilha"');
    expect(html).toContain('♣');
    expect(html).not.toContain('<button');
  });

  it('verso não revela identidade; coberta alheia sem rank', () => {
    const html = renderToStaticMarkup(<Card covered />);
    expect(html).toContain('aria-label="Carta coberta"');
    expect(html).not.toContain('♣');
  });

  it('própria coberta: verso com miniatura da identidade', () => {
    const html = renderToStaticMarkup(<Card covered rank="7" suit="copas" />);
    expect(html).toContain('aria-label="Sua carta coberta: sete de copas"');
    expect(html).toContain('7♥');
  });

  it('às cegas: verso com "?"', () => {
    const html = renderToStaticMarkup(<Card unknown />);
    expect(html).toContain('>?<');
  });

  it('interativa: botão, estados desabilitado e selecionado, dentro dos 44 pt', () => {
    const on = renderToStaticMarkup(<Card rank="K" suit="espadas" onPress={vi.fn()} selected />);
    expect(on).toContain('role="button"');
    expect(on).toContain('aria-pressed="true"');
    expect(on).not.toContain('aria-selected');
    expect(on).toContain('aria-label="rei de espadas, selecionada"');
    expect(on).not.toContain('aria-disabled="true"');
    const off = renderToStaticMarkup(<Card rank="K" suit="espadas" onPress={vi.fn()} disabled />);
    expect(off).toContain('aria-disabled="true"');
  });

  it('rótulo explícito substitui o calculado e ignora texto de HTML do servidor', () => {
    const html = renderToStaticMarkup(
      <Card rank="2" suit="ouros" accessibilityLabel="Zé: dois de ouros" />,
    );
    expect(html).toContain('aria-label="Zé: dois de ouros"');
  });
});
