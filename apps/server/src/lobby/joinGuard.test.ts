import { describe, expect, it } from 'vitest';
import { DEFAULT_JOIN_GUARD, JoinGuard, prefix48 } from './joinGuard';
import type { JoinGuardConfig } from './joinGuard';

const CFG: JoinGuardConfig = {
  attemptsPerUserPerMin: 5,
  attemptsPerIpPerMin: 8,
  failLockThreshold: 3,
  failsPerIp: 6,
  failWindowMs: 60_000,
  lockMs: 120_000,
  failsPerPrefix48: 1000,
  failsGlobal: 100_000,
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

describe('JoinGuard: força bruta distribuída', () => {
  it('prefix48 só existe para chave IPv6 /64', () => {
    expect(prefix48('2001:db8:abcd:1::/64')).toBe('2001:db8:abcd::/48');
    expect(prefix48('2001:db8:abcd:ffff::/64')).toBe('2001:db8:abcd::/48');
    expect(prefix48('1.2.3.4')).toBeNull();
    expect(prefix48('lixo')).toBeNull();
  });

  it('muitos /64 do mesmo /48 e contas diferentes: o /48 é limitado', () => {
    const g = new JoinGuard({ ...CFG, failsPerIp: 1000, failsPerPrefix48: 4 });
    const t = 1_000;
    for (let i = 0; i < 4; i++) {
      expect(g.check(`u${i}`, `2001:db8:abcd:${i}::/64`, t)).toBe('ok');
      g.fail(`u${i}`, `2001:db8:abcd:${i}::/64`, t);
    }
    // novo /64 do MESMO /48, usuário limpo
    expect(g.check('novo', '2001:db8:abcd:9::/64', t)).toBe('limited');
    // outro /48 e IPv4 seguem livres
    expect(g.check('novo', '2001:db8:beef:9::/64', t)).toBe('ok');
    expect(g.check('v4', '9.9.9.9', t)).toBe('ok');
    // a janela esvazia
    expect(g.check('novo2', '2001:db8:abcd:9::/64', t + 61_000)).toBe('ok');
  });

  it('teto global de falhas: acima dele todos são limitados até a janela esvaziar', () => {
    const g = new JoinGuard({ ...CFG, failsGlobal: 5, failLockThreshold: 100 });
    const t = 1_000;
    for (let i = 0; i < 5; i++) {
      expect(g.check(`u${i}`, `10.0.0.${i}`, t)).toBe('ok');
      g.fail(`u${i}`, `10.0.0.${i}`, t);
    }
    expect(g.check('limpo', '8.8.8.8', t)).toBe('limited');
    expect(g.check('limpo', '8.8.8.8', t + 61_000)).toBe('ok');
  });

  it('ip null (entrada direta sem proxy confiável) conta só o usuário', () => {
    const g = new JoinGuard({ ...CFG, failLockThreshold: 2, attemptsPerIpPerMin: 1 });
    const t = 1_000;
    for (let i = 0; i < 3; i++) expect(g.check('u', null, t)).toBe('ok'); // sem limite por IP
    g.fail('u', null, t);
    g.fail('u', null, t);
    expect(g.check('u', null, t)).toBe('locked');
    expect(g.check('outro', null, t)).toBe('ok');
  });
});
