/**
 * E2E web da Fase 4: sinais na mesa e criador de avatar, com 4 convidados em 4 navegadores contra o
 * servidor real. O avatar expõe `data-testid="avatar-<assento>-signal-<id>"` enquanto anima.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { readProbe, startTable } from './support/table';
import type { Player } from './support/table';

/** Segura o botão por mais que os 400 ms exigidos. */
async function hold(page: Page, testId: string, ms = 700): Promise<void> {
  const button = page.getByTestId(testId);
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe('sinais na mesa', () => {
  test('segurar o botão envia o sinal e os 4 navegadores veem o avatar animar; toque rápido não envia', async ({
    players,
  }) => {
    await startTable(players);
    const [sender, ...others] = players as [Player, Player, Player, Player];
    const seat = (await readProbe(sender.page))?.me ?? -1;
    expect(seat).toBeGreaterThanOrEqual(0);
    const marker = (p: Player, id: string) => p.page.getByTestId(`avatar-${seat}-signal-${id}`);

    // Painel fechado por padrão; abre com "Sinais" e lista os 12 sinais com nome.
    await expect(sender.page.getByTestId('signal-grid')).toHaveCount(0);
    await sender.page.getByTestId('signal-toggle').click();
    await expect(sender.page.getByTestId('signal-grid')).toBeVisible();
    await expect(
      sender.page.locator(
        '[role="button"][data-testid^="signal-"]:not([data-testid="signal-toggle"])',
      ),
    ).toHaveCount(12);
    await expect(sender.page.getByTestId('signal-wink')).toHaveText('Piscar um olho');

    // Toque rápido não envia nada.
    await sender.page.getByTestId('signal-nod').click();
    await sender.page.waitForTimeout(900);
    for (const p of players) await expect(marker(p, 'nod')).toHaveCount(0);

    // Segurar envia: o marcador aparece nos 4 (inclusive no emissor) ...
    await hold(sender.page, 'signal-wink');
    await Promise.all(players.map((p) => marker(p, 'wink').waitFor({ state: 'attached' })));
    // ... e some quando a animação termina (volta ao ocioso).
    await Promise.all(players.map((p) => expect(marker(p, 'wink')).toHaveCount(0)));
    // O painel fechou e o botão mostra o cooldown de 3 s.
    await expect(sender.page.getByTestId('signal-grid')).toHaveCount(0);
    await expect(sender.page.getByTestId('signal-toggle')).toContainText('aguarde');
    // Ninguém mais recebeu erro, e quem não sinalizou segue com o painel livre.
    for (const p of others) {
      await expect(p.page.getByTestId('signal-toggle')).not.toContainText('aguarde');
    }
    // Passado o cooldown, o botão volta ao normal.
    await expect(sender.page.getByTestId('signal-toggle')).not.toContainText('aguarde', {
      timeout: 6000,
    });
  });
});

test.describe('criador de avatar', () => {
  test('escolhe partes, salva, o avatar persiste ao recarregar e a mesa segue funcionando', async ({
    players,
  }) => {
    const owner = players[0] as Player;
    await owner.page.getByTestId('open-avatar').click();
    await expect(owner.page.getByTestId('avatar-editor')).toBeVisible();
    await expect(owner.page.getByTestId('avatar-preview')).toBeVisible();
    // Estado inicial: padrão (índice 0) escolhido e "Salvar" desligado (sem mudança).
    await expect(owner.page.getByTestId('avatar-part-hair-0')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(owner.page.getByTestId('avatar-save')).toHaveAttribute('aria-disabled', 'true');

    await owner.page.getByTestId('avatar-part-hair-6').click();
    await owner.page.getByTestId('avatar-part-skin-4').click();
    await owner.page.getByTestId('avatar-part-bg_color-3').click();
    await expect(owner.page.getByTestId('avatar-part-hair-6')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await owner.page.getByTestId('avatar-save').click();
    await expect(owner.page.getByTestId('avatar-saved')).toBeVisible();
    await expect(owner.page.getByTestId('avatar-error')).toHaveCount(0);

    // Recarrega a página (a sessão volta pelo refresh e cai no início): o avatar salvo reaparece.
    await owner.page.reload();
    await expect(owner.page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
    await owner.page.getByTestId('open-avatar').click();
    await expect(owner.page.getByTestId('avatar-editor')).toBeVisible({ timeout: 30_000 });
    await expect(owner.page.getByTestId('avatar-part-hair-6')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(owner.page.getByTestId('avatar-part-skin-4')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(owner.page.getByTestId('avatar-part-bg_color-3')).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Volta ao início e joga: a mesa abre com os 4 avatares (um por assento) e a partida começa.
    await owner.page.getByTestId('avatar-back').click();
    await expect(owner.page.getByTestId('home')).toBeVisible();
    await startTable(players);
    for (const p of players) {
      for (let seat = 0; seat < 4; seat++) {
        await expect(p.page.getByTestId(`avatar-${seat}`)).toBeVisible();
      }
    }
  });

  test('o editor também é acessível pelas configurações', async ({ players }) => {
    const owner = players[0] as Player;
    await owner.page.getByTestId('open-settings').click();
    await owner.page.getByTestId('settings-avatar').click();
    await expect(owner.page.getByTestId('avatar-editor')).toBeVisible();
  });
});
