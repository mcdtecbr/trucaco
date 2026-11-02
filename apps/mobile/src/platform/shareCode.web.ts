import type { ShareOutcome } from './shareOutcome';

export const SHARE_LABEL = 'Copiar código';
export const SHARE_DONE_TEXT = 'Código copiado.';
export const SHARE_FAILED_TEXT = 'Não foi possível copiar. Anote o código acima.';

/** Web: área de transferência. `failed` se o navegador recusar (sem HTTPS, sem permissão). */
export async function shareCode(code: string): Promise<ShareOutcome> {
  try {
    await navigator.clipboard.writeText(code);
    return 'done';
  } catch {
    return 'failed';
  }
}
