import { describe, expect, it, vi } from 'vitest';
import type { ResumeOutcome, TableResumeController } from '../room/tableResume';
import { decideBoot, noticeFor } from './bootResume';

const REC = { reconnectionToken: 'r:t', code: 'ABCDEFGH', userId: 'u1' };

function controller(pending: typeof REC | null, outcome: ResumeOutcome): TableResumeController {
  return {
    pending: vi.fn(() => Promise.resolve(pending)),
    run: vi.fn(() => Promise.resolve(outcome)),
  };
}

describe('decideBoot', () => {
  it('sem mesa guardada: vai ao início sem aviso e sem mostrar "reconectando"', async () => {
    const onResuming = vi.fn();
    const c = controller(null, { kind: 'none' });
    expect(await decideBoot(c, { onResuming })).toEqual({ kind: 'home', notice: null });
    expect(onResuming).not.toHaveBeenCalled();
    expect(c.run).not.toHaveBeenCalled();
  });

  it('com mesa guardada: mostra "reconectando" ANTES de tentar e vai para a mesa', async () => {
    const order: string[] = [];
    const c = controller(REC, { kind: 'resumed', code: 'ABCDEFGH' });
    vi.mocked(c.run).mockImplementation(() => {
      order.push('run');
      return Promise.resolve({ kind: 'resumed', code: 'ABCDEFGH' });
    });
    const d = await decideBoot(c, { onResuming: () => order.push('mostra') });
    expect(order).toEqual(['mostra', 'run']);
    expect(d).toEqual({ kind: 'table', code: 'ABCDEFGH' });
  });

  it('falha: início com aviso claro (mesa perdida ou indisponível)', async () => {
    const lost = controller(REC, { kind: 'failed', reason: 'gone', errorCode: 'ROOM_NOT_FOUND' });
    expect(await decideBoot(lost, { onResuming: vi.fn() })).toEqual({
      kind: 'home',
      notice: 'tableLost',
      code: 'ABCDEFGH', // a tela inicial preenche o campo de código
    });
    const down = controller(REC, { kind: 'failed', reason: 'unavailable', errorCode: 'NETWORK' });
    expect(await decideBoot(down, { onResuming: vi.fn() })).toEqual({
      kind: 'home',
      notice: 'tableUnavailable',
      code: 'ABCDEFGH',
    });
  });

  it('sessão perdida na retomada: reinicia a sessão (o aviso de sessão perdida já existe)', async () => {
    const c = controller(REC, { kind: 'failed', reason: 'session', errorCode: 'TOKEN_EXPIRED' });
    expect(await decideBoot(c, { onResuming: vi.fn() })).toEqual({ kind: 'restartSession' });
  });

  it('já conectado a uma sala (retomada deu certo e a splash remontou): volta para ELA, nunca retoma por cima', async () => {
    const c = controller(REC, { kind: 'resumed', code: 'ABCDEFGH' });
    const d = await decideBoot(c, { onResuming: vi.fn(), heldRoomCode: () => 'ZZZZZZZZ' });
    expect(d).toEqual({ kind: 'table', code: 'ZZZZZZZZ' });
    expect(c.pending).not.toHaveBeenCalled();
    expect(c.run).not.toHaveBeenCalled();
  });

  it('sala conectada mas código ainda desconhecido: início, sem retomar', async () => {
    const c = controller(REC, { kind: 'resumed', code: 'ABCDEFGH' });
    const d = await decideBoot(c, { onResuming: vi.fn(), heldRoomCode: () => '' });
    expect(d).toEqual({ kind: 'home', notice: null });
    expect(c.run).not.toHaveBeenCalled();
  });

  it('sem sala conectada, heldRoomCode nulo não interfere', async () => {
    const c = controller(null, { kind: 'none' });
    expect(await decideBoot(c, { onResuming: vi.fn(), heldRoomCode: () => null })).toEqual({
      kind: 'home',
      notice: null,
    });
  });

  it('leitura do armazenamento que falha equivale a sem registro', async () => {
    const c: TableResumeController = {
      pending: () => Promise.reject(new Error('x')),
      run: vi.fn(),
    };
    expect(await decideBoot(c, { onResuming: vi.fn() })).toEqual({ kind: 'home', notice: null });
  });

  it('mapeia o motivo da falha para o aviso', () => {
    expect(noticeFor('gone')).toBe('tableLost');
    expect(noticeFor('session')).toBe('tableLost');
    expect(noticeFor('unavailable')).toBe('tableUnavailable');
  });
});
