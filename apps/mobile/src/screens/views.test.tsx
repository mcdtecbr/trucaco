import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { describe, expect, it, vi } from 'vitest';
import { BootView } from './BootView';
import { HomeView } from './HomeView';
import type { HomeViewProps } from './HomeView';
import { SettingsView } from './SettingsView';
import { WaitingRoomView } from './WaitingRoomView';
import type { WaitingRoomViewProps } from './WaitingRoomView';
import { AvatarPlaceholder, initialOf } from '@trucaco/ui';

const noop = vi.fn();
function home(over: Partial<HomeViewProps> = {}): string {
  const props: HomeViewProps = {
    nickname: 'Zé',
    lostSession: false,
    resumeNotice: null,
    queueExpired: false,
    table: { variant: 'paulista', format: 'single', ironHand: true },
    code: '',
    queueForm: { variant: 'paulista', ironHand: true },
    queue: { status: 'idle' },
    remainingSeconds: 0,
    busy: 'none',
    error: null,
    retryRemaining: 0,
    on: {
      dismissLost: noop,
      dismissResumeNotice: noop,
      table: noop,
      create: noop,
      code: noop,
      join: noop,
      queueForm: noop,
      queueStart: noop,
      queueCancel: noop,
      settings: noop,
      avatar: noop,
    },
    ...over,
  };
  return renderToStaticMarkup(<HomeView {...props} />);
}

const seat = (n: number, nickname: string, status = 'connected') => ({
  seat: n,
  nickname,
  status,
  isBot: status === 'bot',
  avatar: DEFAULT_AVATAR_PARTS,
});
function waiting(over: Partial<WaitingRoomViewProps> = {}): string {
  return renderToStaticMarkup(
    <WaitingRoomView
      roomCode="ABCDEFGH"
      seats={[seat(0, 'Ana'), seat(1, '', 'empty'), seat(2, 'Caio'), seat(3, '', 'empty')]}
      mySeat={0}
      connection="connected"
      errorCode={null}
      shareLabel="Copiar código"
      shareDoneText="Código copiado."
      shareFailedText="Não foi possível copiar. Anote o código acima."
      shareFeedback="idle"
      on={{ share: noop, leave: noop }}
      {...over}
    />,
  );
}

