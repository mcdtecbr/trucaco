/**
 * Desbloqueio de áudio no web: navegadores só liberam som depois de um gesto do usuário (toque, clique,
 * tecla). Escuta o PRIMEIRO gesto, chama `unlock` uma vez e se desinscreve. Não consome nem impede o
 * evento (o clique segue para o botão normalmente), então o E2E não muda.
 */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
}

export const GESTURE_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'click'] as const;

/** Devolve a função que cancela a escuta. */
export function unlockOnFirstGesture(target: GestureTarget, unlock: () => void): () => void {
  let done = false;
  const cancel = (): void => {
    for (const t of GESTURE_EVENTS) target.removeEventListener(t, handler, { capture: true });
  };
  const handler = (): void => {
    if (done) return;
    done = true;
    cancel();
    unlock();
  };
  for (const t of GESTURE_EVENTS) target.addEventListener(t, handler, { capture: true });
  return () => {
    done = true;
    cancel();
  };
}
