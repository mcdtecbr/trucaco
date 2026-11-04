import { renderToStaticMarkup } from 'react-dom/server';
import { AVATAR_PART_COUNTS, AVATAR_PART_KEYS, DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { SIGNALS } from '@trucaco/avatar';
import { describe, expect, it, vi } from 'vitest';
import { initialAvatar, samePartsAs } from './avatarEditorState';
import {
  AvatarEditorView,
  EDITOR_PART_ORDER,
  HAT_BLOCKED_HINT,
  PART_TITLES,
  applyPick,
  variantLabel,
} from './AvatarEditorView';
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
    expect(out).toContain('Cabelo: Afro');
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

  it('o editor mostra cada cor logo depois da sua forma e cobre todas as chaves', () => {
    expect([...EDITOR_PART_ORDER].sort()).toEqual([...AVATAR_PART_KEYS].sort());
    const i = (k: (typeof EDITOR_PART_ORDER)[number]) => EDITOR_PART_ORDER.indexOf(k);
    expect(i('hair_color')).toBe(i('hair') + 1);
    expect(i('eye_color')).toBe(i('eyes') + 1);
    expect(i('outfit_color')).toBe(i('outfit') + 1);
    expect(PART_TITLES.hair_color).toBe('Cor do cabelo');
    // Fatia 3: sobrancelhas e nariz têm título e vêm logo depois dos olhos
    expect(i('brows')).toBeGreaterThan(i('eye_color'));
    expect(PART_TITLES.brows).toBe('Sobrancelhas');
    expect(PART_TITLES.nose).toBe('Nariz');
    // Fatia 4: barba e chapéu têm título e vêm logo depois do cabelo e da sua cor
    expect(i('beard')).toBe(i('hair_color') + 1);
    expect(i('hat')).toBe(i('beard') + 1);
    expect(PART_TITLES.beard).toBe('Barba');
    expect(PART_TITLES.hat).toBe('Chapéu');
  });

  it('cabelo 2 e 14: escolher zera o chapéu e escolher chapéu depois não muda nada', () => {
    const withHat = { ...DEFAULT_AVATAR_PARTS, hair: 3, hat: 5 };
    for (const hair of [2, 14]) {
      const next = applyPick(withHat, 'hair', hair);
      expect(next).toMatchObject({ hair, hat: 0 });
      expect(applyPick(next, 'hat', 4)).toBe(next);
      expect(applyPick(next, 'hat', 0)).toEqual(next);
    }
    // outros cabelos e outras partes seguem livres
    expect(applyPick(withHat, 'hair', 8)).toMatchObject({ hair: 8, hat: 5 });
    expect(applyPick(withHat, 'hat', 7)).toMatchObject({ hair: 3, hat: 7 });
  });

  it('com cabelo 2/14 as opções de chapéu (menos "Sem chapéu") ficam desabilitadas, com dica', () => {
    for (const hair of [2, 14]) {
      const out = editor({ parts: { ...DEFAULT_AVATAR_PARTS, hair } });
      const tag = (i: number): string =>
        new RegExp(`<[^>]*data-testid="avatar-part-hat-${i}"[^>]*>`).exec(out)![0];
      expect(tag(0)).not.toContain('disabled');
      for (let i = 1; i < AVATAR_PART_COUNTS.hat; i++) {
        expect(tag(i), `hat ${i}`).toContain('aria-disabled="true"');
      }
      expect(out).toContain('data-testid="avatar-part-hat-hint"');
      expect(out).toContain(HAT_BLOCKED_HINT);
    }
  });

  it('com outro cabelo o chapéu fica livre e sem dica', () => {
    const out = editor({ parts: { ...DEFAULT_AVATAR_PARTS, hair: 3, hat: 2 } });
    expect(out).not.toContain('avatar-part-hat-hint');
    expect(out).not.toContain(HAT_BLOCKED_HINT);
    expect(new RegExp('<[^>]*data-testid="avatar-part-hat-5"[^>]*>').exec(out)![0]).not.toContain(
      'aria-disabled="true"',
    );
  });

  it('rótulos vêm do catálogo; índice além do catálogo vira "Opção N"', () => {
    expect(variantLabel('skin', 0)).toBe('Clara');
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
  it('fechado: só o botão "Sinais"; os 16 botões ficam atrás dele', () => {
    const out = renderToStaticMarkup(<SignalPanel connected onSend={() => true} />);
    expect(out).toContain('data-testid="signal-toggle"');
    expect(out).toContain('aria-label="Abrir sinais"');
    expect(out).not.toContain('signal-grid');
  });

  it('o catálogo tem 16 sinais com nome', () => {
    expect(SIGNALS).toHaveLength(16);
    for (const s of SIGNALS) expect(s.name.length).toBeGreaterThan(3);
  });
});
