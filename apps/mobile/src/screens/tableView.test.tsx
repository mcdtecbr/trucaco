import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { projectTable } from '../table/projectTable';
import { priv, snapshot } from '../table/snapshotFixtures';
import { FinishedView } from './FinishedView';
import { TableView } from './TableView';
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
    deadlineAt: 0,
    clockOffsetMs: 0,
    leaveConfirm: false,
    live: { message: '', nonce: 0 },
    on: {
      pressCard: noop,
      act: noop,
      confirmSelected: noop,
      dismissError: noop,
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
        turn: 1,
        pending: { fromSeat: 0, fromTeam: 0, toLevel: 1 },
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

  it('carta selecionada mostra o botão de confirmar; erro e presença aparecem como texto', () => {
    const out = html(snapshot(), {
      selected: 'play:3paus',
      errorText: 'Não é a sua vez.',
      presenceNote: 'Caio está ausente.',
    });
    expect(out).toContain('Jogar três de paus');
    expect(out).toContain('Não é a sua vez.');
    expect(out).toContain('Caio está ausente.');
  });

  it('ocupado (ação em voo) desabilita as cartas', () => {
    const out = html(snapshot(), { busy: true });
    expect(out).not.toContain('Jogar três');
    expect(out).toContain('aria-disabled="true"');
  });

  it('largo: lateral com histórico aberto e vira; Mineiro lista as manilhas fixas', () => {
    const wide = html(snapshot(), { layout: 'wide' });
    expect(wide).toContain('Histórico das mãos');
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
      { live: { message: 'Bia jogou rei de ouros.', nonce: 1 } },
    );
    expect(out).toContain('rei de ouros');
    expect(out).toContain('coberta');
    expect(out).toContain('aria-live');
  });
});

describe('FinishedView', () => {
  it('placeholder de partida encerrada com voltar', () => {
    const out = renderToStaticMarkup(<FinishedView summary="Nós 12 × 7 Eles" onLeave={noop} />);
    expect(out).toContain('Partida encerrada');
    expect(out).toContain('Nós 12 × 7 Eles');
    expect(out).toContain('Voltar ao início');
  });
});
