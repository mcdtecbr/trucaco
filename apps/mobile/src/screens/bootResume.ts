/**
 * Decisão do splash depois que a sessão ficou válida: voltar à mesa (reload da página, reabertura do
 * app) ou seguir para o início. Sem React: o `BootScreen` só aplica o resultado.
 */
import type { ResumeFailure, TableResumeController } from '../room/tableResume';
import type { LobbyResumeNotice } from '../store/lobbyStore';

export type BootDecision =
  /** Sem mesa guardada (ou de outro usuário): fluxo normal para o início. */
  | {
      readonly kind: 'home';
      readonly notice: LobbyResumeNotice;
      /** Código da mesa que não voltou: a tela inicial preenche o campo para tentar entrar. */
      readonly code?: string;
    }
  /** De volta ao assento: vai direto para a mesa. */
  | { readonly kind: 'table'; readonly code: string }
  /** A sessão acabou durante a retomada: a splash reinicia a sessão e segue para o início. */
  | { readonly kind: 'restartSession' };

export function noticeFor(reason: ResumeFailure): LobbyResumeNotice {
  return reason === 'unavailable' ? 'tableUnavailable' : 'tableLost';
}

export async function decideBoot(
  resume: TableResumeController,
  hooks: {
    onResuming(): void;
    /**
     * Código da sala já conectada (a sessão voltou de `unavailable` com o jogador à mesa, ou a retomada
     * acabou de dar certo e a splash remontou): nunca retomar por cima, volta para ELA.
     */
    heldRoomCode?(): string | null;
  },
): Promise<BootDecision> {
  const held = hooks.heldRoomCode?.();
  if (held !== undefined && held !== null) {
    return held === '' ? { kind: 'home', notice: null } : { kind: 'table', code: held };
  }
  let pending;
  try {
    pending = await resume.pending();
  } catch {
    pending = null;
  }
  if (pending === null) return { kind: 'home', notice: null };
  hooks.onResuming();
  const outcome = await resume.run();
  if (outcome.kind === 'resumed') return { kind: 'table', code: outcome.code };
  if (outcome.kind === 'none') return { kind: 'home', notice: null };
  if (outcome.reason === 'session') return { kind: 'restartSession' };
  return { kind: 'home', notice: noticeFor(outcome.reason), code: pending.code };
}
