import { describe, expect, it } from 'vitest';
import {
  isCreateTableResponse,
  isJoinTableResponse,
  isQueueStatusResponse,
  isSeatReservation,
} from './guards';

const reservation = { name: 'truco', sessionId: 's1', roomId: 'r1', processId: 'p' };

describe('guards das respostas do lobby', () => {
  it('reserva exige name, sessionId e roomId não vazios', () => {
    expect(isSeatReservation(reservation)).toBe(true);
    expect(isSeatReservation({ ...reservation, roomId: '' })).toBe(false);
    expect(isSeatReservation({ name: 'x' })).toBe(false);
    expect(isSeatReservation(null)).toBe(false);
    expect(isSeatReservation([])).toBe(false);
  });
  it('criar mesa exige código válido e reserva', () => {
    expect(isCreateTableResponse({ code: 'ABCDEFGH', reservation })).toBe(true);
    expect(isCreateTableResponse({ code: 'abc', reservation })).toBe(false);
    expect(isCreateTableResponse({ code: 'ABCDEFGH' })).toBe(false);
  });
  it('entrar exige reserva', () => {
    expect(isJoinTableResponse({ reservation })).toBe(true);
    expect(isJoinTableResponse({})).toBe(false);
  });
  it('fila: cada status com seus campos', () => {
    expect(isQueueStatusResponse({ status: 'idle' })).toBe(true);
    expect(isQueueStatusResponse({ status: 'seated' })).toBe(true);
    expect(isQueueStatusResponse({ status: 'queued', expiresAt: 5 })).toBe(true);
    expect(isQueueStatusResponse({ status: 'queued' })).toBe(false);
    expect(isQueueStatusResponse({ status: 'queued', expiresAt: Number.NaN })).toBe(false);
    expect(isQueueStatusResponse({ status: 'matched', reservation })).toBe(true);
    expect(isQueueStatusResponse({ status: 'matched' })).toBe(false);
    expect(isQueueStatusResponse({ status: 'outro' })).toBe(false);
    expect(isQueueStatusResponse(undefined)).toBe(false);
  });
});
