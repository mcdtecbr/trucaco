import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { projectTable } from '../table/projectTable';
import { player, priv, snapshot } from '../table/snapshotFixtures';
import { finishedResult, rematchView, secondsLeft } from '../table/tableRoute';
import { ChatPanel } from './ChatPanel';
import { FinishedView } from './FinishedView';
import { TableView, metricsFor } from './TableView';
import type { TableViewProps } from './TableView';

const noop = vi.fn();
/** Abertura da tag HTML que contém o `aria-label` pedido. */
function tagWith(out: string, label: string): string {
  const at = out.indexOf(`aria-label="${label}"`);
  return at < 0 ? '' : out.slice(out.lastIndexOf('<', at), out.indexOf('>', at));
}
function html(state: unknown, over: Partial<TableViewProps> = {}): string {
  const props: TableViewProps = {
    vm: projectTable(state),
    layout: 'phone',
    banner: null,
    connected: true,
    busy: false,
    selected: null,
    errorText: null,
    presenceNote: null,
    history: [],
    handLog: [],
    lingering: null,
    coverMode: false,
    probe: true,
    chatPanel: null,
    chatUnreadTotal: 0,
    bubbles: {},
    signals: {},
    reduceMotion: false,
    deadlineAt: 0,
    clockOffsetMs: 0,
    leaveConfirm: false,
    on: {
      pressCard: noop,
      act: noop,
      dismissError: noop,
      toggleCover: noop,
      voteCancel: noop,
      openChat: noop,
      signalEnd: noop,
      sendSignal: () => true,
      askLeave: noop,
      cancelLeave: noop,
      leave: noop,
    },
    ...over,
  };
  return renderToStaticMarkup(<TableView {...props} />);
}

describe('TableView', () => {
  it('celular: mão, quatro jogadores, vira, placar e sonda de estado', () => {
    const out = html(snapshot());
    expect(out).toContain('data-testid="table"');
    expect(out).toContain('table-felt');
    expect(out).toContain('três de paus');
    for (let i = 1; i < 4; i++) expect(out).toContain(`table-seat-${i}`);
    expect(out).toContain('Ana, online');
    expect(out).toContain('Vira');
    expect(out).toContain('Vale 1');
    expect(out).toContain('playing|turn=0|hand=1|act=true|plays=0');
    expect(out).toContain('Sua vez');
  });

  it('só as cartas e botões de legalActions ficam habilitados', () => {
    const out = html(
      snapshot({
        privates: priv(0, {
          hand: [
            { rank: '3', suit: 'paus' },
            { rank: '4', suit: 'ouros' },
          ],
          legalActions: ['play:3paus'],
        }),
      }),
    );
    expect(out).not.toContain('Truco!');
    expect(out).not.toContain('Aceitar');
    expect(tagWith(out, 'três de paus')).not.toContain('aria-disabled="true"');
    expect(tagWith(out, 'quatro de ouros')).toContain('aria-disabled="true"');
  });

  it('botão de aposta usa o grito do valor do servidor e a aposta pendente aparece', () => {
    const pending = snapshot({
      hand: {
        phase: 'betPending',
        turn: 0,
        actingSeat: 1,
        pending: { fromSeat: 0, fromTeam: 0, toLevel: 1, responderSeat: 1 },
        pendingValue: 3,
        nextBetValue: 6,
      },
      privates: priv(1, { legalActions: ['accept', 'run', 'bet'] }),
    });
    const out = html(pending);
    expect(out).toContain('Seis!');
    expect(out).toContain('Aceitar');
    expect(out).toContain('Correr');
    expect(out).toContain('Ana pediu Truco (vale 3).');
  });

  it('reconectando desabilita as ações e mostra a faixa', () => {
    const out = html(snapshot(), { banner: 'reconnecting', connected: false });
    expect(out).toContain('Reconectando…');
    expect(out).not.toContain('Truco!');
    expect(html(snapshot(), { banner: 'reconnected' })).toContain('Você voltou.');
    expect(html(snapshot(), { banner: 'closed' })).toContain('A conexão com a mesa foi encerrada.');
  });

  it('sem botão de confirmar; erro e presença aparecem como texto', () => {
    const out = html(snapshot(), {
      errorText: 'Não é a sua vez.',
      presenceNote: 'Caio está ausente.',
    });
    expect(out).not.toContain('confirm-play');
    expect(out).toContain('Não é a sua vez.');
    expect(out).toContain('Caio está ausente.');
  });

  it('ocupado (ação em voo) desabilita as cartas', () => {
    const out = html(snapshot(), { busy: true });
    expect(out).not.toContain('Jogar três');
    expect(out).toContain('aria-disabled="true"');
  });

  it('largo: placar fixo compacto com histórico recolhido, vira na lateral; Mineiro lista as manilhas fixas', () => {
    const wide = html(snapshot(), { layout: 'wide' });
    expect(wide).toContain('score-fixed');
    expect(wide).toContain('score-ad');
    expect(html(snapshot(), { layout: 'wide', scoreAd: null })).not.toContain('score-ad');
    expect(wide).toContain('aria-expanded="false"');
    expect(wide).not.toContain('Histórico das mãos');
    const mineiro = html(
      snapshot({
        options: { variant: 'mineiro' },
        hand: { viraRank: '', viraSuit: '', manilhaRank: '', manilhaCards: ['4paus', '7copas'] },
      }),
      { layout: 'wide' },
    );
    expect(mineiro).toContain('Manilhas:');
    expect(mineiro).toContain('4♣');
  });

  it('confirmação de sair e apelido como texto puro (sem HTML interpretado)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const out = html(
      snapshot({
        players: [0, 1, 2, 3].map((i) => ({
          seat: i,
          nickname: i === 1 ? evil : `J${i}`,
          status: 'connected',
          handSize: 3,
          isBot: false,
          avatar: '{}',
        })),
      }),
      { leaveConfirm: true },
    );
    expect(out).toContain('Sair da mesa?');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('vaza em curso e anúncio ao vivo', () => {
    const out = html(
      snapshot({
        hand: {
          current: [
            { seat: 1, rank: 'K', suit: 'ouros', covered: false },
            { seat: 2, rank: '', suit: '', covered: true },
          ],
        },
      }),
    );
    expect(out).toContain('rei de ouros');
    expect(out).toContain('coberta');
  });
});

