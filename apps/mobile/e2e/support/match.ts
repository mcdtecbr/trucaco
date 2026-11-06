/**
 * Partida completa pela UI real para os testes da Fase 6: 4 convidados, todos apostam e aceitam até 12
 * pontos (com `TRUCO_SEED` fixo a primeira mão decide a partida `single`). Ao fim, cada jogador está na
 * tela de resultado e o servidor já gravou (ou está gravando) a partida e a progressão.
 */
import { expect } from '@playwright/test';
import { drive, startTable } from './table';
import type { Player } from './table';

export interface MatchResult {
  readonly code: string;
  readonly winners: Player[];
  readonly losers: Player[];
}

export async function playFullMatch(players: readonly Player[]): Promise<MatchResult> {
  const code = await startTable(players);
  await Promise.all(
    players.map((p) =>
      drive(p, {
        strategy: 'escalate',
        maxMs: 150_000,
        stop: () => p.page.getByTestId('table-finished').isVisible(),
      }),
    ),
  );
  const winners: Player[] = [];
  const losers: Player[] = [];
  for (const p of players) {
    await expect(p.page.getByTestId('table-finished')).toBeVisible();
    if ((await p.page.getByTestId('finished-won').count()) > 0) winners.push(p);
    else losers.push(p);
  }
  expect(winners).toHaveLength(2);
  expect(losers).toHaveLength(2);
  return { code, winners, losers };
}

/** Sai da tela de resultado para o início e abre o perfil. */
export async function openProfileFromFinished(p: Player): Promise<void> {
  await p.page.getByTestId('leave-table').click();
  await expect(p.page.getByTestId('home')).toBeVisible();
  await p.page.getByTestId('open-profile').click();
  await expect(p.page.getByTestId('profile')).toBeVisible();
}
