/**
 * Jogadores silenciados neste aparelho. É preferência LOCAL: nunca vai ao servidor nem à conta. A chave
 * é o apelido em minúsculas (o servidor garante apelidos únicos; o cliente não conhece o `userId` dos outros).
 * Implementações por plataforma: `mutedStorage.web.ts` (localStorage), `mutedStorage.native.ts`
 * (expo-secure-store, já dependência do app) e `mutedStorage.ts` (memória: testes e typecheck).
 */
export interface MutedStorage {
  load(): Promise<readonly string[]>;
  save(names: readonly string[]): Promise<void>;
}

export const MUTED_KEY = 'trucaco.muted.v1';
export const MAX_MUTED = 50;
const NAME_MAX = 32;

export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLowerCase();
}

export function serializeMuted(names: readonly string[]): string {
  return JSON.stringify(names.slice(0, MAX_MUTED));
}

/** Aceita só uma lista de textos curtos; qualquer outra coisa (corrompido, adulterado) vira lista vazia. */
export function parseMuted(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  try {
    const x: unknown = JSON.parse(raw);
    if (!Array.isArray(x)) return [];
    const out: string[] = [];
    for (const v of x) {
      if (typeof v !== 'string') continue;
      const n = normalizeNickname(v);
      if (n !== '' && n.length <= NAME_MAX && !out.includes(n)) out.push(n);
      if (out.length >= MAX_MUTED) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function createMemoryMutedStorage(initial: readonly string[] = []): MutedStorage {
  let current = [...initial];
  return {
    load: () => Promise.resolve(current),
    save: (names) => {
      current = [...names];
      return Promise.resolve();
    },
  };
}

/** Falha do armazenamento (modo privado, Keychain bloqueado) nunca lança: a preferência vale só na sessão. */
export function safeMutedStorage(primary: MutedStorage): MutedStorage {
  return {
    load: async () => {
      try {
        return await primary.load();
      } catch {
        return [];
      }
    },
    save: async (names) => {
      try {
        await primary.save(names);
      } catch {
        // Nada a fazer.
      }
    },
  };
}
