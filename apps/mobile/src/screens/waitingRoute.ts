import { normalizeCodeInput } from '../lobby/codeInput';
import type { RoomConnection } from '../store/roomStore';

export type WaitingRoute =
  /** Sem sala: volta ao início com o campo preenchido (nunca entra sozinho). */
  | { kind: 'toHome'; code: string }
  /** Conectado a OUTRA mesa que não a da URL: vai para a mesa certa (sem sair dela). */
  | { kind: 'toCurrent'; code: string }
  | { kind: 'show' };

/**
 * Decide o que a rota `/table/[code]` faz. Só `show` monta a sala de espera (e o cleanup que faz
 * `leave()`): redirecionar nunca pode derrubar uma sala que não é a desta rota.
 */
export function decideWaitingRoute(input: {
  connection: RoomConnection;
  paramCode: unknown;
  roomCode: string;
}): WaitingRoute {
  const param = typeof input.paramCode === 'string' ? normalizeCodeInput(input.paramCode) : '';
  if (input.connection === 'none') return { kind: 'toHome', code: param };
  if (input.roomCode !== '' && param !== input.roomCode) {
    return { kind: 'toCurrent', code: input.roomCode };
  }
  return { kind: 'show' };
}

export interface ExitRouter {
  canGoBack(): boolean;
  back(): void;
  replace(href: '/home'): void;
}

/** Sair da mesa: sala consentida e volta para o início que está embaixo na pilha. */
export function exitTable(rooms: { leave(): Promise<void> }, router: ExitRouter): void {
  void rooms.leave();
  if (router.canGoBack()) router.back();
  else router.replace('/home');
}
