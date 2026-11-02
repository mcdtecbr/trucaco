import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { createAnnouncementQueue } from './announcements';
import type { AnnouncementQueue, AnnouncementQueueOptions } from './announcements';

export interface Announcer {
  /** Enfileira uma frase para o leitor de tela. */
  readonly announce: (message: string) => void;
  /** Frase atual da região viva (web). Renderize `<LiveRegion message nonce />`. */
  readonly live: { readonly message: string; readonly nonce: number };
}

type QueueOptions = Pick<AnnouncementQueueOptions, 'gapMs' | 'maxPending'>;

export interface AnnouncerBinding {
  /** Estável entre renders; descarta a frase se a fila não está ligada (antes do mount / após o unmount). */
  readonly announce: (message: string) => void;
  /** Cria a fila (nova a cada chamada) e devolve o cleanup que a derruba. Chamar de dentro de `useEffect`. */
  readonly attach: (deliver: (message: string) => void) => () => void;
}

/**
 * Liga/desliga a fila de anúncios. Separado do hook para ser testável sem renderer: a fila nasce
 * no `attach` (efeito) e morre no cleanup, então mount, unmount, mount (StrictMode) recria uma fila viva.
 */
export function createAnnouncerBinding(opts: QueueOptions = {}): AnnouncerBinding {
  let queue: AnnouncementQueue | null = null;
  return {
    announce: (message) => queue?.enqueue(message),
    attach: (deliver) => {
      const mine = createAnnouncementQueue({
        deliver,
        ...(opts.gapMs !== undefined ? { gapMs: opts.gapMs } : {}),
        ...(opts.maxPending !== undefined ? { maxPending: opts.maxPending } : {}),
      });
      queue = mine;
      return () => {
        mine.dispose();
        if (queue === mine) queue = null;
      };
    },
  };
}

/**
 * Anunciador com fila. Nativo: `AccessibilityInfo.announceForAccessibility`. Web: devolve a frase
 * atual para o `LiveRegion` (aria-live). A fila é criada no efeito e derrubada ao desmontar
 * (sobrevive ao StrictMode). Frases anunciadas antes do primeiro efeito são descartadas.
 */
export function useAnnouncer(opts: QueueOptions = {}): Announcer {
  const [live, setLive] = useState({ message: '', nonce: 0 });
  const strategy = Platform.select({ web: 'live', default: 'native' });
  const deliverRef = useRef<(m: string) => void>(() => {});
  deliverRef.current = (m) => {
    if (strategy === 'live') setLive((l) => ({ message: m, nonce: l.nonce + 1 }));
    else AccessibilityInfo.announceForAccessibility(m);
  };

  const { gapMs, maxPending } = opts;
  const binding = useMemo(
    () =>
      createAnnouncerBinding({
        ...(gapMs !== undefined ? { gapMs } : {}),
        ...(maxPending !== undefined ? { maxPending } : {}),
      }),
    [gapMs, maxPending],
  );
  useEffect(() => binding.attach((m) => deliverRef.current(m)), [binding]);
  return { announce: binding.announce, live };
}
