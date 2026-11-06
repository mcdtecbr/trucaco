import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { AchievementsView } from './AchievementsView';
import { LoginView } from './LoginView';
import { MissionsView, MISSIONS_EMPTY_TEXT } from './MissionsView';
import { PublicProfileView } from './PublicProfileView';
import { SocialAuthPanel, UNAVAILABLE_TEXT } from './SocialAuthPanel';
import type { SocialAuthPanelProps } from './SocialAuthPanel';
import { FinishedView } from './FinishedView';
import { SettingsView } from './SettingsView';

const noop = vi.fn();

describe('AchievementsView', () => {
  it('lista o catálogo inteiro com nível e progresso, e conta as desbloqueadas', () => {
    const html = renderToStaticMarkup(
      <AchievementsView
        state="ready"
        error={null}
        items={[{ id: 'maratona', level: 1, progress: 12, unlockedAt: '2026-11-04T10:00:00Z' }]}
        on={{ retry: noop, back: noop }}
      />,
    );
    expect(html).toContain('1 de 9 desbloqueadas');
    expect(html).toContain('Maratona');
    expect(html).toContain('12 de 100');
    expect(html).toContain('achievement-sinaleiro');
    expect(html).toContain('Bloqueada');
  });

  it('carregando e erro com tentar de novo', () => {
    const base = { items: [], on: { retry: noop, back: noop } } as const;
    expect(
      renderToStaticMarkup(<AchievementsView state="loading" error={null} {...base} />),
    ).toContain('achievements-loading');
    const err = renderToStaticMarkup(
      <AchievementsView state="error" error="Sem rede." {...base} />,
    );
    expect(err).toContain('Sem rede.');
    expect(err).toContain('achievements-retry');
  });
});

describe('MissionsView', () => {
  it('diárias e semanal com progresso; vazio e erro', () => {
    const html = renderToStaticMarkup(
      <MissionsView
        state="ready"
        error={null}
        items={[
          {
            id: 'jogar_3_partidas',
            period: 'daily',
            periodKey: '2026-11-04',
            target: 3,
            progress: 1,
            completedAt: null,
          },
          {
            id: 'vencer_5_semana',
            period: 'weekly',
            periodKey: '2026-W45',
            target: 5,
            progress: 5,
            completedAt: '2026-11-04T10:00:00Z',
          },
        ]}
        on={{ retry: noop, back: noop }}
      />,
    );
    expect(html).toContain('Missões do dia');
    expect(html).toContain('Missão da semana');
    expect(html).toContain('1 de 3');
    expect(html).toContain('Concluída');
    const empty = renderToStaticMarkup(
      <MissionsView state="ready" error={null} items={[]} on={{ retry: noop, back: noop }} />,
    );
    expect(empty).toContain(MISSIONS_EMPTY_TEXT);
    expect(
      renderToStaticMarkup(
        <MissionsView state="error" error="Falhou." items={[]} on={{ retry: noop, back: noop }} />,
      ),
    ).toContain('missions-retry');
  });
});

