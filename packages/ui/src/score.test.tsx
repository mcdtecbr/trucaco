import { teamColors } from './tokens';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScoreLayers } from './ScoreLayers';
import type { ScoreLayersProps } from './ScoreLayers';
import {
  defaultTeamNames,
  describeHandResult,
  pointsText,
  scoreSummary,
  specialText,
  trickMarks,
} from './score';

describe('trickMarks', () => {
  it('ganha, perde, empata e a jogar, do ponto de vista da dupla', () => {
    const tricks = [{ winnerTeam: 0 }, { winnerTeam: -1 }];
    expect(trickMarks(tricks, 0)).toEqual(['won', 'draw', 'pending']);
    expect(trickMarks(tricks, 1)).toEqual(['lost', 'draw', 'pending']);
    expect(trickMarks([], 0)).toEqual(['pending', 'pending', 'pending']);
  });
});

describe('textos do placar', () => {
  it('nomes padrão, pontos no singular e mão especial por variante', () => {
    expect(defaultTeamNames(0)).toEqual(['Nós', 'Eles']);
    expect(defaultTeamNames(1)).toEqual(['Eles', 'Nós']);
    expect(pointsText(1)).toBe('1 ponto');
    expect(pointsText(3)).toBe('3 pontos');
    expect(specialText('maoDeOnze')).toBe('Mão de onze');
    expect(specialText('maoDeOnze', 'mineiro')).toBe('Mão de dez');
    expect(specialText('maoDeFerro')).toBe('Mão de ferro');
    expect(specialText('normal')).toBeNull();
  });

  it('describeHandResult cobre vitória, empate e nota', () => {
    const names = ['Nós', 'Eles'] as const;
    const base = { handNumber: 2, points: 3, scores: [3, 0] as const };
    expect(describeHandResult({ ...base, winnerTeam: 0, reason: 'betRun' }, names)).toBe(
      'Mão 2: 3 pontos para Nós (aposta corrida)',
    );
    expect(
      describeHandResult({ ...base, winnerTeam: null, points: 0, reason: 'draw' }, names),
    ).toContain('empatada');
    expect(
      describeHandResult(
        { ...base, winnerTeam: 1, reason: 'tricks', note: 'Ana pediu truco' },
        names,
      ),
    ).toBe('Mão 2: 3 pontos para Eles (nas vazas). Ana pediu truco');
  });
});

const BASE: ScoreLayersProps = {
  myTeam: 1,
  series: { format: 'bo3', games: [1, 0], gameNumber: 2 },
  scores: [5, 7],
  handNumber: 4,
  handValue: 6,
  special: 'maoDeFerro',
  tricks: [{ winnerTeam: 1 }, { winnerTeam: -1 }],
};

describe('ScoreLayers', () => {
  it('histórico mostra os lances de cada mão e da mão em curso', () => {
    const html = renderToStaticMarkup(
      <ScoreLayers
        {...BASE}
        defaultHistoryOpen
        handNumber={2}
        currentLog={['Bia jogou rei de ouros.']}
        history={[
          {
            handNumber: 1,
            winnerTeam: 0,
            points: 1,
            reason: 'tricks',
            scores: [1, 0],
            details: ['Vaza 1: Você levou.'],
          },
        ]}
      />,
    );
    expect(html).toContain('Vaza 1: Você levou.');
    expect(html).toContain('Mão 2 em curso');
    expect(html).toContain('Bia jogou rei de ouros.');
  });

  it('mostra série, jogo, valor da mão e vazas com a minha dupla primeiro', () => {
    const html = renderToStaticMarkup(<ScoreLayers {...BASE} />);
    expect(html).toContain('Série 0 × 1 · Jogo 2');
    expect(html.indexOf('Nós')).toBeLessThan(html.indexOf('Eles'));
    expect(html).toContain('Vale 6');
    expect(html).toContain('Mão de ferro');
    expect(html).toContain('>7<');
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Série: Nós 0, Eles 1. Jogo 2. Placar: Nós 7, Eles 5');
  });

  it('single: sem camada de série; antes da primeira mão sem valor', () => {
    const html = renderToStaticMarkup(
      <ScoreLayers
        {...BASE}
        myTeam={0}
        series={{ format: 'single', games: [0, 0], gameNumber: 1 }}
        handNumber={0}
      />,
    );
    expect(html).not.toContain('Série');
    expect(html).not.toContain('Vale');
  });

  it('histórico aberto: vazio e com mãos; texto do servidor só como texto', () => {
    const empty = renderToStaticMarkup(<ScoreLayers {...BASE} defaultHistoryOpen />);
    expect(empty).toContain('Nenhuma mão concluída ainda.');
    const html = renderToStaticMarkup(
      <ScoreLayers
        {...BASE}
        defaultHistoryOpen
        history={[
          {
            handNumber: 1,
            winnerTeam: 1,
            points: 1,
            reason: 'tricks',
            scores: [0, 1],
            note: '<img src=x onerror=alert(1)>',
          },
        ]}
      />,
    );
    expect(html).toContain('Mão 1: 1 ponto para Nós (nas vazas)');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('cor do "Nós" é fixa (azul) nas duas duplas e a adversária é laranja', () => {
    const hex = (c: string) => {
      const n = Number.parseInt(c.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    };
    for (const my of [0, 1] as const) {
      const html = renderToStaticMarkup(<ScoreLayers {...BASE} myTeam={my} />);
      const nos = html.slice(html.indexOf('>Nós<') - 80, html.indexOf('>Nós<'));
      const eles = html.slice(html.indexOf('>Eles<') - 80, html.indexOf('>Eles<'));
      expect(nos).toContain(hex(teamColors.mine.main));
      expect(eles).toContain(hex(teamColors.theirs.main));
    }
  });

  it('nomes de dupla customizados', () => {
    const html = renderToStaticMarkup(
      <ScoreLayers {...BASE} teamNames={['Ana e Bia', 'Caio e Dê']} />,
    );
    expect(html).toContain('Caio e Dê');
  });

  it('scoreSummary sem mão iniciada e com variante mineira', () => {
    const s = scoreSummary(
      {
        names: ['Nós', 'Eles'],
        scores: [10, 10],
        series: { format: 'single', games: [], gameNumber: 1 },
        handNumber: 9,
        handValue: 2,
        special: 'maoDeOnze',
        myTeam: 0,
        tricks: [],
      },
      'mineiro',
    );
    expect(s).toContain('Mão de dez');
    expect(s).not.toContain('Série');
    expect(
      scoreSummary({
        names: ['Nós', 'Eles'],
        scores: [],
        series: { format: 'single', games: [], gameNumber: 1 },
        handNumber: 0,
        handValue: 0,
        special: 'normal',
        myTeam: 0,
        tricks: [],
      }),
    ).toBe('Placar: Nós 0, Eles 0');
  });
});
