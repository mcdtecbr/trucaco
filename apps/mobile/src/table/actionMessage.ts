/**
 * Ação legal (id do servidor) -> mensagem Colyseus. Só traduz formato; quem decide se a ação existe é
 * o servidor (`legalActions`). O payload nunca leva `seat`.
 */
import { parseClientMessage, parseLegalAction } from '@trucaco/protocol';
import type { ClientMessage } from '@trucaco/protocol';

export function messageForAction(actionId: string): ClientMessage | null {
  const a = parseLegalAction(actionId);
  if (a === null) return null;
  let msg: ClientMessage;
  switch (a.kind) {
    case 'play':
      msg = { type: 'play', card: a.card };
      break;
    case 'playCovered':
      msg = { type: 'play', card: a.card, covered: true };
      break;
    case 'playBlind':
      msg = { type: 'playBlind', index: a.index };
      break;
    case 'bet':
    case 'accept':
    case 'run':
      msg = { type: a.kind };
      break;
    case 'specialPlay':
      msg = { type: 'special', decision: 'play' };
      break;
    case 'specialRun':
      msg = { type: 'special', decision: 'run' };
      break;
  }
  // Mesma porta de entrada do servidor: uma mensagem que ela recusaria nem sai do aparelho.
  return parseClientMessage(msg).ok ? msg : null;
}

/** Payload de `room.send(type, payload)`: a mensagem sem o `type`. */
export function payloadOf(msg: ClientMessage): Record<string, unknown> {
  const { type: _type, ...rest } = msg as ClientMessage & Record<string, unknown>;
  void _type;
  return rest;
}