describe('PublicProfileView', () => {
  const profile = {
    nickname: 'Beto <b>x</b>',
    avatar: DEFAULT_AVATAR_PARTS,
    achievements: [{ id: 'maratona', level: 2 }] as const,
    stats: { paulista: { played: 4, won: 3 }, mineiro: { played: 0, won: 0 } },
  };

  it('apelido escapado, medalhas e partidas; sem histórico', () => {
    const html = renderToStaticMarkup(
      <PublicProfileView
        state="ready"
        error={null}
        profile={profile}
        reduceMotion
        on={{ retry: noop, back: noop }}
      />,
    );
    expect(html).toContain('Beto &lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('Maratona · Prata');
    expect(html).toContain('Paulista: 4 partidas, 3 vitórias');
    expect(html).not.toContain('Histórico');
  });

  it('jogador inexistente mostra o erro traduzido', () => {
    const html = renderToStaticMarkup(
      <PublicProfileView
        state="error"
        error="Jogador não encontrado."
        profile={null}
        reduceMotion
        on={{ retry: noop, back: noop }}
      />,
    );
    expect(html).toContain('Jogador não encontrado.');
  });
});

const panel = (over: Partial<SocialAuthPanelProps> = {}): SocialAuthPanelProps => ({
  mode: 'link',
  providers: [
    { id: 'google', available: true },
    { id: 'apple', available: false },
  ],
  busy: null,
  error: null,
  offerLogin: false,
  on: { press: noop, loginExisting: noop },
  ...over,
});

describe('SocialAuthPanel', () => {
  it('provedor sem SDK aparece desabilitado e rotulado como indisponível', () => {
    const html = renderToStaticMarkup(<SocialAuthPanel {...panel()} />);
    expect(html).toContain('Vincular com Google');
    expect(html).toContain(`Vincular com Apple (${UNAVAILABLE_TEXT})`);
    expect(html).toMatch(/disabled="" aria-label="Vincular com Apple/);
  });

  it('em andamento desabilita tudo; erro e oferta de entrar na conta existente', () => {
    const busy = renderToStaticMarkup(<SocialAuthPanel {...panel({ busy: 'google' })} />);
    expect(busy).toContain('social-busy');
    expect(busy).toMatch(/disabled="" aria-label="Vincular com Google"/);
    const taken = renderToStaticMarkup(
      <SocialAuthPanel
        {...panel({ error: 'Essa conta já está em uso por outro perfil.', offerLogin: true })}
      />,
    );
    expect(taken).toContain('Essa conta já está em uso');
    expect(taken).toContain('social-login-existing');
    expect(taken).toContain('o avatar e o histórico dele não vão junto');
  });

  it('modo entrar usa "Entrar com"', () => {
    expect(renderToStaticMarkup(<SocialAuthPanel {...panel({ mode: 'login' })} />)).toContain(
      'Entrar com Google',
    );
  });
});

describe('LoginView', () => {
  it('oferece conta e convidado', () => {
    const html = renderToStaticMarkup(
      <LoginView nickname="Zé" social={panel({ mode: 'login' })} on={{ guest: noop }} />,
    );
    expect(html).toContain('Entrar com Google');
    expect(html).toContain('login-guest');
    expect(html).toContain('Você segue jogando como Zé');
  });
});

describe('SettingsView: vincular conta', () => {
  const account = (provider: 'guest' | 'google') => ({
    provider,
    blocks: { state: 'ready' as const, items: [], error: null, busyId: null },
    deletion: { step: 0 as const, busy: false, error: null },
    social: panel(),
    on: {
      profile: noop,
      unblock: noop,
      retryBlocks: noop,
      deleteStart: noop,
      deleteContinue: noop,
      deleteCancel: noop,
      deleteConfirm: noop,
      achievements: noop,
      missions: noop,
      login: noop,
    },
  });
  const render = (provider: 'guest' | 'google') =>
    renderToStaticMarkup(
      <SettingsView
        nickname="Zé"
        draft=""
        busy={false}
        error={null}
        saved={false}
        appVersion="1"
        account={account(provider)}
        on={{ draft: noop, save: noop, logout: noop, back: noop, avatar: noop }}
      />,
    );

  it('convidado vê vincular e "Já tenho uma conta"; conta social não', () => {
    const guest = render('guest');
    expect(guest).toContain('Vincular com Google');
    expect(guest).toContain('settings-login');
    expect(guest).toContain('settings-achievements');
    expect(guest).toContain('settings-missions');
    const google = render('google');
    expect(google).not.toContain('Vincular com Google');
    expect(google).not.toContain('settings-login');
  });
});

describe('FinishedView: conquistas', () => {
  const result = { outcome: 'won', title: 'Vitória', lines: [] } as never;
  it('mostra o aviso e as conquistas novas; sem ganho, nada', () => {
    const base = { result, myTeam: 0 as const, history: [], onLeave: noop };
    const html = renderToStaticMarkup(
      <FinishedView
        {...base}
        gains={[{ id: 'maratona', name: 'Maratona', levelLabel: 'Bronze' }]}
        onOpenAchievements={noop}
      />,
    );
    expect(html).toContain('Conquista desbloqueada!');
    expect(html).toContain('Maratona · Bronze');
    expect(html).toContain('finished-open-achievements');
    expect(renderToStaticMarkup(<FinishedView {...base} />)).not.toContain('finished-achievements');
  });
});
