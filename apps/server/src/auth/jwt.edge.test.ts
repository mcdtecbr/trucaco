import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AuthConfig } from './config';
import { AccessTokenService, InvalidTokenError } from './jwt';

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
const svc = new AccessTokenService(CFG);
const mk = (jti: string, sub: unknown = USER) =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('trucaco')
    .setAudience('trucaco-api')
    .setSubject(sub as string)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(SECRET);

describe('AccessTokenService: bordas do jti e do tipo de entrada', () => {
  it('jti curto demais (< 8) ou longo demais (> 64) é recusado mesmo com assinatura válida', async () => {
    await expect(svc.verify(await mk('curto'))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(svc.verify(await mk('x'.repeat(65)))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(svc.verify(await mk('x'.repeat(8)))).resolves.toMatchObject({ userId: USER });
    await expect(svc.verify(await mk('x'.repeat(64)))).resolves.toMatchObject({ userId: USER });
  });

  it('entrada que não é string, vazia ou acima de 1024 caracteres: InvalidTokenError sem tocar na assinatura', async () => {
    for (const bad of [undefined, null, 42, {}, '', 'a'.repeat(1025)]) {
      await expect(svc.verify(bad as unknown as string)).rejects.toBeInstanceOf(InvalidTokenError);
    }
  });

  it('a mensagem do erro não revela o motivo (sem oráculo entre expirado, assinatura e claims)', async () => {
    const msgs = new Set<string>();
    for (const t of ['lixo', await mk('curto'), `${await mk('x'.repeat(8))}x`]) {
      await svc.verify(t).catch((e: Error) => msgs.add(e.message));
    }
    expect(msgs.size).toBe(1);
  });
});
