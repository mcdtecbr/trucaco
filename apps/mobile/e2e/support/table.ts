/**
 * Ajudantes de E2E para uma mesa de 4 navegadores. Seletores por `data-testid` e papel (role); espera
 * sempre por estado (a sonda `table-state`, que só existe com `EXPO_PUBLIC_E2E=1`), nunca por tempo fixo.
 */
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import { SERVER_PORT, WEB_URL } from './env';

export interface Player {
  readonly index: number;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Sockets do jogo vistos por esta página (o último é o ativo). */
  readonly sockets: { page: WebSocketRoute; server: WebSocketRoute }[];
  /** Todos os frames que o SERVIDOR mandou a esta página (todos os sockets), exatamente como saíram dele. */
  readonly frames: Buffer[];
  /** Erros de JavaScript não tratados na página (devem ficar vazios). */
  readonly pageErrors: string[];
}

export interface Probe {
  readonly phase: string;
  /** `actingSeat` do servidor. */
  readonly turn: number;
  readonly hand: number;
  readonly act: boolean;
  readonly plays: number;
  readonly match: number;
  /** Assento do próprio jogador. */
  readonly me: number;
  readonly raw: string;
}

/** Abre um convidado novo (contexto isolado = storage próprio) e espera a tela inicial. */
export async function openPlayer(browser: Browser, index: number): Promise<Player> {
  const context = await browser.newContext({
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const sockets: Player['sockets'] = [];
  const frames: Buffer[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Faz de proxy do tráfego do jogo: guarda os sockets (para derrubar um) e cada frame que o servidor
  // manda à página (para provar o que NÃO chega ao navegador, antes de qualquer filtro do cliente).
  await page.routeWebSocket(
    (url) => url.port === String(SERVER_PORT),
    (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        frames.push(typeof message === 'string' ? Buffer.from(message, 'utf8') : message);
        ws.send(message); // ao registrar o handler, o repasse automático deste sentido deixa de existir
      });
      sockets.push({ page: ws, server });
    },
  );
  await page.goto('/');
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
  return { index, context, page, sockets, frames, pageErrors };
}

/** Código de 8 caracteres exibido na sala de espera (sem o hífen de exibição). */
export async function roomCodeOf(page: Page): Promise<string> {
  const shown = await page.getByTestId('room-code').innerText();
  return shown.replace(/[^A-Z2-9]/g, '');
}

export async function createTable(owner: Player): Promise<string> {
  await owner.page.getByTestId('create-submit').click();
  await expect(owner.page.getByTestId('waiting-room')).toBeVisible();
  await expect(owner.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  return roomCodeOf(owner.page);
}

export async function joinTable(p: Player, code: string): Promise<void> {
  await p.page.getByTestId('join-code').fill(code);
  await p.page.getByTestId('join-submit').click();
  // O quarto a entrar já cai direto na mesa (a partida começa ao fechar os 4 lugares).
  await expect(p.page.getByTestId('waiting-room').or(p.page.getByTestId('table'))).toBeVisible();
}

/** Dono cria, os outros três entram pelo código e a partida começa para os quatro. */
export async function startTable(players: readonly Player[]): Promise<string> {
  const [owner, ...others] = players;
  if (owner === undefined || others.length !== 3) throw new Error('startTable exige 4 jogadores');
  const code = await createTable(owner);
  for (const p of others) await joinTable(p, code);
  for (const p of players) {
    await expect(p.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
    await expect(p.page.getByTestId('table-state')).toContainText('playing|');
  }
  return code;
}

export async function readProbe(page: Page): Promise<Probe | null> {
  const raw = await page.evaluate(
    () => document.querySelector('[data-testid="table-state"]')?.textContent ?? null,
  );
  return raw === null ? null : parseProbe(raw);
}

/**
 * Sonda e mão lidas no MESMO `evaluate` (uma tarefa de JS, sem renderização no meio): evita a corrida
 * de ler a sonda da mão 1 e as cartas já da mão 2.
 */
export async function readProbeAndHand(
  page: Page,
): Promise<{ probe: Probe | null; hand: string[] }> {
  const snap = await page.evaluate(() => ({
    raw: document.querySelector('[data-testid="table-state"]')?.textContent ?? null,
    hand: Array.from(
      document.querySelectorAll('[data-testid="my-hand"] [role="button"]'),
      (el) => el.getAttribute('aria-label') ?? '',
    ),
  }));
  return { probe: snap.raw === null ? null : parseProbe(snap.raw), hand: snap.hand };
}

function parseProbe(raw: string): Probe {
  const f = raw.split('|');
  const kv = (name: string): string => {
    const hit = f.find((x) => x.startsWith(`${name}=`));
    return hit === undefined ? '' : hit.slice(name.length + 1);
  };
  return {
    phase: f[0] ?? '',
    turn: Number(kv('turn')),
    hand: Number(kv('hand')),
    act: kv('act') === 'true',
    plays: Number(kv('plays')),
    match: Number(kv('match')),
    me: Number(kv('me')),
    raw,
  };
}

/** Rótulos (acessibilidade) das cartas da mão do jogador. */
export async function handLabels(page: Page): Promise<string[]> {
  const cards = page.getByTestId('my-hand').getByRole('button');
  const n = await cards.count();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await cards.nth(i).getAttribute('aria-label')) ?? '');
  return out;
}

export type Strategy = 'cards' | 'escalate';

/**
 * Uma ação pela UI real: nunca "chuta" o que o servidor não ofereceu (os botões só existem para
 * `legalActions`). `escalate`: aposta/aumenta sempre que pode, senão aceita, senão joga carta.
 * Devolve `false` se nada acionável estava na tela (estado já mudou).
 */
async function performAction(page: Page, strategy: Strategy): Promise<boolean> {
  const bar = page.getByRole('toolbar', { name: 'Ações da mão' });
  if (strategy === 'escalate') {
    const bet = bar.getByRole('button').filter({ hasNotText: /^(Aceitar|Correr|Jogar a mão)/ });
    if ((await bet.count()) > 0) {
      await bet.first().click();
      return true;
    }
  }
  const accept = bar.getByRole('button', { name: /^Aceitar/ });
  if ((await accept.count()) > 0) {
    await accept.first().click();
    return true;
  }
  const special = bar.getByRole('button', { name: 'Jogar a mão' });
  if ((await special.count()) > 0) {
    await special.click();
    return true;
  }
  const cards = page.getByTestId('my-hand').locator('[role="button"]:not([aria-disabled="true"])');
  if ((await cards.count()) === 0) return false;
  await cards.first().click();
  await page.getByTestId('confirm-play').click();
  return true;
}

/** O aviso de "Muitas tentativas" (`RATE_LIMITED`, pt-BR) é o único erro de mesa que o driver repete. */
const RATE_LIMITED_TEXT = /Muitas tentativas/;
/** Acima do intervalo mínimo entre ações do mesmo assento no servidor (150 ms). */
const RATE_LIMIT_BACKOFF_MS = 300;
const MAX_RATE_LIMIT_RETRIES = 20;

export interface DriveOptions {
  strategy: Strategy;
  /** Termina depois de tantas ações CONFIRMADAS pelo estado (a vez passou). */
  maxActs?: number;
  /** Termina quando devolver `true` (avaliada a cada mudança de estado e a cada segundo). */
  stop?(): Promise<boolean>;
  /** Prazo total do laço; estourar é falha do teste. */
  maxMs: number;
}

interface Snapshot {
  /** Texto da sonda, ou `null` se a mesa não está na tela. */
  readonly raw: string | null;
  readonly turnText: string;
}

function readSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => ({
    raw: document.querySelector('[data-testid="table-state"]')?.textContent ?? null,
    turnText: document.querySelector('[data-testid="turn-text"]')?.textContent ?? '',
  }));
}

