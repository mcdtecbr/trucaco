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
  refreshReuseGraceSec: 20,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};
const USER = randomUUID();

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('loadServerConfig', () => {
  const base = { NODE_ENV: 'production', REDIS_URL: 'redis://localhost:6380' };
  const secret = 'aB3dE5gH7jK9mN1pQ3sT5vX7zC9fL2oR4uW6yA8d';

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

  it('segredo de entropia obviamente baixa é recusado (também em dev/test)', () => {
    for (const weak of ['x'.repeat(40), 'ab'.repeat(20), '1234567'.repeat(6)]) {
      expect(() => loadServerConfig({ ...base, JWT_SECRET: weak })).toThrow(/entropia/);
      expect(() => loadServerConfig({ NODE_ENV: 'test', JWT_SECRET: weak })).toThrow(/entropia/);
    }
  });

  it('janela de graça e teto da família: padrões e limites', () => {
    const ok = { ...base, JWT_SECRET: secret };
    expect(loadServerConfig(ok).auth).toMatchObject({
      refreshReuseGraceSec: 20,
      refreshFamilyMaxSec: 7_776_000,
    });
    expect(
      loadServerConfig({ ...ok, REFRESH_REUSE_GRACE_SECONDS: '0' }).auth.refreshReuseGraceSec,
    ).toBe(0);
    expect(
      loadServerConfig({ ...ok, REFRESH_REUSE_GRACE_SECONDS: '60' }).auth.refreshReuseGraceSec,
    ).toBe(60);
    for (const bad of ['-1', '61', 'x', '1.5']) {
      expect(() => loadServerConfig({ ...ok, REFRESH_REUSE_GRACE_SECONDS: bad })).toThrow(/GRACE/);
    }
    expect(() => loadServerConfig({ ...ok, REFRESH_FAMILY_MAX_SECONDS: '10' })).toThrow(
      /FAMILY_MAX/,
    );
    expect(
      loadServerConfig({ ...ok, REFRESH_FAMILY_MAX_SECONDS: '86400' }).auth.refreshFamilyMaxSec,
    ).toBe(86400);
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

  it('login social: sem variáveis fica desligado; client IDs viram lista limpa; verificador de teste só em dev/test', () => {
    const ok = { ...base, JWT_SECRET: secret };
    expect(loadServerConfig(ok).social).toEqual({
      googleClientIds: [],
      appleClientIds: [],
      testIdentity: false,
    });
    expect(
      loadServerConfig({
        ...ok,
        GOOGLE_CLIENT_IDS: ' a.apps.googleusercontent.com, ,b ,a.apps.googleusercontent.com',
        APPLE_CLIENT_IDS: 'com.mcdtec.trucaco',
      }).social,
    ).toMatchObject({
      googleClientIds: ['a.apps.googleusercontent.com', 'b'],
      appleClientIds: ['com.mcdtec.trucaco'],
    });
    expect(loadServerConfig({ ...ok, GOOGLE_CLIENT_IDS: '   ' }).social.googleClientIds).toEqual(
      [],
    );
    expect(() => loadServerConfig({ ...ok, GOOGLE_CLIENT_IDS: 'com espaco' })).toThrow(
      /GOOGLE_CLIENT_IDS/,
    );
    expect(() => loadServerConfig({ ...ok, APPLE_CLIENT_IDS: 'x'.repeat(257) })).toThrow(
      /APPLE_CLIENT_IDS/,
    );
    // verificador de teste: fail-closed fora de development/test
    expect(() => loadServerConfig({ ...ok, AUTH_TEST_IDENTITY: '1' })).toThrow(
      /AUTH_TEST_IDENTITY/,
    );
    expect(
      loadServerConfig({ NODE_ENV: 'test', AUTH_TEST_IDENTITY: '1' }).social.testIdentity,
    ).toBe(true);
    expect(loadServerConfig({ ...ok, AUTH_TEST_IDENTITY: '0' }).social.testIdentity).toBe(false);
    expect(() => loadServerConfig({ NODE_ENV: 'test', AUTH_TEST_IDENTITY: 'sim' })).toThrow(
      /AUTH_TEST_IDENTITY/,
    );
    expect(loadServerConfig(ok).limits.socialPerIpPerMin).toBe(20);
    expect(
      loadServerConfig({ ...ok, AUTH_SOCIAL_PER_IP_PER_MIN: '5' }).limits.socialPerIpPerMin,
    ).toBe(5);
    expect(() => loadServerConfig({ ...ok, AUTH_SOCIAL_PER_IP_PER_MIN: '0' })).toThrow();
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
  const setup = (over: Partial<AuthConfig> = {}) => {
    const repos = createMemoryRepositories();
    const tokens = new MemoryTokenStore(() => now);
    const auth = new AuthService(repos.users, tokens, { ...CFG, ...over }, () => now);
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
    // reuso do 1º FORA da janela de graça: derruba tudo
    now += 21_000;
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(auth.refresh(third.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    // o access da última rotação (lastJti) foi revogado
    await expect(auth.authenticateAccess(third.accessToken)).rejects.toBeInstanceOf(AuthError);
  });

  /** Segundo aparelho do mesmo usuário: outra família de refresh com o seu próprio access. */
  const secondDevice = async (
    auth: AuthService,
    tokens: MemoryTokenStore,
    userId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> => {
    const refreshToken = randomBytesB64();
    const access = await auth.jwt.sign(userId);
    await tokens.createFamily({
      familyId: randomUUID(),
      userId,
      refreshHash: hashRefresh(refreshToken),
      jti: access.jti,
      ttlSec: 3600,
    });
    return { accessToken: access.token, refreshToken };
  };
  const randomBytesB64 = (): string =>
    Buffer.from(randomUUID() + randomUUID())
      .toString('base64url')
      .slice(0, 43);

  it('logout { all }: o access vigente de OUTRO aparelho morre junto (não espera o TTL)', async () => {
    const { auth, tokens } = setup();
    const g = await auth.createGuest();
    const other = await secondDevice(auth, tokens, g.user.id);
    const principal = await auth.authenticateAccess(g.pair.accessToken);
    await auth.logout(principal, { all: true });
    await expect(auth.authenticateAccess(g.pair.accessToken)).rejects.toBeInstanceOf(AuthError);
    await expect(auth.authenticateAccess(other.accessToken)).rejects.toBeInstanceOf(AuthError);
    await expect(auth.refresh(other.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('logout { all } NÃO derruba o access de outro usuário', async () => {
    const { auth } = setup();
    const a = await auth.createGuest();
    const b = await auth.createGuest();
    await auth.logout(await auth.authenticateAccess(a.pair.accessToken), { all: true });
    await expect(auth.authenticateAccess(b.pair.accessToken)).resolves.toBeDefined();
  });

  it('logout por refreshToken depois de uma rotação: o access NOVO (lastJti) também morre', async () => {
    const { auth } = setup();
    const g = await auth.createGuest();
    const rotated = await auth.refresh(g.pair.refreshToken);
    // o logout chega com o access ANTIGO (principal) e o refresh novo: a rotação já tinha ocorrido
    const principal = await auth.authenticateAccess(g.pair.accessToken);
    await auth.logout(principal, { refreshToken: rotated.refreshToken });
    await expect(auth.authenticateAccess(rotated.accessToken)).rejects.toBeInstanceOf(AuthError);
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

  it('concorrência sem graça: dois refresh com o mesmo token, só um vence', async () => {
    const { auth } = setup({ refreshReuseGraceSec: 0 });
    const g = await auth.createGuest();
    const results = await Promise.allSettled([
      auth.refresh(g.pair.refreshToken),
      auth.refresh(g.pair.refreshToken),
      auth.refresh(g.pair.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('concorrência com graça: no máximo o original e UM irmão; o terceiro revoga a família', async () => {
    const { auth } = setup();
    const g = await auth.createGuest();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => auth.refresh(g.pair.refreshToken)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('graça: resposta perdida (mesmo token reapresentado) devolve par novo, e o ramo perdido não atrapalha', async () => {
    const { auth } = setup();
    const g = await auth.createGuest();
    const lost = await auth.refresh(g.pair.refreshToken); // a resposta "se perdeu"
    now += 3_000;
    const retry = await auth.refresh(g.pair.refreshToken); // o cliente repete
    expect(retry.refreshToken).not.toBe(lost.refreshToken);
    await expect(auth.authenticateAccess(retry.accessToken)).resolves.toBeDefined();
    // o cliente segue com o par da retentativa
    const next = await auth.refresh(retry.refreshToken);
    await expect(auth.authenticateAccess(next.accessToken)).resolves.toBeDefined();
    // reapresentar o original DE NOVO (2ª vez) já é reuso: revoga tudo
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(auth.refresh(next.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('graça: fora da janela (ou com graça 0) o reuso revoga a família', async () => {
    const a = setup();
    const g = await a.auth.createGuest();
    await a.auth.refresh(g.pair.refreshToken);
    now += 21_000;
    await expect(a.auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    const b = setup({ refreshReuseGraceSec: 0 });
    const h = await b.auth.createGuest();
    const second = await b.auth.refresh(h.pair.refreshToken);
    await expect(b.auth.refresh(h.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(b.auth.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
  });

  it('falha do banco ANTES de rotacionar não gasta o refresh token', async () => {
    const { auth, repos } = setup();
    const g = await auth.createGuest();
    const real = repos.users.findById.bind(repos.users);
    let failures = 1;
    repos.users.findById = async (id: string) => {
      if (failures-- > 0) throw new Error('banco fora');
      return real(id);
    };
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toThrow('banco fora');
    // o mesmo token continua válido e a família NÃO foi revogada
    const pair = await auth.refresh(g.pair.refreshToken);
    await expect(auth.authenticateAccess(pair.accessToken)).resolves.toBeDefined();
  });

  it('teto absoluto da família: a rotação não renova além de createdAt + REFRESH_FAMILY_MAX', async () => {
    const { auth } = setup({ refreshTtlSec: 3600, refreshFamilyMaxSec: 7200 });
    const g = await auth.createGuest();
    now += 3_000_000;
    const a = await auth.refresh(g.pair.refreshToken); // t=3000 s
    now += 3_000_000;
    const b = await auth.refresh(a.refreshToken); // t=6000 s: expira em 7200, não em 9600
    now += 1_201_000; // t=7201 s: dentro do TTL de 3600 s, mas além do teto
    await expect(auth.refresh(b.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
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

  it('redige refresh token (43 caracteres base64url) em campo inocente e dentro da msg', async () => {
    const refresh = 'aB3dE5gH7jK9mN1pQ3sT5vX7zC9fL2oR4uW6yA8dEfG'.slice(0, 43);
    expect(refresh).toHaveLength(43);
    expect(redact({ note: refresh, uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })).toEqual({
      note: REDACTED,
      uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
    const { log } = await import('../logger');
    const lines: string[] = [];
    const restore = setLogSink((_l, msg) => lines.push(msg));
    log.warn(`falhou com ${refresh} e Bearer abc.def`);
    restore();
    expect(lines[0]).not.toContain(refresh);
    expect(lines[0]).toContain(REDACTED);
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

tokenStoreContract('memória', (clock) => new MemoryTokenStore(clock));
