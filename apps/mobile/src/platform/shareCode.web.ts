export const SHARE_LABEL = 'Copiar código';

/** Web: área de transferência. Devolve false se o navegador recusar (sem HTTPS, sem permissão). */
export async function shareCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}
