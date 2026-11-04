/**
 * E2E web da Fase 6 (bloco 6H): conta. Apagar conta pela UI, vínculo do convidado a uma conta social e
 * entrada numa conta existente (`PROVIDER_TAKEN`), contra o servidor real com o verificador de identidade
 * de TESTE (`AUTH_TEST_IDENTITY=1`, token `test:<sub>`).
 *
 * LIMITE: o web não registra nenhum provedor de identidade (`identityRegistry` nasce vazio; Google e Apple
 * entram só na Fase 7), então os botões "Vincular com Google" ficam desabilitados e o clique não é
 * exercitável pela UI. O vínculo e a entrada na conta existente são feitos pela API (Node) e a UI é
 * conferida DEPOIS (tipo de conta, apelido, ausência do cartão de vínculo). O caminho do clique no botão
 * está coberto em `apps/mobile/src/lobby/socialAuth.int.test.ts` (sessão real contra o servidor real).
 */
import type { Browser } from '@playwright/test';
import { expect, test } from './fixtures';
import { playFullMatch, openProfileFromFinished } from './support/match';
import type { Player } from './support/table';
import {
  accountOf,
  call,
  createGuest,
  linkGoogle,
  loginGoogle,
  signInContext,
  uniqueSub,
} from './support/api';
import type { Account } from './support/api';
import { WEB_URL } from './support/env';

/** Abre uma aba já autenticada como `acc` (sessão semeada no `localStorage`). */
async function openAs(browser: Browser, acc: Account, screen: 'profile' | 'settings') {
  const context = await browser.newContext({
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 900 },
  });
  await signInContext(context, acc);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Link direto para /profile cai no início (o app abre sempre pela tela inicial): navega pelos botões.
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(screen === 'profile' ? 'open-profile' : 'open-settings').click();
  return { context, page, pageErrors };
}

async function setNickname(acc: Account, nickname: string): Promise<Account> {
  const r = await call('PUT', '/me', { token: acc.accessToken, body: { nickname } });
  expect(r.status).toBe(200);
  return { ...acc, nickname };
}

test.describe('apagar conta', () => {
  test('cancelar em qualquer passo mantém a conta; confirmar apaga e encerra a sessão no servidor', async ({
    browser,
  }) => {
    const acc = await setNickname(await createGuest(), 'Apagavel');
    const { context, page, pageErrors } = await openAs(browser, acc, 'settings');
    try {
      await expect(page.getByTestId('settings')).toBeVisible({ timeout: 30_000 });

      // Passo 1: aviso. Cancelar volta ao começo.
      await page.getByTestId('delete-start').click();
      await expect(page.getByTestId('delete-warning')).toBeVisible();
      await page.getByTestId('delete-cancel').click();
      await expect(page.getByTestId('delete-start')).toBeVisible();

      // Passo 2: confirmação final. Cancelar de novo.
      await page.getByTestId('delete-start').click();
      await page.getByTestId('delete-continue').click();
      await expect(page.getByTestId('delete-final')).toBeVisible();
      await page.getByTestId('delete-cancel').click();
      await expect(page.getByTestId('delete-start')).toBeVisible();
      expect((await call('GET', '/me', { token: acc.accessToken })).status).toBe(200);

      // Confirma de verdade.
      await page.getByTestId('delete-start').click();
      await page.getByTestId('delete-continue').click();
      await page.getByTestId('delete-confirm').click();
      await expect(page.getByTestId('settings')).toHaveCount(0);
      // Nenhuma sessão da conta apagada sobra no aparelho: só pode haver um convidado NOVO (ou nada).
      await expect
        .poll(async () =>
          page.evaluate(() => window.localStorage.getItem('trucaco.session.v1') ?? ''),
        )
        .not.toContain(acc.id);
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);

    // No servidor: o refresh antigo não vale mais e a conta não existe mais para o próprio access antigo.
    const refresh = await call('POST', '/auth/refresh', {
      body: { refreshToken: acc.refreshToken },
    });
    expect(refresh.status).toBe(401);
    expect([401, 404]).toContain((await call('GET', '/me', { token: acc.accessToken })).status);
    // O id público apagado e um id que nunca existiu respondem igual (sem oráculo de enumeração).
    const viewer = await createGuest();
    const gone = await call('GET', `/users/${acc.id}`, { token: viewer.accessToken });
    const never = await call('GET', '/users/00000000-0000-4000-8000-000000000000', {
      token: viewer.accessToken,
    });
    expect(gone.status).toBe(never.status);
    expect(gone.json).toEqual(never.json);
  });

  test('depois de apagar a conta, o outro jogador vê "Jogador removido" no histórico e não pode mais bloqueá-lo', async ({
    players,
  }) => {
    test.setTimeout(240_000);
    await playFullMatch(players);
    const [a, , , d] = players as [Player, Player, Player, Player];

    // d apaga a própria conta, pela UI.
    await d.page.getByTestId('leave-table').click();
    await expect(d.page.getByTestId('home')).toBeVisible();
    await d.page.getByTestId('open-settings').click();
    await d.page.getByTestId('delete-start').click();
    await d.page.getByTestId('delete-continue').click();
    await d.page.getByTestId('delete-confirm').click();
    await expect(d.page.getByTestId('settings')).toHaveCount(0);

    // a vê o histórico com o jogador anonimizado; só 2 podem ser bloqueados/denunciados.
    await openProfileFromFinished(a);
    await expect(a.page.getByText('Jogador removido', { exact: false }).first()).toBeVisible();
    await expect(a.page.locator('[data-testid^="block-"]')).toHaveCount(2);
    await expect(a.page.locator('[data-testid^="report-"]')).toHaveCount(2);
  });
});

