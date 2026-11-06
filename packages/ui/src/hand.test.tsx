import { renderToStaticMarkup } from 'react-dom/server';
import { cardSizes } from './tokens';
import { describe, expect, it, vi } from 'vitest';
import { HandFan } from './HandFan';
import {
  MAX_FAN,
  PlayedCards,
  placePlays,
  slideFrom,
  trickCardOffset,
  trickFanStep,
  trickFootprint,
} from './PlayedCards';
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

describe('slideFrom / PlayedCards slideMs', () => {
  it('a carta parte do lado do assento do jogador', () => {
    expect(slideFrom('self', 64, 90).y).toBeGreaterThan(0);
    expect(slideFrom('partner', 64, 90).y).toBeLessThan(0);
    expect(slideFrom('left', 64, 90).x).toBeLessThan(0);
    expect(slideFrom('right', 64, 90).x).toBeGreaterThan(0);
  });

  it('carta nova com deslize nasce invisível; com slideMs 0 já nasce parada', () => {
    const plays = [{ seat: 0, rank: '3', suit: 'paus', covered: false }];
    const slide = renderToStaticMarkup(<PlayedCards plays={plays} mySeat={0} slideMs={450} />);
    const still = renderToStaticMarkup(<PlayedCards plays={plays} mySeat={0} slideMs={0} />);
    expect(slide).toContain('opacity:0');
    expect(still).toContain('opacity:1');
  });

  it('com e sem deslize renderiza as mesmas cartas (rótulos preservados)', () => {
    const plays = [{ seat: 0, rank: '3', suit: 'paus', covered: false }];
    const a = renderToStaticMarkup(<PlayedCards plays={plays} mySeat={0} />);
    const b = renderToStaticMarkup(<PlayedCards plays={plays} mySeat={0} slideMs={450} />);
    expect(a).toContain('três de paus');
    expect(b).toContain('três de paus');
  });
});

describe('PlayedCards: as vazas da mão se acumulam', () => {
  const t1 = [
    { seat: 0, rank: '4', suit: 'paus', covered: false },
    { seat: 1, rank: '5', suit: 'ouros', covered: false },
  ];
  const t2 = [
    { seat: 1, rank: '6', suit: 'copas', covered: false },
    { seat: 0, rank: '', suit: '', covered: true },
  ];

  it('renderiza as cartas das vazas anteriores junto com a mais recente (a minha coberta com a face)', () => {
    const html = renderToStaticMarkup(
      <PlayedCards
        earlier={[{ plays: t1 }]}
        plays={t2}
        ownCovered={{ rank: '7', suit: 'espadas' }}
        mySeat={0}
      />,
    );
    expect(html).toContain('quatro de paus');
    expect(html).toContain('cinco de ouros');
    expect(html).toContain('seis de copas');
    expect(html).toContain('Sua carta coberta: sete de espadas');
  });

  it('a identidade da minha coberta de uma vaza antiga vem da própria vaza', () => {
    const html = renderToStaticMarkup(
      <PlayedCards
        earlier={[
          {
            plays: [{ seat: 0, rank: '', suit: '', covered: true }],
            ownCovered: { rank: '6', suit: 'copas' },
          },
        ]}
        plays={t2.slice(0, 1)}
        mySeat={0}
      />,
    );
    expect(html).toContain('seis de copas');
  });

  it('a coberta dos outros nunca mostra a identidade, em nenhuma vaza', () => {
    const html = renderToStaticMarkup(
      <PlayedCards
        earlier={[{ plays: [{ seat: 1, rank: 'K', suit: 'copas', covered: true }] }]}
        plays={[]}
        mySeat={0}
      />,
    );
    expect(html).not.toContain('rei de copas');
    expect(html).toContain('Carta coberta');
  });

  it('a carta mais nova de cada jogador fica por cima e à direita da anterior', () => {
    for (const arr of ['cross', 'row'] as const) {
      const a = trickCardOffset('sm', arr, 'self', 0);
      const b = trickCardOffset('sm', arr, 'self', 1);
      const c = trickCardOffset('sm', arr, 'self', 2);
      expect(b.x - a.x).toBe(trickFanStep('sm', arr));
      expect(c.x - b.x).toBe(trickFanStep('sm', arr));
      expect(a.y).toBe(c.y);
    }
  });

  it('o leque cheio de cada posição cabe na caixa e as quatro posições não se encavalam por inteiro', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      for (const arr of ['cross', 'row'] as const) {
        const foot = trickFootprint(size, arr);
        const w = cardSizes[size].width;
        const h = cardSizes[size].height;
        for (const pos of ['self', 'partner', 'left', 'right'] as const) {
          for (let k = 0; k < MAX_FAN; k++) {
            const o = trickCardOffset(size, arr, pos, k);
            expect(Math.abs(o.x) + w / 2).toBeLessThanOrEqual(foot.width / 2);
            expect(Math.abs(o.y) + h / 2).toBeLessThanOrEqual(foot.height / 2 + 0.5);
          }
        }
      }
    }
    // Fileira: o último card do slot de uma posição não passa do primeiro da seguinte.
    const e = trickCardOffset('sm', 'row', 'self', MAX_FAN - 1);
    const n = trickCardOffset('sm', 'row', 'right', 0);
    expect(e.x + cardSizes.sm.width / 2).toBeLessThanOrEqual(n.x - cardSizes.sm.width / 2 + 1);
  });

  it('sem deslize (reconexão: slideMs 0) as cartas antigas já nascem paradas e visíveis', () => {
    const html = renderToStaticMarkup(
      <PlayedCards earlier={[{ plays: t1 }]} plays={t2} mySeat={0} slideMs={0} />,
    );
    expect(html).not.toContain('opacity:0');
  });
});
