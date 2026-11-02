import { describe, expect, it, vi } from 'vitest';
import { projectTable } from './projectTable';
import { snapshot } from './snapshotFixtures';
import { connectionBanner, finishedSummary, holdRoom, roomViewFor } from './tableRoute';

describe('roomViewFor', () => {
  it('uma visão por fase; desconhecido ou vazio = espera', () => {
    expect(roomViewFor('waiting')).toBe('waiting');
    expect(roomViewFor('playing')).toBe('playing');
    expect(roomViewFor('finished')).toBe('finished');
    expect(roomViewFor('')).toBe('waiting');
    expect(roomViewFor('outra')).toBe('waiting');
  });
});

describe('ciclo de vida da tela dona da sala', () => {
  it('trocar de fase (waiting -> playing -> finished) NÃO larga a sala; só o cleanup larga', () => {
    const rooms = { leave: vi.fn(() => Promise.resolve()) };
    const cleanup = holdRoom(rooms); // montagem da tela (efeito com deps [])
    for (const phase of ['waiting', 'playing', 'finished']) {
      expect(roomViewFor(phase)).toBe(phase);
      expect(rooms.leave).not.toHaveBeenCalled();
    }
    cleanup(); // saiu da rota de verdade
    expect(rooms.leave).toHaveBeenCalledTimes(1);
  });
});

describe('connectionBanner', () => {
  it('cai -> reconectando; encerrou -> closed; voltou -> aviso; normal -> nada', () => {
    expect(connectionBanner('reconnecting', null)).toBe('reconnecting');
    expect(connectionBanner('reconnecting', 'reconnected')).toBe('reconnecting');
    expect(connectionBanner('closed', null)).toBe('closed');
    expect(connectionBanner('connected', 'reconnected')).toBe('reconnected');
    expect(connectionBanner('connected', null)).toBeNull();
    expect(connectionBanner('joining', null)).toBeNull();
  });
});

describe('finishedSummary', () => {
  it('placar do jogo e da série na perspectiva do jogador', () => {
    expect(finishedSummary(null)).toBeNull();
    const single = projectTable(snapshot({ phase: 'finished', game: { scores: [12, 7] } }));
    expect(finishedSummary(single)).toBe('Nós 12 × 7 Eles');
    const bo3 = projectTable(
      snapshot({
        phase: 'finished',
        game: { scores: [12, 7] },
        series: { format: 'bo3', games: [2, 1] },
        privates: {
          '1': { seat: 1, hand: [], legalActions: [], partnerCards: [], ownCovered: [] },
        },
      }),
    );
    expect(finishedSummary(bo3)).toBe('Série: Nós 1 × 2 Eles. Último jogo: Nós 7 × 12 Eles');
  });
});