describe('TableView: 3H2', () => {
  const pendingState = (seat: number) =>
    snapshot({
      hand: {
        phase: 'betPending',
        turn: 0,
        actingSeat: 1,
        pending: { fromSeat: 0, fromTeam: 0, toLevel: 1, responderSeat: 1 },
        pendingValue: 3,
        nextBetValue: 6,
      },
      privates: priv(seat, { legalActions: seat === 1 ? ['accept', 'run', 'bet'] : [] }),
    });

  it('aposta pendente: só o respondedor age; pedinte e seu parceiro aguardam', () => {
    const responder = html(pendingState(1));
    expect(responder).toContain('Sua vez');
    expect(responder).toContain('Aceitar');
    const caller = html(pendingState(0));
    expect(caller).toContain('Aguardando resposta de Bia');
    expect(caller).not.toContain('Aceitar');
    expect(html(pendingState(2))).toContain('Aguardando resposta de Bia');
  });

  it('aposta pendente: o parceiro do respondedor não tem botões', () => {
    const out = html(pendingState(3));
    expect(out).toContain('Seu parceiro responde');
    expect(out).not.toContain('Aceitar');
    expect(out).not.toContain('Correr');
  });

  const special = (seat: number, legal: boolean, accepted: number[] = []) =>
    snapshot({
      game: { scores: [11, 3] },
      hand: {
        special: 'maoDeOnze',
        specialTeam: 0,
        phase: 'specialDecision',
        turn: 0,
        actingSeat: -1,
        specialAccepted: accepted,
      },
      privates: priv(seat, {
        hand: [{ rank: '4', suit: 'paus' }],
        partnerCards: [
          { rank: '3', suit: 'copas' },
          { rank: '5', suit: 'ouros' },
        ],
        legalActions: legal ? ['specialPlay', 'specialRun'] : [],
      }),
    });

  it('onze/dez: quem já aceitou aguarda o parceiro, sem botões, e ainda vê as cartas dele', () => {
    const out = html(special(0, false, [0]));
    expect(out).toContain('Aguardando o parceiro');
    expect(out).not.toContain('Jogar a mão');
    expect(out).toContain('partner-cards');
    expect(html(special(2, true, [0]))).toContain('Você e seu parceiro decidem');
  });

  it('onze/dez: os dois da dupla decidem e veem as cartas do parceiro', () => {
    const out = html(special(2, true));
    expect(html(special(0, true))).toContain('Você e seu parceiro decidem');
    expect(out).toContain('Você e seu parceiro decidem');
    expect(out).toContain('Jogar a mão');
    expect(out).toContain('Correr da mão');
    expect(out).toContain('partner-cards');
    expect(out).toContain('três de copas');
  });

  it('onze/dez: adversário não decide, e cartas do parceiro só aparecem na decisão', () => {
    expect(html(special(1, false))).toContain('A dupla adversária decide');
    const normal = html(
      snapshot({
        privates: priv(0, {
          partnerCards: [{ rank: '3', suit: 'copas' }],
          legalActions: ['play:3paus'],
          hand: [{ rank: '3', suit: 'paus' }],
        }),
      }),
    );
    expect(normal).not.toContain('partner-cards');
  });

  it('mão de ferro: cartas às cegas jogáveis por playBlind', () => {
    const out = html(
      snapshot({
        hand: { special: 'maoDeFerro' },
        privates: priv(0, { legalActions: ['playBlind:0', 'playBlind:1', 'playBlind:2'] }),
      }),
    );
    expect(out).toContain('Carta 1 de 3, às cegas');
    expect(out).toContain('Carta 2 de 3, às cegas');
  });

  it('botão Cobrir só existe com playCovered legal; modo ligado marca o botão', () => {
    const state = snapshot({
      privates: priv(0, {
        hand: [{ rank: '3', suit: 'paus' }],
        legalActions: ['play:3paus', 'playCovered:3paus'],
      }),
    });
    expect(html(state)).toContain('cover-toggle');
    expect(html(state, { coverMode: true })).toContain('Cobrir: ligado');
    expect(html(snapshot())).not.toContain('cover-toggle');
    expect(html(state, { coverMode: true })).toContain('Jogar coberta: três de paus');
    expect(html(state)).not.toContain('Jogar coberta');
  });

  it('a última vaza fica na mesa por um instante, com o vencedor', () => {
    const out = html(snapshot(), {
      lingering: {
        plays: [
          { seat: 0, rank: 'K', suit: 'ouros', covered: false },
          { seat: 1, rank: '4', suit: 'paus', covered: false },
        ],
        winnerSeat: 1,
        ownCovered: null,
      },
    });
    expect(out).toContain('rei de ouros');
    expect(out).toContain('Vaza de Bia');
  });

  it('votar para cancelar: contagem e estado de "já votou"', () => {
    const out = html(snapshot({ cancelVotes: [1] }), { defaultMenuOpen: true });
    expect(out).toContain('Cancelar mesa (1)');
    const voted = html(snapshot({ cancelVotes: [0] }), { defaultMenuOpen: true });
    expect(voted).toContain('Você já votou');
    expect(voted).toContain('Cancelar: você votou (1)');
  });

  it('sonda table-state só em modo E2E; manilhas do Mineiro continuam legíveis', () => {
    expect(html(snapshot(), { probe: false })).not.toContain('table-state');
    expect(html(snapshot())).toContain('table-state');
    const m = html(
      snapshot({
        options: { variant: 'mineiro' },
        hand: { viraRank: '', viraSuit: '', manilhaRank: '', manilhaCards: ['4paus'] },
      }),
    );
    expect(m).not.toContain('Manilhas fixas');
  });

  it('diálogo de sair esconde o fundo do leitor de tela e desabilita as ações', () => {
    const out = html(snapshot(), { leaveConfirm: true });
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('aria-modal');
    expect(out).not.toContain('Truco!');
  });

  it('histórico detalhado recolhido por padrão: nada das jogadas aparece até expandir', () => {
    const out = html(snapshot(), {
      layout: 'wide',
      handLog: ['Bia jogou rei de ouros.'],
      history: [
        {
          handNumber: 1,
          winnerTeam: 0,
          points: 1,
          reason: 'tricks',
          scores: [1, 0],
          details: ['Vaza 1: Você levou.'],
        },
      ],
    });
    expect(out).not.toContain('Vaza 1: Você levou.');
    expect(out).not.toContain('Bia jogou rei de ouros.');
    expect(out).toContain('score-history-toggle');
  });
});

