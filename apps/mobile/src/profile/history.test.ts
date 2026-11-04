import type { MatchSummaryResponse } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { formatDuration, hasStats, statLine, toHistoryRow, REPORT_REASON_OPTIONS } from './history';

const ME = '11111111-1111-4111-8111-111111111111';
const PARTNER = '22222222-2222-4222-8222-222222222222';
const OPP = '33333333-3333-4333-8333-333333333333';

function match(over: Partial<MatchSummaryResponse> = {}): MatchSummaryResponse {
  return {
    id: 'm1',
    variant: 'paulista',
    format: 'single',
    ironHand: true,
    visibility: 'public',
    status: 'finished',
    winnerTeam: 0,
    games: [{ game: 1, winnerTeam: 0, scores: [12, 9] }],
    startedAt: '2026-11-04T12:00:00.000Z',
    endedAt: '2026-11-04T12:14:30.000Z',
    players: [
      { seat: 2, team: 0, userId: PARTNER, nickname: 'Ana', botFrom: null },
      { seat: 0, team: 0, userId: ME, nickname: 'Eu', botFrom: null },
      { seat: 1, team: 1, userId: OPP, nickname: 'Beto', botFrom: null },
      { seat: 3, team: 1, userId: null, nickname: null, botFrom: 4 },
    ],
    ...over,
  };
}

describe('toHistoryRow', () => {
  it('vitória, placar do ponto de vista do usuário, duração e jogadores ordenados por assento', () => {
    const row = toHistoryRow(match(), ME);
    expect(row).toMatchObject({
      title: 'Paulista · Partida única',
      outcome: 'won',
      outcomeLabel: 'Vitória',
      scoreLabel: 'Placar 12 x 9',
      durationLabel: '15 min',
    });
    expect(row.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(row.players.map((p) => p.relation)).toEqual(['self', 'opponent', 'partner', 'opponent']);
  });

  it('derrota quando a equipe do usuário é a 1 e o placar inverte', () => {
    const m = match({ winnerTeam: 0 });
    const row = toHistoryRow(m, OPP);
    expect(row.outcome).toBe('lost');
    expect(row.scoreLabel).toBe('Placar 9 x 12');
  });

  it('melhor de 3 mostra o placar da série', () => {
    const row = toHistoryRow(
      match({
        format: 'bo3',
        variant: 'mineiro',
        games: [
          { game: 1, winnerTeam: 0, scores: [12, 5] },
          { game: 2, winnerTeam: 1, scores: [3, 12] },
          { game: 3, winnerTeam: 0, scores: [12, 11] },
        ],
      }),
      ME,
    );
    expect(row.title).toBe('Mineiro · Melhor de 3');
    expect(row.scoreLabel).toBe('Série 2 x 1');
  });

  it('cancelada não tem placar nem vitória', () => {
    const row = toHistoryRow(match({ status: 'cancelled', winnerTeam: null }), ME);
    expect(row).toMatchObject({ outcome: 'cancelled', scoreLabel: null });
  });

  it('só humanos com conta, que não sejam o usuário, podem ser bloqueados ou denunciados', () => {
    const row = toHistoryRow(match(), ME);
    expect(row.players.map((p) => p.userId)).toEqual([null, OPP, PARTNER, null]);
    expect(row.players[3]?.name).toBe('Bot');
  });

  it('conta apagada aparece como removida e sem ação', () => {
    const row = toHistoryRow(
      match({
        players: [
          { seat: 0, team: 0, userId: ME, nickname: 'Eu', botFrom: null },
          { seat: 1, team: 1, userId: null, nickname: null, botFrom: null },
        ],
      }),
      ME,
    );
    expect(row.players[1]).toMatchObject({ name: 'Jogador removido', userId: null });
  });

  it('games malformado e datas inválidas não quebram', () => {
    const row = toHistoryRow(
      match({ games: [null, 7, { winnerTeam: 'x', scores: 'y' }], endedAt: 'lixo' }),
      ME,
    );
    expect(row.scoreLabel).toBeNull();
    expect(row.dateLabel).toBe('Data indisponível');
    expect(row.durationLabel).toBeNull();
  });
});

describe('formatDuration', () => {
  it('segundos, minutos e horas', () => {
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
    const start = t(0);
    expect(formatDuration(start, t(45))).toBe('45 s');
    expect(formatDuration(start, t(600))).toBe('10 min');
    expect(formatDuration(start, t(3 * 3600 + 5 * 60))).toBe('3 h 5 min');
    expect(formatDuration(t(10), t(0))).toBeNull();
  });
});

describe('estatísticas', () => {
  const zero = { paulista: { played: 0, won: 0 }, mineiro: { played: 0, won: 0 } };
  it('zeros não contam como números reais', () => {
    expect(hasStats(zero)).toBe(false);
    expect(hasStats(null)).toBe(false);
  });
  it('com partidas mostra a linha por variante', () => {
    const s = { ...zero, paulista: { played: 4, won: 3 } };
    expect(hasStats(s)).toBe(true);
    expect(statLine('paulista', s)).toBe('Paulista: 4 partidas, 3 vitórias');
  });
});

describe('motivos de denúncia', () => {
  it('todos os motivos do protocolo têm rótulo em pt-BR', () => {
    expect(REPORT_REASON_OPTIONS).toHaveLength(5);
    for (const o of REPORT_REASON_OPTIONS) expect(o.label).not.toBe(o.value);
  });
});
