/**
 * Contrato REST <-> protocol: o conjunto `HTTP_ERROR_CODES` do protocol tem de coincidir com os códigos
 * que o servidor emite (varredura de `errorCodes.contract.test.ts`). Código novo no servidor sem entrada
 * no protocol (ou o inverso) quebra aqui.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, HTTP_ERROR_CODES, WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type {
  CreateTableResponse,
  GuestAuthResponse,
  HealthResponse,
  JoinTableResponse,
  MeResponse,
  QueueStatusResponse,
  RefreshResponse,
  SeatReservation,
} from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { WS_BEARER_PROTOCOL as SERVER_BEARER } from '../auth/authService';
import type { TokenPair } from '../auth/authService';
import { buildHealth } from '../index';
import type { SeatReservation as ServerReservation, QueueStatus } from '../lobby/lobby';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function emittedCodes(): Set<string> {
  const found = new Set<string>();
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bfail\(res, \d{3}, '([A-Z_]+)'\)/g)) found.add(m[1]!);
    for (const m of text.matchAll(/new ServerError\(\d{3}, '([A-Z_]+)'\)/g)) found.add(m[1]!);
    for (const m of text.matchAll(/failWith\(res, '([A-Z_]+)', \d{3}\)/g)) found.add(m[1]!);
  }
  const routes = readFileSync(join(SRC, 'http/lobbyRoutes.ts'), 'utf8');
  const table = /const STATUS[^{]*\{([^}]*)\}/.exec(routes)?.[1] ?? '';
  for (const m of table.matchAll(/([A-Z_]+): \d{3}/g)) found.add(m[1]!);
  // Emitidos por variável (AuthError.code / validateRoomOptions), não visíveis à varredura literal.
  found.add('INVALID_REFRESH_TOKEN');
  found.add('BO3_REQUIRES_PRIVATE');
  return found;
}

describe('contrato HTTP protocol <-> servidor', () => {
  it('HTTP_ERROR_CODES coincide com os códigos emitidos pelo servidor', () => {
    expect([...HTTP_ERROR_CODES].sort()).toEqual([...emittedCodes()].sort());
  });

  it('a varredura não ficou vazia', () => {
    expect(emittedCodes().size).toBeGreaterThan(30);
  });

  it('códigos do canal WS e do HTTP só se sobrepõem nos de sentido igual', () => {
    const both = HTTP_ERROR_CODES.filter((c) => (ERROR_CODES as readonly string[]).includes(c));
    expect([...both].sort()).toEqual(['INVALID_CODE', 'RATE_LIMITED', 'ROOM_FULL', 'UNAUTHORIZED']);
  });

  it('subprotocolo vem do protocol (sem duplicata)', () => {
    expect(SERVER_BEARER).toBe(WS_BEARER_PROTOCOL);
  });

  it('tipos de resposta são compatíveis com o que o servidor produz (compile-time)', () => {
    const reservation: SeatReservation = { name: 'truco', sessionId: 's', roomId: 'r' };
    // Reserva do servidor (3 campos tipados) cabe no tipo do protocol.
    const fromServer: ServerReservation = reservation;
    const asProtocol: SeatReservation = fromServer;
    const pair: TokenPair = { accessToken: 'a', refreshToken: 'b', expiresIn: 900 };
    const refresh: RefreshResponse = pair;
    const guest: GuestAuthResponse = { user: { id: 'u', nickname: 'n' }, ...pair };
    const queue: QueueStatus = { status: 'matched', reservation: asProtocol };
    const queueResp: QueueStatusResponse = queue;
    const created: CreateTableResponse = { code: 'ABCDEFGH', reservation };
    const joined: JoinTableResponse = { reservation };
    const me: MeResponse = {
      id: 'u',
      nickname: 'n',
      provider: 'guest',
      avatar: null,
      createdAt: new Date(0).toISOString(),
    };
    const health: HealthResponse = buildHealth();
    expect([refresh, guest, queueResp, created, joined, me, health]).toHaveLength(7);
  });
});
