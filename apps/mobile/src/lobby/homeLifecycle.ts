import type { LobbyController } from './lobbyController';
import { normalizeCodeInput } from './codeInput';
import type { LobbyStore } from '../store/lobbyStore';

/**
 * Ciclo de vida da tela inicial (testável sem React): ao montar limpa erro e aviso de visitas
 * anteriores; o retorno (cleanup do efeito) cancela o polling e sai da fila no servidor.
 */
export function startHome(controller: LobbyController, store: LobbyStore): () => void {
  store.getState().setError(null);
  store.getState().setNotice(null);
  return () => controller.dispose();
}

/**
 * Deep link `trucaco://table/CODE`: o parâmetro só PREENCHE o campo. Entrar na mesa é sempre uma ação do
 * usuário (nenhum caminho daqui chama a rede).
 */
export function prefillCode(param: unknown): string {
  return typeof param === 'string' ? normalizeCodeInput(param) : '';
}