describe('HomeView', () => {
  it('mostra as três seções, mão de ferro ligada por padrão e rótulos acessíveis', () => {
    const html = home();
    expect(html).toContain('Criar mesa privada');
    expect(html).toContain('Entrar com código');
    expect(html).toContain('Fila pública');
    expect(html).toContain('aria-label="Mão de ferro"');
    expect(html).toMatch(
      /role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/,
    );
    expect(html).toContain('role="button"');
    expect(html).toContain('Jogando como Zé');
  });

  it('a fila pública não oferece melhor de 3', () => {
    const html = home();
    const queueSection = html.slice(html.indexOf('Fila pública'));
    expect(queueSection).not.toContain('Melhor de 3');
    expect(html).toContain('Melhor de 3'); // só na criação de mesa privada
  });

  it('aviso de sessão perdida', () => {
    expect(home({ lostSession: true })).toContain(
      'Sessão anterior perdida, criamos um novo convidado.',
    );
    expect(home()).not.toContain('Sessão anterior perdida');
  });

  it('em voo, os botões ficam desabilitados', () => {
    const html = home({ busy: 'create' });
    expect(html).toContain('Criando…');
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('fila: tempo restante e botão de sair; outras ações travadas', () => {
    const html = home({ queue: { status: 'queued', expiresAt: 1 }, remainingSeconds: 42 });
    expect(html).toContain('expira em 42 s');
    expect(html).toContain('Sair da fila');
    expect(html).not.toContain('Entrar na fila');
  });

  it('erros por escopo, com Retry-After e sem revelar existência da mesa', () => {
    const cool = home({
      error: { scope: 'queue', code: 'QUEUE_COOLDOWN', retryAfterSeconds: 30, retryUntil: 1 },
      retryRemaining: 30,
    });
    expect(cool).toContain('(30 s)');
    const a = home({ error: { scope: 'join', code: 'TABLE_UNAVAILABLE' } });
    expect(a).toContain('Mesa indisponível. Confira o código.');
    expect(a).not.toContain('error-create');
    expect(home({ error: { scope: 'join', code: 'INVALID_CODE' } })).toContain('Código inválido');
  });

  it('Configurações fica desabilitado na fila e enquanto algo está em voo', () => {
    const settingsBtn = (html: string): string =>
      /<[^>]*data-testid="open-settings"[^>]*>/.exec(html)?.[0] ?? '';
    expect(settingsBtn(home())).not.toContain('aria-disabled="true"');
    expect(settingsBtn(home({ queue: { status: 'queued', expiresAt: 1 } }))).toContain(
      'aria-disabled="true"',
    );
    expect(settingsBtn(home({ queue: { status: 'matched' } }))).toContain('aria-disabled="true"');
    expect(settingsBtn(home({ busy: 'entering' }))).toContain('aria-disabled="true"');
  });

  it('Retry-After: contagem regressiva no texto e botão do escopo desabilitado até zerar', () => {
    const btn = (html: string, id: string): string =>
      new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
    const err = {
      scope: 'queue',
      code: 'QUEUE_COOLDOWN',
      retryAfterSeconds: 30,
      retryUntil: 99,
    } as const;
    const waitingHtml = home({ error: err, retryRemaining: 17 });
    expect(waitingHtml).toContain('(17 s)');
    expect(btn(waitingHtml, 'queue-start')).toContain('aria-disabled="true"');
    expect(btn(waitingHtml, 'create-submit')).not.toContain('aria-disabled="true"'); // outro escopo
    expect(btn(home({ error: err, retryRemaining: 0 }), 'queue-start')).not.toContain(
      'aria-disabled="true"',
    );
  });

  it('aviso de fila expirada e estado seated', () => {
    expect(home({ queueExpired: true })).toContain('A busca expirou');
    expect(home({ queue: { status: 'seated' } })).toContain('Você já está sentado');
  });

  it('o código aparece mascarado', () => {
    expect(home({ code: 'abcdefgh' })).toContain('value="ABCD-EFGH"');
  });
});

describe('WaitingRoomView', () => {
  it('mostra o código grande, 4 assentos e a contagem', () => {
    const html = waiting();
    expect(html).toContain('ABCD-EFGH');
    expect(html).toContain('Jogadores (2 de 4)');
    for (let i = 0; i < 4; i++) expect(html).toContain(`data-testid="seat-${i}"`);
    expect(html).toContain('Ana');
    expect(html).toContain('Conectado (você)');
    expect(html).toContain('Aguardando jogador…');
    expect(html).toContain('Copiar código');
    expect(html).toContain('Sair da mesa');
  });

  it('apelido do servidor é texto: HTML é escapado', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = waiting({
      seats: [seat(0, evil), seat(1, '', 'empty'), seat(2, '', 'empty'), seat(3, '', 'empty')],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('reconectando e fechada', () => {
    expect(waiting({ connection: 'reconnecting' })).toContain('Reconectando…');
    const closed = waiting({ connection: 'closed', errorCode: 'ROOM_NOT_FOUND' });
    expect(closed).toContain('A mesa não existe mais.');
  });

  it('feedback do botão de copiar', () => {
    expect(waiting({ shareFeedback: 'done' })).toContain('Código copiado.');
    expect(waiting({ shareFeedback: 'idle' })).not.toContain('Código copiado.');
    expect(waiting({ shareFeedback: 'failed' })).toContain('Não foi possível copiar');
  });
});

describe('SettingsView e BootView', () => {
  it('configurações: apelido, sair e versões', () => {
    const html = renderToStaticMarkup(
      <SettingsView
        nickname="Zé"
        draft=""
        busy={false}
        error="Esse apelido já está em uso. Escolha outro."
        saved={false}
        appVersion="1.2.3"
        on={{ draft: noop, save: noop, logout: noop, back: noop, avatar: noop }}
      />,
    );
    expect(html).toContain('Atual: Zé');
    expect(html).toContain('Esse apelido já está em uso');
    expect(html).toContain('App 1.2.3 · protocolo v4');
    expect(html).toContain('Sair');
  });

  it('boot: carregando e indisponível com botão de tentar de novo', () => {
    expect(renderToStaticMarkup(<BootView phase="loading" onRetry={noop} />)).toContain(
      'Entrando…',
    );
    const bad = renderToStaticMarkup(<BootView phase="unavailable" onRetry={noop} />);
    expect(bad).toContain('Tentar de novo');
    expect(bad).toContain('sessão foi mantida');
  });

  it('boot: reconectando à mesa mostra o texto e o indicador acessível', () => {
    const html = renderToStaticMarkup(<BootView phase="resuming" onRetry={noop} />);
    expect(html).toContain('data-testid="boot-resuming"');
    expect(html).toContain('Reconectando à mesa…');
    expect(html).not.toContain('Entrando…');
  });
});

describe('aviso de retomada de mesa na tela inicial', () => {
  it('mesa perdida e indisponível têm textos próprios; sem aviso, nada aparece', () => {
    expect(home({ resumeNotice: 'tableLost' })).toContain('ela terminou');
    expect(home({ resumeNotice: 'tableUnavailable' })).toContain('Verifique a conexão');
    expect(home({ resumeNotice: null })).not.toContain('notice-table-lost');
  });
});

describe('AvatarPlaceholder', () => {
  it('inicial do apelido, com code point inteiro', () => {
    expect(initialOf('zé')).toBe('Z');
    expect(initialOf('😀x')).toBe('😀');
    expect(initialOf('  ')).toBe('?');
    const html = renderToStaticMarkup(<AvatarPlaceholder nickname="bia" caption="Conectado" />);
    expect(html).toContain('>B<');
    expect(html).toContain('aria-label="bia, Conectado"');
  });
});
