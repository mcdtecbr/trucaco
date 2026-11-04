import { describe, expect, it } from 'vitest';
import { dayKey, periodKeys, weekKey } from './period';

describe('period: chaves em America/Sao_Paulo', () => {
  it('dia e semana ISO de uma quarta-feira comum', () => {
    const at = new Date('2026-11-04T15:00:00Z');
    expect(dayKey(at)).toBe('2026-11-04');
    expect(weekKey(at)).toBe('2026-W45');
    expect(periodKeys(at)).toEqual({ daily: '2026-11-04', weekly: '2026-W45' });
  });

  it('a virada do dia é à meia-noite de Brasília (UTC-3), não de UTC', () => {
    // 02:59:59Z = 23:59:59 do dia 3 em Brasília; 03:00:00Z = 00:00:00 do dia 4.
    expect(dayKey(new Date('2026-11-04T02:59:59Z'))).toBe('2026-11-03');
    expect(dayKey(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04');
    // 22:00 em Brasília já é o dia seguinte em UTC, mas continua no dia local.
    expect(dayKey(new Date('2026-11-05T01:00:00Z'))).toBe('2026-11-04');
  });

  it('a semana vira na segunda-feira local', () => {
    // 2026-11-08 é domingo (W45); 2026-11-09 é segunda (W46).
    expect(weekKey(new Date('2026-11-09T02:59:59Z'))).toBe('2026-W45');
    expect(weekKey(new Date('2026-11-09T03:00:00Z'))).toBe('2026-W46');
  });

  it('bordas de ano: semana 53 e primeira semana do ano seguinte (ISO)', () => {
    // 2026-12-31 é quinta (W53); 2027-01-01 (sexta) ainda é W53 de 2026; 2027-01-04 (segunda) é W01.
    expect(weekKey(new Date('2026-12-31T12:00:00Z'))).toBe('2026-W53');
    expect(weekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(weekKey(new Date('2027-01-04T12:00:00Z'))).toBe('2027-W01');
    // 2024-12-30 (segunda) já pertence à W01 de 2025.
    expect(weekKey(new Date('2024-12-30T12:00:00Z'))).toBe('2025-W01');
  });

  it('o ano local vira à meia-noite de Brasília', () => {
    expect(dayKey(new Date('2027-01-01T02:59:59Z'))).toBe('2026-12-31');
    expect(dayKey(new Date('2027-01-01T03:00:00Z'))).toBe('2027-01-01');
  });
});
