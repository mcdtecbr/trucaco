/**
 * Backend real: `expo-audio` (iOS, Android e web). Só os arquivos `platform.web.ts` e `platform.native.ts`
 * importam este módulo (o Vitest nunca carrega `expo-audio`). Um player por arquivo, reaproveitado:
 * `play` volta ao início, e sons diferentes tocam sobrepostos.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioBackend } from './audioService';

let modeSet = false;

async function configureOnce(): Promise<void> {
  if (modeSet) return;
  modeSet = true;
  try {
    // Toca mesmo com o aparelho no silencioso (iOS) e mistura com outros apps (música do usuário).
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
  } catch {
    // O modo é um refinamento: sem ele o som toca com os padrões da plataforma.
  }
}

export const expoAudioBackend: AudioBackend = {
  async load(source) {
    await configureOnce();
    const player = createAudioPlayer(source);
    return {
      play(volume) {
        player.volume = volume;
        // `seekTo` é assíncrono: tocar só depois dele (ou se ele falhar), senão o início pode ser cortado.
        void player.seekTo(0).then(
          () => player.play(),
          () => player.play(),
        );
      },
      release() {
        player.remove();
      },
    };
  },
};
