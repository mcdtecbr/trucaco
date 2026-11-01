import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { createServer, type RunningServer } from './server';

describe('createServer', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await createServer({ port: 0 });
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /health responde ok com a versão do protocolo', async () => {
    expect(server.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', protocol: PROTOCOL_VERSION });
  });
});
