/**
 * Histórico de partidas para exibição (puro, sem rede nem UI). Só texto e números derivados de
 * `MatchSummaryResponse`; nenhuma carta e nenhum dado de adversário além do apelido e do id público.
 */
import type { MatchSummaryResponse, ReportReason, UserStats, VariantId } from '@trucaco/protocol';
import { REPORT_REASONS } from '@trucaco/protocol';

export const VARIANT_LABEL: Readonly<Record<VariantId, string>> = {
  paulista: 'Paulista',
  mineiro: 'Mineiro',
};

export const REPORT_REASON_LABEL: Readonly<Record<ReportReason, string>> = {
  cheating: 'Trapaça',
  abusive_chat: 'Chat ofensivo',
  offensive_nickname: 'Apelido ofensivo',
  harassment: 'Assédio',
  other: 'Outro motivo',
};

export const REPORT_REASON_OPTIONS = REPORT_REASONS.map((value) => ({
  value,
  label: REPORT_REASON_LABEL[value],
}));

export type MatchOutcome = 'won' | 'lost' | 'cancelled' | 'unknown';

export const OUTCOME_LABEL: Readonly<Record<MatchOutcome, string>> = {
  won: 'Vitória',
  lost: 'Derrota',
  cancelled: 'Cancelada',
  unknown: 'Sem resultado',
};

export interface HistoryPlayer {
  readonly seat: number;
  readonly name: string;
  readonly relation: 'self' | 'partner' | 'opponent' | 'unknown';
  /** Só humanos com conta ativa, que não sejam o próprio usuário, podem ser bloqueados ou denunciados. */
  readonly userId: string | null;
}

export interface HistoryRow {
  readonly id: string;
  readonly title: string;
  readonly outcome: MatchOutcome;
  readonly outcomeLabel: string;
  /** "Série 2 x 1" (melhor de 3) ou "Placar 12 x 9" (partida única), do ponto de vista do usuário. */
  readonly scoreLabel: string | null;
  readonly dateLabel: string;
  readonly durationLabel: string | null;
  readonly players: readonly HistoryPlayer[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

interface GameLine {
  readonly winnerTeam: 0 | 1 | null;
  readonly scores: readonly [number, number] | null;
}

/** `games` é JSON do servidor tratado como opaco: lê só o que usa e ignora o resto. */
function readGames(games: readonly unknown[]): GameLine[] {
  const out: GameLine[] = [];
  for (const g of games) {
    if (!isRecord(g)) continue;
    const w = g['winnerTeam'];
    const s = g['scores'];
    const scores =
      Array.isArray(s) && s.length === 2 && s.every((n) => typeof n === 'number' && n >= 0)
        ? ([s[0] as number, s[1] as number] as const)
        : null;
    out.push({ winnerTeam: w === 0 || w === 1 ? w : null, scores });
  }
  return out;
}

export function formatDuration(startedAt: string, endedAt: string): string | null {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Data e hora no fuso do aparelho. `Invalid Date` vira texto neutro. */
export function formatLocalDate(iso: string, locale = 'pt-BR'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Data indisponível';
  return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

function scoreOf(m: MatchSummaryResponse, myTeam: 0 | 1 | null): string | null {
  if (myTeam === null || m.status !== 'finished') return null;
  const other: 0 | 1 = myTeam === 0 ? 1 : 0;
  const games = readGames(m.games);
  if (games.length === 0) return null;
  if (m.format === 'bo3') {
    const mine = games.filter((g) => g.winnerTeam === myTeam).length;
    const theirs = games.filter((g) => g.winnerTeam === other).length;
    return `Série ${mine} x ${theirs}`;
  }
  const last = games[games.length - 1];
  if (last?.scores == null) return null;
  return `Placar ${last.scores[myTeam]} x ${last.scores[other]}`;
}

export function toHistoryRow(m: MatchSummaryResponse, myUserId: string): HistoryRow {
  const me = m.players.find((p) => p.userId === myUserId);
  const myTeam = me?.team ?? null;
  let outcome: MatchOutcome = 'unknown';
  if (m.status === 'cancelled') outcome = 'cancelled';
  else if (m.winnerTeam !== null && myTeam !== null)
    outcome = m.winnerTeam === myTeam ? 'won' : 'lost';
  const players: HistoryPlayer[] = [...m.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const self = p.userId !== null && p.userId === myUserId;
      let relation: HistoryPlayer['relation'] = 'unknown';
      if (self) relation = 'self';
      else if (myTeam !== null) relation = p.team === myTeam ? 'partner' : 'opponent';
      const name =
        p.nickname ?? (p.userId === null && p.botFrom !== null ? 'Bot' : 'Jogador removido');
      return {
        seat: p.seat,
        name,
        relation,
        userId: !self && p.userId !== null && p.nickname !== null ? p.userId : null,
      };
    });
  const variant = VARIANT_LABEL[m.variant] ?? m.variant;
  return {
    id: m.id,
    title: `${variant} · ${m.format === 'bo3' ? 'Melhor de 3' : 'Partida única'}`,
    outcome,
    outcomeLabel: OUTCOME_LABEL[outcome],
    scoreLabel: scoreOf(m, myTeam),
    dateLabel: formatLocalDate(m.endedAt),
    durationLabel: formatDuration(m.startedAt, m.endedAt),
    players,
  };
}

export const RELATION_LABEL: Readonly<Record<HistoryPlayer['relation'], string>> = {
  self: 'Você',
  partner: 'Parceiro',
  opponent: 'Adversário',
  unknown: 'Jogador',
};

/** Estatísticas ainda não contabilizadas (servidor devolve zeros até o bloco 6E): nada de números falsos. */
export function hasStats(stats: UserStats | null | undefined): boolean {
  if (stats === null || stats === undefined) return false;
  return Object.values(stats).some((v) => v.played > 0);
}

export function statLine(variant: VariantId, stats: UserStats): string {
  const s = stats[variant];
  return `${VARIANT_LABEL[variant]}: ${s.played} partidas, ${s.won} vitórias`;
}

export const PROVIDER_LABEL = {
  guest: 'Convidado',
  google: 'Conta Google',
  apple: 'Conta Apple',
} as const;
