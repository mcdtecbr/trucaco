import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HandFan } from './HandFan';
import { PlayedCards, placePlays } from './PlayedCards';
import { blindActions, canCover, handCardViews } from './handActions';

const HAND = [
  { rank: '3', suit: 'paus' },
  { rank: '7', suit: 'copas' },
  { rank: 'Q', suit: 'ouros' },
];

describe('handCardViews', () => {
  it('habilita só as cartas listadas em legalActions e devolve os ids do servidor', () => {
    const v = handCardViews(HAND, ['play:3paus', 'playCovered:3paus', 'play:Qouros', 'bet']);
    expect(v.map((x) => x.play)).toEqual(['play:3paus', null, 'play:Qouros']);
    expect(v[0]?.playCovered).toBe('playCovered:3paus');
    expect(v[1]?.playCovered).toBeNull();
  });

  it('sem legalActions ninguém joga; ids inválidos e carta desconhecida são ignorados', () => {
    expect(handCardViews(HAND, []).every((x) => x.play === null)).toBe(true);
    const v = handCardViews([{ rank: '9', suit: 'paus' }], ['play:9paus', 'play:__proto__']);
    expect(v[0]?.face).toBeNull();
    expect(v[0]?.play).toBeNull();
  });

  it('blindActions e canCover', () => {
    expect(blindActions(3, ['playBlind:0', 'playBlind:2', 'playBlind:5'])).toEqual([
      'playBlind:0',
      null,
      'playBlind:2',
    ]);
    expect(blindActions(0, ['playBlind:0'])).toEqual([]);
    expect(blindActions(9, [])).toHaveLength(3);
    expect(canCover(['play:3paus'])).toBe(false);
    expect(canCover(['playCovered:3paus'])).toBe(true);
  });
});

describe('HandFan', () => {
  it('três cartas, só as legais habilitadas, manilha destacada no rótulo', () => {
    const html = renderToStaticMarkup(
      <HandFan
        hand={HAND}
        legalActions={['play:3paus']}
        manilhas={[{ rank: '3', suit: 'paus' }]}
        onPress={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Sua mão"');
    expect(html).toContain('aria-label="três de paus, manilha"');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it('modo coberta usa as ações playCovered', () => {
    const html = renderToStaticMarkup(
      <HandFan
        hand={HAND}
        legalActions={['play:3paus', 'playCovered:7copas']}
        coverMode
        onPress={vi.fn()}
      />,
    );
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
  });

  it('mão de ferro: três versos com "?" e rótulos sem identidade', () => {
    const html = renderToStaticMarkup(
      <HandFan
        hand={[]}
        blindCount={3}
        legalActions={['playBlind:0', 'playBlind:1', 'playBlind:2']}
        onPress={vi.fn()}
      />,
    );
    expect(html.match(/>\?</g)).toHaveLength(3);
    expect(html).toContain('Carta 2 de 3, às cegas');
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('♣');
  });
});

describe('placePlays / PlayedCards', () => {
  const plays = [
    { seat: 2, rank: '4', suit: 'paus', covered: false },
    { seat: 3, rank: '', suit: '', covered: true },
    { seat: 1, rank: 'A', suit: 'copas', covered: false },
  ];

  it('mapeia assentos para posições relativas ao jogador e guarda a ordem de chegada', () => {
    const { byPosition, order } = placePlays(plays, 1);
    expect(byPosition.partner?.seat).toBe(3);
    expect(byPosition.self?.seat).toBe(1);
    expect(byPosition.right?.seat).toBe(2);
    expect(order).toEqual(['right', 'partner', 'self']);
  });

  it('assento repetido: vale a última jogada e a ordem não duplica', () => {
    const r = placePlays([plays[0]!, { ...plays[0]!, rank: '5' }], 0);
    expect(r.order).toHaveLength(1);
    expect(r.byPosition.partner?.rank).toBe('5');
  });

  it('renderiza nomes, coberta alheia sem identidade e própria coberta com miniatura', () => {
    const html = renderToStaticMarkup(
      <PlayedCards
        plays={[
          { seat: 0, rank: '', suit: '', covered: true },
          { seat: 1, rank: '', suit: '', covered: true },
          { seat: 2, rank: '3', suit: 'paus', covered: false },
        ]}
        mySeat={0}
        ownCovered={{ rank: '6', suit: 'espadas' }}
        manilhas={[{ rank: '3', suit: 'paus' }]}
        nicknameOf={(s) => `P${s}`}
      />,
    );
    expect(html).toContain('P0: Sua carta coberta: seis de espadas');
    expect(html).toContain('P1: Carta coberta');
    expect(html).toContain('P2: três de paus, manilha');
    expect(html).toContain('Cartas na mesa');
  });

  it('mesa vazia tem rótulo próprio', () => {
    expect(renderToStaticMarkup(<PlayedCards plays={[]} mySeat={0} />)).toContain(
      'Nenhuma carta na mesa',
    );
  });
});
