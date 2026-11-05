import { describe, expect, it } from 'vitest';
import { CODE_MEANINGS, customText, optionsFor, selectedMeaning } from './codeMeanings';
import { PARTNER_CODE_MAX_LENGTH } from '@trucaco/protocol';

describe('codeMeanings', () => {
  it('todos os significados cabem no limite do servidor', () => {
    for (const m of CODE_MEANINGS)
      expect(m.label.length).toBeLessThanOrEqual(PARTNER_CODE_MAX_LENGTH);
  });

  it('sem combinados, todas as 7 opções aparecem', () => {
    expect(optionsFor('wink', {})).toHaveLength(7);
  });

  it('significado usado por outro sinal some das demais opções; "Nada" sempre fica', () => {
    const codes = { eyebrow: 'ZAP / manilha de paus', nod: '3', smile: '' };
    const labels = optionsFor('wink', codes).map((m) => m.label);
    expect(labels).not.toContain('ZAP / manilha de paus');
    expect(labels).not.toContain('3');
    expect(labels).toContain('');
    expect(labels).toContain('2');
  });

  it('o significado do próprio sinal continua; trocar libera o anterior', () => {
    expect(
      optionsFor('eyebrow', { eyebrow: 'ZAP / manilha de paus' }).map((m) => m.label),
    ).toContain('ZAP / manilha de paus');
    expect(optionsFor('wink', { eyebrow: '2' }).map((m) => m.label)).not.toContain('2');
    expect(optionsFor('wink', { eyebrow: '' }).map((m) => m.label)).toContain('2');
  });

  it('selectedMeaning e customText separam lista, vazio e texto livre antigo', () => {
    expect(selectedMeaning('ZAP / manilha de paus')?.id).toBe('zap');
    expect(selectedMeaning('')?.id).toBe('nada');
    expect(selectedMeaning('tenho o zap')).toBeNull();
    expect(customText('tenho o zap')).toBe('tenho o zap');
    expect(customText('')).toBeNull();
    expect(customText('3')).toBeNull();
  });
});
