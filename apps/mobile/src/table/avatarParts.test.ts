import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { avatarPartsOf } from './avatarParts';
import { projectTable } from './projectTable';
import { player, snapshot } from './snapshotFixtures';

const custom = { ...DEFAULT_AVATAR_PARTS, hair: 5, skin: 2 };

describe('avatarPartsOf', () => {
  it('lê o JSON do estado e devolve o MESMO objeto para o mesmo texto (avatar memoizado)', () => {
    const raw = JSON.stringify(custom);
    const a = avatarPartsOf(raw);
    expect(a).toEqual(custom);
    expect(avatarPartsOf(raw)).toBe(a);
    expect(avatarPartsOf(JSON.stringify(custom))).toBe(a);
  });

  it('vazio, ausente, JSON inválido, chave extra e índice fora do catálogo caem no padrão', () => {
    for (const raw of [
      '',
      '{}',
      '{lixo',
      undefined,
      null,
      42,
      JSON.stringify({ ...custom, glasses: 1 }),
      JSON.stringify({ ...custom, hair: 99 }),
      JSON.stringify({ ...custom, hair: '1' }),
      'null',
      '[1]',
    ]) {
      expect(avatarPartsOf(raw)).toBe(DEFAULT_AVATAR_PARTS);
    }
  });

  it('a projeção da mesa expõe as partes por assento e mantém a identidade entre patches', () => {
    const state = snapshot({
      players: [0, 1, 2, 3].map((i) =>
        player(i, { avatar: i === 1 ? JSON.stringify(custom) : '{}' }),
      ),
    });
    const a = projectTable(state);
    const b = projectTable(state);
    expect(a.seats[1]?.avatar).toEqual(custom);
    expect(a.seats[0]?.avatar).toBe(DEFAULT_AVATAR_PARTS);
    expect(b.seats[1]?.avatar).toBe(a.seats[1]?.avatar);
  });
});
