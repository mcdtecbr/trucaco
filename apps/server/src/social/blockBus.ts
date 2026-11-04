/**
 * Barramento em processo das mudanças de bloqueio. `POST/DELETE /me/blocks` publica; a fila do lobby e as
 * salas abertas assinam para aplicar o bloqueio na hora (sem esperar a próxima entrada). Sem rede: com
 * várias instâncias isto vira Redis pub/sub (mesma limitação do lobby, ver `lobby/lobby.ts`).
 */
export interface BlockChange {
  readonly blockerId: string;
  readonly blockedId: string;
  /** `true` = bloqueou; `false` = desbloqueou. */
  readonly active: boolean;
}

type Listener = (change: BlockChange) => void;

const listeners = new Set<Listener>();

/** Assina; devolve a função que cancela. */
export function onBlockChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitBlockChange(change: BlockChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // Um assinante com defeito não impede os demais nem a resposta HTTP.
    }
  }
}

type DeletedListener = (userId: string) => void;
const deletedListeners = new Set<DeletedListener>();

/** Conta apagada (`DELETE /me`): as salas derrubam o socket e passam a gravar o assento sem `userId`. */
export function onUserDeleted(listener: DeletedListener): () => void {
  deletedListeners.add(listener);
  return () => {
    deletedListeners.delete(listener);
  };
}

export function emitUserDeleted(userId: string): void {
  for (const listener of [...deletedListeners]) {
    try {
      listener(userId);
    } catch {
      // Ver `emitBlockChange`.
    }
  }
}
