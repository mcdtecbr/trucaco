import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { setLogSink } from './logger';
import { SlidingWindowLimiter, clientKey, trustedIpFromHeaders } from './rateLimit';

describe('SlidingWindowLimiter: record e count', () => {
  it('record conta sem checar limite; count não registra nem reordena', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    for (let i = 0; i < 5; i++) l.record('k', 100 + i);
    expect(l.count('k', 200)).toBe(5);
    expect(l.count('k', 200)).toBe(5);
    expect(l.count('outra', 200)).toBe(0);
    expect(l.count('k', 1101)).toBe(3); // 100 e 101 saíram da janela
  });

  it('janela deslizante e teto de chaves valem para record', () => {
    const l = new SlidingWindowLimiter(1, 1000, 3);
    for (let i = 0; i < 10; i++) l.record(`k${i}`, 1);
    expect(l.size).toBe(3);
    l.record('x', 5000);
    expect(l.count('x', 5500)).toBe(1);
    expect(l.count('x', 6001)).toBe(0);
  });
});

describe('clientKey e trustedIpFromHeaders: TRUST_PROXY por modo', () => {
  const req = (headers: Record<string, string | string[]>, remote = '10.0.0.9'): IncomingMessage =>
    ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

  it('false ignora todos os cabeçalhos e usa o socket', () => {
    const r = req({ 'x-forwarded-for': '1.1.1.1', 'fly-client-ip': '2.2.2.2' });
    expect(clientKey(r, false)).toBe('10.0.0.9');
  });

  it('true usa o ÚLTIMO item de X-Forwarded-For (também quando vem repetido)', () => {
    expect(clientKey(req({ 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }), true)).toBe('7.7.7.7');
    expect(clientKey(req({ 'x-forwarded-for': ['1.1.1.1', '5.5.5.5'] }), true)).toBe('5.5.5.5');
    expect(clientKey(req({}), true)).toBe('10.0.0.9');
  });

  it('{ header } usa o valor inteiro do cabeçalho nomeado e ignora X-Forwarded-For', () => {
    const trust = { header: 'Fly-Client-IP' };
    const r = req({ 'fly-client-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' });
    expect(clientKey(r, trust)).toBe('203.0.113.7');
    // IPv6 vira o prefixo /64, como no socket
    expect(clientKey(req({ 'fly-client-ip': '2001:db8:1:2:3:4:5:6' }), trust)).toBe(
      '2001:db8:1:2::/64',
    );
  });

  it('{ header } ausente ou vazio cai no IP do socket (não confia em XFF)', () => {
    const trust = { header: 'fly-client-ip' };
    expect(clientKey(req({ 'x-forwarded-for': '1.1.1.1' }), trust)).toBe('10.0.0.9');
    expect(clientKey(req({ 'fly-client-ip': '  ' }), trust)).toBe('10.0.0.9');
  });

  it('{ header: "X-Forwarded-For" } equivale a true (último item)', () => {
    expect(
      clientKey(req({ 'x-forwarded-for': '1.1.1.1, 4.4.4.4' }), { header: 'X-Forwarded-For' }),
    ).toBe('4.4.4.4');
  });

  it('trustedIpFromHeaders (matchmaker): null sem proxy confiável ou sem cabeçalho', () => {
    const h = new Headers({ 'x-forwarded-for': '1.1.1.1, 6.6.6.6', 'fly-client-ip': '9.9.9.9' });
    expect(trustedIpFromHeaders(h, false)).toBeNull();
    expect(trustedIpFromHeaders(h, true)).toBe('6.6.6.6');
    expect(trustedIpFromHeaders(h, { header: 'fly-client-ip' })).toBe('9.9.9.9');
    expect(trustedIpFromHeaders(h, { header: 'x-outro' })).toBeNull();
    expect(trustedIpFromHeaders(undefined, true)).toBeNull();
  });

  it('valor que não é IP não vale: cai no socket e loga aviso (sem o valor)', () => {
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    try {
      const trust = { header: 'fly-client-ip' };
      for (const bad of ['lixo', '1.2.3', '1.1.1.1; DROP', '999.1.1.1', '<script>']) {
        expect(clientKey(req({ 'fly-client-ip': bad }), trust), bad).toBe('10.0.0.9');
      }
      expect(clientKey(req({ 'x-forwarded-for': '1.1.1.1, nao-ip' }), true)).toBe('10.0.0.9');
      expect(trustedIpFromHeaders(new Headers({ 'fly-client-ip': 'lixo' }), trust)).toBeNull();
      // IP válido (v4, v6 e v6 entre colchetes) segue valendo
      expect(clientKey(req({ 'fly-client-ip': '203.0.113.5' }), trust)).toBe('203.0.113.5');
      expect(clientKey(req({ 'fly-client-ip': '[2001:db8::1]' }), trust)).toBe('2001:db8:0:0::/64');
    } finally {
      restore();
    }
    // aviso limitado a 1 por minuto, sem vazar o valor do cabeçalho
    expect(lines.filter((l) => l.includes('sem IP válido'))).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('lixo');
    expect(lines.join('\n')).toContain('fly-client-ip');
  });
});