describe('ChatPanel', () => {
  const props = {
    tab: 'table' as const,
    chat: [
      { id: 1, scope: 'table' as const, seat: 1, text: '<img src=x onerror=alert(1)>', at: 1 },
      { id: 2, scope: 'partner' as const, seat: 2, text: 'segredo da dupla', at: 2 },
    ],
    unread: { table: 0, partner: 3 },
    draft: '',
    errorText: null,
    connected: true,
    nicknameOf: (s: number) => ['Ana', 'Bia', 'Caio', 'Davi'][s] ?? '',
    mySeat: 0,
    on: { setTab: noop, setDraft: noop, send: noop, phrase: noop, close: noop },
  };

  it('texto de chat é sempre texto puro e cada aba mostra só o seu escopo', () => {
    const out = renderToStaticMarkup(<ChatPanel {...props} />);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
    expect(out).not.toContain('segredo da dupla');
    expect(out).toContain('Dupla (3)');
    const partner = renderToStaticMarkup(<ChatPanel {...props} tab="partner" />);
    expect(partner).toContain('segredo da dupla');
    expect(partner).toContain('Só a sua dupla vê');
  });

  it('erro de chat e envio desabilitado sem texto ou sem conexão', () => {
    const out = renderToStaticMarkup(
      <ChatPanel {...props} errorText="Mensagem não enviada." connected={false} />,
    );
    expect(out).toContain('Mensagem não enviada.');
    expect(out).toContain('chat-phrase-good_luck');
  });

  it('o painel aparece na mesa quando aberto', () => {
    const out = html(snapshot(), { chatPanel: props, chatUnreadTotal: 3 });
    expect(out).toContain('chat-panel');
    expect(out).toContain('Chat, 3 mensagens novas');
  });
});

