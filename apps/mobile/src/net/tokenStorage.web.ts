/**
 * Web (Fase 7A): o refresh vive num cookie httpOnly que o JS não lê; o `localStorage` guarda só o usuário
 * (`{ userId, nickname }`, dica de UI e aviso entre abas), NUNCA o refresh. Um refresh LEGADO gravado pela
 * Fase 3 (chave v1) ainda é devolvido por `load()` para a sessão trocá-lo por cookie uma vez; o primeiro
 * `save()` ou `clear()` apaga a chave v1.
 */
import {
  STORAGE_KEY,
  WEB_STORAGE_KEY,
  parseStoredSession,
  parseWebUser,
  serializeWebUser,
  withMemoryFallback,
} from './tokenStorageCore';
import type { TokenStorage } from './tokenStorageCore';

export * from './tokenStorageCore';

interface StorageEventLike {
  key: string | null;
  newValue: string | null;
}

const local: TokenStorage = {
  /** O evento `storage` só dispara nas OUTRAS abas do mesmo origin: exatamente o aviso que queremos. */
  subscribe: (listener) => {
    const target = globalThis as unknown as {
      addEventListener?: (type: string, cb: (e: StorageEventLike) => void) => void;
      removeEventListener?: (type: string, cb: (e: StorageEventLike) => void) => void;
    };
    if (target.addEventListener === undefined) return () => undefined;
    const onStorage = (e: StorageEventLike): void => {
      if (e.key !== WEB_STORAGE_KEY) return;
      const s = parseWebUser(e.newValue);
      if (s !== null) listener(s);
    };
    target.addEventListener('storage', onStorage);
    return () => target.removeEventListener?.('storage', onStorage);
  },
  load: () => {
    const user = parseWebUser(globalThis.localStorage.getItem(WEB_STORAGE_KEY));
    if (user !== null) return Promise.resolve(user);
    // Legado (Fase 3): refresh no localStorage. A sessão o troca por cookie e apaga.
    return Promise.resolve(parseStoredSession(globalThis.localStorage.getItem(STORAGE_KEY)));
  },
  save: (s) => {
    globalThis.localStorage.setItem(WEB_STORAGE_KEY, serializeWebUser(s));
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return Promise.resolve();
  },
  clear: () => {
    globalThis.localStorage.removeItem(WEB_STORAGE_KEY);
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return Promise.resolve();
  },
};

export function createTokenStorage(): TokenStorage {
  return withMemoryFallback(local);
}
