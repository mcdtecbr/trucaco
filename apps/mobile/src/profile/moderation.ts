/**
 * Bloquear e denunciar: transições de estado do painel (puro, só depende da API injetada). A UI mostra o
 * resultado; o servidor decide tudo (limites, "a si mesmo", partida em comum).
 */
import type { ApiClient } from '../net/api';
import { messageForError } from '../i18n/errors';
import type { ModerationState, ModerationTarget } from '../screens/ModerationPanel';

export const BLOCKED_DONE_TEXT =
  'Jogador bloqueado. Vale na fila pública e nas próximas mesas; não afeta a partida em andamento.';
export const REPORT_DONE_TEXT = 'Denúncia enviada. Obrigado por ajudar a manter a mesa limpa.';

export function openModeration(
  mode: ModerationState['mode'],
  target: ModerationTarget,
): ModerationState {
  return { mode, target, reason: null, text: '', busy: false, error: null, done: null };
}

export async function submitModeration(
  state: ModerationState,
  api: Pick<ApiClient, 'block' | 'report'>,
): Promise<ModerationState> {
  if (state.busy || state.done !== null) return state;
  const { target } = state;
  try {
    if (state.mode === 'block') {
      await api.block(target.userId);
      return { ...state, busy: false, error: null, done: BLOCKED_DONE_TEXT };
    }
    if (state.reason === null) return state;
    const text = state.text.trim();
    await api.report({
      userId: target.userId,
      matchId: target.matchId,
      reason: state.reason,
      ...(text !== '' ? { text } : {}),
    });
    return { ...state, busy: false, error: null, done: REPORT_DONE_TEXT };
  } catch (e) {
    return { ...state, busy: false, error: messageForError(e), done: null };
  }
}