describe('FinishedView', () => {
  const finished = (over: Record<string, unknown> = {}) =>
    projectTable(
      snapshot({
        phase: 'finished',
        game: { scores: [12, 9] },
        hand: { phase: 'finished', turn: -1, actingSeat: -1 },
        ...over,
      }),
    );

  it('vitória da série bo3 com placares e histórico', () => {
    const vm = finished({ series: { format: 'bo3', games: [2, 1], winnerTeam: 0 } });
    const out = renderToStaticMarkup(
      <FinishedView
        result={finishedResult(vm)}
        myTeam={0}
        history={[{ handNumber: 3, winnerTeam: 0, points: 3, reason: 'tricks', scores: [12, 9] }]}
        onLeave={noop}
      />,
    );
    expect(out).toContain('Vitória da sua dupla!');
    expect(out).toContain('Série: Nós 2 × 1 Eles');
    expect(out).toContain('Último jogo: Nós 12 × 9 Eles');
    expect(out).toContain('Mão 3');
    expect(out).toContain('Voltar ao início');
  });

  it('derrota, e mesa cancelada sem vencedor', () => {
    expect(finishedResult(finished({ series: { winnerTeam: 1 } })).outcome).toBe('lost');
    const c = finishedResult(finished());
    expect(c.outcome).toBe('cancelled');
    const out = renderToStaticMarkup(
      <FinishedView result={c} myTeam={0} history={[]} onLeave={noop} />,
    );
    expect(out).toContain('Mesa cancelada');
  });

  it('dupla 1 enxerga o próprio placar como "Nós"', () => {
    const vm = projectTable(
      snapshot({
        phase: 'finished',
        game: { scores: [5, 12] },
        series: { winnerTeam: 1 },
        privates: priv(1),
      }),
    );
    const r = finishedResult(vm);
    expect(r.outcome).toBe('won');
    expect(r.lines[0]).toBe('Último jogo: Nós 12 × 5 Eles');
  });

  it('sem estado, resultado desconhecido', () => {
    expect(finishedResult(null).outcome).toBe('unknown');
  });
});

describe('FinishedView: revanche', () => {
  const done = (over: Record<string, unknown> = {}) =>
    projectTable(
      snapshot({
        phase: 'finished',
        series: { winnerTeam: 0 },
        game: { scores: [12, 9] },
        rematchDeadlineAt: Date.now() + 25_000,
        hand: { phase: 'finished', turn: -1, actingSeat: -1 },
        ...over,
      }),
    );
  const render = (vm: ReturnType<typeof projectTable>, extra: object = {}) =>
    renderToStaticMarkup(
      <FinishedView
        result={finishedResult(vm)}
        myTeam={0}
        history={[]}
        onLeave={noop}
        rematch={rematchView(vm)}
        onRematch={noop}
        {...extra}
      />,
    );

  it('janela aberta: botão, contagem regressiva e quem já votou', () => {
    const out = render(done({ rematchVotes: [1] }));
    expect(out).toContain('Jogar de novo');
    expect(out).toContain('Tempo para decidir:');
    expect(out).toContain('Querem jogar de novo: Bia');
    expect(out).toContain('Voltar ao início');
  });

  it('depois do meu voto: aguardando a mesa (x/y) e botão desabilitado', () => {
    const out = render(done({ rematchVotes: [0, 1] }));
    expect(out).toContain('Aguardando a mesa (2 votaram)');
    expect(tagWith(out, 'Aguardando a mesa (2 votaram)')).toContain('aria-disabled="true"');
    expect(out).not.toContain('>Jogar de novo<');
  });

  it('poucos humanos: o botão segue habilitado (o servidor decide) e há só a nota informativa', () => {
    const out = render(
      done({
        players: [
          player(0),
          player(1, { isBot: true }),
          player(2, { isBot: true }),
          player(3, { isBot: true }),
        ],
      }),
    );
    expect(tagWith(out, 'Jogar de novo')).not.toContain('disabled');
    expect(out).toContain('A revanche precisa de pelo menos 2 jogadores conectados.');
  });

  it('oculta sem prazo publicado (servidor antigo) e com a mesa cancelada', () => {
    expect(render(done({ rematchDeadlineAt: 0 }))).not.toContain('Jogar de novo');
    expect(render(done({ series: { winnerTeam: -1 } }))).not.toContain('Jogar de novo');
    expect(rematchView(done({ rematchDeadlineAt: 0 }))).toBeNull();
    expect(rematchView(null)).toBeNull();
  });

  it('prazo vencido desabilita e avisa; erro do servidor aparece', () => {
    const out = render(done({ rematchDeadlineAt: 1 }), {
      errorText: 'A revanche não está disponível.',
    });
    expect(tagWith(out, 'Jogar de novo')).toContain('aria-disabled="true"');
    expect(out).toContain('O tempo para jogar de novo acabou.');
    expect(out).toContain('A revanche não está disponível.');
  });

  it('secondsLeft usa o offset do servidor e nunca fica negativo', () => {
    expect(secondsLeft(10_000, 4_000, 0)).toBe(6);
    expect(secondsLeft(10_000, 4_000, 3_000)).toBe(3);
    expect(secondsLeft(10_000, 9_500, 0)).toBe(1);
    expect(secondsLeft(10_000, 20_000, 0)).toBe(0);
  });
});

