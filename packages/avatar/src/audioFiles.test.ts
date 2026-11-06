import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_IDS, VOICE_IDS } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { ALL_SFX_IDS, GAME_SFX_IDS, SOUNDBOARD_SFX, soundboardInfo, sfxPath } from './sfx';
import { ALL_TAKES } from './speech';
import { VOICES, VOICES_WITH_FILES, resolveVoice, voiceInfo, voiceTakePath } from './voices';

const here = dirname(fileURLToPath(import.meta.url));
const AUDIO = resolve(here, '../../../assets/audio');
const MANIFEST = readFileSync(join(here, 'audioManifest.ts'), 'utf8');
const BUDGET = 1024 * 1024;

const sizeOf = (rel: string): number => statSync(join(AUDIO, rel)).size;

describe('vozes', () => {
  it('declara as 9 vozes do protocolo (5 masc, 4 fem); masc_1 a masc_5 e fem_1 com arquivo', () => {
    expect(VOICES.map((v) => v.id)).toEqual([...VOICE_IDS]);
    expect(VOICES_WITH_FILES).toEqual(['masc_1', 'masc_2', 'masc_3', 'masc_4', 'masc_5', 'fem_1']);
    expect(voiceInfo('fem_2')).toMatchObject({
      group: 'fem',
      label: 'Feminina 2',
      hasFiles: false,
    });
    expect(voiceInfo('masc_3')).toMatchObject({
      group: 'masc',
      label: 'Masculina 3',
      hasFiles: true,
    });
    expect(voiceInfo('masc_5')).toMatchObject({ group: 'masc', label: 'Masculina 5' });
    expect(voiceInfo('fem_4')).toMatchObject({ group: 'fem', label: 'Feminina 4' });
  });

  it('voz sem arquivo cai para a do mesmo grupo; sem nenhuma, null', () => {
    expect(resolveVoice('masc_1')).toBe('masc_1');
    expect(resolveVoice('masc_3')).toBe('masc_3');
    expect(resolveVoice('masc_5')).toBe('masc_5');
    expect(resolveVoice('fem_4')).toBe('fem_1');
    expect(resolveVoice('fem_2')).toBe('fem_1');
    expect(resolveVoice('fem_2', ['masc_1'])).toBeNull();
  });
});

describe('gerador do manifesto', () => {
  const script = resolve(here, '../../../scripts/audio/gen-manifest.mjs');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it('o manifesto versionado é igual ao que o script geraria', () => {
    const r = run('--check');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.each([
    ['arquivo', 'sfx', "x'});evil();({'.m4a"],
    ['arquivo com maiúscula', 'sfx', 'Horn.m4a'],
    ['pasta de voz', 'voices/a b', 'ok.m4a'],
  ])('nome inválido (%s) faz o script falhar', (_n, dir, name) => {
    const tmp = mkdtempSync(join(tmpdir(), 'audio-manifest-'));
    try {
      mkdirSync(join(tmp, dir), { recursive: true });
      writeFileSync(join(tmp, dir, name), '');
      const r = run('--audio-dir', tmp, '--out', join(tmp, 'out.ts'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('inválido');
      expect(existsSync(join(tmp, 'out.ts'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('arquivos de áudio', () => {
  it('todo par voz-com-arquivo x take existe em disco e no manifesto', () => {
    for (const voice of VOICES_WITH_FILES) {
      for (const take of ALL_TAKES) {
        const rel = voiceTakePath(voice, take.id);
        expect(existsSync(join(AUDIO, rel)), rel).toBe(true);
        expect(sizeOf(rel), rel).toBeGreaterThan(0);
        expect(MANIFEST, rel).toContain(`'../../../assets/audio/${rel}'`);
      }
    }
  });

  it('não há arquivo de voz fora do catálogo', () => {
    const expected = new Set(ALL_TAKES.map((t) => `${t.id}.m4a`));
    for (const voice of VOICES_WITH_FILES) {
      for (const f of readdirSync(join(AUDIO, 'voices', voice)))
        expect(expected.has(f), f).toBe(true);
    }
    expect(readdirSync(join(AUDIO, 'voices')).sort()).toEqual([...VOICES_WITH_FILES].sort());
  });

  it('todo SFX_ID e todo efeito de jogo tem arquivo e entrada no manifesto', () => {
    expect(SOUNDBOARD_SFX.map((s) => s.id)).toEqual([...SFX_IDS]);
    expect(ALL_SFX_IDS).toEqual([...SFX_IDS, ...GAME_SFX_IDS]);
    for (const id of ALL_SFX_IDS) {
      expect(existsSync(join(AUDIO, sfxPath(id))), id).toBe(true);
      expect(MANIFEST).toContain(`'../../../assets/audio/${sfxPath(id)}'`);
    }
    expect(soundboardInfo('horn').label).toBe('Buzina');
    for (const s of SOUNDBOARD_SFX) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.icon.length).toBeGreaterThan(0);
    }
    expect(readdirSync(join(AUDIO, 'sfx')).sort()).toEqual(
      ALL_SFX_IDS.map((id) => `${id}.m4a`).sort(),
    );
  });

  it('efeitos de jogo não entram no protocolo', () => {
    for (const id of GAME_SFX_IDS) expect((SFX_IDS as readonly string[]).includes(id)).toBe(false);
  });

  it('orçamento: até 1 MB por voz e 1 MB de efeitos', () => {
    for (const voice of VOICES_WITH_FILES) {
      const total = ALL_TAKES.reduce((n, t) => n + sizeOf(voiceTakePath(voice, t.id)), 0);
      expect(total, voice).toBeLessThanOrEqual(BUDGET);
    }
    const sfx = ALL_SFX_IDS.reduce((n, id) => n + sizeOf(sfxPath(id)), 0);
    expect(sfx).toBeLessThanOrEqual(BUDGET);
  });

  it('cada arquivo é curto: até 300 KB', () => {
    for (const id of ALL_SFX_IDS) expect(sizeOf(sfxPath(id))).toBeLessThanOrEqual(300 * 1024);
  });
});
