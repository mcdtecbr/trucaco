import { describe, expect, it } from 'vitest';
import { DEFAULT_JOIN_GUARD, JoinGuard } from './joinGuard';
import type { JoinGuardConfig } from './joinGuard';

const CFG: JoinGuardConfig = {
  attemptsPerUserPerMin: 5,
  attemptsPerIpPerMin: 8,
  failLockThreshold: 3,
  failsPerIp: 6,
  failWindowMs: 60_000,
  lockMs: 120_000,
};

describe('JoinGuard', () => {
  it('limita tentativas por usuário e por IP (cada um sozinho)', () => {
    const g = new JoinGuard(CFG);
    const t = 1_000;
    for (let i = 0; i < 5; i++) expect(g.check('u1', '1.1.1.1', t)).toBe('ok');
    expect(g.check('u1', '1.1.1.1', t)).toBe('limited');
    // Outro usuário, mesmo IP: o IP ainda tem 3 de 8.
    for (let i = 0; i < 3; i++) expect(g.check(`x${i}`, '1.1.1.1', t)).toBe('ok');
    expect(g.check('y', '1.1.1.1', t)).toBe('limited');
    // Outro IP, mesmo usuário já estourado: continua limitado pelo usuário.
    expect(g.check('u1', '2.2.2.2', t)).toBe('limited');
    // Passada a janela, volta.
    expect(g.check('u1', '1.1.1.1', t + 61_000)).toBe('ok');
  });

  it('N falhas bloqueiam o usuário por lockMs, mesmo trocando de IP, e depois liberam', () => {
    const g = new JoinGuard(CFG);
    let t = 0;
    for (let i = 0; i < 3; i++) {
      expect(g.check('u', `10.0.0.${i}`, (t += 1000))).toBe('ok');
      g.fail('u', `10.0.0.${i}`, t);
    }
    expect(g.isLocked('u', t)).toBe(true);
    expect(g.check('u', '99.9.9.9', t + 1)).toBe('locked');
    expect(g.check('u', '99.9.9.9', t + 119_000)).toBe('locked');
    expect(g.check('u', '99.9.9.9', t + 121_000)).toBe('ok');
    // Outro usuário não é afetado.
    expect(g.check('outro', '5.5.5.5', t)).toBe('ok');
  });

  it('falhas acima do teto do IP limitam o IP inteiro (vários usuários descartáveis)', () => {
    const g = new JoinGuard(CFG);
    const t = 5_000;
    for (let i = 0; i < 6; i++) {
      expect(g.check(`bot${i}`, '7.7.7.7', t)).toBe('ok');
      g.fail(`bot${i}`, '7.7.7.7', t);
    }
    expect(g.check('novo', '7.7.7.7', t)).toBe('limited');
    expect(g.check('novo', '8.8.8.8', t)).toBe('ok');
  });

  it('acerto não zera a contagem de falhas', () => {
    const g = new JoinGuard(CFG);
    g.fail('u', 'ip', 1);
    g.fail('u', 'ip', 2);
    expect(g.check('u', 'ip', 3)).toBe('ok'); // um acerto no meio
    g.fail('u', 'ip', 4);
    expect(g.isLocked('u', 4)).toBe(true);
  });

  it('memória limitada: teto de chaves em todos os mapas', () => {
    const g = new JoinGuard(CFG, 50);
    for (let i = 0; i < 500; i++) {
      g.check(`u${i}`, `ip${i}`, 1);
      g.fail(`u${i}`, `ip${i}`, 1);
      g.fail(`u${i}`, `ip${i}`, 1);
      g.fail(`u${i}`, `ip${i}`, 1);
    }
    let locked = 0;
    for (let i = 0; i < 500; i++) if (g.isLocked(`u${i}`, 1)) locked++;
    expect(locked).toBeLessThanOrEqual(50);
  });

  it('padrões razoáveis', () => {
    expect(DEFAULT_JOIN_GUARD.failLockThreshold).toBeLessThan(
      DEFAULT_JOIN_GUARD.attemptsPerUserPerMin,
    );
  });
});
