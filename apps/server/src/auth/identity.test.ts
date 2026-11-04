/**
 * `JwksIdentityVerifier` com um JWKS local (chaves geradas no teste) e `TestIdentityVerifier`.
 * Cobre assinatura, `iss`, `aud`, `exp`, `nonce`, algoritmo, `email_verified` e provedor desligado.
 */
import { createHash } from 'node:crypto';
import { SignJWT, createLocalJWKSet, errors, exportJWK, generateKeyPair } from 'jose';
import type { JWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { setLogSink } from '../logger';
import {
  DISABLED_IDENTITY,
  IdentityUnavailableError,
  InvalidIdTokenError,
  JwksIdentityVerifier,
  TestIdentityVerifier,
  buildIdentityVerifier,
  enabledProviders,
} from './identity';

const GOOGLE_AUD = 'google-client.apps.googleusercontent.com';
const APPLE_AUD = 'com.mcdtec.trucaco';

interface Keys {
  priv: CryptoKey;
  jwk: JWK;
}
async function makeKeys(kid: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  return {
    priv: privateKey,
    jwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' },
  };
}

async function setup() {
  const good = await makeKeys('good');
  const evil = await makeKeys('good'); // mesmo kid, chave outra: assinatura tem de falhar
  const jwks = createLocalJWKSet({ keys: [good.jwk] });
  const verifier = new JwksIdentityVerifier({
    clientIds: { google: [GOOGLE_AUD, 'outro-google'], apple: [APPLE_AUD] },
    keys: { google: jwks, apple: jwks },
  });
  const sign = (
    claims: Record<string, unknown>,
    o: {
      key?: CryptoKey;
      iss?: string;
      aud?: string | string[];
      exp?: number | string;
      alg?: string;
    } = {},
  ): Promise<string> => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: o.alg ?? 'RS256', kid: 'good' })
      .setIssuer(o.iss ?? 'https://accounts.google.com')
      .setAudience(o.aud ?? GOOGLE_AUD)
      .setIssuedAt()
      .setExpirationTime(o.exp ?? '1h');
    return jwt.sign(o.key ?? good.priv);
  };
  return { good, evil, verifier, sign };
}

