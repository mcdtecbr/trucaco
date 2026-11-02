import { test as base, expect } from '@playwright/test';
import { openPlayer } from './support/table';
import type { Player } from './support/table';

/** `players`: 4 convidados em 4 contextos de navegador, todos na tela inicial. */
export const test = base.extend<{ players: Player[] }>({
  players: async ({ browser }, use, testInfo) => {
    const players: Player[] = [];
    try {
      for (let i = 0; i < 4; i++) players.push(await openPlayer(browser, i));
      await use(players);
      // Erro de JavaScript não tratado em qualquer página é falha, mesmo com as asserções verdes.
      for (const p of players) expect(p.pageErrors, `pageerror do jogador ${p.index}`).toEqual([]);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        for (const p of players) {
          await testInfo.attach(`jogador-${p.index}`, {
            body: await p.page.screenshot({ fullPage: true }).catch(() => Buffer.alloc(0)),
            contentType: 'image/png',
          });
        }
      }
      for (const p of players) await p.context.close();
    }
  },
});

export { expect };
