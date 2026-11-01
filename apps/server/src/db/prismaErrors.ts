import { Prisma } from '../generated/prisma/client';
import {
  InvalidInputError,
  NicknameTakenError,
  NotPartnersError,
  PersistenceError,
  ProviderSubjectTakenError,
} from './types';

export const NICKNAME_CONSTRAINT = 'users_nickname_lower_key';
export const PROVIDER_CONSTRAINT = 'users_provider_provider_subject_key';

const SAFE_NAME = /^[A-Za-z0-9_]{1,63}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Nome da constraint violada, lido do campo estruturado do driver adapter
 * (`meta.driverAdapterError.cause.constraint`: string, ou `{ index }` nas violações de unicidade).
 * Sem esse campo (CHECK não o traz), cai para o texto padrão do Postgres
 * (`... constraint "nome"`) na mensagem original do driver. Só devolve identificadores simples:
 * nunca um trecho livre do erro, que poderia conter valores.
 */
export function constraintNameOf(error: unknown): string | null {
  const err = record(error);
  const cause = record(record(record(err?.['meta'])?.['driverAdapterError'])?.['cause']);
  const structured = cause?.['constraint'];
  const candidates: unknown[] = [structured, record(structured)?.['index']];
  for (const c of candidates) {
    if (typeof c === 'string' && SAFE_NAME.test(c)) return c;
  }
  const texts = [cause?.['originalMessage'], cause?.['message'], err?.['message']];
  for (const t of texts) {
    if (typeof t !== 'string') continue;
    const m = /constraint[: ]+[`"]([A-Za-z0-9_]{1,63})[`"]/.exec(t);
    if (m?.[1] !== undefined) return m[1];
  }
  return null;
}

/** Códigos Prisma que significam "o banco recusou esta entrada" (e não "o banco falhou"). */
const INPUT_CODES = new Set([
  'P2000',
  'P2002',
  'P2003',
  'P2004',
  'P2007',
  'P2011',
  'P2012',
  'P2039',
]);

/**
 * Converte QUALQUER falha de uma chamada Prisma de escrita em erro de domínio saneado: só `code`
 * e nome da constraint, sem `cause`/`meta`/`detail`/valores. O erro bruto do Prisma é descartado
 * porque carrega a linha inteira ("Failing row contains ...", incluindo `deals`).
 */
export function translateDbError(error: unknown): Error {
  if (
    error instanceof InvalidInputError ||
    error instanceof NicknameTakenError ||
    error instanceof ProviderSubjectTakenError ||
    error instanceof NotPartnersError ||
    error instanceof PersistenceError
  ) {
    return error;
  }
  const constraint = constraintNameOf(error);
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      if (constraint === NICKNAME_CONSTRAINT) return new NicknameTakenError();
      if (constraint === PROVIDER_CONSTRAINT) return new ProviderSubjectTakenError();
      return new InvalidInputError('Registro duplicado.', constraint);
    }
    if (error.code === 'P2003') {
      return new InvalidInputError('Usuário ou partida inexistente.', constraint);
    }
    if (INPUT_CODES.has(error.code)) {
      return new InvalidInputError('Entrada recusada pelo banco.', constraint);
    }
    return new PersistenceError(error.code, constraint);
  }
  const name = error instanceof Error ? error.name : 'unknown';
  return new PersistenceError(SAFE_NAME.test(name) ? name : 'unknown', constraint);
}

/** Executa uma escrita Prisma relançando só erros de domínio saneados. */
export async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw translateDbError(error);
  }
}
