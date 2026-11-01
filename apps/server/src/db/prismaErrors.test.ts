import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client';
import { constraintNameOf, translateDbError } from './prismaErrors';
import {
  InvalidInputError,
  NicknameTakenError,
  PersistenceError,
  ProviderSubjectTakenError,
} from './types';

const SECRET = 'CARTA-SECRETA-4C-7H';

/** Forma real do erro com driver adapter (Prisma 7.10 + adapter-pg), incluindo a linha inteira. */
function prismaError(
  code: string,
  cause: Record<string, unknown>,
  message = `Invalid invocation ${SECRET}`,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    meta: { modelName: 'Match', driverAdapterError: { name: 'DriverAdapterError', cause } },
  });
}

const checkCause = {
  originalCode: '23514',
  originalMessage:
    'new row for relation "matches" violates check constraint "matches_status_winner_check"',
  kind: 'postgres',
  code: '23514',
  message: 'new row for relation "matches" violates check constraint "matches_status_winner_check"',
  detail: `Failing row contains (x, ${SECRET}).`,
};

function everythingOf(error: Error): string {
  const props = Object.getOwnPropertyNames(error).map((k) => String(Reflect.get(error, k)));
  return [error.message, error.stack ?? '', JSON.stringify(error), ...props].join('\n');
}

describe('nome da constraint', () => {
  it('lê o campo estruturado (string ou { index }) antes de olhar texto', () => {
    expect(constraintNameOf(prismaError('P2002', { constraint: { index: 'a_key' } }))).toBe(
      'a_key',
    );
    expect(constraintNameOf(prismaError('P2003', { constraint: 'b_fkey' }))).toBe('b_fkey');
    // O campo estruturado vence um texto que cite outra constraint.
    expect(
      constraintNameOf(
        prismaError('P2002', { constraint: { index: 'a_key' }, message: 'constraint "outra"' }),
      ),
    ).toBe('a_key');
  });

  it('CHECK não traz o campo: fallback pelo texto padrão do Postgres e pela mensagem', () => {
    expect(constraintNameOf(prismaError('P2039', checkCause))).toBe('matches_status_winner_check');
    expect(
      constraintNameOf(
        prismaError('P2002', {}, 'failed on the constraint: `users_nickname_lower_key`'),
      ),
    ).toBe('users_nickname_lower_key');
    expect(constraintNameOf(new Error('nada'))).toBeNull();
    // Nunca devolve texto livre que possa carregar valores.
    expect(
      constraintNameOf(prismaError('P2002', { constraint: { index: `x ${SECRET}` } })),
    ).toBeNull();
  });
});

describe('translateDbError', () => {
  it('unicidade conhecida vira erro de domínio; desconhecida vira InvalidInputError com o nome', () => {
    expect(
      translateDbError(prismaError('P2002', { constraint: { index: 'users_nickname_lower_key' } })),
    ).toBeInstanceOf(NicknameTakenError);
    expect(
      translateDbError(
        prismaError('P2002', { constraint: { index: 'users_provider_provider_subject_key' } }),
      ),
    ).toBeInstanceOf(ProviderSubjectTakenError);
    const other = translateDbError(prismaError('P2002', { constraint: { index: 'outra_key' } }));
    expect(other).toBeInstanceOf(InvalidInputError);
    expect((other as InvalidInputError).constraint).toBe('outra_key');
  });

  it('CHECK, FK e uuid inválido viram InvalidInputError sem meta, detail, cause nem valores', () => {
    for (const err of [
      prismaError('P2039', checkCause),
      prismaError('P2003', { constraint: { index: 'match_players_user_id_fkey' } }),
      prismaError('P2007', { message: `invalid input syntax for type uuid: "${SECRET}"` }),
    ]) {
      const out = translateDbError(err);
      expect(out).toBeInstanceOf(InvalidInputError);
      expect(everythingOf(out)).not.toContain(SECRET);
      expect(Object.getOwnPropertyNames(out).sort()).toEqual(
        ['constraint', 'message', 'name', 'stack'].sort(),
      );
      expect(Reflect.get(out, 'cause')).toBeUndefined();
      expect(Reflect.get(out, 'meta')).toBeUndefined();
    }
    expect(
      (translateDbError(prismaError('P2039', checkCause)) as InvalidInputError).constraint,
    ).toBe('matches_status_winner_check');
  });

  it('qualquer outra falha vira PersistenceError saneado (só code e constraint)', () => {
    const known = translateDbError(prismaError('P2028', { message: SECRET }));
    expect(known).toBeInstanceOf(PersistenceError);
    expect((known as PersistenceError).code).toBe('P2028');
    expect(everythingOf(known)).not.toContain(SECRET);

    const validation = translateDbError(
      new Prisma.PrismaClientValidationError(`Argument deals: ${SECRET}`, {
        clientVersion: 'test',
      }),
    );
    expect(validation).toBeInstanceOf(PersistenceError);
    expect((validation as PersistenceError).code).toBe('PrismaClientValidationError');
    expect(everythingOf(validation)).not.toContain(SECRET);

    const generic = translateDbError(new Error(`conexão ${SECRET}`));
    expect(generic).toBeInstanceOf(PersistenceError);
    expect(everythingOf(generic)).not.toContain(SECRET);
  });

  it('erros de domínio passam como estão', () => {
    const e = new InvalidInputError('x');
    expect(translateDbError(e)).toBe(e);
  });
});
