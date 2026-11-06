/**
 * Contrato de persistência da sessão. Nunca o access token (só em memória, `session.ts`). Nativo: o REFRESH
 * token e metadados mínimos (`tokenStorage.native.ts`, expo-secure-store). Web: só o usuário (dica de UI,
 * `tokenStorage.web.ts`), SEM refresh: ele vive no cookie httpOnly do servidor. O Metro resolve o arquivo
 * certo por extensão; `tokenStorage.ts` (memória) serve a testes e ao typecheck.
 */
export interface StoredSession {
  /** Ausente no web (cookie). No web, presente só para um refresh LEGADO do `localStorage` a migrar. */
  readonly refreshToken?: string;
  readonly userId: string;
  readonly nickname: string;
}

export interface TokenStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
  /**
   * Opcional (web): avisa quando OUTRA aba grava uma sessão nova, para esta aba adotar o refresh
   * rotacionado sem renovar. Nativo tem processo único e não implementa.
   */
  subscribe?(listener: (session: StoredSession) => void): () => void;
}

export const STORAGE_KEY = 'trucaco.session.v1';

/** Chave do web depois da 7A: só `{ userId, nickname }`, nunca refresh. A `STORAGE_KEY` v1 é legado a migrar. */
export const WEB_STORAGE_KEY = 'trucaco.session.v2';

export function serializeSession(s: StoredSession): string {
  return JSON.stringify({
    ...(s.refreshToken !== undefined ? { refreshToken: s.refreshToken } : {}),
    userId: s.userId,
    nickname: s.nickname,
  });
}

/** Web: grava só o usuário (dica de UI); o refresh jamais entra aqui. */
export function serializeWebUser(s: StoredSession): string {
  return JSON.stringify({ userId: s.userId, nickname: s.nickname });
}

/** Web: lê `{ userId, nickname }` (ignora qualquer `refreshToken` que apareça). */
export function parseWebUser(raw: string | null | undefined): StoredSession | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const x: unknown = JSON.parse(raw);
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    if (
      typeof o['userId'] === 'string' &&
      o['userId'] !== '' &&
      typeof o['nickname'] === 'string'
    ) {
      return { userId: o['userId'], nickname: o['nickname'] };
    }
    return null;
  } catch {
    return null;
  }
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
  const subscribe = primary.subscribe?.bind(primary);
  return {
    ...(subscribe !== undefined ? { subscribe } : {}),
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
        // O primário pode ter ficado com o refresh ANTERIOR (já rotacionado/morto): apaga para o próximo
        // início não restaurar um token inválido.
        try {
          await primary.clear();
        } catch {
          // Nada a fazer.
        }
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
