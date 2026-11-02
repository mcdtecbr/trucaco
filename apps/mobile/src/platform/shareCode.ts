import { Share } from 'react-native';

export const SHARE_LABEL = 'Compartilhar código';

/** Nativo: folha de compartilhamento do sistema (sem dependência extra de área de transferência). */
export async function shareCode(code: string): Promise<boolean> {
  try {
    const res = await Share.share({
      message: `Venha jogar truco comigo no Trucaco! Código da mesa: ${code}`,
    });
    return res.action === Share.sharedAction;
  } catch {
    return false;
  }
}
