/**
 * Contrato dos códigos de erro que o servidor emite. NÃO existe catálogo único em código de produção:
 * REST usa literais (`fail`/`failWith`), o handshake de sala usa `ServerError(status, 'CODE')` e o
 * canal WS usa `ErrorCode` do protocolo. Este teste congela o conjunto conhecido (varrendo as fontes):
 * um código novo, ou um código existente com outro status HTTP, quebra aqui e exige decisão explícita.
 */
import { ERROR_CODES, ROOM_OPTIONS_ERRORS } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { dynamicCodes, emittedRoomOptionErrors, scanHttp } from './errorCodeScan.contract';

/** Catálogo congelado (Fase 2; Fase 6B acrescentou INVALID_BLOCK, INVALID_REPORT e USER_NOT_FOUND). Chave = código; valor = status HTTP possíveis. */
const KNOWN: Record<string, number[]> = {
  ALREADY_IN_TABLE: [409],
  ALREADY_SEATED: [409],
  BANNED: [403],
  CORS_FORBIDDEN: [403],
  FORBIDDEN: [403],
  INTERNAL: [500],
  INVALID_AVATAR: [400],
  INVALID_BLOCK: [400],
  INVALID_BODY: [400],
  INVALID_CODE: [400],
  INVALID_CODES: [400],
  INVALID_INPUT: [400],
  INVALID_JSON: [400],
  INVALID_NICKNAME: [400],
  INVALID_OPTIONS: [400],
  INVALID_PARTNER: [400],
  INVALID_REPORT: [400],
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
  USER_NOT_FOUND: [404],
  USE_LOBBY: [403],
};

describe('catálogo de códigos de erro do servidor', () => {
  const found = scanHttp();
  // Códigos que chegam por variável (não literal): a varredura literal não os vê (ver `dynamicCodes`).

  it('todo código de erro HTTP/handshake emitido nas fontes está no catálogo congelado, com o mesmo status', () => {
    const actual = Object.fromEntries(
      [...found.entries()]
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

  it('erros dinâmicos de validateRoomOptions (viram 400 em POST /tables, /queue e no onCreate) são só os da lista exportada', () => {
    expect([...emittedRoomOptionErrors()].sort()).toEqual([...ROOM_OPTIONS_ERRORS].sort());
  });

  it('códigos dinâmicos (AuthError e validateRoomOptions) são todos confirmados no código', () => {
    expect([...dynamicCodes()].sort()).toEqual([
      'BO3_REQUIRES_PRIVATE',
      'INVALID_OPTIONS',
      'INVALID_REFRESH_TOKEN',
      'SERVICE_UNAVAILABLE',
      'UNAUTHORIZED',
    ]);
  });
});
