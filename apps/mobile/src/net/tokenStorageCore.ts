/**
 * Contrato de persistência da sessão. Só o REFRESH token e metadados mínimos são persistidos; o
 * access token vive somente em memória (`session.ts`). Implementações por plataforma:
 * `tokenStorage.native.ts` (expo-secure-store) e `tokenStorage.web.ts` (localStorage). O Metro resolve
 * o arquivo certo por extensão; `tokenStorage.ts` (memória) serve a testes e ao typecheck.
 */
export interface StoredSession {
  readonly refreshToken: string;
  readonly userId: string;
  readonly nickname: string;
}

export interface TokenStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export const STORAGE_KEY = 'trucaco.session.v1';

export function serializeSession(s: StoredSession): string {
  return JSON.stringify({ refreshToken: s.refreshToken, userId: s.userId, nickname: s.nickname });
}

/** Aceita só a forma esperada; qualquer outra coisa (corrompido, versão antiga) vira `null`. */
export function parseStoredSession(raw: string | null | undefined): StoredSession | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const x: unknown = JSON.parse(raw);
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    if (
      typeof o['refreshToken'] === 'string' &&
      o['refreshToken'] !== '' &&
      typeof o['userId'] === 'string' &&
      typeof o['nickname'] === 'string'
    ) {
      return { refreshToken: o['refreshToken'], userId: o['userId'], nickname: o['nickname'] };
    }
    return null;
  } catch {
    return null;
  }
}

export function createMemoryTokenStorage(initial: StoredSession | null = null): TokenStorage {
  let current = initial;
  return {
    load: () => Promise.resolve(current),
    save: (s) => {
      current = s;
      return Promise.resolve();
    },
    clear: () => {
      current = null;
      return Promise.resolve();
    },
  };
}

/**
 * Envolve um armazenamento que pode falhar (modo privado, quota, Keychain bloqueado). Qualquer falha
 * degrada para memória durante o processo: a sessão segue valendo, só não sobrevive ao reinício.
 * Nunca propaga exceção, e a exceção nunca é registrada (poderia conter o valor).
 */
export function withMemoryFallback(primary: TokenStorage): TokenStorage {
  const memory = createMemoryTokenStorage();
  let degraded = false;
  return {
    async load() {
      if (!degraded) {
        try {
          return await primary.load();
        } catch {
          degraded = true;
        }
      }
      return memory.load();
    },
    async save(s) {
      // Sempre espelha em memória: se o primário falhar depois, o valor mais novo não se perde.
      await memory.save(s);
      if (degraded) return;
      try {
        await primary.save(s);
      } catch {
        degraded = true;
      }
    },
    async clear() {
      await memory.clear();
      try {
        await primary.clear();
      } catch {
        // Nada a fazer: já limpamos a memória.
      }
    },
  };
}
