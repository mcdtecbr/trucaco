/**
 * Guards de tipo para as respostas REST do lobby consumidas pela UI. O servidor é confiável, mas um
 * proxy/versão diferente não deve virar `undefined.reservation` na tela: só os campos usados são checados.
 */
import { isValidRoomCode } from '@trucaco/protocol';
import type {
  CreateTableResponse,
  JoinTableResponse,
  QueueStatusResponse,
  SeatReservation,
} from '@trucaco/protocol';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

export function isSeatReservation(x: unknown): x is SeatReservation {
  return isRecord(x) && nonEmpty(x['name']) && nonEmpty(x['sessionId']) && nonEmpty(x['roomId']);
}

export function isCreateTableResponse(x: unknown): x is CreateTableResponse {
  return isRecord(x) && isValidRoomCode(x['code']) && isSeatReservation(x['reservation']);
}

export function isJoinTableResponse(x: unknown): x is JoinTableResponse {
  return isRecord(x) && isSeatReservation(x['reservation']);
}

export function isQueueStatusResponse(x: unknown): x is QueueStatusResponse {
  if (!isRecord(x)) return false;
  switch (x['status']) {
    case 'idle':
    case 'seated':
      return true;
    case 'queued':
      return typeof x['expiresAt'] === 'number' && Number.isFinite(x['expiresAt']);
    case 'matched':
      return isSeatReservation(x['reservation']);
    default:
      return false;
  }
}
