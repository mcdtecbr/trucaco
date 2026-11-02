/**
 * Varredura compartilhada de `errorCodes.contract.test.ts` e `http/httpContract.test.ts`: descobre, nas
 * fontes de produção do servidor, os códigos de erro HTTP/handshake emitidos. Sufixo `.contract.ts`:
 * fica fora da própria varredura.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_OPTIONS_ERRORS, validateRoomOptions } from '@trucaco/protocol';
import { AUTH_ERROR_CODES } from './auth/authService';

export const SRC = dirname(fileURLToPath(import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'generated') return [];
    if (statSync(p).isDirectory()) return sources(p);
    return /\.ts$/.test(name) && !/\.test\.ts$|\.contract\.ts$|testkit|testRedis/.test(name)
      ? [p]
      : [];
  });
}

/** Códigos HTTP literais -> conjunto de status em que aparecem. */
export function scanHttp(): Map<string, Set<number>> {
  const found = new Map<string, Set<number>>();
  const add = (code: string, status: number): void => {
    found.set(code, (found.get(code) ?? new Set<number>()).add(status));
  };
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bfail\(res, (\d{3}), '([A-Z_]+)'\)/g)) add(m[2]!, Number(m[1]));
    for (const m of text.matchAll(/new ServerError\((\d{3}), '([A-Z_]+)'\)/g)) {
      add(m[2]!, Number(m[1]));
    }
    for (const m of text.matchAll(/failWith\(res, '([A-Z_]+)', (\d{3})\)/g)) {
      add(m[1]!, Number(m[2]));
    }
  }
  // Tabela STATUS de lobbyRoutes.ts (LobbyError -> HTTP).
  const routes = readFileSync(join(SRC, 'http/lobbyRoutes.ts'), 'utf8');
  const table = /const STATUS[^{]*\{([^}]*)\}/.exec(routes)?.[1] ?? '';
  for (const m of table.matchAll(/([A-Z_]+): (\d{3})/g)) add(m[1]!, Number(m[2]));
  return found;
}

/** Entradas inválidas que cobrem todos os erros de `validateRoomOptions`. */
const BAD_ROOM_OPTIONS: readonly unknown[] = [
  null,
  [],
  {},
  { variant: 'x', format: 'single', ironHand: true, visibility: 'private' },
  { variant: 'paulista', format: 'bo3', ironHand: true, visibility: 'public' },
  { variant: 'paulista', format: 'single', ironHand: true, visibility: 'private', extra: 1 },
];

/** Erros que `validateRoomOptions` DE FATO devolve (executa; não confia na lista). */
export function emittedRoomOptionErrors(): Set<string> {
  const errors = new Set<string>();
  for (const raw of BAD_ROOM_OPTIONS) {
    const r = validateRoomOptions(raw);
    if (!r.ok) errors.add(r.error);
  }
  return errors;
}

/** Códigos de `AuthError` que o servidor lança de verdade (`new AuthError('X')` nas fontes). */
export function emittedAuthCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/new AuthError\('([A-Z_]+)'\)/g)) found.add(m[1]!);
  }
  return found;
}

/**
 * Códigos que chegam por variável, derivados das listas `as const` e confirmados no código: se o
 * servidor deixar de emitir, o código some daqui.
 */
export function dynamicCodes(): Set<string> {
  const auth = emittedAuthCodes();
  const room = emittedRoomOptionErrors();
  return new Set([
    ...AUTH_ERROR_CODES.filter((c) => auth.has(c)),
    ...ROOM_OPTIONS_ERRORS.filter((c) => room.has(c)),
  ]);
}

/** Tudo que o servidor emite como código HTTP/handshake: literais + dinâmicos. */
export function emittedHttpCodes(): Set<string> {
  return new Set([...scanHttp().keys(), ...dynamicCodes()]);
}
