import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BetButtons } from './BetButtons';
import { betButtons, betCorner } from './bets';
import { CardBacks } from './CardBacks';
import { ScoreLayers } from './ScoreLayers';
import { isHorizontalTable, tableLayoutFor } from './layout';

describe('tableLayoutFor', () => {
  it('celular em retrato, celular deitado e web largo', () => {
    expect(tableLayoutFor(360, 640)).toBe('phone');
    expect(tableLayoutFor(390, 844)).toBe('phone');
    expect(tableLayoutFor(844, 390)).toBe('landscape');
    expect(tableLayoutFor(932, 430)).toBe('landscape');
    expect(tableLayoutFor(1280, 720)).toBe('wide');
    expect(tableLayoutFor(900, 600)).toBe('wide');
    // Tablet em retrato e janela estreita alta continuam coluna única, como antes.
    expect(tableLayoutFor(800, 1100)).toBe('phone');
    expect(tableLayoutFor(1024, 1366)).toBe('wide');
  });

  it('landscape e wide usam a mesa horizontal', () => {
    expect(isHorizontalTable('phone')).toBe(false);
    expect(isHorizontalTable('landscape')).toBe(true);
    expect(isHorizontalTable('wide')).toBe(true);
  });
});

describe('botão de aposta do canto', () => {
  const main = (legal: string[], nextValue?: number, raising = false) =>
    betCorner(betButtons(legal, { raising, nextValue })).main;

  it('o mesmo botão vira TRUCO!, SEIS!, NOVE! e DOZE! (Paulista)', () => {
    expect(main(['bet'], 3)?.label).toBe('Truco!');
    expect(main(['accept', 'run', 'bet'], 6, true)?.label).toBe('Seis!');
    expect(main(['accept', 'run', 'bet'], 9, true)?.label).toBe('Nove!');
    expect(main(['accept', 'run', 'bet'], 12, true)?.label).toBe('Doze!');
  });

  it('Mineiro: truco 4, seis, oito, dez e doze', () => {
    expect(main(['bet'], 4)?.label).toBe('Truco!');
    expect(main(['bet'], 6, true)?.label).toBe('Seis!');
    expect(main(['bet'], 8, true)?.label).toBe('Oito!');
    expect(main(['bet'], 10, true)?.label).toBe('Dez!');
    expect(main(['bet'], 12, true)?.label).toBe('Doze!');
  });

  it('respostas ficam ao lado: correr, aceitar; sem aumentar, a vaga principal é nula', () => {
    const c = betCorner(betButtons(['accept', 'run'], { pendingValue: 12 }));
    expect(c.main).toBeNull();
    expect(c.side.map((b) => b.id)).toEqual(['run', 'accept']);
  });

  it('mão de onze/dez: correr da mão e jogar a mão ao lado, sem principal', () => {
    const c = betCorner(betButtons(['specialPlay', 'specialRun']));
    expect(c.main).toBeNull();
    expect(c.side.map((b) => b.id)).toEqual(['specialRun', 'specialPlay']);
  });

  it('o principal é sempre o último da fileira; a vaga é reservada quando não há aumentar', () => {
    const withBet = renderToStaticMarkup(
      <BetButtons
        variant="corner"
        legalActions={['accept', 'run', 'bet']}
        raising
        nextValue={6}
        pendingValue={3}
        onPress={vi.fn()}
      />,
    );
    expect(withBet.lastIndexOf('data-testid="bet-bet"')).toBeGreaterThan(
      withBet.lastIndexOf('data-testid="bet-accept"'),
    );
    expect(withBet.indexOf('data-testid="bet-run"')).toBeLessThan(
      withBet.indexOf('data-testid="bet-accept"'),
    );
    const noBet = renderToStaticMarkup(
      <BetButtons variant="corner" legalActions={['accept', 'run']} onPress={vi.fn()} />,
    );
    expect(noBet).not.toContain('bet-bet');
    expect(noBet.match(/role="button"/g)).toHaveLength(2);
  });

  it('sem ação de aposta não renderiza nada (cartas não contam)', () => {
    expect(
      renderToStaticMarkup(
        <BetButtons variant="corner" legalActions={['play:3paus']} onPress={vi.fn()} />,
      ),
    ).toBe('');
  });
});

describe('CardBacks', () => {
  it('uma carta virada por carta na mão (0 a 3), fora da árvore de acessibilidade', () => {
    expect(renderToStaticMarkup(<CardBacks count={0} direction="down" avatarSize={82} />)).toBe('');
    const out = renderToStaticMarkup(<CardBacks count={3} direction="down" avatarSize={82} />);
    expect(out.match(/aria-label="Carta virada"/g)).toHaveLength(3);
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('card-backs');
    expect(
      renderToStaticMarkup(<CardBacks count={9} direction="left" avatarSize={82} />).match(
        /aria-label="Carta virada"/g,
      ),
    ).toHaveLength(3);
  });
});

describe('ScoreLayers em barra', () => {
  const base = {
    myTeam: 0 as const,
    series: { format: 'bo3', games: [1, 0], gameNumber: 2 },
    scores: [7, 3],
    handNumber: 4,
    handValue: 6,
    special: '',
    tricks: [{ winnerTeam: 0 }],
  };

  it('mostra duplas, vazas, valor, série e os botões recebidos', () => {
    const out = renderToStaticMarkup(
      <ScoreLayers {...base} bar actions={<span data-testid="x-action" />} />,
    );
    expect(out).toContain('score-bar');
    expect(out).toContain('Vale 6');
    expect(out).toContain('Série 1×0');
    expect(out).toContain('score-history-toggle');
    expect(out).toContain('x-action');
    expect(out).toContain('●');
  });

  it('histórico recolhido por padrão e série só no bo3', () => {
    const out = renderToStaticMarkup(
      <ScoreLayers {...base} series={{ format: 'single', games: [0, 0], gameNumber: 1 }} bar />,
    );
    expect(out).not.toContain('Série');
    expect(out).not.toContain('score-history"');
    expect(out).toContain('aria-expanded="false"');
  });
});
