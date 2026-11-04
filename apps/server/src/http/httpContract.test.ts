/**
 * Contrato REST <-> protocol: o conjunto `HTTP_ERROR_CODES` do protocol tem de coincidir com os códigos
 * que o servidor emite (varredura de `errorCodes.contract.test.ts`). Código novo no servidor sem entrada
 * no protocol (ou o inverso) quebra aqui.
 */
import { ERROR_CODES, HTTP_ERROR_CODES, WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type {
  CreateTableResponse,
  GuestAuthResponse,
  HealthResponse,
  JoinTableResponse,
  LogoutRequest,
  MeResponse,
  QueueStatusResponse,
  RefreshResponse,
  SeatReservation,
} from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { WS_BEARER_PROTOCOL as SERVER_BEARER } from '../auth/authService';
import type { AuthService, TokenPair } from '../auth/authService';
import { emittedHttpCodes } from '../errorCodeScan.contract';
import { buildHealth } from '../index';
import type { SeatReservation as ServerReservation, QueueStatus } from '../lobby/lobby';

/**
 * Códigos da Fase 6 declarados no protocol (bloco 6A) e ainda não emitidos pelo servidor. Cada bloco
 * (6B a 6F) remove daqui os que passar a emitir; a lista tem de ficar vazia ao fim da fase.
 */
const PENDING_PHASE6 = [
  'ALREADY_LINKED',
  'INVALID_BLOCK',
  'INVALID_ID_TOKEN',
  'INVALID_REPORT',
  'PROVIDER_TAKEN',
  'SOCIAL_LOGIN_DISABLED',
  'USER_NOT_FOUND',
];

describe('contrato HTTP protocol <-> servidor', () => {
  it('todo item de PENDING_PHASE6 pertence a HTTP_ERROR_CODES', () => {
    for (const c of PENDING_PHASE6) expect(HTTP_ERROR_CODES as readonly string[]).toContain(c);
  });

  it.todo('PENDING_PHASE6 vazio ao fim da fase 6 (bloco 6H)');

  it('HTTP_ERROR_CODES coincide com os códigos emitidos pelo servidor', () => {
    const declared = HTTP_ERROR_CODES.filter((c) => !PENDING_PHASE6.includes(c));
    expect([...declared].sort()).toEqual([...emittedHttpCodes()].sort());
  });

  it('a varredura não ficou vazia', () => {
    expect(emittedHttpCodes().size).toBeGreaterThan(30);
  });

  it('códigos do canal WS e do HTTP só se sobrepõem nos de sentido igual', () => {
    const both = HTTP_ERROR_CODES.filter((c) => (ERROR_CODES as readonly string[]).includes(c));
    expect([...both].sort()).toEqual(['INVALID_CODE', 'RATE_LIMITED', 'ROOM_FULL', 'UNAUTHORIZED']);
  });

  it('subprotocolo vem do protocol (sem duplicata)', () => {
    expect(SERVER_BEARER).toBe(WS_BEARER_PROTOCOL);
  });

  it('tipos de resposta são compatíveis com o que o servidor produz (compile-time)', () => {
    const reservation: SeatReservation = {
      name: 'truco',
      sessionId: 's',
      roomId: 'r',
      reconnectionToken: 'rt',
    };
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
      stats: { paulista: { played: 0, won: 0 }, mineiro: { played: 0, won: 0 } },
    };
    const health: HealthResponse = buildHealth();
    const logoutRefresh: LogoutRequest = { refreshToken: 'r' };
    const logoutAll: LogoutRequest = { all: true };
    // O serviço aceita exatamente a união do protocol.
    const svc: Parameters<AuthService['logout']>[1][] = [logoutRefresh, logoutAll];
    expect([refresh, guest, queueResp, created, joined, me, health]).toHaveLength(7);
    expect(svc).toHaveLength(2);
  });
});
