/**
 * Web: `localStorage` (decisão do usuário na Fase 3). Exposto a XSS: mitigado por CSP do host, chat
 * só como texto, access de 15 min e rotação com detecção de reuso no servidor. Fica atrás da
 * interface para trocar por cookie httpOnly na Fase 6.
 */
import {
  STORAGE_KEY,
  parseStoredSession,
  serializeSession,
  withMemoryFallback,
} from './tokenStorageCore';
import type { TokenStorage } from './tokenStorageCore';

export * from './tokenStorageCore';

const local: TokenStorage = {
  load: () => Promise.resolve(parseStoredSession(globalThis.localStorage.getItem(STORAGE_KEY))),
  save: (s) => {
    globalThis.localStorage.setItem(STORAGE_KEY, serializeSession(s));
    return Promise.resolve();
  },
  clear: () => {
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return Promise.resolve();
  },
};

export function createTokenStorage(): TokenStorage {
  return withMemoryFallback(local);
}
