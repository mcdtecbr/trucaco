/**
 * Arquivos de áudio empacotados pelo Metro (manifesto gerado em `@trucaco/avatar/audio`). Só os arquivos
 * `platform.web.ts` e `platform.native.ts` importam este módulo: o Vitest e o Node não carregam `.m4a`.
 */
import { SFX_AUDIO, VOICE_AUDIO } from '@trucaco/avatar/audio';
import type { AudioSources } from './audioService';

export const manifestSources: AudioSources = {
  voice: (voice, takeId) => VOICE_AUDIO[voice]?.[takeId],
  sfx: (id) => SFX_AUDIO[id],
};
