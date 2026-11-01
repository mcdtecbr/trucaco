import { describe, expect, it } from 'vitest';
import { MatchQueue, QUEUE_GROUP_SIZE } from './matchQueue';

const P = { variant: 'paulista', ironHand: true } as const;
const M = { variant: 'mineiro', ironHand: true } as const;
const TTL = 1000;

describe('MatchQueue', () => {
  it('FIFO: forma o grupo com os 4 mais antigos e deixa os demais', () => {
    const q = new MatchQueue();
    for (let i = 1; i <= 6; i++) q.enqueue(`u${i}`, P, i, TTL);
    const groups = q.takeGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((e) => e.userId)).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(q.size).toBe(2);
    expect(q.has('u5')).toBe(true);
    expect(q.takeGroups()).toEqual([]);
  });

  it('só casa compatíveis (mesma variante e mesma mão de ferro)', () => {
    const q = new MatchQueue();
    q.enqueue('a', P, 1, TTL);
    q.enqueue('b', M, 2, TTL);
    q.enqueue('c', { variant: 'paulista', ironHand: false }, 3, TTL);
    q.enqueue('d', P, 4, TTL);
    q.enqueue('e', P, 5, TTL);
    expect(q.takeGroups()).toEqual([]);
    q.enqueue('f', P, 6, TTL);
    const [g] = q.takeGroups();
    expect(g?.map((e) => e.userId)).toEqual(['a', 'd', 'e', 'f']);
    expect(q.size).toBe(2); // b e c seguem esperando
  });

  it('um userId, uma entrada (segunda fila, mesmo com outra variante, é recusada)', () => {
    const q = new MatchQueue();
    expect(q.enqueue('u', P, 1, TTL)).not.toBeNull();
    expect(q.enqueue('u', M, 2, TTL)).toBeNull();
    expect(q.size).toBe(1);
  });

  it('cancelar tira da fila e impede o grupo', () => {
    const q = new MatchQueue();
    for (const u of ['a', 'b', 'c', 'd']) q.enqueue(u, P, 1, TTL);
    expect(q.remove('c')?.userId).toBe('c');
    expect(q.remove('c')).toBeNull();
    expect(q.takeGroups()).toEqual([]);
  });

  it('expiração remove só as vencidas', () => {
    const q = new MatchQueue();
    q.enqueue('velho', P, 0, 100);
    q.enqueue('novo', P, 90, 100);
    expect(q.expire(100).map((e) => e.userId)).toEqual(['velho']);
    expect(q.has('novo')).toBe(true);
  });

  it('requeue devolve à posição original (sem perder a vez)', () => {
    const q = new MatchQueue();
    const a = q.enqueue('a', P, 1, TTL);
    q.enqueue('b', P, 2, TTL);
    q.enqueue('c', P, 3, TTL);
    q.remove('a');
    expect(q.requeue(a!, 10, TTL)).toBe(true);
    expect(q.requeue(a!, 10, TTL)).toBe(false);
    q.enqueue('d', P, 4, TTL);
    q.enqueue('e', P, 5, TTL);
    const [g] = q.takeGroups();
    expect(g?.map((e) => e.userId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('muitas entradas: vários grupos, nenhum usuário em dois', () => {
    const q = new MatchQueue();
    for (let i = 0; i < 40; i++) q.enqueue(`u${i}`, i % 2 === 0 ? P : M, i, TTL);
    const groups = q.takeGroups();
    expect(groups).toHaveLength(40 / QUEUE_GROUP_SIZE);
    const all = groups.flat().map((e) => e.userId);
    expect(new Set(all).size).toBe(40);
    expect(q.size).toBe(0);
  });

  it('teto de tamanho', () => {
    const q = new MatchQueue(2);
    expect(q.enqueue('a', P, 1, TTL)).not.toBeNull();
    expect(q.enqueue('b', P, 1, TTL)).not.toBeNull();
    expect(q.enqueue('c', P, 1, TTL)).toBeNull();
  });
});
