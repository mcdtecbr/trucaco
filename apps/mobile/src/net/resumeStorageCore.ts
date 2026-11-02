/**
 * Retomada da mesa depois de recarregar a página (web) ou reabrir o app (nativo): guarda o token de
 * reconexão do Colyseus, o código da mesa e o dono (`userId`). Implementações por plataforma:
 * `resumeStorage.web.ts` (sessionStorage: por aba, morre com a aba; NUNCA localStorage) e
 * `resumeStorage.native.ts` (expo-secure-store). `resumeStorage.ts` (memória) serve a testes e ao typecheck.
 *
 * O token vale só enquanto o servidor mantém a janela de reconexão aberta (60 s) e só serve ao MESMO
 * `userId` (o servidor confere o JWT). Mesmo assim ele é tratado como segredo: nunca em URL, log ou erro.
 */
import { isValidRoomCode } from '@trucaco/protocol';

export interface TableResume {
  /** `room.reconnectionToken` do SDK: `<roomId>:<token>`. */
  readonly reconnectionToken: string;
  /** Código de 8 caracteres da mesa (para o fallback de entrada pelo lobby). */
  readonly code: string;
  /** Dono da gravação: outro usuário neste armazenamento descarta o registro. */
  readonly userId: string;
  /** Tipo da mesa quando o cliente o conhece (`options.visibility` do estado). Mesa pública não volta por código. */
  readonly visibility?: 'private' | 'public';
}

export interface ResumeStorage {
  load(): Promise<TableResume | null>;
  save(resume: TableResume): Promise<void>;
  clear(): Promise<void>;
}

export const RESUME_KEY = 'trucaco.table.v1';

const TOKEN_FORMAT = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;
const USER_ID_MAX = 128;

export function isValidReconnectionToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && TOKEN_FORMAT.test(value);
}

export function serializeResume(r: TableResume): string {
  return JSON.stringify({
    reconnectionToken: r.reconnectionToken,
    code: r.code,
    userId: r.userId,
    ...(r.visibility !== undefined ? { visibility: r.visibility } : {}),
  });
}

/** Aceita só a forma esperada; qualquer outra coisa (corrompido, adulterado) vira `null`. */
export function parseResume(raw: string | null | undefined): TableResume | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const x: unknown = JSON.parse(raw);
    if (typeof x !== 'object' || x === null) return null;
    const o = x as Record<string, unknown>;
    const token = o['reconnectionToken'];
    const code = o['code'];
    const userId = o['userId'];
    if (
      isValidReconnectionToken(token) &&
      isValidRoomCode(code) &&
      typeof userId === 'string' &&
      userId !== '' &&
      userId.length <= USER_ID_MAX
    ) {
      const v = o['visibility'];
      return {
        reconnectionToken: token,
        code,
        userId,
        ...(v === 'private' || v === 'public' ? { visibility: v } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function createMemoryResumeStorage(initial: TableResume | null = null): ResumeStorage {
  let current = initial;
  return {
    load: () => Promise.resolve(current),
    save: (r) => {
      current = r;
      return Promise.resolve();
    },
    clear: () => {
      current = null;
      return Promise.resolve();
    },
  };
}

/**
 * Envolve um armazenamento que pode falhar (modo privado, Keychain bloqueado). Qualquer falha degrada
 * para memória: a retomada por reload deixa de funcionar, mas nada lança e nada é registrado (a exceção
 * poderia conter o valor).
 */
export function withResumeMemoryFallback(primary: ResumeStorage): ResumeStorage {
  const memory = createMemoryResumeStorage();
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
    async save(r) {
      await memory.save(r);
      if (degraded) return;
      try {
        await primary.save(r);
      } catch {
        degraded = true;
        try {
          await primary.clear(); // o primário pode ter ficado com o token ANTERIOR (morto)
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
        // Nada a fazer: a memória já foi limpa.
      }
    },
  };
}
