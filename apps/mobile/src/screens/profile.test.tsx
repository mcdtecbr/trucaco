import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { openModeration } from '../profile/moderation';
import type { HistoryRow } from '../profile/history';
import { ProfileView, HISTORY_EMPTY_TEXT, STATS_SOON_TEXT } from './ProfileView';
import type { ProfileViewProps } from './ProfileView';
import { SettingsView, DELETE_CONFIRM_TEXT, DELETE_WARNING_TEXT } from './SettingsView';
import type { AccountSectionProps, SettingsViewProps } from './SettingsView';

const noop = vi.fn();

const row: HistoryRow = {
  id: 'm1',
  title: 'Paulista · Partida única',
  outcome: 'won',
  outcomeLabel: 'Vitória',
  scoreLabel: 'Placar 12 x 9',
  dateLabel: '04/11/2026 12:14',
  durationLabel: '15 min',
  players: [
    { seat: 0, name: 'Eu', relation: 'self', userId: null },
    { seat: 1, name: 'Beto <b>x</b>', relation: 'opponent', userId: 'u-2' },
    { seat: 3, name: 'Bot', relation: 'opponent', userId: null },
  ],
};

function profile(over: Partial<ProfileViewProps> = {}): string {
  const props: ProfileViewProps = {
    nickname: 'Zé',
    provider: 'guest',
    avatar: DEFAULT_AVATAR_PARTS,
    reduceMotion: true,
    me: {
      state: 'ready',
      error: null,
      stats: { paulista: { played: 0, won: 0 }, mineiro: { played: 0, won: 0 } },
    },
    history: { state: 'ready', rows: [row], hasMore: false, loadingMore: false, error: null },
    moderation: null,
    on: {
      back: noop,
      retryMe: noop,
      retryHistory: noop,
      loadMore: noop,
      block: noop,
      report: noop,
      moderation: { reason: noop, text: noop, confirm: noop, cancel: noop },
    },
    ...over,
  };
  return renderToStaticMarkup(<ProfileView {...props} />);
}

describe('ProfileView', () => {
  it('mostra apelido, tipo de conta e o histórico; estatísticas zeradas viram "em breve"', () => {
    const html = profile();
    expect(html).toContain('Zé');
    expect(html).toContain('Convidado');
    expect(html).toContain(STATS_SOON_TEXT);
    expect(html).not.toContain('0 partidas');
    expect(html).toContain('Vitória');
    expect(html).toContain('Placar 12 x 9');
    expect(html).toContain('15 min');
  });

  it('estatísticas reais aparecem quando há partidas', () => {
    const html = profile({
      me: {
        state: 'ready',
        error: null,
        stats: { paulista: { played: 5, won: 2 }, mineiro: { played: 0, won: 0 } },
      },
    });
    expect(html).toContain('Paulista: 5 partidas, 2 vitórias');
    expect(html).not.toContain(STATS_SOON_TEXT);
  });

  it('apelido do adversário é texto escapado, nunca HTML', () => {
    const html = profile();
    expect(html).toContain('Beto &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('Bloquear e Denunciar só para humano com conta (não para o próprio usuário nem bot)', () => {
    const html = profile();
    expect(html).toContain('block-m1-1');
    expect(html).toContain('report-m1-1');
    expect(html).not.toContain('block-m1-0');
    expect(html).not.toContain('block-m1-3');
  });

  it('estados: vazio, carregando, erro e carregar mais', () => {
    expect(
      profile({
        history: { state: 'ready', rows: [], hasMore: false, loadingMore: false, error: null },
      }),
    ).toContain(HISTORY_EMPTY_TEXT);
    expect(
      profile({
        history: { state: 'loading', rows: [], hasMore: false, loadingMore: false, error: null },
      }),
    ).toContain('history-loading');
    const err = profile({
      history: { state: 'error', rows: [], hasMore: false, loadingMore: false, error: 'Falhou.' },
    });
    expect(err).toContain('Falhou.');
    expect(err).toContain('history-retry');
    expect(
      profile({
        history: { state: 'ready', rows: [row], hasMore: true, loadingMore: false, error: null },
      }),
    ).toContain('history-more');
    expect(profile({ me: { state: 'error', error: 'Sem rede.', stats: null } })).toContain(
      'Sem rede.',
    );
  });

  it('painel de denúncia sob o jogador: motivos em pt-BR e limite de texto; confirmar exige motivo', () => {
    const html = profile({
      moderation: openModeration('report', { userId: 'u-2', nickname: 'Beto', matchId: 'm1' }),
    });
    expect(html).toContain('Trapaça');
    expect(html).toContain('Chat ofensivo');
    expect(html).toContain('500');
    expect(html).toMatch(/disabled="" aria-label="Enviar denúncia"/);
  });

  it('painel de bloqueio avisa que não afeta a partida em andamento', () => {
    const html = profile({
      moderation: openModeration('block', { userId: 'u-2', nickname: 'Beto', matchId: 'm1' }),
    });
    expect(html).toContain('Não afeta a partida em andamento');
  });
});

function account(over: Partial<AccountSectionProps> = {}): AccountSectionProps {
  return {
    provider: 'guest',
    blocks: { state: 'ready', items: [], error: null, busyId: null },
    deletion: { step: 0, busy: false, error: null },
    on: {
      profile: noop,
      unblock: noop,
      retryBlocks: noop,
      deleteStart: noop,
      deleteContinue: noop,
      deleteCancel: noop,
      deleteConfirm: noop,
    },
    ...over,
  };
}

function settings(acc: AccountSectionProps): string {
  const props: SettingsViewProps = {
    nickname: 'Zé',
    draft: '',
    busy: false,
    error: null,
    saved: false,
    appVersion: '1.0.0',
    account: acc,
    on: { draft: noop, save: noop, logout: noop, back: noop, avatar: noop },
  };
  return renderToStaticMarkup(<SettingsView {...props} />);
}

describe('SettingsView: conta', () => {
  it('lista vazia de bloqueados e botão de apagar conta no passo 0', () => {
    const html = settings(account());
    expect(html).toContain('blocks-empty');
    expect(html).toContain('delete-start');
    expect(html).not.toContain('delete-confirm');
  });

  it('lista bloqueados com desbloquear acessível; conta apagada aparece como removida', () => {
    const html = settings(
      account({
        blocks: {
          state: 'ready',
          items: [
            { userId: 'u-2', nickname: 'Beto' },
            { userId: 'u-3', nickname: null },
          ],
          error: null,
          busyId: null,
        },
      }),
    );
    expect(html).toContain('Desbloquear Beto');
    expect(html).toContain('Desbloquear Jogador removido');
  });

  it('apagar conta em 2 passos descreve o que some', () => {
    const one = settings(account({ deletion: { step: 1, busy: false, error: null } }));
    expect(one).toContain('delete-warning');
    expect(DELETE_WARNING_TEXT).toMatch(/avatar.*histórico.*combinados.*sessões/);
    expect(one).not.toContain('delete-confirm');
    const two = settings(account({ deletion: { step: 2, busy: false, error: 'Erro.' } }));
    expect(two).toContain(DELETE_CONFIRM_TEXT);
    expect(two).toContain('delete-confirm');
    expect(two).toContain('Erro.');
  });

  it('texto de sessão depende do provider', () => {
    expect(settings(account({ provider: 'guest' }))).toContain('Você joga como convidado');
    expect(settings(account({ provider: 'google' }))).toContain('Você entrou com Conta Google');
  });
});