const keyOf = (s: Snapshot): string => `${s.raw ?? 'sem-mesa'}#${s.turnText}`;

/**
 * Joga pela UI até `maxActs`/`stop()`: espera a sonda indicar `act=true`, aciona UMA ação e espera o
 * estado mudar (isso confirma a ação). Erro de mesa derruba o teste, exceto `RATE_LIMITED`: o aviso é
 * dispensado e a ação, repetida depois de um intervalo (a ação recusada não conta). Devolve quantas
 * ações foram confirmadas.
 */
export async function drive(p: Player, opts: DriveOptions): Promise<number> {
  const deadline = Date.now() + opts.maxMs;
  let acts = 0;
  let rateLimited = 0;
  /** Chave de estado no momento do clique; enquanto não mudar, a ação ainda não foi confirmada. */
  let pending: string | null = null;
  const finished = async (): Promise<boolean> =>
    (opts.maxActs !== undefined && acts >= opts.maxActs) ||
    (opts.stop !== undefined && (await opts.stop()));

  for (;;) {
    const err = p.page.getByTestId('table-error');
    if ((await err.count()) > 0) {
      const text = await err.innerText();
      if (!RATE_LIMITED_TEXT.test(text) || ++rateLimited > MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`jogador ${p.index}: erro na mesa: ${text}`);
      }
      await err.click(); // dispensa o aviso
      pending = null; // a ação recusada não aconteceu
      await p.page.waitForTimeout(RATE_LIMIT_BACKOFF_MS);
      continue;
    }

    const snap = await readSnapshot(p.page);
    const key = keyOf(snap);
    if (pending !== null && key !== pending) {
      acts += 1;
      pending = null;
    }
    if (pending === null && (await finished())) return acts;
    if (Date.now() > deadline) {
      throw new Error(`jogador ${p.index}: prazo estourado (sonda: ${snap.raw ?? 'ausente'})`);
    }

    const probe = snap.raw === null ? null : parseProbe(snap.raw);
    // Aposta pendente e decisão de onze/dez: os DOIS da dupla têm ação legal, mas quem responde é o
    // `actingSeat` (como um humano combinaria); o parceiro que agisse junto tomaria `NOT_YOUR_TURN`.
    const shared = /^Sua dupla/.test(snap.turnText);
    const mayAct = probe !== null && probe.act && (!shared || probe.turn === probe.me);
    if (pending === null && mayAct && (await performAction(p.page, opts.strategy))) {
      pending = key;
      continue;
    }
    // Acorda quando a sonda/vez muda ou quando aparece um erro (para tratá-lo sem esperar o timeout).
    await p.page
      .waitForFunction(
        (prev) => {
          const raw = document.querySelector('[data-testid="table-state"]')?.textContent ?? null;
          const turn = document.querySelector('[data-testid="turn-text"]')?.textContent ?? '';
          const hasError = document.querySelector('[data-testid="table-error"]') !== null;
          return hasError || `${raw ?? 'sem-mesa'}#${turn}` !== prev;
        },
        key,
        { timeout: 1000 },
      )
      .catch(() => undefined);
  }
}

/** Derruba o WebSocket ativo do jogador dos dois lados (queda sem consentimento, código 4010). */
export async function dropSocket(p: Player): Promise<void> {
  const current = p.sockets.at(-1);
  if (current === undefined) throw new Error(`jogador ${p.index} sem WebSocket`);
  // Lado do servidor primeiro: ele passa a ver a queda e abre a janela de reconexão; o navegador
  // vê o fechamento com `MAY_TRY_RECONNECT` e reconecta sozinho (SDK).
  await current.server.close({ code: 4010, reason: 'e2e drop' });
  await current.page.close({ code: 4010, reason: 'e2e drop' });
}
