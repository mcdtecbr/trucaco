import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabaseUrl } from './testDatabase';

describe('trava do banco de teste', () => {
  it('aceita host local com banco descartável', () => {
    for (const url of [
      'postgresql://u:p@localhost:5432/trucaco_test',
      'postgresql://u@127.0.0.1:5437/trucaco_verif',
      'postgres://u@[::1]:5432/meu_TEST_db',
    ]) {
      expect(assertSafeTestDatabaseUrl(url)).toBe(url);
    }
  });

  it('recusa ausente, malformada, host remoto, nome de produção e host por parâmetro', () => {
    for (const url of [
      undefined,
      '',
      'lixo',
      'mysql://u@localhost/trucaco_test',
      'postgresql://u:senha@db.exemplo.com:5432/trucaco_test',
      'postgresql://u@localhost.exemplo.com/trucaco_test',
      'postgresql://u@10.0.0.5/trucaco_test',
      'postgresql://u:p@localhost:5432/trucaco',
      'postgresql://u@localhost/postgres',
      'postgresql://u@localhost/trucaco_test?host=db.exemplo.com',
      'postgresql://u@localhost/trucaco_test?hostaddr=10.0.0.5',
    ]) {
      expect(() => assertSafeTestDatabaseUrl(url), String(url)).toThrow();
    }
  });

  it('a mensagem de erro não vaza a senha', () => {
    expect(() => assertSafeTestDatabaseUrl('postgresql://u:SEGREDO@db.exemplo.com/x')).toThrow(
      /^((?!SEGREDO).)*$/s,
    );
  });
});
