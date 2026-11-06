/**
 * E2E web: bots de vaga. Um humano cria a mesa privada e joga contra bots, pelo atalho "Jogar contra bots"
 * ou preenchendo as vagas pela sala de espera. O servidor é o real (`apps/server/dist/main.js`).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drive, joinTable, openPlayer, readProbe, roomCodeOf } from './support/table';
import type { Player } from './support/table';

async function withPlayers(
  browser: Parameters<typeof openPlayer>[0],
  count: number,
  run: (players: Player[]) => Promise<void>,
): Promise<void> {
  const players: Player[] = [];
  try {
    for (let i = 0; i < count; i++) players.push(await openPlayer(browser, i));
    await run(players);
    for (const p of players) expect(p.pageErrors, `pageerror do jogador ${p.index}`).toEqual([]);
  } finally {
    for (const p of players) await p.context.close();
  }
}

/**
 * O servidor limita ações do mesmo assento a uma a cada 150 ms (`RATE_LIMITED`, a ação se perde): repete o
 * toque até o estado refletir, como um jogador faria.
 */
async function clickUntil(page: Page, clickId: string, resultId: string): Promise<void> {
  await expect(async () => {
    const button = page.getByTestId(clickId);
    if ((await button.count()) > 0) await button.click();
    await expect(page.getByTestId(resultId)).toBeVisible({ timeout: 800 });
  }).toPass({ timeout: 15_000 });
}

/** Sentado numa partida com 3 bots: 3 cartas na mão e uma jogada confirmada pelo estado. */
async function playOneCard(me: Player): Promise<void> {
  await expect(me.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  await expect(me.page.getByTestId('table-state')).toContainText('playing|');
  await expect(me.page.getByTestId('my-hand').getByRole('button')).toHaveCount(3);
  expect((await readProbe(me.page))?.match).toBe(1);
  // Exatamente 3 assentos de bot (sonda: contagem de `isBot` do estado do servidor).
  await expect(me.page.getByTestId('table-state')).toContainText('|bots=3');
  await drive(me, { strategy: 'cards', maxMs: 90_000, maxActs: 1 });
}

test.describe('mesa contra bots', () => {
  test('"Jogar contra bots" cria a mesa privada, preenche as vagas e a partida começa', async ({
    browser,
  }) => {
    await withPlayers(browser, 1, async ([me]) => {
      if (me === undefined) throw new Error('sem jogador');
      await me.page.getByTestId('play-vs-bots').click();
      await playOneCard(me);
    });
  });

  test('o host põe e tira bots na sala de espera e inicia com bots nas vagas', async ({
    browser,
  }) => {
    await withPlayers(browser, 2, async ([host, guest]) => {
      if (host === undefined || guest === undefined) throw new Error('faltam jogadores');
      await host.page.getByTestId('create-submit').click();
      await expect(host.page.getByTestId('waiting-room')).toBeVisible();
      const code = await roomCodeOf(host.page);

      // Sozinho: 3 vagas com "Adicionar bot", nenhum "Remover", iniciar habilitado.
      for (const seat of [1, 2, 3]) {
        await expect(host.page.getByTestId(`bot-add-${seat}`)).toBeVisible();
      }
      await expect(host.page.getByTestId('bot-add-0')).toHaveCount(0);
      await expect(host.page.getByTestId('fill-bots')).toBeEnabled();
      await expect(host.page.getByTestId('bots-notice')).toHaveCount(0);

      await host.page.getByTestId('bot-add-1').click();
      await expect(host.page.getByTestId('bot-remove-1')).toBeVisible();
      await expect(host.page.getByTestId('seat-1')).toContainText('Bot');
      await expect(host.page.getByTestId('bots-notice')).toContainText(
        'Partidas com bots não contam para conquistas nem ranking',
      );
      await clickUntil(host.page, 'bot-remove-1', 'bot-add-1');
      await expect(host.page.getByTestId('bots-notice')).toHaveCount(0);

      // Um convidado entra: não é host, não vê controle algum de bot.
      await clickUntil(host.page, 'bot-add-2', 'bot-remove-2');
      await joinTable(guest, code);
      await expect(guest.page.getByTestId('waiting-room')).toBeVisible();
      await expect(guest.page.getByTestId('seated-count')).toContainText('3');
      await expect(guest.page.getByTestId('bots-notice')).toBeVisible();
      await expect(guest.page.getByTestId('fill-bots')).toHaveCount(0);
      await expect(guest.page.locator('[data-testid^="bot-add-"]')).toHaveCount(0);
      await expect(guest.page.locator('[data-testid^="bot-remove-"]')).toHaveCount(0);

      // O host preenche a última vaga e a partida começa para os dois humanos.
      await host.page.getByTestId('fill-bots').click();
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
        await expect(p.page.getByTestId('table-state')).toContainText('playing|');
      }
      await expect(host.page.getByTestId('my-hand').getByRole('button')).toHaveCount(3);
    });
  });
});
