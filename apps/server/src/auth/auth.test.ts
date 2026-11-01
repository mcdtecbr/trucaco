import { createHmac, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db';
import { REDACTED, redact, setLogSink } from '../logger';
import {
  AuthError,
  AuthService,
  bearerFromHeader,
  bearerFromSubprotocol,
  hashRefresh,
} from './authService';
import { loadServerConfig, type AuthConfig } from './config';
import { AccessTokenService, InvalidTokenError } from './jwt';
import { MemoryTokenStore } from './tokenStore';
import { tokenStoreContract } from './tokenStore.contract';
import { assertSafeTestRedisUrl } from './testRedis';

const SECRET = new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!');
const CFG: AuthConfig = {
  secret: SECRET,
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  clockToleranceSec: 5,
};
const USER = randomUUID();

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('loadServerConfig', () => {
  const base = { NODE_ENV: 'production', REDIS_URL: 'redis://localhost:6380' };
  const secret = 'x'.repeat(40);

  it('produção exige JWT_SECRET (sem padrão), com 32 bytes e fora do valor de exemplo', () => {
    expect(() => loadServerConfig(base)).toThrow(/JWT_SECRET/);
    expect(() => loadServerConfig({ ...base, JWT_SECRET: 'curto' })).toThrow(/32 bytes/);
    expect(() =>
      loadServerConfig({
        ...base,
        JWT_SECRET: 'troque-por-um-segredo-longo-e-aleatorio-em-producao',
      }),
    ).toThrow(/exemplo/);
    expect(loadServerConfig({ ...base, JWT_SECRET: secret }).auth.secret.length).toBe(40);
  });

  it('NODE_ENV ausente ou desconhecido NÃO ganha segredo efêmero', () => {
    for (const nodeEnv of [undefined, 'staging', 'prod', '']) {
      expect(() => loadServerConfig({ NODE_ENV: nodeEnv, REDIS_URL: 'redis://x' })).toThrow(
        /JWT_SECRET/,
      );
    }
  });

  it('development/test geram segredo efêmero de 32 bytes, distinto a cada carga', () => {
    const a = loadServerConfig({ NODE_ENV: 'test' });
    const b = loadServerConfig({ NODE_ENV: 'development' });
    expect(a.auth.secret.length).toBe(32);
    expect(Buffer.from(a.auth.secret).equals(Buffer.from(b.auth.secret))).toBe(false);
    expect(a.redisUrl).toBeNull();
  });

  it('produção exige REDIS_URL; CORS_ORIGINS recusa curinga; TTLs e limites validados', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'production', JWT_SECRET: secret })).toThrow(
      /REDIS_URL/,
    );
    const ok = { ...base, JWT_SECRET: secret };
    expect(loadServerConfig(ok).corsOrigins).toEqual([]);
    expect(
      loadServerConfig({ ...ok, CORS_ORIGINS: 'https://a.com, http://localhost:8081' }).corsOrigins,
    ).toEqual(['https://a.com', 'http://localhost:8081']);
    for (const bad of ['*', 'https://a.com/', 'ftp://a.com', 'a.com']) {
      expect(() => loadServerConfig({ ...ok, CORS_ORIGINS: bad })).toThrow(/CORS_ORIGINS/);
    }
    expect(() => loadServerConfig({ ...ok, ACCESS_TOKEN_TTL_SECONDS: '999999' })).toThrow();
    expect(() => loadServerConfig({ ...ok, AUTH_GUEST_PER_IP_PER_HOUR: '0' })).toThrow();
    expect(loadServerConfig({ ...ok, ACCESS_TOKEN_TTL_SECONDS: '600' }).auth.accessTtlSec).toBe(
      600,
    );
  });
});