describe('JwksIdentityVerifier', () => {
  it('aceita token válido do Google e devolve só sub e expiração', async () => {
    const { verifier, sign } = await setup();
    const out = await verifier.verify('google', await sign({ sub: '1234567890' }));
    expect(out.subject).toBe('1234567890');
    expect(out.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(out.email).toBeUndefined();
  });

  it('aceita os dois emissores do Google, qualquer client ID configurado e aud em lista', async () => {
    const { verifier, sign } = await setup();
    for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
      await expect(
        verifier.verify('google', await sign({ sub: 'a' }, { iss })),
      ).resolves.toBeDefined();
    }
    await expect(
      verifier.verify('google', await sign({ sub: 'a' }, { aud: 'outro-google' })),
    ).resolves.toBeDefined();
    await expect(
      verifier.verify('google', await sign({ sub: 'a' }, { aud: ['x', GOOGLE_AUD] })),
    ).resolves.toBeDefined();
  });

  it('Apple: iss próprio e aud do bundle', async () => {
    const { verifier, sign } = await setup();
    const ok = await sign(
      { sub: '000123.abc' },
      { iss: 'https://appleid.apple.com', aud: APPLE_AUD },
    );
    expect((await verifier.verify('apple', ok)).subject).toBe('000123.abc');
    // emissor do Google no provedor Apple: recusado
    await expect(
      verifier.verify('apple', await sign({ sub: 'a' }, { aud: APPLE_AUD })),
    ).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  it('recusa assinatura de outra chave, emissor errado, audiência errada e token expirado', async () => {
    const { verifier, sign, evil } = await setup();
    const bad: string[] = [
      await sign({ sub: 'a' }, { key: evil.priv }),
      await sign({ sub: 'a' }, { iss: 'https://evil.example' }),
      await sign({ sub: 'a' }, { aud: 'client-de-outro-app' }),
      await sign({ sub: 'a' }, { aud: ['x', 'y'] }),
      await sign({ sub: 'a' }, { exp: Math.floor(Date.now() / 1000) - 3600 }),
    ];
    for (const token of bad) {
      await expect(verifier.verify('google', token)).rejects.toBeInstanceOf(InvalidIdTokenError);
    }
  });

  it('recusa token do Apple apresentado como Google e vice-versa (aud/iss cruzados)', async () => {
    const { verifier, sign } = await setup();
    const apple = await sign({ sub: 'a' }, { iss: 'https://appleid.apple.com', aud: APPLE_AUD });
    await expect(verifier.verify('google', apple)).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  it('recusa sub ausente, vazio ou longo demais, e algoritmo diferente de RS256', async () => {
    const { verifier, sign, good } = await setup();
    await expect(verifier.verify('google', await sign({}))).rejects.toBeInstanceOf(
      InvalidIdTokenError,
    );
    await expect(verifier.verify('google', await sign({ sub: '' }))).rejects.toBeInstanceOf(
      InvalidIdTokenError,
    );
    await expect(
      verifier.verify('google', await sign({ sub: 'x'.repeat(256) })),
    ).rejects.toBeInstanceOf(InvalidIdTokenError);
    // alg=none e HS256 com a chave pública como segredo: nunca passam
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({
        sub: 'a',
        iss: 'https://accounts.google.com',
        aud: GOOGLE_AUD,
        exp: 9999999999,
      }),
    ).toString('base64url')}.`;
    await expect(verifier.verify('google', none)).rejects.toBeInstanceOf(InvalidIdTokenError);
    const hs = await new SignJWT({ sub: 'a' })
      .setProtectedHeader({ alg: 'HS256', kid: 'good' })
      .setIssuer('https://accounts.google.com')
      .setAudience(GOOGLE_AUD)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JSON.stringify(good.jwk)));
    await expect(verifier.verify('google', hs)).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  it('lixo, vazio e formato quebrado viram InvalidIdTokenError', async () => {
    const { verifier } = await setup();
    for (const t of ['', 'a', 'a.b', 'a.b.c', '....', 'x'.repeat(4096)]) {
      await expect(verifier.verify('google', t)).rejects.toBeInstanceOf(InvalidIdTokenError);
    }
  });

  it('nonce: confere cru (Google) ou em SHA-256 (Apple); ausente ou diferente é recusado', async () => {
    const { verifier, sign } = await setup();
    const raw = 'nonce-do-cliente-123';
    const withRaw = await sign({ sub: 'a', nonce: raw });
    await expect(verifier.verify('google', withRaw, raw)).resolves.toBeDefined();
    const hashed = createHash('sha256').update(raw).digest('hex');
    const withHash = await sign({ sub: 'a', nonce: hashed });
    await expect(verifier.verify('google', withHash, raw)).resolves.toBeDefined();
    await expect(verifier.verify('google', withRaw, 'outro')).rejects.toBeInstanceOf(
      InvalidIdTokenError,
    );
    // token sem nonce, mas o cliente enviou um: não dá para provar o vínculo
    await expect(verifier.verify('google', await sign({ sub: 'a' }), raw)).rejects.toBeInstanceOf(
      InvalidIdTokenError,
    );
    // nonce numérico na claim não passa
    await expect(
      verifier.verify('google', await sign({ sub: 'a', nonce: 5 }), '5'),
    ).rejects.toBeInstanceOf(InvalidIdTokenError);
    // sem nonce na requisição, a claim não é exigida
    await expect(verifier.verify('google', withRaw)).resolves.toBeDefined();
  });

  it('e-mail só sai se verificado (boolean ou "true"); nunca de claim não verificada', async () => {
    const { verifier, sign } = await setup();
    const v = async (claims: Record<string, unknown>) =>
      (await verifier.verify('google', await sign({ sub: 'a', ...claims }))).email;
    expect(await v({ email: 'a@b.c', email_verified: true })).toBe('a@b.c');
    expect(await v({ email: 'a@b.c', email_verified: 'true' })).toBe('a@b.c');
    expect(await v({ email: 'a@b.c', email_verified: false })).toBeUndefined();
    expect(await v({ email: 'a@b.c', email_verified: 'false' })).toBeUndefined();
    expect(await v({ email: 'a@b.c' })).toBeUndefined();
    expect(await v({ email: 5, email_verified: true })).toBeUndefined();
    expect(await v({ email: '', email_verified: true })).toBeUndefined();
  });

  it('provedor sem client ID fica desligado e recusa mesmo token bom', async () => {
    const { good } = await setup();
    const jwks = createLocalJWKSet({ keys: [good.jwk] });
    const onlyApple = new JwksIdentityVerifier({
      clientIds: { google: [], apple: [APPLE_AUD] },
      keys: { google: jwks, apple: jwks },
    });
    expect(onlyApple.isEnabled('google')).toBe(false);
    expect(onlyApple.isEnabled('apple')).toBe(true);
    expect(enabledProviders(onlyApple)).toEqual(['apple']);
    const token = await new SignJWT({ sub: 'a' })
      .setProtectedHeader({ alg: 'RS256', kid: 'good' })
      .setIssuer('https://accounts.google.com')
      .setAudience(GOOGLE_AUD)
      .setExpirationTime('1h')
      .sign(good.priv);
    await expect(onlyApple.verify('google', token)).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  it('o erro não carrega a causa nem o token', async () => {
    const { verifier } = await setup();
    const err = await verifier.verify('google', 'segredo.no.token').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidIdTokenError);
    expect(String((err as Error).message)).not.toContain('segredo');
    expect((err as Error).cause).toBeUndefined();
  });
});

describe('JWKS indisponível x token inválido', () => {
  const make = (err: Error) =>
    new JwksIdentityVerifier({
      clientIds: { google: [GOOGLE_AUD], apple: [] },
      keys: {
        google: (async () => {
          throw err;
        }) as never,
      },
    });

  it('timeout, rede e resposta inesperada do JWKS viram IdentityUnavailableError (503)', async () => {
    const { sign } = await setup();
    const token = await sign({ sub: 'a' });
    for (const err of [
      new errors.JWKSTimeout(),
      new TypeError('fetch failed'),
      new errors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response'),
    ]) {
      await expect(make(err).verify('google', token)).rejects.toBeInstanceOf(
        IdentityUnavailableError,
      );
    }
  });

  it('kid desconhecido continua sendo token inválido (401)', async () => {
    const { sign } = await setup();
    const token = await sign({ sub: 'a' });
    await expect(
      make(new errors.JWKSNoMatchingKey()).verify('google', token),
    ).rejects.toBeInstanceOf(InvalidIdTokenError);
  });

  it('o log traz o nome do erro e nunca o token', async () => {
    const { sign } = await setup();
    const token = await sign({ sub: 'sub-secreto' });
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    try {
      await make(new errors.JWKSTimeout())
        .verify('google', token)
        .catch(() => undefined);
      await make(new errors.JWKSNoMatchingKey())
        .verify('google', token)
        .catch(() => undefined);
    } finally {
      restore();
    }
    const text = lines.join('\n');
    expect(text).toContain('JWKSTimeout');
    expect(text).toContain('JWKSNoMatchingKey');
    expect(text).not.toContain(token);
    expect(text).not.toContain('sub-secreto');
  });
});

describe('TestIdentityVerifier', () => {
  it('aceita test:<sub> e test:<sub>:<sufixo>; recusa o resto', async () => {
    const v = new TestIdentityVerifier('test');
    expect((await v.verify('google', 'test:ana')).subject).toBe('ana');
    expect((await v.verify('apple', 'test:ana:2')).subject).toBe('ana');
    for (const bad of ['', 'ana', 'test:', 'test:a b', 'test:a:b:c', `test:${'x'.repeat(65)}`]) {
      await expect(v.verify('google', bad)).rejects.toBeInstanceOf(InvalidIdTokenError);
    }
    expect(v.isEnabled()).toBe(true);
  });

  it('não existe fora de development/test (fail-closed)', () => {
    expect(() => new TestIdentityVerifier('production')).toThrow();
    expect(() => new TestIdentityVerifier(undefined)).toThrow();
    expect(() => new TestIdentityVerifier('development')).not.toThrow();
  });
});

describe('buildIdentityVerifier', () => {
  it('sem credenciais: tudo desligado', () => {
    const v = buildIdentityVerifier({
      googleClientIds: [],
      appleClientIds: [],
      testIdentity: false,
    });
    expect(v).toBe(DISABLED_IDENTITY);
    expect(enabledProviders(v)).toEqual([]);
  });

  it('com client IDs: só os provedores configurados ligam', () => {
    const v = buildIdentityVerifier({
      googleClientIds: ['g'],
      appleClientIds: [],
      testIdentity: false,
    });
    expect(enabledProviders(v)).toEqual(['google']);
  });

  it('o verificador desligado recusa verify', async () => {
    await expect(DISABLED_IDENTITY.verify('google', 'x')).rejects.toBeInstanceOf(
      InvalidIdTokenError,
    );
  });
});
