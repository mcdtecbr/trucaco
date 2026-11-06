// @vitest-environment jsdom
/**
 * Fase 5b, etapa 2B: painel de efeitos (cooldown visual), atalho de som, tela de som das configurações
 * (persistência) e seletor de voz do criador de avatar.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { SOUNDBOARD_SFX, VOICES } from '@trucaco/avatar';
import { DEFAULT_AVATAR_PARTS, parseAvatarParts } from '@trucaco/protocol';
import type { SfxId } from '@trucaco/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioService } from '../audio/audioService';
import { createFakeBackend, createFakeSources } from '../audio/fake';
import { createMemoryAudioPrefsStorage } from '../audio/prefs';
import { applyVoice, initialAvatar, samePartsAs, voiceOf } from './avatarEditorState';
import { AvatarEditorView } from './AvatarEditorView';
import { SettingsView } from './SettingsView';
import { SoundSettings, stepVolume } from './SoundSettings';
import { SoundboardPanel } from './SoundboardPanel';
import { fallbackNote } from './VoicePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

const byTestId = (id: string): HTMLElement | null => host.querySelector(`[data-testid="${id}"]`);
function must(id: string): HTMLElement {
  const el = byTestId(id);
  if (el === null) throw new Error(`sem elemento ${id}`);
  return el;
}
function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
function render(node: React.ReactNode): void {
  const r = createRoot(host);
  root = r;
  act(() => r.render(node));
}
const disabled = (id: string): boolean => must(id).getAttribute('aria-disabled') === 'true';

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  const r = root;
  if (r !== null) act(() => r.unmount());
  root = null;
  host.remove();
  vi.useRealTimers();
});

describe('painel de efeitos', () => {
  it('fechado: só o botão; aberto: os 8 efeitos com rótulo acessível', () => {
    render(<SoundboardPanel connected onSend={() => true} />);
    expect(byTestId('soundboard-grid')).toBeNull();
    click(must('soundboard-toggle'));
    expect(SOUNDBOARD_SFX).toHaveLength(8);
    for (const s of SOUNDBOARD_SFX) {
      expect(must(`sfx-${s.id}`).getAttribute('aria-label')).toBe(`Efeito: ${s.label}`);
    }
  });

  it('um toque envia, fecha o painel e abre o cooldown de 5 s com contagem; depois libera', () => {
    vi.useFakeTimers();
    const sent: SfxId[] = [];
    render(
      <SoundboardPanel
        connected
        onSend={(id) => {
          sent.push(id);
          return true;
        }}
      />,
    );
    click(must('soundboard-toggle'));
    click(must('sfx-rimshot'));
    expect(sent).toEqual(['rimshot']);
    expect(byTestId('soundboard-grid')).toBeNull();
    expect(must('soundboard-toggle').textContent).toBe('Efeitos (5s)');
    // No cooldown o painel abre, mas os efeitos ficam desligados e nada é enviado.
    click(must('soundboard-toggle'));
    expect(disabled('sfx-horn')).toBe(true);
    click(must('sfx-horn'));
    expect(sent).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(must('soundboard-toggle').textContent).toBe('Efeitos (3s)');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(must('soundboard-toggle').textContent).toBe('Efeitos');
    expect(disabled('sfx-horn')).toBe(false);
    click(must('sfx-horn'));
    expect(sent).toEqual(['rimshot', 'horn']);
  });

  it('envio recusado (sem sala) não inicia cooldown; sem conexão os botões ficam desligados', () => {
    const onSend = vi.fn(() => false);
    render(<SoundboardPanel connected onSend={onSend} />);
    click(must('soundboard-toggle'));
    click(must('sfx-clap'));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(must('soundboard-toggle').textContent).toBe('Efeitos');
    act(() => root?.render(<SoundboardPanel connected={false} onSend={onSend} />));
    expect(disabled('sfx-clap')).toBe(true);
  });

  it('com efeitos engraçados silenciados o aviso explica', () => {
    render(<SoundboardPanel connected onSend={() => true} silenced />);
    click(must('soundboard-toggle'));
    expect(must('soundboard-grid').textContent).toContain('silenciou');
  });
});

describe('tela de som das configurações', () => {
  it('passo de volume fica entre 0 e 1 sem erro de ponto flutuante', () => {
    expect(stepVolume(0.8, 1)).toBe(0.9);
    expect(stepVolume(0.9, 1)).toBe(1);
    expect(stepVolume(1, 1)).toBe(1);
    expect(stepVolume(0.1, -1)).toBe(0);
    expect(stepVolume(0, -1)).toBe(0);
    expect(stepVolume(0.7, 1)).toBe(0.8);
  });

  it('muda volume, sem som e silenciar engraçados; persiste e volta ao recarregar', async () => {
    const storage = createMemoryAudioPrefsStorage();
    const mk = () =>
      createAudioService({
        backend: createFakeBackend(),
        sources: createFakeSources(),
        storage,
      });
    const audio = mk();
    function View() {
      return (
        <SoundSettings
          prefs={audio.getPrefs()}
          onChange={(patch) => {
            audio.setPrefs(patch);
            act(() => root?.render(<View />));
          }}
        />
      );
    }
    render(<View />);
    expect(must('sound-voice-value').textContent).toBe('100%');
    expect(must('sound-sfx-value').textContent).toBe('80%');
    click(must('sound-voice-down'));
    click(must('sound-sfx-up'));
    click(must('sound-muted'));
    click(must('sound-funny-muted'));
    expect(must('sound-voice-value').textContent).toBe('90%');
    expect(must('sound-sfx-value').textContent).toBe('90%');
    expect(must('sound-muted').getAttribute('aria-checked')).toBe('true');
    expect(must('sound-funny-muted').getAttribute('aria-checked')).toBe('true');
    // "Reabre o app": outro serviço sobre o mesmo armazenamento.
    const again = mk();
    await again.hydrate();
    expect(again.getPrefs()).toEqual({
      muted: true,
      voiceVolume: 0.9,
      sfxVolume: 0.9,
      funnyMuted: true,
    });
  });

  it('o cartão aparece nas configurações e explica o silenciar por jogador', () => {
    render(
      <SettingsView
        nickname="Ana"
        draft=""
        busy={false}
        error={null}
        saved={false}
        appVersion="1.0.0"
        sound={{
          prefs: createAudioService({
            backend: createFakeBackend(),
            sources: createFakeSources(),
          }).getPrefs(),
          onChange: () => undefined,
        }}
        on={{ draft: vi.fn(), save: vi.fn(), logout: vi.fn(), back: vi.fn(), avatar: vi.fn() }}
      />,
    );
    expect(byTestId('sound-muted')).not.toBeNull();
    expect(host.textContent).toContain('botão Silenciar no chat da mesa');
  });
});

describe('voz no criador de avatar', () => {
  const base = {
    loading: false,
    loadError: null,
    dirty: false,
    busy: false,
    error: null,
    saved: false,
    reduceMotion: true,
  };
  const on = (over: Record<string, unknown> = {}) => ({
    pick: vi.fn(),
    save: vi.fn(),
    reload: vi.fn(),
    back: vi.fn(),
    voice: vi.fn(),
    preview: vi.fn(),
    ...over,
  });

  it('lista as 9 vozes; a escolhida vem marcada (padrão masc_1); sem arquivo = "em breve" e sem Ouvir', () => {
    render(<AvatarEditorView {...base} parts={DEFAULT_AVATAR_PARTS} on={on()} />);
    for (const v of VOICES) expect(byTestId(`avatar-voice-${v.id}`)).not.toBeNull();
    expect(must('avatar-voice-masc_1').getAttribute('aria-checked')).toBe('true');
    expect(must('avatar-voice-fem_2').textContent).toContain('em breve');
    expect(must('avatar-voice-masc_1').textContent).not.toContain('em breve');
    expect(disabled('avatar-voice-listen-fem_2')).toBe(true);
    expect(disabled('avatar-voice-listen-masc_2')).toBe(false);
    expect(disabled('avatar-voice-listen-fem_1')).toBe(false);
    expect(fallbackNote('fem_3')).toContain('Feminina 1');
    expect(fallbackNote('fem_4')).toContain('Feminina 1');
    expect(fallbackNote('masc_4')).toBeNull();
    expect(fallbackNote('masc_1')).toBeNull();
  });

  it('escolher e ouvir chamam os callbacks; "Ouvir" sem arquivo não faz nada', () => {
    const o = on();
    render(<AvatarEditorView {...base} parts={DEFAULT_AVATAR_PARTS} on={o} />);
    click(must('avatar-voice-fem_1'));
    expect(o.voice).toHaveBeenCalledWith('fem_1');
    click(must('avatar-voice-listen-fem_1'));
    expect(o.preview).toHaveBeenCalledWith('fem_1');
    click(must('avatar-voice-listen-fem_2'));
    expect(o.preview).toHaveBeenCalledTimes(1);
  });

  it('mostra o aviso do "Ouvir" e a nota de voz em breve', () => {
    render(
      <AvatarEditorView
        {...base}
        parts={{ ...DEFAULT_AVATAR_PARTS, voice: 'fem_3' }}
        voiceNote="O som está desligado nas configurações."
        on={on()}
      />,
    );
    expect(must('avatar-voice-note').textContent).toContain('desligado');
    expect(must('avatar-voice-soon').textContent).toContain('Feminina 1');
    expect(must('avatar-voice-fem_3').getAttribute('aria-checked')).toBe('true');
  });

  it('sem os callbacks de voz o editor não mostra o seletor (compatível com o uso antigo)', () => {
    render(
      <AvatarEditorView
        {...base}
        parts={DEFAULT_AVATAR_PARTS}
        on={{ pick: vi.fn(), save: vi.fn(), reload: vi.fn(), back: vi.fn() }}
      />,
    );
    expect(byTestId('avatar-voice-masc_1')).toBeNull();
  });
});

describe('voz no estado do editor', () => {
  it('a voz entra no que vai ao PUT, sobrevive à troca de partes e é válida no protocolo', () => {
    const picked = applyVoice(DEFAULT_AVATAR_PARTS, 'fem_2');
    expect(voiceOf(picked)).toBe('fem_2');
    expect(voiceOf(DEFAULT_AVATAR_PARTS)).toBe('masc_1');
    const withHair = { ...picked, hair: 2 }; // mesma forma que `applyPick` produz
    expect(withHair.voice).toBe('fem_2');
    expect(parseAvatarParts({ ...withHair })).toEqual(withHair);
  });

  it('o avatar salvo volta com a voz no reload; dirty ignora a ordem das chaves', () => {
    const saved = applyVoice({ ...DEFAULT_AVATAR_PARTS, eyes: 3 }, 'fem_1');
    const reloaded = initialAvatar(JSON.parse(JSON.stringify(saved)));
    expect(reloaded.voice).toBe('fem_1');
    expect(samePartsAs(reloaded, saved)).toBe(true);
    const reordered = { voice: 'fem_1', ...DEFAULT_AVATAR_PARTS, eyes: 3 } as typeof saved;
    expect(samePartsAs(reordered, saved)).toBe(true);
    expect(samePartsAs(applyVoice(saved, 'masc_1'), saved)).toBe(false);
  });

  it('voz inválida vinda do servidor derruba o avatar inteiro para o padrão (não passa lixo)', () => {
    expect(initialAvatar({ ...DEFAULT_AVATAR_PARTS, voice: 'robo_9' })).toBe(DEFAULT_AVATAR_PARTS);
  });
});
