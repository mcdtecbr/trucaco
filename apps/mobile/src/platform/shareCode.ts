import { Share } from 'react-native';
import { outcomeFromShareAction } from './shareOutcome';
import type { ShareOutcome } from './shareOutcome';

export const SHARE_LABEL = 'Compartilhar código';
export const SHARE_DONE_TEXT = 'Compartilhado.';
export const SHARE_FAILED_TEXT = 'Não foi possível compartilhar. Anote o código acima.';

/** Nativo: folha de compartilhamento do sistema (sem dependência extra de área de transferência). */
export async function shareCode(code: string): Promise<ShareOutcome> {
  try {
    const res = await Share.share({
      message: `Venha jogar truco comigo no Trucaço! Código da mesa: ${code}`,
    });
    return outcomeFromShareAction(res.action);
  } catch {
    return 'failed';
  }
}
