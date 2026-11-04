import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../net/api';
import {
  BLOCKED_DONE_TEXT,
  REPORT_DONE_TEXT,
  openModeration,
  submitModeration,
} from './moderation';

const target = { userId: 'u-2', nickname: 'Beto', matchId: 'm-1' };

describe('submitModeration', () => {
  it('bloquear chama a API e termina com a mensagem honesta', async () => {
    const api = { block: vi.fn().mockResolvedValue(undefined), report: vi.fn() };
    const out = await submitModeration(openModeration('block', target), api);
    expect(api.block).toHaveBeenCalledWith('u-2');
    expect(out.done).toBe(BLOCKED_DONE_TEXT);
    expect(BLOCKED_DONE_TEXT).toContain('não afeta a partida em andamento');
  });

  it('denunciar manda motivo, partida e texto aparado; sem texto não manda a chave', async () => {
    const api = { block: vi.fn(), report: vi.fn().mockResolvedValue(undefined) };
    const base = { ...openModeration('report', target), reason: 'cheating' as const };
    await submitModeration({ ...base, text: '  fez trapaça  ' }, api);
    await submitModeration(base, api);
    expect(api.report).toHaveBeenNthCalledWith(1, {
      userId: 'u-2',
      matchId: 'm-1',
      reason: 'cheating',
      text: 'fez trapaça',
    });
    expect(api.report).toHaveBeenNthCalledWith(2, {
      userId: 'u-2',
      matchId: 'm-1',
      reason: 'cheating',
    });
    expect((await submitModeration(base, api)).done).toBe(REPORT_DONE_TEXT);
  });

  it('denúncia sem motivo não chama a API', async () => {
    const api = { block: vi.fn(), report: vi.fn() };
    await submitModeration(openModeration('report', target), api);
    expect(api.report).not.toHaveBeenCalled();
  });

  it('erro vira texto pt-BR (sem código cru) e o painel continua aberto', async () => {
    const api = {
      block: vi.fn(),
      report: vi
        .fn()
        .mockRejectedValue(new ApiError({ status: 429, code: 'RATE_LIMITED', kind: 'http' })),
    };
    const out = await submitModeration(
      { ...openModeration('report', target), reason: 'other' },
      api,
    );
    expect(out.done).toBeNull();
    expect(out.error).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.');
  });

  it('ignora toque duplo enquanto ocupado e depois de concluído', async () => {
    const api = { block: vi.fn(), report: vi.fn() };
    const busy = { ...openModeration('block', target), busy: true };
    expect(await submitModeration(busy, api)).toBe(busy);
    const done = { ...openModeration('block', target), done: 'ok' };
    expect(await submitModeration(done, api)).toBe(done);
    expect(api.block).not.toHaveBeenCalled();
  });
});