describe('TableView: disposição por layout', () => {
  it('avatares grandes, quadrados e sem mudar com o layout além do tamanho', () => {
    const phone = metricsFor('phone');
    expect(phone.avatar).toBeGreaterThanOrEqual(72);
    expect(phone.avatar).toBeLessThanOrEqual(80);
    expect(metricsFor('landscape').avatar).toBeGreaterThanOrEqual(64);
    expect(metricsFor('wide').avatar).toBeGreaterThan(phone.avatar);
    expect(metricsFor('landscape').trick).toBe('row');
    expect(metricsFor('phone').trick).toBe('cross');
  });

  for (const layout of ['phone', 'landscape', 'wide'] as const) {
    it(`${layout}: placar no topo, quatro assentos, dock com mão, sinais e menu`, () => {
      const out = html(snapshot(), { layout });
      expect(out).toContain('score-fixed');
      expect(out).toContain('data-testid="my-seat"');
      for (let i = 1; i < 4; i++) expect(out).toContain(`table-seat-${i}`);
      expect(out).toContain('data-testid="dock"');
      expect(out).toContain('data-testid="my-hand"');
      expect(out).toContain('data-testid="signal-toggle"');
      expect(out).toContain('data-testid="open-chat"');
      expect(out).toContain('data-testid="leave-table"');
      expect(out).toContain('data-testid="score-history-toggle"');
      expect(out).toContain('data-testid="turn-timer"');
      // Ordem de leitura: placar, mesa (assentos e vez), mão e depois as ações da dock.
      expect(out.indexOf('score-fixed')).toBeLessThan(out.indexOf('turn-text'));
      expect(out.indexOf('turn-text')).toBeLessThan(out.indexOf('data-testid="my-hand"'));
    });
  }

  it('histórico fica só como ícone no topo, recolhido; o menu fecha por padrão', () => {
    const out = html(snapshot());
    expect(out).not.toContain('Histórico das mãos');
    expect(out).not.toContain('data-testid="table-menu"');
    expect(html(snapshot(), { defaultMenuOpen: true })).toContain('data-testid="table-menu"');
  });

  it('o botão de aposta fica sempre no canto, depois de correr e aceitar', () => {
    const out = html(
      snapshot({
        hand: {
          phase: 'betPending',
          turn: 0,
          actingSeat: 1,
          pending: { fromSeat: 0, fromTeam: 0, toLevel: 1, responderSeat: 1 },
          pendingValue: 3,
          nextBetValue: 6,
        },
        privates: priv(1, { legalActions: ['accept', 'run', 'bet'] }),
      }),
    );
    expect(out.indexOf('data-testid="bet-run"')).toBeLessThan(out.indexOf('data-testid="bet-bet"'));
    expect(out.indexOf('data-testid="bet-accept"')).toBeLessThan(
      out.indexOf('data-testid="bet-bet"'),
    );
    expect(out).toContain('Seis!');
  });

  it('costas das cartas só nos outros três assentos durante a mão', () => {
    const out = html(snapshot());
    expect(out.match(/data-testid="card-backs"/g)?.length ?? 0).toBeLessThanOrEqual(3);
    expect(out).toContain('card-backs');
  });
});
