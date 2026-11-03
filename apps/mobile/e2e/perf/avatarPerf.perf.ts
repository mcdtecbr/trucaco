/**
 * Medição de desempenho (bloco 4I): 4 avatares animando ao mesmo tempo na mesa web. FORA da suíte e do
 * CI (`testMatch` do playwright.config.ts só pega `*.spec.ts`; este arquivo termina em `.perf.ts`).
 * Rode: `pnpm --filter @trucaco/mobile exec playwright test -c e2e/perf/playwright.perf.config.ts`
 * (precisa de `pnpm build` antes; `E2E_SKIP_BUILD=1` reaproveita `dist-e2e/`). Variável `PERF_SECONDS` (padrão 10).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { startTable } from '../support/table';
import type { Player } from '../support/table';

/** PERF_PASSIVE=1: o observador (jogador 0) não sinaliza nem abre o painel; só os outros 3 animam. */
const PASSIVE = process.env['PERF_PASSIVE'] === '1';
/** PERF_REDUCED=1: controle; o observador usa prefers-reduced-motion (avatares sem animação contínua). */
const REDUCED = process.env['PERF_REDUCED'] === '1';
const SECONDS = Number(process.env['PERF_SECONDS'] ?? '10');
const SIGNALS = [
  'wink',
  'eyebrow',
  'lip_bite',
  'cheek_puff',
  'tongue',
  'nose_twitch',
  'shrug',
  'nod',
  'head_shake',
  'chin_up',
  'look_away',
  'smile',
];

async function startRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__frames = [];
    w.__rec = true;
    let last = performance.now();
    const tick = (t: number): void => {
      if (!w.__rec) return;
      w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopRecorder(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __rec: boolean };
    w.__rec = false;
    return w.__frames.slice(1);
  });
}

async function metrics(
  cdp: import('@playwright/test').CDPSession,
): Promise<Record<string, number>> {
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

function share(a: Record<string, number>, b: Record<string, number>): string {
  const d = (k: string): number => ((b[k] ?? 0) - (a[k] ?? 0)) * 1000;
  return `CPU(ms) task=${d('TaskDuration').toFixed(0)} script=${d('ScriptDuration').toFixed(0)} layout=${d('LayoutDuration').toFixed(0)} recalcStyle=${d('RecalcStyleDuration').toFixed(0)}`;
}

function stats(d: number[]): string {
  const total = d.reduce((a, b) => a + b, 0);
  const sorted = [...d].sort((a, b) => a - b);
  const p = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const over33 = d.filter((x) => x > 33.4).length;
  return `FPS medio=${((d.length / total) * 1000).toFixed(1)} frames=${d.length} p50=${p(0.5).toFixed(1)}ms p95=${p(0.95).toFixed(1)}ms p99=${p(0.99).toFixed(1)}ms max=${sorted.at(-1)?.toFixed(1)}ms >33ms=${over33} (${((over33 / d.length) * 100).toFixed(1)}%)`;
}

async function sendSignal(p: Player, id: string): Promise<void> {
  const toggle = p.page.getByTestId('signal-toggle');
  await expect(toggle).not.toContainText('aguarde', { timeout: 10_000 });
  if ((await p.page.getByTestId('signal-grid').count()) === 0) await toggle.click();
  const b = p.page.getByTestId(`signal-${id}`);
  await b.hover();
  await p.page.mouse.down();
  await p.page.waitForTimeout(650);
  await p.page.mouse.up();
}

test('desempenho: 4 avatares sinalizando juntos', async ({ players }) => {
  test.setTimeout(240_000);
  await startTable(players);
  const observer = players[0] as Player;
  const cdp = await observer.context.newCDPSession(observer.page);

  if (REDUCED) await observer.page.emulateMedia({ reducedMotion: 'reduce' });
  await cdp.send('Performance.enable');
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    // Ocioso (respiração/olhar) com 4 avatares na mesa.
    await observer.page.waitForTimeout(1000);
    const m0 = await metrics(cdp);
    await startRecorder(observer.page);
    await observer.page.waitForTimeout(SECONDS * 1000);
    console.log(
      `[perf] cpu=${rate}x OCIOSO   ${stats(await stopRecorder(observer.page))} ${share(m0, await metrics(cdp))}`,
    );

    // Sinais nos 4 ao mesmo tempo, em rajadas a cada ~3,3 s (cooldown do servidor: 3 s).
    const m1 = await metrics(cdp);
    await startRecorder(observer.page);
    const end = Date.now() + SECONDS * 1000;
    let n = 0;
    while (Date.now() < end) {
      const id = SIGNALS[n++ % SIGNALS.length] as string;
      const t0 = Date.now();
      await Promise.all(
        players.filter((p) => !PASSIVE || p !== observer).map((p) => sendSignal(p, id)),
      );
      await observer.page.waitForTimeout(Math.max(0, 3300 - (Date.now() - t0)));
    }
    console.log(
      `[perf] cpu=${rate}x SINAIS x4 (${n} rajadas) ${stats(await stopRecorder(observer.page))} ${share(m1, await metrics(cdp))}`,
    );
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