describe('AccessTokenService (JWT HS256)', () => {
  const svc = new AccessTokenService(CFG);

  it('emite e verifica com iss, aud, sub, jti, iat, exp', async () => {
    const { token, jti } = await svc.sign(USER);
    const claims = await svc.verify(token);
    expect(claims.userId).toBe(USER);
    expect(claims.jti).toBe(jti);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] as string, 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ iss: 'trucaco', aud: 'trucaco-api', sub: USER, jti });
    expect(payload['exp']).toBe((payload['iat'] as number) + 900);
  });

  it('expirado (além da tolerância) é recusado; dentro da tolerância passa', async () => {
    let now = Date.now();
    const clocked = new AccessTokenService(CFG, () => now);
    const { token } = await clocked.sign(USER);
    now += 900_000 + 3_000;
    await expect(clocked.verify(token)).resolves.toBeDefined();
    now += 5_000;
    await expect(clocked.verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('iss ou aud errados são recusados', async () => {
    const wrongAud = new AccessTokenService({ ...CFG, audience: 'outro' });
    const wrongIss = new AccessTokenService({ ...CFG, issuer: 'outro' });
    await expect(svc.verify((await wrongAud.sign(USER)).token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    await expect(svc.verify((await wrongIss.sign(USER)).token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('alg:none, confusão de algoritmo, assinatura adulterada e segredo alheio são recusados', async () => {
    const claims = {
      iss: 'trucaco',
      aud: 'trucaco-api',
      sub: USER,
      jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    // alg none
    await expect(
      svc.verify(`${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(svc.verify(`${b64({ alg: 'none' })}.${b64(claims)}.abc`)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    // HS384 e HS512 com o MESMO segredo (algoritmo fora da lista)
    for (const alg of ['HS384', 'HS512']) {
      const t = await new SignJWT(claims).setProtectedHeader({ alg }).sign(SECRET);
      await expect(svc.verify(t)).rejects.toBeInstanceOf(InvalidTokenError);
    }
    // cabeçalho RS256 com "assinatura" HMAC (clássico de confusão)
    const header = b64({ alg: 'RS256', typ: 'JWT' });
    const body = b64(claims);
    const sig = createHmac('sha256', Buffer.from(SECRET))
      .update(`${header}.${body}`)
      .digest('base64url');
    await expect(svc.verify(`${header}.${body}.${sig}`)).rejects.toBeInstanceOf(InvalidTokenError);
    // assinatura adulterada / payload adulterado
    const { token } = await svc.sign(USER);
    const [h, p, s] = token.split('.') as [string, string, string];
    await expect(svc.verify(`${h}.${p}.${s.slice(0, -2)}AA`)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
    const other = b64({ ...claims, sub: randomUUID() });
    await expect(svc.verify(`${h}.${other}.${s}`)).rejects.toBeInstanceOf(InvalidTokenError);
    // outro segredo
    const foreign = new AccessTokenService({
      ...CFG,
      secret: new TextEncoder().encode('y'.repeat(40)),
    });
    await expect(svc.verify((await foreign.sign(USER)).token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('exige sub UUID, jti e exp; lixo e tokens enormes são recusados', async () => {
    const mk = (claims: Record<string, unknown>, exp = '10m') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('trucaco')
        .setAudience('trucaco-api')
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(SECRET);
    await expect(
      svc.verify(await mk({ sub: 'nao-uuid', jti: randomUUID() })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(svc.verify(await mk({ sub: USER }))).rejects.toBeInstanceOf(InvalidTokenError);
    const noExp = await new SignJWT({ sub: USER, jti: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('trucaco')
      .setAudience('trucaco-api')
      .setIssuedAt()
      .sign(SECRET);
    await expect(svc.verify(noExp)).rejects.toBeInstanceOf(InvalidTokenError);
    for (const junk of ['', 'a.b', 'a.b.c', 'x'.repeat(5000), '..']) {
      await expect(svc.verify(junk)).rejects.toBeInstanceOf(InvalidTokenError);
    }
  });
});

describe('AuthService', () => {
  let now = Date.now();
  const setup = () => {
    const repos = createMemoryRepositories();
    const tokens = new MemoryTokenStore(() => now);
    const auth = new AuthService(repos.users, tokens, CFG, () => now);
    return { repos, tokens, auth };
  };

  it('convidado: apelido válido e único, par de tokens, access autentica', async () => {
    const { auth, repos } = setup();
    const a = await auth.createGuest();
    const b = await auth.createGuest();
    expect(a.user.nickname).toMatch(/^Visitante\d{4,7}$/);
    expect(a.user.nickname).not.toBe(b.user.nickname);
    expect(a.user.provider).toBe('guest');
    expect(a.pair.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await auth.authenticateAccess(a.pair.accessToken)).userId).toBe(a.user.id);
    expect(repos.store.users.size).toBe(2);
  });

  it('refresh rotaciona; o token antigo reapresentado revoga a família e o access vigente', async () => {
    const { auth } = setup();
    const g = await auth.createGuest();
    const second = await auth.refresh(g.pair.refreshToken);
    expect(second.refreshToken).not.toBe(g.pair.refreshToken);
    const third = await auth.refresh(second.refreshToken);
    await expect(auth.authenticateAccess(third.accessToken)).resolves.toBeDefined();
    // reuso do 1º: derruba tudo
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(auth.refresh(third.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    // o access da última rotação (lastJti) foi revogado
    await expect(auth.authenticateAccess(third.accessToken)).rejects.toBeInstanceOf(AuthError);
  });

  it('refresh expirado, malformado ou de usuário removido é recusado', async () => {
    const { auth, repos } = setup();
    const g = await auth.createGuest();
    for (const bad of ['', 'abc', 'x'.repeat(43), 5 as unknown as string]) {
      await expect(auth.refresh(bad)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    }
    repos.store.users.delete(g.user.id);
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });

    const h = await auth.createGuest();
    now += 3600_000 + 1;
    await expect(auth.refresh(h.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('concorrência: dois refresh com o mesmo token, só um vence', async () => {
    const { auth } = setup();
    const g = await auth.createGuest();
    const results = await Promise.allSettled([
      auth.refresh(g.pair.refreshToken),
      auth.refresh(g.pair.refreshToken),
      auth.refresh(g.pair.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('o store só vê o hash (SHA-256), nunca o token em claro', async () => {
    const repos = createMemoryRepositories();
    const seen: string[] = [];
    const tokens = new MemoryTokenStore();
    const spy = {
      ...tokens,
      createFamily: (i: Parameters<MemoryTokenStore['createFamily']>[0]) => {
        seen.push(i.refreshHash);
        return tokens.createFamily(i);
      },
    } as unknown as MemoryTokenStore;
    const auth = new AuthService(repos.users, spy, CFG);
    const g = await auth.createGuest();
    expect(seen).toEqual([hashRefresh(g.pair.refreshToken)]);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cabeçalhos de credencial', () => {
  it('Bearer exato; subprotocolo trucaco.bearer', () => {
    expect(bearerFromHeader('Bearer abc')).toBe('abc');
    for (const bad of [
      undefined,
      null,
      '',
      'bearer abc',
      'Bearer',
      'Bearer  abc',
      'Basic abc',
      'Bearer a b',
    ]) {
      expect(bearerFromHeader(bad)).toBeUndefined();
    }
    expect(bearerFromSubprotocol('trucaco.bearer, tok.en')).toBe('tok.en');
    expect(bearerFromSubprotocol('tok.en')).toBeUndefined();
    expect(bearerFromSubprotocol('trucaco.bearer')).toBeUndefined();
    expect(bearerFromSubprotocol(null)).toBeUndefined();
  });
});

describe('logger: redação', () => {
  it('redige campos sensíveis por nome e valores com cara de JWT/Bearer', () => {
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: 'x' })}.assinaturaassinatura`;
    const out = redact({
      token: 'abc',
      refreshToken: 'abc',
      authorization: 'Bearer abc',
      tokenHash: 'abc',
      body: 'x',
      cookie: 'a=b',
      note: jwt,
      other: `Bearer ${jwt}`,
      seat: 2,
      room: 'abc',
    });
    expect(out).toEqual({
      token: REDACTED,
      refreshToken: REDACTED,
      authorization: REDACTED,
      tokenHash: REDACTED,
      body: REDACTED,
      cookie: REDACTED,
      note: REDACTED,
      other: REDACTED,
      seat: 2,
      room: 'abc',
    });
  });

  it('log.* aplica a redação antes do destino', async () => {
    const { log } = await import('../logger');
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, fields) => lines.push(JSON.stringify({ msg, ...fields })));
    log.info('x', { accessToken: 'segredo123', seat: 1 });
    restore();
    expect(lines[0]).not.toContain('segredo123');
  });
});

describe('assertSafeTestRedisUrl', () => {
  it('só host local e DB lógico diferente de 0', () => {
    expect(assertSafeTestRedisUrl('redis://localhost:6390/15')).toBeTruthy();
    expect(assertSafeTestRedisUrl('redis://127.0.0.1:6390/2')).toBeTruthy();
    for (const bad of [
      undefined,
      '',
      'redis://localhost:6390',
      'redis://localhost:6390/0',
      'redis://prod.example.com/15',
      'rediss://localhost/15',
      'http://localhost/1',
      'redis://localhost/abc',
    ]) {
      expect(() => assertSafeTestRedisUrl(bad)).toThrow();
    }
  });
});

tokenStoreContract('memória', () => new MemoryTokenStore());
