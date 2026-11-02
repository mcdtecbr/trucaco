import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { createAnnouncementQueue } from './announcements';
import type { AnnouncementQueueOptions } from './announcements';

export interface Announcer {
  /** Enfileira uma frase para o leitor de tela. */
  readonly announce: (message: string) => void;
  /** Frase atual da região viva (web). Renderize `<LiveRegion message nonce />`. */
  readonly live: { readonly message: string; readonly nonce: number };
}

/**
 * Anunciador com fila. Nativo: `AccessibilityInfo.announceForAccessibility`. Web: devolve a frase
 * atual para o `LiveRegion` (aria-live). A fila é derrubada ao desmontar.
 */
export function useAnnouncer(
  opts: Pick<AnnouncementQueueOptions, 'gapMs' | 'maxPending'> = {},
): Announcer {
  const [live, setLive] = useState({ message: '', nonce: 0 });
  const strategy = Platform.select({ web: 'live', default: 'native' });
  const deliverRef = useRef<(m: string) => void>(() => {});
  deliverRef.current = (m) => {
    if (strategy === 'live') setLive((l) => ({ message: m, nonce: l.nonce + 1 }));
    else AccessibilityInfo.announceForAccessibility(m);
  };

  const { gapMs, maxPending } = opts;
  const queue = useMemo(
    () =>
      createAnnouncementQueue({
        deliver: (m) => deliverRef.current(m),
        ...(gapMs !== undefined ? { gapMs } : {}),
        ...(maxPending !== undefined ? { maxPending } : {}),
      }),
    [gapMs, maxPending],
  );
  useEffect(() => () => queue.dispose(), [queue]);
  return { announce: queue.enqueue, live };
}
