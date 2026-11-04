import { useEffect, useState } from 'react';
import type { AudioService } from './audioService';
import type { AudioPrefs } from './prefs';

/** Preferências de som deste aparelho como estado de React (assina o `AudioService`). */
export function useAudioPrefs(audio: AudioService): AudioPrefs {
  const [prefs, setPrefs] = useState<AudioPrefs>(() => audio.getPrefs());
  useEffect(() => {
    // `hydrate` pode ter terminado entre o primeiro render e a assinatura.
    setPrefs(audio.getPrefs());
    return audio.subscribe(setPrefs);
  }, [audio]);
  return prefs;
}
