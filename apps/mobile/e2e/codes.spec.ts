/**
 * E2E web da Fase 5: combinado de sinais e chat da dupla na sala de espera, com 4 convidados em 4
 * navegadores contra o servidor real. A dupla é formada pelos assentos 0 e 2 (ordem de entrada).
 * O que o adversário NÃO pode receber é provado nos frames brutos que o servidor mandou à página
 * (`Player.frames`), antes de qualquer filtro do cliente.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createTable, joinTable, readProbe } from './support/table';
import type { Player } from './support/table';

const MEANING = 'tenho o zap E2E';
const CHAT = 'oi parceiro E2E';

/** Segura o botão por mais que os 400 ms exigidos. */
async function hold(page: Page, testId: string, ms = 700): Promise<void> {
  const button = page.getByTestId(testId);
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const sawInFrames = (p: Player, text: string): boolean =>
  p.frames.some((f) => f.includes(Buffer.from(text, 'utf8')));

test.describe('combinado da dupla', () => {
  test('a dupla combina na espera, o parceiro vê o significado no sinal na mesa; o adversário não vê nada', async ({
    players,
  }) => {
    const [a, b, c, d] = players as [Player, Player, Player, Player];
    // a = assento 0 e c = assento 2 (dupla); b = 1 e d = 3 (adversários).
    const code = await createTable(a);
    await joinTable(b, code);
    await joinTable(c, code);
    for (const p of [a, b, c]) await expect(p.page.getByTestId('waiting-room')).toBeVisible();

    // A combina o sinal "Piscar um olho" na sala de espera (a preparação).
    await a.page.getByTestId('open-codes').click();
    await expect(a.page.getByTestId('codes-panel')).toBeVisible();
    await expect(a.page.getByTestId('codes-partner')).toBeVisible();
    await expect(a.page.getByTestId('codes-guest')).toHaveText(
      'Como convidado, seu combinado some ao sair da conta.',
    );
    await expect(a.page.getByTestId('code-count-wink')).toHaveText('0/60');
    await a.page.getByTestId('code-input-wink').fill(MEANING);
    await expect(a.page.getByTestId('code-count-wink')).toHaveText(`${MEANING.length}/60`);
    await a.page.getByTestId('code-save-wink').click();

    // C vê a edição ao vivo no próprio painel.
    await c.page.getByTestId('open-codes').click();
    await expect(c.page.getByTestId('code-input-wink')).toHaveValue(MEANING);

    // O adversário B abre o painel dele: nada combinado e sem parceiro sentado ainda.
    await b.page.getByTestId('open-codes').click();
    await expect(b.page.getByTestId('codes-no-partner')).toBeVisible();
    await expect(b.page.getByTestId('code-input-wink')).toHaveValue('');
    await b.page.getByTestId('codes-close').click();

    // Chat da dupla na espera: A escreve na aba Dupla, C lê; B não tem nada da dupla de A.
    await a.page.getByTestId('codes-close').click();
    await a.page.getByTestId('open-chat').click();
    await a.page.getByTestId('chat-tab-partner').click();
    await a.page.getByTestId('chat-input').fill(CHAT);
    await a.page.getByTestId('chat-send').click();
    await c.page.getByTestId('codes-close').click();
    await c.page.getByTestId('open-chat').click();
    await c.page.getByTestId('chat-tab-partner').click();
    await expect(c.page.getByTestId('chat-list')).toContainText(CHAT);
    await b.page.getByTestId('open-chat').click();
    await b.page.getByTestId('chat-tab-partner').click();
    await expect(b.page.getByTestId('chat-list')).not.toContainText(CHAT);
    await b.page.getByTestId('chat-close').click();
    await a.page.getByTestId('chat-close').click();
    await c.page.getByTestId('chat-close').click();

    // O 4º senta e a partida começa para os quatro.
    await joinTable(d, code);
    for (const p of players) {
      await expect(p.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await expect(p.page.getByTestId('table-state')).toContainText('playing|');
    }
    expect((await readProbe(a.page))?.me).toBe(0);
    expect((await readProbe(c.page))?.me).toBe(2);

    // O painel de sinais de C mostra o combinado; o de B (adversário) não.
    await c.page.getByTestId('signal-toggle').click();
    await expect(c.page.getByTestId('signal-meaning-wink')).toHaveText(MEANING);
    await expect(c.page.getByTestId('signal-wink')).toHaveAttribute(
      'aria-label',
      `Piscar um olho, combinado: ${MEANING}`,
    );
    await c.page.getByTestId('signal-toggle').click();
    await b.page.getByTestId('signal-toggle').click();
    await expect(b.page.locator('[data-testid^="signal-meaning-"]')).toHaveCount(0);
    await b.page.getByTestId('signal-toggle').click();

    // A sinaliza "Piscar um olho": C vê o significado combinado na mesa; B e D só veem o sinal.
    await a.page.getByTestId('signal-toggle').click();
    await hold(a.page, 'signal-wink');
    await expect(c.page.getByTestId('partner-signal-note')).toContainText(
      `Piscar um olho = ${MEANING}`,
    );
    for (const adv of [b, d]) {
      await expect(adv.page.getByTestId('partner-signal-note')).toHaveCount(0);
    }
    // O aviso some sozinho.
    await expect(c.page.getByTestId('partner-signal-note')).toHaveCount(0, { timeout: 10_000 });

    // Os frames do servidor aos adversários nunca trouxeram o significado nem o chat da dupla.
    for (const adv of [b, d]) {
      expect(sawInFrames(adv, MEANING), `significado vazou para o jogador ${adv.index}`).toBe(
        false,
      );
      expect(sawInFrames(adv, CHAT), `chat da dupla vazou para o jogador ${adv.index}`).toBe(false);
    }
    // E a dupla de fato recebeu (controle do detector: o texto aparece nos frames do parceiro).
    expect(sawInFrames(c, MEANING)).toBe(true);
    expect(sawInFrames(c, CHAT)).toBe(true);
  });

  test('o painel de combinar também abre na mesa e salva durante a partida', async ({
    players,
  }) => {
    const [a, b, c, d] = players as [Player, Player, Player, Player];
    const code = await createTable(a);
    for (const p of [b, c, d]) await joinTable(p, code);
    for (const p of players) {
      await expect(p.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
    }
    await a.page.getByTestId('open-codes').click();
    await expect(a.page.getByTestId('codes-panel')).toBeVisible();
    await a.page.getByTestId('code-input-nod').fill('pode pedir truco');
    await a.page.getByTestId('code-save-nod').click();
    await c.page.getByTestId('signal-toggle').click();
    await expect(c.page.getByTestId('signal-meaning-nod')).toHaveText('pode pedir truco');
    for (const adv of [b, d]) {
      expect(sawInFrames(adv, 'pode pedir truco')).toBe(false);
    }
    // O servidor limita a 1 edição por segundo por assento; o teto de 60 caracteres cabe inteiro.
    await a.page.waitForTimeout(1100);
    await a.page.getByTestId('code-input-wink').fill('z'.repeat(60));
    await a.page.getByTestId('code-save-wink').click();
    await expect(c.page.getByTestId('signal-meaning-wink')).toHaveText('z'.repeat(60));
    await a.page.getByTestId('codes-close').click();
    await expect(a.page.getByTestId('codes-panel')).toHaveCount(0);
  });
});
