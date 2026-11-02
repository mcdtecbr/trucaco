/**
 * Web: `sessionStorage`. Por aba e com a vida da aba: sobrevive ao reload (o objetivo), não vai para outra
 * aba nem para a próxima visita ao site. De propósito NÃO é `localStorage` (esse é compartilhado entre
 * abas e sobrevive ao fechamento do navegador).
 */
import {
  RESUME_KEY,
  parseResume,
  serializeResume,
  withResumeMemoryFallback,
} from './resumeStorageCore';
import type { ResumeStorage } from './resumeStorageCore';

export * from './resumeStorageCore';

const session: ResumeStorage = {
  load: () => Promise.resolve(parseResume(globalThis.sessionStorage.getItem(RESUME_KEY))),
  save: (r) => {
    globalThis.sessionStorage.setItem(RESUME_KEY, serializeResume(r));
    return Promise.resolve();
  },
  clear: () => {
    globalThis.sessionStorage.removeItem(RESUME_KEY);
    return Promise.resolve();
  },
};

export function createResumeStorage(): ResumeStorage {
  return withResumeMemoryFallback(session);
}
