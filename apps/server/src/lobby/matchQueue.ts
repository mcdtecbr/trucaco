import type { VariantId } from '@trucaco/protocol';

/** Quatro jogadores por mesa (duplas: assentos 0/2 e 1/3). */
export const QUEUE_GROUP_SIZE = 4;

export interface QueueEntry {
  readonly userId: string;
  readonly variant: VariantId;
  readonly ironHand: boolean;
  /** Ordem de chegada (FIFO). Preservada ao reenfileirar quem já esperava. */
  readonly seq: number;
  readonly joinedAt: number;
  readonly expiresAt: number;
  /**
   * `userId`s com bloqueio (em qualquer sentido) em relação a este jogador: nunca na mesma mesa. O
   * conjunto é mutável de propósito (`addAvoid`) e sobrevive ao `requeue`.
   */
  readonly avoid?: Set<string>;
}

/** Duas entradas só casam se tiverem a mesma variante e a mesma opção de mão de ferro. */
export const queueKey = (e: { variant: VariantId; ironHand: boolean }): string =>
  `${e.variant}:${e.ironHand ? 'iron' : 'plain'}`;

/**
 * Fila FIFO da mesa pública. Pura (sem relógio nem I/O): quem chama passa `now`. Um `userId` aparece no
 * máximo uma vez. Cada chave de compatibilidade (`queueKey`) forma seu grupo com as quatro entradas mais
 * antigas dela; chaves não se bloqueiam entre si, e dentro da chave ninguém passa na frente de quem chegou
 * antes (sem starvation além da falta de jogadores compatíveis; a entrada expira em `expiresAt`).
 */
export class MatchQueue {
  /** Sempre ordenado por `seq`. */
  private entries: QueueEntry[] = [];
  private nextSeq = 1;

  constructor(private readonly maxSize: number = 5000) {}

  get size(): number {
    return this.entries.length;
  }

  has(userId: string): boolean {
    return this.entries.some((e) => e.userId === userId);
  }

  /** `null` se o usuário já está na fila ou a fila está cheia. */
  enqueue(
    userId: string,
    options: { variant: VariantId; ironHand: boolean },
    now: number,
    ttlMs: number,
    avoid: ReadonlySet<string> = new Set(),
  ): QueueEntry | null {
    if (this.has(userId) || this.entries.length >= this.maxSize) return null;
    const entry: QueueEntry = {
      userId,
      variant: options.variant,
      ironHand: options.ironHand,
      seq: this.nextSeq++,
      joinedAt: now,
      expiresAt: now + ttlMs,
      avoid: new Set(avoid),
    };
    this.entries.push(entry);
    return entry;
  }

  /** Devolve quem esperava à posição original (mesmo `seq`), com novo prazo. */
  requeue(entry: QueueEntry, now: number, ttlMs: number): boolean {
    if (this.has(entry.userId)) return false;
    const renewed: QueueEntry = { ...entry, expiresAt: now + ttlMs };
    const at = this.entries.findIndex((e) => e.seq > entry.seq);
    if (at === -1) this.entries.push(renewed);
    else this.entries.splice(at, 0, renewed);
    return true;
  }

  remove(userId: string): QueueEntry | null {
    const at = this.entries.findIndex((e) => e.userId === userId);
    if (at === -1) return null;
    return this.entries.splice(at, 1)[0] ?? null;
  }

  /** Registra o bloqueio nas entradas que já esperam (bloqueio feito com a fila andando). */
  addAvoid(a: string, b: string): void {
    for (const e of this.entries) {
      if (e.userId === a) e.avoid?.add(b);
      else if (e.userId === b) e.avoid?.add(a);
    }
  }

  /** Remove e devolve as entradas vencidas. */
  expire(now: number): QueueEntry[] {
    const gone = this.entries.filter((e) => e.expiresAt <= now);
    if (gone.length > 0) this.entries = this.entries.filter((e) => e.expiresAt > now);
    return gone;
  }

  /** Remove e devolve todos os grupos completos (4 compatíveis, os mais antigos de cada chave). */
  takeGroups(): QueueEntry[][] {
    const buckets = new Map<string, QueueEntry[]>();
    for (const e of this.entries) {
      const key = queueKey(e);
      const list = buckets.get(key);
      if (list === undefined) buckets.set(key, [e]);
      else list.push(e);
    }
    const groups: QueueEntry[][] = [];
    const taken = new Set<string>();
    for (const list of buckets.values()) {
      for (const group of this.groupsOf(list)) {
        for (const e of group) taken.add(e.userId);
        groups.push(group);
      }
    }
    if (taken.size > 0) this.entries = this.entries.filter((e) => !taken.has(e.userId));
    // Grupos cujo membro mais antigo chegou primeiro saem primeiro.
    return groups.sort((a, b) => (a[0] as QueueEntry).seq - (b[0] as QueueEntry).seq);
  }

  /**
   * Grupos de 4 de uma chave. Sem bloqueios: os 4 mais antigos, em blocos (comportamento original). Com
   * bloqueios: a cada rodada, o mais antigo que consegue formar um grupo (completado em ordem de chegada
   * só com quem não tem bloqueio com ninguém já no grupo) sai; quem não encaixa segue esperando.
   */
  private groupsOf(list: readonly QueueEntry[]): QueueEntry[][] {
    const out: QueueEntry[][] = [];
    if (list.every((e) => (e.avoid?.size ?? 0) === 0)) {
      for (let i = 0; i + QUEUE_GROUP_SIZE <= list.length; i += QUEUE_GROUP_SIZE) {
        out.push(list.slice(i, i + QUEUE_GROUP_SIZE));
      }
      return out;
    }
    const conflict = (a: QueueEntry, b: QueueEntry): boolean =>
      a.avoid?.has(b.userId) === true || b.avoid?.has(a.userId) === true;
    let pool = [...list];
    while (pool.length >= QUEUE_GROUP_SIZE) {
      let found: QueueEntry[] | null = null;
      for (const seed of pool) {
        const group = [seed];
        for (const e of pool) {
          if (e === seed) continue;
          if (group.every((m) => !conflict(m, e))) group.push(e);
          if (group.length === QUEUE_GROUP_SIZE) break;
        }
        if (group.length === QUEUE_GROUP_SIZE) {
          found = group.sort((x, y) => x.seq - y.seq);
          break;
        }
      }
      if (found === null) break;
      out.push(found);
      const gone = new Set(found.map((e) => e.userId));
      pool = pool.filter((e) => !gone.has(e.userId));
    }
    return out;
  }
}
