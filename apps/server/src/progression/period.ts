/**
 * Chaves de período das missões em `America/Sao_Paulo` (ADR 0009), calculadas com `Intl` (sem biblioteca
 * e sem job): `2026-11-04` (diária) e `2026-W45` (semanal ISO, semana de segunda a domingo).
 */
import { MISSION_TIME_ZONE } from '@trucaco/protocol';

const DAY_MS = 86_400_000;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MISSION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ano, mês (1 a 12) e dia da data no fuso das missões. */
export function localDate(at: Date): { year: number; month: number; day: number } {
  const parts = formatter.formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const pad = (n: number, size: number): string => String(n).padStart(size, '0');

/** `2026-11-04`. */
export function dayKey(at: Date): string {
  const { year, month, day } = localDate(at);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** `2026-W45`: semana ISO 8601 (a que contém a quinta-feira define o ano). */
export function weekKey(at: Date): string {
  const { year, month, day } = localDate(at);
  const date = Date.UTC(year, month - 1, day);
  const mondayBased = (new Date(date).getUTCDay() + 6) % 7;
  const thursday = date + (3 - mondayBased) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return `${pad(isoYear, 4)}-W${pad(week, 2)}`;
}

/** Chaves de período correntes: dia e semana. */
export function periodKeys(at: Date): { readonly daily: string; readonly weekly: string } {
  return { daily: dayKey(at), weekly: weekKey(at) };
}
