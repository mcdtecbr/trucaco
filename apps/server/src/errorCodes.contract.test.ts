/**
 * Contrato dos códigos de erro que o servidor emite. NÃO existe catálogo único em código de produção:
 * REST usa literais (`fail`/`failWith`), o handshake de sala usa `ServerError(status, 'CODE')` e o
 * canal WS usa `ErrorCode` do protocolo. Este teste congela o conjunto conhecido (varrendo as fontes):
 * um código novo, ou um código existente com outro status HTTP, quebra aqui e exige decisão explícita.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, validateRoomOptions } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

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
function scanHttp(): Map<string, Set<number>> {
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

/** Catálogo congelado (Fase 2). Chave = código; valor = status HTTP possíveis. */
const KNOWN: Record<string, number[]> = {
  ALREADY_IN_TABLE: [409],
  ALREADY_SEATED: [409],
  BANNED: [403],
  CORS_FORBIDDEN: [403],
  FORBIDDEN: [403],
  INTERNAL: [500],
  INVALID_AVATAR: [400],
  INVALID_BODY: [400],
  INVALID_CODE: [400],
  INVALID_CODES: [400],
  INVALID_INPUT: [400],
  INVALID_JSON: [400],
  INVALID_NICKNAME: [400],
  INVALID_OPTIONS: [400],
  INVALID_PARTNER: [400],
  METHOD_NOT_ALLOWED: [405],
  NICKNAME_TAKEN: [409],
  NOT_FOUND: [404],
  NOT_IMPLEMENTED: [501],
  NOT_PARTNERS: [403],
  PAYLOAD_TOO_LARGE: [413],
  QUEUE_COOLDOWN: [429],
  QUEUE_FULL: [503],
  RATE_LIMITED: [429],
  ROOM_FULL: [409],
  SERVICE_UNAVAILABLE: [503],
  TABLE_UNAVAILABLE: [404],
  UNAUTHORIZED: [401],
  UNAVAILABLE: [503],
  UNSUPPORTED_MEDIA_TYPE: [415],
  USE_LOBBY: [403],
};

describe('catálogo de códigos de erro do servidor', () => {
  const found = scanHttp();
  // Códigos que chegam por variável (não literal) e por isso a varredura não os vê com status.
  const DYNAMIC = ['INVALID_REFRESH_TOKEN'];

  it('todo código de erro HTTP/handshake emitido nas fontes está no catálogo congelado, com o mesmo status', () => {
    const actual = Object.fromEntries(
      [...found.entries()]
        .filter(([c]) => !DYNAMIC.includes(c))
        .map(([c, s]) => [c, [...s].sort()])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
    expect(actual).toEqual(KNOWN);
  });

  it('a varredura não ficou vazia (guarda contra regex quebrada por refatoração)', () => {
    expect(found.size).toBeGreaterThan(25);
    expect(found.get('USE_LOBBY')).toEqual(new Set([403]));
  });

  it('cada código tem um único status HTTP (cliente decide só pelo código)', () => {
    for (const [code, statuses] of found) {
      expect([code, statuses.size]).toEqual([code, 1]);
    }
  });

  it('códigos do canal WS (`error { code }`) vêm só de ERROR_CODES e não colidem com HTTP de outro sentido', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    // Códigos de lobby/REST que NÃO podem aparecer como mensagem WS (o cliente os trata por HTTP).
    for (const httpOnly of [
      'USE_LOBBY',
      'TABLE_UNAVAILABLE',
      'QUEUE_COOLDOWN',
      'ALREADY_IN_TABLE',
    ]) {
      expect(ERROR_CODES as readonly string[]).not.toContain(httpOnly);
    }
    // Os que existem nos dois mundos têm o mesmo sentido (mesmo literal, mesma semântica de recusa).
    for (const both of ['RATE_LIMITED', 'UNAUTHORIZED', 'INVALID_CODE', 'ROOM_FULL']) {
      expect(ERROR_CODES as readonly string[]).toContain(both);
      expect(found.has(both)).toBe(true);
    }
  });

  it('erros dinâmicos de validateRoomOptions (viram 400 em POST /tables, /queue e no onCreate) são só dois e conhecidos', () => {
    const errors = new Set<string>();
    const bad: unknown[] = [
      null,
      [],
      {},
      { variant: 'x', format: 'single', ironHand: true, visibility: 'private' },
      { variant: 'paulista', format: 'bo3', ironHand: true, visibility: 'public' },
      { variant: 'paulista', format: 'single', ironHand: true, visibility: 'private', extra: 1 },
    ];
    for (const raw of bad) {
      const r = validateRoomOptions(raw);
      if (!r.ok) errors.add(r.error);
    }
    expect([...errors].sort()).toEqual(['BO3_REQUIRES_PRIVATE', 'INVALID_OPTIONS']);
  });
});
