/**
 * Esqueleto do apelido (7A): letras de Latin Extended parecidas com ASCII colidem entre si na troca de
 * apelido, sem tocar nos apelidos que já existem nem nos acentos do português.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from './memoryRepositories';
import { NicknameTakenError } from './types';
import {
  NICKNAME_PATTERN,
  SKELETON_TRANSLATE_FROM,
  SKELETON_TRANSLATE_TO,
  nicknameSkeleton,
  validateNickname,
} from './validation';

describe('nicknameSkeleton', () => {
  it('Latin Extended e letras com barra viram a letra ASCII parecida, em minúsculas', () => {
    expect(nicknameSkeleton('Mıguel')).toBe('miguel'); // i sem ponto
    expect(nicknameSkeleton('Łukasz')).toBe('lukasz');
    expect(nicknameSkeleton('Đorđe')).toBe('dorde');
    expect(nicknameSkeleton('Øyvind')).toBe('oyvind');
    expect(nicknameSkeleton('ĀăĆğŞ')).toBe('aacgs');
    expect(nicknameSkeleton('İsmail')).toBe('lsmail'); // İ -> I -> l
    expect(nicknameSkeleton('ǥuga')).toBe('guga');
  });

  it('acentos do português (Latin-1) continuam distintos: João x Joao, Zé x Ze', () => {
    expect(nicknameSkeleton('João')).not.toBe(nicknameSkeleton('Joao'));
    expect(nicknameSkeleton('Zé')).not.toBe(nicknameSkeleton('Ze'));
    expect(nicknameSkeleton('Conceição')).toBe('conceição');
  });

  it('ASCII só muda a caixa; NFC é aplicada antes (a + til combinante = ã)', () => {
    expect(nicknameSkeleton('Ana_Maria.7-X')).toBe('ana_maria.7-x');
    expect(nicknameSkeleton('João')).toBe(nicknameSkeleton('João'));
  });

  it('não muda o tamanho (1 caractere vira 1), requisito do translate() do Postgres', () => {
    expect([...SKELETON_TRANSLATE_FROM]).toHaveLength([...SKELETON_TRANSLATE_TO].length);
    for (const nick of ['Mıguel', 'Łukasz', 'ĀăĆğŞ', 'Zé_Øl']) {
      expect([...nicknameSkeleton(nick)]).toHaveLength([...nick].length);
    }
  });

  it('I maiúsculo vira l e 0 vira o (falso positivo aceito); ǀ (U+01C0) e afins viram a letra parecida', () => {
    expect(nicknameSkeleton('Ivo')).toBe(nicknameSkeleton('lvo'));
    expect(nicknameSkeleton('Leo')).toBe(nicknameSkeleton('Ieo'));
    expect(nicknameSkeleton('R0b')).toBe('rob');
    expect(nicknameSkeleton('ǀeo')).toBe(nicknameSkeleton('leo'));
    expect(nicknameSkeleton('ǀeo')).toBe('leo');
    expect(nicknameSkeleton('ŀuz')).toBe('luz');
    expect(nicknameSkeleton('ƚuz')).toBe('luz');
    expect(nicknameSkeleton('Ɩvo')).toBe('lvo');
    expect(nicknameSkeleton('ȷoao')).toBe('joao');
    expect(nicknameSkeleton('ɉoao')).toBe('joao');
    expect(nicknameSkeleton('ſol')).toBe('sol');
    expect(nicknameSkeleton('ĸaio')).toBe('kaio');
  });

  it('idempotente e a tabela só produz letra ASCII', () => {
    for (const ch of SKELETON_TRANSLATE_TO) expect(/^[A-Za-z]$/.test(ch)).toBe(true);
    expect(nicknameSkeleton(nicknameSkeleton('Mıguel'))).toBe('miguel');
  });
});

describe('política de apelido novo (NICKNAME_PATTERN)', () => {
  it('recusa Latin Extended fora de NFD+lookalikes: ǀ ȷ ŀ ƚ ɉ ſ ĸ Ɩ e afins', () => {
    for (const bad of [
      'ǀeo',
      'ȷoao',
      'ŀuz',
      'ƚuz',
      'ɉoao',
      'ſol',
      'ĸaio',
      'Ɩvo',
      'ƒox',
      'ǥuga',
      'ƀob',
    ]) {
      expect(() => validateNickname(bad), bad).toThrow();
      expect(NICKNAME_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('aceita ASCII, acentos do português (Latin-1) e letras que decompõem por NFD ou são lookalikes aceitos', () => {
    for (const ok of [
      'Ana_Maria',
      'João',
      'Conceição',
      'Zé.99',
      'Ñandú',
      'Øyvind',
      'Mıguel',
      'Łukasz',
      'Đorđe',
      'Āğǎ',
      'Ŷpsilon',
    ]) {
      expect(validateNickname(ok), ok).toBe(ok.normalize('NFC'));
    }
  });

  it('o que o apelido aceita de Latin Extended sempre tem esqueleto ASCII (ou Latin-1)', () => {
    for (let cp = 0x100; cp <= 0x24f; cp++) {
      const ch = String.fromCodePoint(cp);
      if (!NICKNAME_PATTERN.test(`aa${ch}`)) continue;
      expect(/^[a-z]$/.test(nicknameSkeleton(ch)), `U+${cp.toString(16)}`).toBe(true);
    }
  });
});

describe('troca de apelido por esqueleto (repositório em memória)', () => {
  const setup = async () => {
    const { users } = createMemoryRepositories();
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Miguel' });
    const b = await users.createGuest({ providerSubject: 'b', nickname: 'Visitante1' });
    return { users, a, b };
  };

  it('apelido com letra parecida do apelido de OUTRO jogador é recusado (NICKNAME_TAKEN)', async () => {
    const { users, b } = await setup();
    await expect(users.updateNickname(b.id, validateNickname('Mıguel'))).rejects.toBeInstanceOf(
      NicknameTakenError,
    );
    await expect(users.updateNickname(b.id, 'MIGUEL')).rejects.toBeInstanceOf(NicknameTakenError);
    await users.updateNickname(b.id, 'Miguela');
    expect((await users.findById(b.id))?.nickname).toBe('Miguela');
  });

  it('Ivo x lvo e Ro0 x Roo colidem; ǀeo nem chega a ser aceito (política) e colidiria com leo', async () => {
    const { users, b } = await setup();
    const c = await users.createGuest({ providerSubject: 'c', nickname: 'lvo' });
    await expect(users.updateNickname(b.id, 'Ivo')).rejects.toBeInstanceOf(NicknameTakenError);
    await users.updateNickname(c.id, 'Ro0');
    await expect(users.updateNickname(b.id, 'Roo')).rejects.toBeInstanceOf(NicknameTakenError);
    await expect(users.updateNickname(b.id, 'ǀeo')).rejects.toThrow();
  });

  it('o inverso também: o apelido existente é o parecido, o novo é o ASCII', async () => {
    const { users, a, b } = await setup();
    await users.updateNickname(a.id, 'Łukasz');
    await expect(users.updateNickname(b.id, 'Lukasz')).rejects.toBeInstanceOf(NicknameTakenError);
  });

  it('o próprio jogador pode trocar para a variante do seu apelido (não colide consigo)', async () => {
    const { users, a } = await setup();
    await users.updateNickname(a.id, 'Mıguel');
    expect((await users.findById(a.id))?.nickname).toBe('Mıguel');
  });

  it('acento do português não é bloqueado: João e Joao convivem', async () => {
    const { users, b } = await setup();
    const c = await users.createGuest({ providerSubject: 'c', nickname: 'Joao' });
    await users.updateNickname(b.id, 'João');
    expect((await users.findById(b.id))?.nickname).toBe('João');
    expect((await users.findById(c.id))?.nickname).toBe('Joao');
  });

  it('apelidos que já existem (mesmo esqueleto) não quebram: criação não confere o esqueleto', async () => {
    const { users } = createMemoryRepositories();
    await users.createGuest({ providerSubject: 'x', nickname: 'Pedro' });
    // legado: já existia antes da regra; segue válido e carregável
    const legacy = await users.createGuest({ providerSubject: 'y', nickname: 'Pedrø' });
    expect((await users.findById(legacy.id))?.nickname).toBe('Pedrø');
  });
});

describe('migração do índice de esqueleto', () => {
  it('traz exatamente as tabelas do TypeScript (sem deriva entre SQL e código)', () => {
    const sql = readFileSync(
      new URL(
        '../../prisma/migrations/20261106120000_nickname_skeleton/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toContain(`'${SKELETON_TRANSLATE_FROM}'`);
    expect(sql).toContain(`'${SKELETON_TRANSLATE_TO}'`);
    expect(sql).toContain('CREATE UNIQUE INDEX users_nickname_skeleton_key');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+users/i);
  });
});
