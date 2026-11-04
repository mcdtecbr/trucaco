/**
 * E2E web da Fase 6 (bloco 6H): uma partida completa de 4 convidados e o que ela deixa para trás, pela UI
 * e contra o servidor real: histórico, estatísticas, conquista, missões, bloqueio e denúncia a partir do
 * histórico. Cada teste joga a SUA partida (sem dependência de ordem).
 */
import { expect, test } from './fixtures';
import { openProfileFromFinished, playFullMatch } from './support/match';
import type { Player } from './support/table';

test.describe('progressão e moderação depois de uma partida', () => {
  test('histórico lista a partida com resultado, placar e os outros três jogadores; estatísticas contam 1 partida', async ({
    players,
  }) => {
    test.setTimeout(240_000);
    const { winners } = await playFullMatch(players);

    for (const p of players) {
      await openProfileFromFinished(p);
      const row = p.page.getByTestId(/^history-[0-9a-f-]{36}$/);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Paulista · Partida única');
      const won = winners.includes(p);
      await expect(row).toContainText(won ? 'Vitória' : 'Derrota');
      await expect(row).toContainText(/Placar \d+ x \d+/);
      // Os três outros jogadores, com a relação deles com o dono do histórico, e uma ação de cada tipo.
      await expect(p.page.getByText(/· Parceiro$/)).toHaveCount(1);
      await expect(p.page.getByText(/· Adversário$/)).toHaveCount(2);
      await expect(p.page.locator('[data-testid^="block-"]')).toHaveCount(3);
      await expect(p.page.locator('[data-testid^="report-"]')).toHaveCount(3);
      await expect(p.page.getByTestId('profile-provider')).toHaveText('Convidado');
      // Estatística do Paulista: 1 partida, 1 vitória só para quem venceu.
      await expect(p.page.getByTestId('profile-stats')).toContainText(
        `Paulista: 1 partidas, ${won ? 1 : 0} vitórias`,
      );
    }
  });

  test('quem vence recebe o aviso e a medalha da primeira vitória; quem perde não; missões avançam', async ({
    players,
  }) => {
    test.setTimeout(240_000);
    const { winners, losers } = await playFullMatch(players);

    // O servidor grava a progressão depois de salvar a partida; o cliente relê por até ~13 s.
    for (const w of winners) {
      await expect(w.page.getByTestId('finished-achievements')).toBeVisible({ timeout: 25_000 });
      await expect(w.page.getByTestId('gain-primeira_vitoria')).toContainText('Estreia vitoriosa');
    }
    for (const l of losers) {
      await expect(l.page.getByTestId('finished-achievements')).toHaveCount(0);
    }

    // Tela de conquistas pelo perfil.
    const checkAchievements = async (p: Player, unlocked: boolean): Promise<void> => {
      await openProfileFromFinished(p);
      await p.page.getByTestId('profile-achievements').click();
      await expect(p.page.getByTestId('achievements')).toBeVisible();
      const card = p.page.getByTestId('achievement-primeira_vitoria');
      await expect(card).toBeVisible();
      if (unlocked) await expect(card).not.toHaveAttribute('aria-label', /Bloqueada/);
      else await expect(card).toHaveAttribute('aria-label', /Bloqueada/);
    };
    await checkAchievements(winners[0] as Player, true);
    await checkAchievements(losers[0] as Player, false);

    // Missões: a semanal "vencer 5" avança 1 só para o time vencedor. As diárias são sorteadas por
    // jogador, então só se exige que existam.
    for (const [p, progress] of [
      [winners[1] as Player, '1 de 5'],
      [losers[1] as Player, '0 de 5'],
    ] as const) {
      await openProfileFromFinished(p);
      await p.page.getByTestId('profile-missions').click();
      await expect(p.page.getByTestId('missions')).toBeVisible();
      await expect(p.page.locator('[data-testid^="mission-"]').first()).toBeVisible();
      await expect(p.page.getByTestId(/^mission-vencer_5_semana:/)).toContainText(progress);
    }
  });

  test('bloquear um jogador pelo histórico: aparece em Configurações e some ao desbloquear', async ({
    players,
  }) => {
    test.setTimeout(240_000);
    await playFullMatch(players);
    const me = players[0] as Player;
    await openProfileFromFinished(me);

    await me.page.locator('[data-testid^="block-"]').first().click();
    await expect(me.page.getByTestId('moderation-confirm')).toBeVisible();
    // Cancelar não bloqueia nada.
    await me.page.getByTestId('moderation-cancel').click();
    await expect(me.page.getByTestId('moderation-confirm')).toHaveCount(0);

    const blockBtn = me.page.locator('[data-testid^="block-"]').first();
    const label = (await blockBtn.innerText()).replace(/^Bloquear\s+/, '');
    await blockBtn.click();
    await me.page.getByTestId('moderation-confirm').click();
    await expect(me.page.getByTestId('moderation-done')).toBeVisible();
    await me.page.getByTestId('moderation-close').click();

    await me.page.getByTestId('profile-back').click();
    await me.page.getByTestId('open-settings').click();
    await expect(me.page.getByTestId('settings')).toBeVisible();
    const unblock = me.page.locator('[data-testid^="unblock-"]');
    await expect(unblock).toHaveCount(1);
    await expect(unblock).toContainText(`Desbloquear ${label}`);
    await expect(me.page.getByTestId('blocks-empty')).toHaveCount(0);

    // O bloqueio está no servidor: sobrevive ao reload.
    // (o app reabre sempre pela tela inicial depois do reload.)
    await me.page.reload();
    await expect(me.page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
    await me.page.getByTestId('open-settings').click();
    await expect(me.page.getByTestId('settings')).toBeVisible();
    await expect(me.page.locator('[data-testid^="unblock-"]')).toHaveCount(1);

    await me.page.locator('[data-testid^="unblock-"]').click();
    await expect(me.page.getByTestId('blocks-empty')).toBeVisible();
    await expect(me.page.locator('[data-testid^="unblock-"]')).toHaveCount(0);
  });

  test('denunciar um jogador pelo histórico exige motivo e confirma o envio', async ({
    players,
  }) => {
    test.setTimeout(240_000);
    await playFullMatch(players);
    const me = players[1] as Player;
    await openProfileFromFinished(me);

    await me.page.locator('[data-testid^="report-"]').first().click();
    // Sem motivo o envio fica desabilitado.
    await expect(me.page.getByTestId('moderation-confirm')).toBeDisabled();
    await me.page.getByTestId('report-reason-abusive_chat').click();
    await me.page.getByTestId('report-text').fill('mensagens ofensivas no E2E');
    await expect(me.page.getByTestId('moderation-confirm')).toBeEnabled();
    await me.page.getByTestId('moderation-confirm').click();
    await expect(me.page.getByTestId('moderation-done')).toBeVisible();
    await me.page.getByTestId('moderation-close').click();
    await expect(me.page.getByTestId('moderation-done')).toHaveCount(0);
    // Denunciar não bloqueia.
    await me.page.getByTestId('profile-back').click();
    await me.page.getByTestId('open-settings').click();
    await expect(me.page.getByTestId('blocks-empty')).toBeVisible();
  });

  test('perfil público de um adversário mostra as estatísticas e nunca o histórico dele', async ({
    players,
  }) => {
    test.setTimeout(240_000);
    await playFullMatch(players);
    const me = players[2] as Player;
    await openProfileFromFinished(me);
    await me.page.locator('[data-testid^="view-"]').first().click();
    await expect(me.page.getByTestId('public-profile')).toBeVisible();
    await expect(me.page.getByTestId('public-profile-stats')).toBeVisible();
    // (o histórico do próprio usuário segue montado por baixo; só a tela do perfil público conta.)
    const pub = me.page.getByTestId('public-profile');
    await expect(pub.locator('[data-testid^="history-"]')).toHaveCount(0);
    await expect(pub).not.toContainText('Histórico de partidas');
    await expect(me.page.getByTestId('public-profile-error')).toHaveCount(0);
    await me.page.getByTestId('public-profile-back').click();
    await expect(me.page.getByTestId('profile')).toBeVisible();
  });
});
