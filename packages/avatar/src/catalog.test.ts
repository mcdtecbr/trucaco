import { describe, expect, it } from 'vitest';
import {
  AVATAR_PART_COUNTS,
  AVATAR_PART_KEYS,
  SIGNAL_IDS,
  parseAvatarParts,
  DEFAULT_AVATAR_PARTS,
} from '@trucaco/protocol';
import {
  BG_COLORS,
  HAIR_COLORS,
  EYE_COLORS,
  OUTFIT_COLORS,
  PART_VARIANT_NAMES,
  SKIN_COLORS,
  safeIndex,
} from './parts';
import { POSES } from './poses';
import { RIVE_CONTRACT, RIVE_INPUT_DOCS } from './riveContract';
import { MAX_SIGNAL_DURATION_MS, SIGNALS, signalInfo, signalTrigger } from './signals';

describe('catálogo de sinais', () => {
  it('todo SignalId tem entrada com trigger trig_<id> (wink usa trig_wink_l), na ordem do protocolo', () => {
    expect(SIGNALS.map((s) => s.id)).toEqual([...SIGNAL_IDS]);
    for (const id of SIGNAL_IDS) {
      const info = signalInfo(id);
      const trigger = id === 'wink' ? 'trig_wink_l' : `trig_${id}`;
      expect(info.trigger).toBe(trigger);
      expect(signalTrigger(id)).toBe(trigger);
      expect(RIVE_CONTRACT.triggers[id]).toBe(trigger);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.meaning.length).toBeGreaterThan(0);
      expect(info.durationMs).toBeGreaterThanOrEqual(800);
      expect(info.durationMs).toBeLessThanOrEqual(MAX_SIGNAL_DURATION_MS);
    }
  });

  it('todo sinal tem pose, com neutra nas pontas', () => {
    for (const id of SIGNAL_IDS) {
      const channels = Object.values(POSES[id]);
      expect(channels.length).toBeGreaterThan(0);
      for (const values of channels) {
        expect(values.length).toBeGreaterThanOrEqual(2);
        expect(values[values.length - 1]).toBe(values[0]);
      }
    }
  });
});

describe('contrato do rig', () => {
  it('toda parte do protocolo é um input Number documentado', () => {
    expect([...RIVE_CONTRACT.inputs]).toEqual([...AVATAR_PART_KEYS]);
    expect(RIVE_CONTRACT.artboard).toBe('Avatar');
    expect(RIVE_CONTRACT.stateMachine).toBe('Main');
    for (const key of AVATAR_PART_KEYS) {
      expect(RIVE_INPUT_DOCS[key].length).toBeGreaterThan(0);
      expect(RIVE_CONTRACT.inputCounts[key]).toBe(AVATAR_PART_COUNTS[key]);
    }
  });

  it('cada parte tem nome de variante e (quando aplicável) cor para todas as variantes', () => {
    for (const key of AVATAR_PART_KEYS) {
      expect(PART_VARIANT_NAMES[key]).toHaveLength(AVATAR_PART_COUNTS[key]);
      expect(new Set(PART_VARIANT_NAMES[key]).size).toBe(AVATAR_PART_COUNTS[key]);
    }
    expect(SKIN_COLORS).toHaveLength(AVATAR_PART_COUNTS.skin);
    expect(BG_COLORS).toHaveLength(AVATAR_PART_COUNTS.bg_color);
    expect(new Set(SKIN_COLORS.map((c) => c.base)).size).toBe(SKIN_COLORS.length);
    expect(new Set(BG_COLORS).size).toBe(BG_COLORS.length);
    for (const c of SKIN_COLORS) {
      expect(c.base).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.shade).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(HAIR_COLORS[0]).toBe('#2B1B12');
    expect(HAIR_COLORS).toHaveLength(AVATAR_PART_COUNTS.hair_color);
    expect(EYE_COLORS).toHaveLength(AVATAR_PART_COUNTS.eye_color);
    expect(OUTFIT_COLORS).toHaveLength(AVATAR_PART_COUNTS.outfit_color);
    for (const list of [HAIR_COLORS, EYE_COLORS, OUTFIT_COLORS]) {
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('o catálogo segue o avatar.riv: contagens e nomes', () => {
    expect(AVATAR_PART_COUNTS.accessory).toBe(3);
    expect(PART_VARIANT_NAMES.accessory).toEqual(['nenhum', 'bigode', 'brinco']);
    expect(PART_VARIANT_NAMES.hair[2]).toBe('afro');
    expect(PART_VARIANT_NAMES.hair[7]).toBe('topete');
    expect(SKIN_COLORS[0]).toEqual({ base: '#FCE4D6', shade: '#E8B89B' });
    expect(BG_COLORS[0]).toBe('#1E5631');
  });

  it('safeIndex nunca devolve índice fora do catálogo', () => {
    expect(safeIndex('hair', 3)).toBe(3);
    expect(safeIndex('hair', 99)).toBe(0);
    expect(safeIndex('hair', -1)).toBe(0);
    expect(safeIndex('hair', 1.5)).toBe(0);
    expect(safeIndex('hair', 'x')).toBe(0);
    expect(parseAvatarParts(DEFAULT_AVATAR_PARTS)).not.toBeNull();
  });
});
