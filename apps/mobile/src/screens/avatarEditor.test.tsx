import { renderToStaticMarkup } from 'react-dom/server';
import { AVATAR_PART_COUNTS, AVATAR_PART_KEYS, DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { SIGNALS } from '@trucaco/avatar';
import { describe, expect, it, vi } from 'vitest';
import { initialAvatar, samePartsAs } from './avatarEditorState';
import { AvatarEditorView, PART_TITLES, variantLabel } from './AvatarEditorView';
import type { AvatarEditorViewProps } from './AvatarEditorView';
import { SeatAvatar } from './SeatAvatar';
import { SignalPanel } from './SignalPanel';

const noop = vi.fn();
function editor(over: Partial<AvatarEditorViewProps> = {}): string {
  return renderToStaticMarkup(
    <AvatarEditorView
      loading={false}
      loadError={null}
      parts={DEFAULT_AVATAR_PARTS}
      dirty={false}
      busy={false}
      error={null}
      saved={false}
      reduceMotion={false}
      on={{ pick: noop, save: noop, reload: noop, back: noop }}
      {...over}
    />,
  );
}

describe('acessibilidade do avatar', () => {
  it('o avatar do assento fica fora da árvore de acessibilidade (sem "Avatar" repetido)', () => {
    const out = renderToStaticMarkup(
      <SeatAvatar
        seat={2}
        parts={DEFAULT_AVATAR_PARTS}
        signal={null}
        reduceMotion={false}
        onSignalEnd={noop}
      />,
    );
    expect(out).toMatch(/aria-hidden="true"[^>]*>/);
    expect(out).toContain('data-testid="avatar-2"');
  });

  it('a pré-visualização do criador tem rótulo próprio', () => {
    expect(editor()).toContain('Pré-visualização do seu avatar');
  });
});

describe('AvatarEditorView', () => {
  it('mostra a pré-visualização e todas as variantes de todas as partes, marcando a escolhida', () => {
    const out = editor({ parts: { ...DEFAULT_AVATAR_PARTS, hair: 2 } });
    expect(out).toContain('data-testid="avatar-preview"');
    for (const key of AVATAR_PART_KEYS) {
      expect(out).toContain(PART_TITLES[key]);
      for (let i = 0; i < AVATAR_PART_COUNTS[key]; i++) {
        expect(out).toContain(`data-testid="avatar-part-${key}-${i}"`);
      }
    }
    expect(out).toContain('Cabelo: Repartido de lado');
    const checked = (key: string, i: number): boolean =>
      new RegExp(`aria-checked="true"[^>]*data-testid="avatar-part-${key}-${i}"`).test(out) ||
      new RegExp(`data-testid="avatar-part-${key}-${i}"[^>]*aria-checked="true"`).test(out);
    expect(checked('hair', 2)).toBe(true);
    expect(checked('hair', 0)).toBe(false);
  });

  it('salvar fica desligado sem mudança ou durante o salvamento; erro e confirmação aparecem', () => {
    const disabled = (out: string): boolean =>
      /<[^>]*data-testid="avatar-save"[^>]*>/.exec(out)?.[0].includes('aria-disabled="true"') ??
      false;
    expect(disabled(editor())).toBe(true);
    expect(disabled(editor({ dirty: true }))).toBe(false);
    expect(disabled(editor({ dirty: true, busy: true }))).toBe(true);
    expect(editor({ busy: true })).toContain('Salvando…');
    expect(editor({ error: 'Avatar inválido.' })).toContain('Avatar inválido.');
    expect(editor({ saved: true })).toContain('Avatar salvo.');
    expect(editor({ saved: true, dirty: true })).not.toContain('Avatar salvo.');
  });

  it('carregando e erro de carga têm estado próprio, com "Tentar de novo"', () => {
    const loading = editor({ loading: true });
    expect(loading).toContain('Carregando seu avatar');
    expect(loading).not.toContain('avatar-part-');
    const failed = editor({ loadError: 'Sem conexão.' });
    expect(failed).toContain('Sem conexão.');
    expect(failed).toContain('avatar-reload');
    expect(failed).toContain('avatar-back');
  });

  it('rótulos vêm do catálogo; índice além do catálogo vira "Opção N"', () => {
    expect(variantLabel('skin', 0)).toBe('Bege claro');
    expect(variantLabel('skin', 99)).toBe('Opção 100');
  });
});

describe('AvatarEditorScreen: helpers', () => {
  it('avatar nulo ou inválido do servidor cai no padrão; igualdade por conteúdo', () => {
    expect(initialAvatar(null)).toBe(DEFAULT_AVATAR_PARTS);
    expect(initialAvatar({ hat: 1 })).toBe(DEFAULT_AVATAR_PARTS);
    const p = initialAvatar({ ...DEFAULT_AVATAR_PARTS, eyes: 3 });
    expect(p.eyes).toBe(3);
    expect(samePartsAs(p, { ...DEFAULT_AVATAR_PARTS, eyes: 3 })).toBe(true);
    expect(samePartsAs(p, DEFAULT_AVATAR_PARTS)).toBe(false);
  });
});

describe('SignalPanel', () => {
  it('fechado: só o botão "Sinais"; os 12 botões ficam atrás dele', () => {
    const out = renderToStaticMarkup(<SignalPanel connected onSend={() => true} />);
    expect(out).toContain('data-testid="signal-toggle"');
    expect(out).toContain('aria-label="Abrir sinais"');
    expect(out).not.toContain('signal-grid');
  });

  it('o catálogo tem 12 sinais com nome', () => {
    expect(SIGNALS).toHaveLength(12);
    for (const s of SIGNALS) expect(s.name.length).toBeGreaterThan(3);
  });
});