test.describe('vincular conta e entrar na conta existente', () => {
  test('convidado vê o cartão de vincular; sem SDK no web os botões ficam indisponíveis', async ({
    browser,
  }) => {
    const acc = await setNickname(await createGuest(), 'Convidado');
    const { context, page, pageErrors } = await openAs(browser, acc, 'profile');
    try {
      await expect(page.getByTestId('profile')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('profile-provider')).toHaveText('Convidado');
      await expect(page.getByTestId('social-link-intro')).toBeVisible();
      for (const id of ['google', 'apple']) {
        const b = page.getByTestId(`social-link-${id}`);
        await expect(b).toBeDisabled();
        await expect(b).toContainText('indisponível');
      }
      await expect(page.getByTestId('social-login-existing')).toHaveCount(0);
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });

  test('vínculo mantém o mesmo usuário e o apelido; a sessão antiga é revogada e o perfil passa a Conta Google', async ({
    browser,
  }) => {
    const guest = await setNickname(await createGuest(), 'Vinculada');
    const sub = uniqueSub('link');
    const linked = await linkGoogle(guest.accessToken, sub);
    expect(linked.status).toBe(200);
    const acc = accountOf(linked);
    // O vínculo não cria outro usuário: o id (e então o histórico, o avatar e o combinado) é o mesmo.
    expect(acc.id).toBe(guest.id);
    expect(acc.nickname).toBe('Vinculada');
    // A família de refresh antiga foi revogada.
    expect(
      (await call('POST', '/auth/refresh', { body: { refreshToken: guest.refreshToken } })).status,
    ).toBe(401);
    // Vincular de novo a conta que já é social: ALREADY_LINKED.
    const again = await linkGoogle(acc.accessToken, uniqueSub('outra'));
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: { code: 'ALREADY_LINKED' } });

    const { context, page, pageErrors } = await openAs(browser, acc, 'profile');
    try {
      await expect(page.getByTestId('profile')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('profile-provider')).toHaveText('Conta Google');
      await expect(page.getByTestId('profile').getByText('Vinculada')).toBeVisible();
      await expect(page.getByTestId('social-link-intro')).toHaveCount(0);
      await page.getByTestId('profile-back').click();
      await page.getByTestId('open-settings').click();
      await expect(page.getByTestId('session-note')).toContainText('Você entrou com Conta Google');
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });

  test('PROVIDER_TAKEN: vincular a uma conta que já existe falha e o convidado segue convidado; entrar nela traz a conta original', async ({
    browser,
  }) => {
    const sub = uniqueSub('taken');
    // A conta social já existe (com apelido próprio).
    const created = await loginGoogle(sub, 'a');
    expect(created.status).toBe(201);
    const original = await setNickname(accountOf(created), 'Original');

    const guest = await setNickname(await createGuest(), 'Intruso');
    const blocked = await linkGoogle(guest.accessToken, sub, 'b');
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ error: { code: 'PROVIDER_TAKEN' } });
    // O convidado não mudou: continua convidado, com o mesmo id.
    const stillGuest = await call('GET', '/me', { token: guest.accessToken });
    expect(stillGuest.status).toBe(200);
    expect(stillGuest.json).toMatchObject({ id: guest.id, provider: 'guest' });

    // "Entrar na conta existente": login social com o mesmo sub devolve a conta ORIGINAL (200, não criada).
    const entered = await loginGoogle(sub, 'c');
    expect(entered.status).toBe(200);
    expect(entered.json).toMatchObject({ created: false });
    const acc = accountOf(entered);
    expect(acc.id).toBe(original.id);

    const { context, page, pageErrors } = await openAs(browser, acc, 'profile');
    try {
      await expect(page.getByTestId('profile')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('profile-provider')).toHaveText('Conta Google');
      await expect(page.getByTestId('profile').getByText('Original')).toBeVisible();
      await expect(page.getByTestId('profile').getByText('Intruso')).toHaveCount(0);
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });

  test('o idToken é de uso único: reapresentar o mesmo token é recusado com INVALID_ID_TOKEN', async () => {
    const sub = uniqueSub('once');
    expect((await loginGoogle(sub, 'x')).status).toBe(201);
    const replay = await loginGoogle(sub, 'x');
    expect(replay.status).toBe(401);
    expect(replay.json).toMatchObject({ error: { code: 'INVALID_ID_TOKEN' } });
    // Token com formato inválido também.
    const bad = await call('POST', '/auth/google', {
      body: { provider: 'google', idToken: 'nao-e-um-token' },
    });
    expect(bad.status).toBe(401);
    expect(bad.json).toMatchObject({ error: { code: 'INVALID_ID_TOKEN' } });
  });
});
