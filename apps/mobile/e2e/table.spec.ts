/**
 * E2E web: 4 convidados em 4 navegadores numa mesa privada REAL (servidor `apps/server/dist/main.js`).
 * Cada teste monta a própria mesa (sem depender de ordem nem de estado dos outros).
 */
import { expect, test } from './fixtures';
import {
  createTable,
  drive,
  dropSocket,
  handLabels,
  joinTable,
  readProbe,
  readProbeAndHand,
  roomCodeOf,
  startTable,
} from './support/table';
import type { Player } from './support/table';

const CODE = /^[A-Z2-9]{8}$/;

/** Espera até exatamente um jogador ter `act=true` e devolve-o (a vez é do servidor). */
async function waitActor(players: readonly Player[]): Promise<Player> {
  let actor: Player | undefined;
  await expect
    .poll(
      async () => {
        const acting: Player[] = [];
        for (const p of players) if ((await readProbe(p.page))?.act === true) acting.push(p);
        actor = acting[0];
        return acting.length;
      },
      { message: 'exatamente um jogador pode agir' },
    )
    .toBe(1);
  if (actor === undefined) throw new Error('sem jogador na vez');
  return actor;
}

test.describe('mesa privada de 4 jogadores', () => {
  test('convidados criam a mesa, entram pelo código de 8 caracteres e a partida começa', async ({
    players,
  }) => {
    const code = await startTable(players);
    expect(code).toMatch(CODE);

    // Todos estão em jogo, na mão 1 da partida 1, com 3 cartas cada.
    for (const p of players) {
      await expect(p.page.getByTestId('table-state')).toContainText('|hand=1|');
      await expect(p.page.getByTestId('table-state')).toContainText('|match=1');
      await expect(p.page.getByTestId('my-hand').getByRole('button')).toHaveCount(3);
    }
    // O que cada navegador MOSTRA: as 12 cartas visíveis (3 de cada) são todas distintas, ou seja, cada
    // um renderiza só a própria mão. A prova de que o servidor nem envia a carta alheia (nível de
    // estado/frames) está nos testes do servidor (`game/leakdetect.test.ts`, testes de sala) e em
    // `src/table/table.int.test.ts`; este E2E não inspeciona o estado binário do Colyseus.
    const all = (await Promise.all(players.map((p) => handLabels(p.page)))).flat();
    expect(new Set(all).size).toBe(12);
    // Um único jogador pode agir, e todos concordam em de quem é a vez.
    await waitActor(players);
    const turns = await Promise.all(players.map(async (p) => (await readProbe(p.page))?.turn));
    expect(new Set(turns).size).toBe(1);
  });

  test('jogam cartas pelos botões da UI guiados por actingSeat e canAct', async ({ players }) => {
    await startTable(players);

    const actor = await waitActor(players);
    await expect(actor.page.getByTestId('turn-text')).toHaveText('Sua vez');
    for (const p of players) {
      if (p === actor) continue;
      await expect(p.page.getByTestId('turn-text')).toHaveText(/^Vez de /);
      // Sem ação legal fora da vez: nenhuma carta da mão está habilitada.
      await expect(
        p.page.getByTestId('my-hand').locator('[role="button"]:not([aria-disabled="true"])'),
      ).toHaveCount(0);
    }

    const acts = await Promise.all(
      players.map((p) => drive(p, { strategy: 'cards', maxMs: 90_000, maxActs: 2 })),
    );
    expect(acts).toEqual([2, 2, 2, 2]);
    for (const p of players) {
      await expect(p.page.getByTestId('table-error')).toHaveCount(0);
      // A mão que sobrou reflete o servidor: jogou 2 cartas (sobra 1) ou a mão 1 acabou e veio outra.
      // Sonda e cartas vêm do mesmo `evaluate`, senão a mão 2 poderia aparecer entre as duas leituras.
      const { probe, hand } = await readProbeAndHand(p.page);
      expect(probe?.phase).toBe('playing');
      expect(probe !== null && probe.hand >= 2 ? hand.length === 3 : hand.length === 1).toBe(true);
    }
  });

  test('mensagem do chat da mesa aparece como texto e balão; a da dupla não chega ao adversário', async ({
    players,
  }) => {
    await startTable(players);
    const [sender, ...receivers] = players as [Player, Player, Player, Player];
    const markup = '<b>Olá, mesa!</b>';
    const secret = 'segredo-da-dupla';

    // Quem é o parceiro do autor (assento + 2) e quem são os adversários, pelo assento de cada um.
    const senderSeat = (await readProbe(sender.page))?.me ?? -1;
    const seatOf = async (p: Player): Promise<number> => (await readProbe(p.page))?.me ?? -1;
    let partner: Player | undefined;
    const opponents: Player[] = [];
    for (const p of receivers) {
      if ((await seatOf(p)) === (senderSeat + 2) % 4) partner = p;
      else opponents.push(p);
    }
    if (partner === undefined || opponents.length !== 2) throw new Error('mesa sem parceiro');

    const send = async (tab: 'table' | 'partner', text: string): Promise<void> => {
      await sender.page.getByTestId(`chat-tab-${tab}`).click();
      await sender.page.getByTestId('chat-input').fill(text);
      await sender.page.getByTestId('chat-send').click();
    };
    await sender.page.getByTestId('open-chat').click();
    await expect(sender.page.getByTestId('chat-panel')).toBeVisible();
    // A da dupla vai primeiro e a da mesa logo em seguida (sem esperar eco): o servidor entrega em
    // ordem, então quando a da mesa chegar a um jogador a da dupla já teria chegado, se fosse dele.
    await send('partner', secret);
    // Rate limit de chat (2 s entre mensagens): a segunda, em seguida, é recusada com aviso.
    await send('table', markup);
    await expect(sender.page.getByTestId('chat-error')).toBeVisible();
    // Passado o intervalo, a mesma mensagem é entregue.
    await expect(async () => {
      await send('table', markup);
      await expect(sender.page.getByTestId('chat-list')).toContainText(markup, { timeout: 2500 });
    }).toPass({ timeout: 15_000 });

    // Nos FRAMES que o servidor mandou a cada navegador (antes de qualquer filtro do cliente): a mensagem
    // da mesa chega aos três; a da dupla chega ao parceiro e a NENHUM adversário.
    const includes = (p: Player, text: string): boolean =>
      p.frames.some((f) => f.includes(Buffer.from(text, 'utf8')));
    const tableNeedle = 'mesa!</b>'; // ASCII, trecho da mensagem da mesa
    await expect
      .poll(() => receivers.every((p) => includes(p, tableNeedle)), {
        message: 'a mensagem da mesa chega aos três',
      })
      .toBe(true);
    expect(includes(partner, secret), 'o parceiro recebe a mensagem da dupla').toBe(true);
    for (const o of opponents) {
      expect(
        includes(o, secret),
        `adversário (jogador ${o.index}) NÃO pode receber a da dupla`,
      ).toBe(false);
    }

    // Balão sobre o assento do autor, para os outros três, como TEXTO LITERAL (nada vira elemento).
    for (const p of receivers) {
      const bubble = p.page.locator('[data-testid^="bubble-"]', { hasText: 'Olá, mesa!' });
      await expect(bubble).toBeVisible();
      await expect(bubble).toContainText(markup);
      await expect(p.page.getByTestId('table').locator('b')).toHaveCount(0);
    }

    // Painel de cada receptor: a mensagem da mesa está lá como texto; a da dupla só no parceiro.
    for (const p of receivers) {
      await p.page.getByTestId('open-chat').click();
      await p.page.getByTestId('chat-tab-table').click();
      await expect(p.page.getByTestId('chat-list')).toContainText(markup);
      await expect(p.page.getByTestId('chat-list').locator('b')).toHaveCount(0);
      await p.page.getByTestId('chat-tab-partner').click();
      await expect(p.page.getByTestId('chat-list').getByText(secret)).toHaveCount(
        p === partner ? 1 : 0,
      );
      await p.page.getByTestId('chat-close').click();
    }
  });

  test('série decidida numa mão: todos jogam de novo e a partida 2 começa', async ({ players }) => {
    test.setTimeout(240_000);
    await startTable(players);

    // Todos apostam e aceitam até 12 pontos: a primeira mão decide a partida (e a série `single`).
    await Promise.all(
      players.map((p) =>
        drive(p, {
          strategy: 'escalate',
          maxMs: 150_000,
          stop: () => p.page.getByTestId('table-finished').isVisible(),
        }),
      ),
    );
    for (const p of players) {
      await expect(p.page.getByTestId('table-finished')).toBeVisible();
      await expect(p.page.getByTestId('rematch')).toBeVisible();
    }
    // Duas duplas: uma vence e a outra perde.
    const won = await Promise.all(players.map((p) => p.page.getByTestId('finished-won').count()));
    const lost = await Promise.all(players.map((p) => p.page.getByTestId('finished-lost').count()));
    expect(won.reduce((a, b) => a + b, 0)).toBe(2);
    expect(lost.reduce((a, b) => a + b, 0)).toBe(2);

    // Todos votam. Quem acabou de jogar pode bater no intervalo mínimo entre ações do servidor: o clique
    // se repete até o botão mudar para "Aguardando a mesa".
    for (const p of players) {
      const vote = p.page.getByTestId('rematch');
      await expect(async () => {
        if (await p.page.getByText('Jogar de novo').count()) await vote.click();
        // O último voto reinicia a mesa na hora: o botão some e a mesa (com a sonda) reaparece.
        await expect(
          vote
            .getByText(/Aguardando a mesa/)
            .or(p.page.getByTestId('table-state'))
            .first(),
        ).toBeAttached({ timeout: 2000 });
      }).toPass({ timeout: 15_000 });
    }

    for (const p of players) {
      await expect(p.page.getByTestId('table-state')).toContainText('playing|', {
        timeout: 30_000,
      });
      await expect(p.page.getByTestId('table-state')).toContainText('|hand=1|');
      await expect(p.page.getByTestId('table-state')).toContainText('|match=2');
      await expect(p.page.getByTestId('my-hand').getByRole('button')).toHaveCount(3);
    }
  });

  test('queda do WebSocket de um jogador: reconecta, volta à mesa e consegue jogar', async ({
    players,
  }) => {
    await startTable(players);
    const victim = players[2] as Player;
    const socketsBefore = victim.sockets.length;
    const handBefore = await handLabels(victim.page);

    await dropSocket(victim);

    // O navegador reabre o socket sozinho e avisa o jogador.
    await expect(victim.page.getByTestId('table-reconnected')).toBeVisible({ timeout: 30_000 });
    expect(victim.sockets.length).toBeGreaterThan(socketsBefore);
    await expect(victim.page.getByTestId('table-state')).toContainText('playing|');
    // Mesma mão de antes da queda (o estado vem de novo do servidor).
    await expect(victim.page.getByTestId('my-hand').getByRole('button')).toHaveCount(3);
    expect(await handLabels(victim.page)).toEqual(handBefore);

    // Depois da volta, a mesa inteira ainda joga (a vítima age pela UI como qualquer um).
    const acts = await Promise.all(
      players.map((p) => drive(p, { strategy: 'cards', maxMs: 90_000, maxActs: 1 })),
    );
    expect(acts).toEqual([1, 1, 1, 1]);
  });

  test('reload da página no meio da partida: volta ao mesmo assento, com a mesma mão, e a mesa segue', async ({
    players,
  }) => {
    const code = await startTable(players);
    const victim = players[2] as Player;
    const before = await readProbeAndHand(victim.page);
    expect(before.hand).toHaveLength(3);
    const tableUrl = victim.page.url();
    expect(tableUrl).toContain(`/table/${code}`);
    // O token de reconexão fica no sessionStorage (por aba) e nunca na URL nem no localStorage.
    const stored = await victim.page.evaluate(() => ({
      session: window.sessionStorage.getItem('trucaco.table.v1'),
      local: window.localStorage.getItem('trucaco.table.v1'),
    }));
    expect(stored.session).toContain(code);
    expect(stored.local).toBeNull();
    const token = (JSON.parse(stored.session ?? '{}') as { reconnectionToken?: string })
      .reconnectionToken;
    expect(token).toMatch(/^[\w-]+:[\w-]+$/);
    expect(tableUrl).not.toContain(token?.split(':')[1] ?? 'x');

    await victim.page.reload();

    // De volta à mesma rota e ao mesmo assento, sem passar pelo início.
    await expect(victim.page.getByTestId('table-state')).toContainText('playing|', {
      timeout: 30_000,
    });
    expect(victim.page.url()).toContain(`/table/${code}`);
    await expect(victim.page.getByTestId('my-hand').getByRole('button')).toHaveCount(3);
    const after = await readProbeAndHand(victim.page);
    expect(after.probe?.me).toBe(before.probe?.me);
    expect(after.probe?.match).toBe(before.probe?.match);
    expect(after.hand).toEqual(before.hand);
    // Quatro assentos distintos, e nas páginas dos outros o assento do recarregado voltou a "presente":
    // nem bot nem ausente (a presença vem do servidor).
    const seats = await Promise.all(players.map(async (p) => (await readProbe(p.page))?.me));
    expect(new Set(seats).size).toBe(4);
    for (const p of players) {
      if (p === victim) continue;
      const box = p.page.getByTestId(`table-seat-${before.probe?.me}`);
      await expect(box).not.toContainText(/Bot|Ausente/);
    }

    // A mesa inteira continua jogando (o recarregado age pela UI como qualquer um).
    const acts = await Promise.all(
      players.map((p) => drive(p, { strategy: 'cards', maxMs: 90_000, maxActs: 1 })),
    );
    expect(acts).toEqual([1, 1, 1, 1]);
  });

  test('reload na sala de espera: o dono volta à mesma mesa pelo código', async ({ players }) => {
    const [owner, guest] = players as [Player, Player, Player, Player];
    const code = await createTable(owner);
    await joinTable(guest, code);
    await expect(owner.page.getByTestId('seated-count')).toContainText('2');

    await owner.page.reload();

    // O dono sai da mesa no reload (a espera não tem janela de reconexão): o convidado vê cair para 1...
    await expect(guest.page.getByTestId('seated-count')).toContainText('1');
    // ...e a volta pelo código devolve o segundo lugar.
    await expect(owner.page.getByTestId('waiting-room')).toBeVisible({ timeout: 30_000 });
    await expect(owner.page.getByTestId('room-code')).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await roomCodeOf(owner.page)).toBe(code);
    expect(owner.page.url()).toContain(`/table/${code}`);
    // Os dois continuam sentados, sem lugar duplicado.
    await expect(owner.page.getByTestId('seated-count')).toContainText('2');
    await expect(guest.page.getByTestId('seated-count')).toContainText('2');
  });

  test('sair da mesa de propósito apaga o registro: o reload seguinte cai no início', async ({
    players,
  }) => {
    const [owner] = players as [Player, Player, Player, Player];
    await createTable(owner);
    await owner.page.getByTestId('leave-table').click();
    await expect(owner.page.getByTestId('home')).toBeVisible();
    const stored = await owner.page.evaluate(() =>
      window.sessionStorage.getItem('trucaco.table.v1'),
    );
    expect(stored).toBeNull();
    await owner.page.reload();
    await expect(owner.page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
    await expect(owner.page.getByTestId('notice-table-lost')).toHaveCount(0);
  });
});
