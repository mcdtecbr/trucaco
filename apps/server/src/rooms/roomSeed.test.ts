/**
 * TRUCO_SEED: vale só em development/test; em qualquer outro ambiente é ignorada (aviso único, sem o
 * valor). Duas mesas com a mesma semente jogam o mesmo baralho. UM `Server` por arquivo.
 */
import type { Room } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import type { RoomOptions } from '@trucaco/protocol';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLogSink } from '../logger';
import { buildColyseusServer } from '../server';
import { NO_EFFORT_POLICY } from '../progression/achievements';
import {
  resetSeedWarningForTests,
  resolveRelaxedProgression,
  resolveTrucoSeed,
  roomConfigFromEnv,
} from './roomSeed';
import type { TrucoRoom } from './TrucoRoom';

const OPTS: RoomOptions = {
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'private',
};

describe('resolveTrucoSeed', () => {
  beforeEach(resetSeedWarningForTests);

  it('dev e test usam a semente', () => {
    expect(resolveTrucoSeed({ NODE_ENV: 'development', TRUCO_SEED: '42' })).toBe(42);
    expect(resolveTrucoSeed({ NODE_ENV: 'test', TRUCO_SEED: '0' })).toBe(0);
    expect(resolveTrucoSeed({ NODE_ENV: 'test', TRUCO_SEED: '4294967295' })).toBe(4294967295);
    expect(roomConfigFromEnv({ NODE_ENV: 'test', TRUCO_SEED: '7' })).toEqual({ rngSeed: 7 });
  });

  it('ausente ou vazia: sem semente', () => {
    expect(resolveTrucoSeed({ NODE_ENV: 'test' })).toBeUndefined();
    expect(resolveTrucoSeed({ NODE_ENV: 'test', TRUCO_SEED: '' })).toBeUndefined();
    expect(roomConfigFromEnv({ NODE_ENV: 'test' })).toEqual({});
  });

  it('production, NODE_ENV ausente ou outro valor: IGNORADA, com um único aviso sem o valor', () => {
    const lines: string[] = [];
    const restore = setLogSink((level, msg, f) => lines.push(JSON.stringify({ level, msg, ...f })));
    try {
      for (const nodeEnv of ['production', undefined, 'staging', 'Production']) {
        expect(resolveTrucoSeed({ NODE_ENV: nodeEnv, TRUCO_SEED: '123456' })).toBeUndefined();
      }
      expect(roomConfigFromEnv({ NODE_ENV: 'production', TRUCO_SEED: '123456' })).toEqual({});
    } finally {
      restore();
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":"warn"');
    expect(lines[0]).not.toContain('123456');
  });

  it('sem aviso quando a variável não está definida em produção', () => {
    const lines: string[] = [];
    const restore = setLogSink((_l, msg) => lines.push(msg));
    try {
      expect(resolveTrucoSeed({ NODE_ENV: 'production' })).toBeUndefined();
    } finally {
      restore();
    }
    expect(lines).toEqual([]);
  });

  it('TRUCO_PROGRESSION_RELAXED: liga a política sem anti-farm só em dev/test e recusa fora delas', () => {
    expect(resolveRelaxedProgression({ NODE_ENV: 'test' })).toBe(false);
    expect(
      resolveRelaxedProgression({ NODE_ENV: 'production', TRUCO_PROGRESSION_RELAXED: '' }),
    ).toBe(false);
    expect(
      resolveRelaxedProgression({ NODE_ENV: 'production', TRUCO_PROGRESSION_RELAXED: '0' }),
    ).toBe(false);
    for (const nodeEnv of ['test', 'development']) {
      expect(
        roomConfigFromEnv({ NODE_ENV: nodeEnv, TRUCO_PROGRESSION_RELAXED: '1' }).progressionPolicy,
      ).toBe(NO_EFFORT_POLICY);
    }
    expect(roomConfigFromEnv({ NODE_ENV: 'test' }).progressionPolicy).toBeUndefined();
    for (const nodeEnv of ['production', undefined, 'staging']) {
      expect(() =>
        roomConfigFromEnv({ NODE_ENV: nodeEnv, TRUCO_PROGRESSION_RELAXED: '1' }),
      ).toThrow(/só é permitido em development\/test/);
    }
    expect(() =>
      resolveRelaxedProgression({ NODE_ENV: 'test', TRUCO_PROGRESSION_RELAXED: 'sim' }),
    ).toThrow(/deve ser 1/);
  });

  it('valor inválido em dev/test falha cedo (e sem eco do valor)', () => {
    for (const bad of ['abc', '-1', '1.5', '4294967296', ' 1', '1e3', '99999999999']) {
      expect(() => resolveTrucoSeed({ NODE_ENV: 'test', TRUCO_SEED: bad })).toThrow(
        /TRUCO_SEED inválida/,
      );
    }
  });
});

describe('semente nas salas', () => {
  let t: ColyseusTestServer;
  beforeAll(async () => {
    t = await boot(
      buildColyseusServer(
        { ...roomConfigFromEnv({ NODE_ENV: 'test', TRUCO_SEED: '42' }), patchRateMs: 5 },
        { allowDevAuth: true },
      ),
      2583,
    );
  });
  afterAll(async () => {
    await t.shutdown();
  });

  async function fullTable(prefix: string): Promise<TrucoRoom> {
    const room = await t.createRoom<TrucoRoom>('truco', OPTS);
    for (let i = 0; i < 4; i++) {
      await t.connectTo(room as unknown as Room, { userId: `${prefix}${i}`, nickname: `P${i}` });
    }
    const end = Date.now() + 4000;
    while (room.series === null && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
    expect(room.series).not.toBeNull();
    return room;
  }

  it('duas mesas com TRUCO_SEED em test usam a mesma semente e dão o mesmo baralho', async () => {
    const a = await fullTable('a');
    const b = await fullTable('b');
    expect(a.seed).toBe(42);
    expect(b.seed).toBe(42);
    expect(JSON.stringify(a.series?.match.hand)).toBe(JSON.stringify(b.series?.match.hand));
  });

  it('sem semente (como em produção) cada sala sorteia a sua', async () => {
    const prodCfg = roomConfigFromEnv({ NODE_ENV: 'production', TRUCO_SEED: '42' });
    expect(prodCfg.rngSeed).toBeUndefined();
  });
});
