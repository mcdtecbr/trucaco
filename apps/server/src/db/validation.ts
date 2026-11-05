import {
  PARTNER_CODE_MAX_LENGTH,
  SIGNAL_IDS,
  cleanPartnerCode,
  isAchievementId,
  isMissionId,
  parseAvatarParts,
} from '@trucaco/protocol';
import type { AvatarParts, MissionId } from '@trucaco/protocol';
import {
  InvalidInputError,
  PROGRESS_CAP,
  PROGRESS_DELTA_MAX,
  type AchievementDelta,
  type FinishedMatchInput,
  type MissionDelta,
  type PartnerCodesMap,
  type UserProgressDelta,
} from './types';

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const PARTNER_CODE_MAX = PARTNER_CODE_MAX_LENGTH;
export const REPORT_TEXT_MAX = 500;
export const UINT32_MAX = 4294967295;
/** Tetos de tamanho (bytes de JSON) por coluna; os mesmos valores dos CHECKs `*_size_check`. */
export const JSON_LIMITS = {
  options: 16384,
  games: 65536,
  deals: 1048576,
  events: 2097152,
} as const;

function assertJsonSize(value: unknown, limit: number): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') >= limit) {
    throw new InvalidInputError('Conteúdo da partida grande demais.');
  }
}

/** Conta code points, como o `char_length` do Postgres. */
function length(text: string): number {
  return [...text].length;
}

/** Forma canônica do apelido (NFC). Deve ser aplicada ANTES de validar e de gravar. */
export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC');
}

/** Normaliza (NFC), valida e devolve o apelido a gravar. Lança `InvalidInputError`. */
export function validateNickname(raw: string): string {
  const nickname = normalizeNickname(raw);
  const n = length(nickname);
  if (n < NICKNAME_MIN || n > NICKNAME_MAX || !NICKNAME_PATTERN.test(nickname)) {
    throw new InvalidInputError(
      `Apelido deve ter ${NICKNAME_MIN} a ${NICKNAME_MAX} caracteres: letras latinas, números, "_", "." ou "-".`,
    );
  }
  return nickname;
}

/**
 * Letras de aparência igual ou quase igual a uma letra ASCII que a decomposição NFD não resolve (sem ponto,
 * com barra, com traço). `ACCEPTED_*`: continuam valendo em apelido novo (Latin-1 ou Latin Extended-A de
 * uso real). `SKELETON_ONLY`: NÃO valem em apelido novo, mas entram no esqueleto para colidir com
 * apelidos antigos que as tenham (o banco ainda aceita U+00C0 a U+024F).
 */
const ACCEPTED_LOOKALIKES: Readonly<Record<string, string>> = {
  ı: 'i',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  ħ: 'h',
  Ħ: 'H',
  ŧ: 't',
  Ŧ: 'T',
  ø: 'o',
  Ø: 'O',
};
const SKELETON_ONLY: Readonly<Record<string, string>> = {
  ƒ: 'f',
  ǥ: 'g',
  Ǥ: 'G',
  ƀ: 'b',
  ǀ: 'l', // U+01C0 (clique dental), igual a "l" e "I"
  ȷ: 'j',
  ŀ: 'l',
  Ŀ: 'L',
  ƚ: 'l',
  ɉ: 'j',
  Ɉ: 'J',
  ſ: 's',
  ĸ: 'k',
  Ɩ: 'l',
};

/** Confusáveis ASCII clássicos no resultado final do esqueleto: `I` (i maiúsculo) = `l`, `0` = `o`. */
const finalLetter = (c: string): string => (c === 'I' ? 'l' : c === '0' ? 'o' : c);

function buildSkeleton(): {
  from: string;
  to: string;
  map: ReadonlyMap<string, string>;
  extraAccepted: string;
} {
  const map = new Map<string, string>();
  let extraAccepted = '';
  // U+0100 a U+024F: letra de base ASCII + marca (NFD) => a base. Latin-1 (ã, é, ç...) NÃO entra: acento
  // do português distingue apelidos de verdade (João x Joao). Essas letras são as únicas de Latin
  // Extended aceitas em apelido novo, além das de `ACCEPTED_LOOKALIKES`.
  for (let cp = 0x100; cp <= 0x24f; cp++) {
    const ch = String.fromCodePoint(cp);
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (base !== ch && /^[A-Za-z]$/.test(base)) {
      map.set(ch, finalLetter(base));
      extraAccepted += ch;
    }
  }
  for (const [ch, base] of Object.entries(ACCEPTED_LOOKALIKES)) {
    map.set(ch, finalLetter(base));
    if (ch.charCodeAt(0) >= 0x100) extraAccepted += ch;
  }
  for (const [ch, base] of Object.entries(SKELETON_ONLY)) map.set(ch, finalLetter(base));
  map.set('I', 'l');
  map.set('0', 'o');
  let from = '';
  let to = '';
  for (const [ch, base] of map) {
    from += ch;
    to += base;
  }
  return { from, to, map, extraAccepted };
}

const SKELETON = buildSkeleton();
/** Tabelas do esqueleto para o `translate(nickname, from, to)` do Postgres (mesma regra do TypeScript). */
export const SKELETON_TRANSLATE_FROM = SKELETON.from;
export const SKELETON_TRANSLATE_TO = SKELETON.to;

const hex4 = (ch: string): string => `\\u${ch.codePointAt(0)?.toString(16).padStart(4, '0')}`;

/**
 * Política de apelido para apelidos NOVOS: NFC; ASCII (letras, dígitos), `_`, `.`, `-`; Latin-1 (acentos do
 * português, sem × e ÷); e, de Latin Extended-A/B, só as letras que decompõem por NFD em letra ASCII mais
 * marca (ā, ğ, ǎ...) e as de `ACCEPTED_LOOKALIKES` (ı, ł, đ...). O resto de U+0100 a U+024F (ǀ, ȷ, ŀ, ƚ,
 * ɉ, ſ, ĸ, Ɩ...) é recusado. 3 a 16 code points. Sem espaço, tab, controle, zero-width, bidi nem outros
 * alfabetos. O CHECK do banco (`users_nickname_charset_check`) segue mais largo (U+00C0 a U+024F), então
 * apelidos que já existem continuam carregando.
 */
export const NICKNAME_PATTERN = new RegExp(
  `^[0-9A-Za-z_.\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF${[...SKELETON.extraAccepted].map(hex4).join('')}-]+$`,
);

/**
 * "Esqueleto" do apelido para unicidade: Latin Extended e letras com barra viram a letra ASCII parecida,
 * `I` vira `l` e `0` vira `o` (aceitando o falso positivo `Ivo` x `lvo`), e o resultado vai para
 * minúsculas. `ı` (sem ponto) colide com `i`, `ǀeo` com `leo`; `João` e `Joao` continuam distintos. Cada
 * caractere vira um caractere (o tamanho não muda). Aplicado pelo índice único de expressão
 * `users_nickname_skeleton_key` (a mesma tabela, por `translate`) e pelo repositório em memória.
 */
export function nicknameSkeleton(nickname: string): string {
  let out = '';
  for (const ch of normalizeNickname(nickname)) out += SKELETON.map.get(ch) ?? ch;
  return out.toLowerCase();
}

export function assertProviderSubject(subject: string): void {
  const n = length(subject);
  if (n < 1 || n > 255 || subject.includes('\u0000')) {
    throw new InvalidInputError('Identificador do provedor inválido.');
  }
}

export function assertReportText(text: string | undefined): void {
  if (text !== undefined && length(text) > REPORT_TEXT_MAX) {
    throw new InvalidInputError(`Texto da denúncia passa de ${REPORT_TEXT_MAX} caracteres.`);
  }
}

const SIGNAL_ID_SET: ReadonlySet<string> = new Set(SIGNAL_IDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `signalId` só do catálogo; cada significado passa pela MESMA limpeza do chat (`cleanPartnerCode`,
 * teto 60): recusado lança, vazio apaga a chave. Devolve o mapa limpo a gravar.
 */
export function assertPartnerCodes(codes: PartnerCodesMap): PartnerCodesMap {
  if (!isPlainObject(codes)) throw new InvalidInputError('Códigos inválidos.');
  const entries = Object.entries(codes);
  if (entries.length > SIGNAL_IDS.length) throw new InvalidInputError('Códigos demais.');
  const clean: Record<string, string> = {};
  for (const [signalId, meaning] of entries) {
    if (!SIGNAL_ID_SET.has(signalId)) throw new InvalidInputError('Sinal desconhecido.');
    const cleaned = typeof meaning === 'string' ? cleanPartnerCode(meaning) : null;
    if (cleaned === null) {
      throw new InvalidInputError(`Código inválido (máximo ${PARTNER_CODE_MAX} caracteres).`);
    }
    if (cleaned !== '') clean[signalId] = cleaned;
  }
  return clean;
}

/**
 * Valida o avatar pelo catálogo do protocolo (`parseAvatarParts`: chaves exatas, índices no
 * intervalo, `voice` opcional) e devolve a cópia canônica. Texto livre não passa mais.
 */
export function assertAvatarParts(parts: unknown): AvatarParts {
  const parsed = parseAvatarParts(parts);
  if (parsed === null) throw new InvalidInputError('Avatar inválido.');
  return parsed;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Valida e normaliza (minúsculas) um id de entrada. Qualquer não-UUID vira `InvalidInputError`. */
export function normalizeId(id: unknown): string {
  if (typeof id !== 'string') throw new InvalidInputError('Identificador inválido.');
  const lower = id.toLowerCase();
  if (!UUID_RE.test(lower)) throw new InvalidInputError('Identificador inválido.');
  return lower;
}

/**
 * Regras de `matches`/`match_players` que o banco recusa por CHECK/FK, aplicadas antes de gravar
 * (as duas implementações). Devolve o input com os `userId` normalizados.
 */
export function assertFinishedMatch(input: FinishedMatchInput): FinishedMatchInput {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > UINT32_MAX) {
    throw new InvalidInputError('Semente fora de uint32.');
  }
  if (
    !(input.startedAt instanceof Date) ||
    !(input.endedAt instanceof Date) ||
    Number.isNaN(input.startedAt.getTime()) ||
    Number.isNaN(input.endedAt.getTime()) ||
    input.startedAt.getTime() > input.endedAt.getTime()
  ) {
    throw new InvalidInputError('Período da partida inválido.');
  }
  if ((input.status === 'finished') !== (input.winnerTeam === 0 || input.winnerTeam === 1)) {
    throw new InvalidInputError('Vencedor incoerente com o status.');
  }
  if (input.winnerTeam !== null && input.winnerTeam !== 0 && input.winnerTeam !== 1) {
    throw new InvalidInputError('Vencedor inválido.');
  }
  if (input.roomCode !== null && length(input.roomCode) > 8) {
    throw new InvalidInputError('Código de sala inválido.');
  }
  assertJsonSize(input.options, JSON_LIMITS.options);
  assertJsonSize(input.games, JSON_LIMITS.games);
  assertJsonSize(input.events, JSON_LIMITS.events);
  if (input.deals !== null) assertJsonSize(input.deals, JSON_LIMITS.deals);
  const seats = new Set<number>();
  const players = input.players.map((p) => {
    if (!Number.isInteger(p.seat) || p.seat < 0 || p.seat > 3) {
      throw new InvalidInputError('Assento fora de 0..3.');
    }
    if (p.team !== p.seat % 2) throw new InvalidInputError('Dupla incoerente com o assento.');
    if (seats.has(p.seat)) throw new InvalidInputError('Assento repetido.');
    seats.add(p.seat);
    if (p.botFrom !== null && (!Number.isInteger(p.botFrom) || p.botFrom < 0)) {
      throw new InvalidInputError('botFrom inválido.');
    }
    return { ...p, userId: p.userId === null ? null : normalizeId(p.userId) };
  });
  return { ...input, players };
}

/**
 * Forma canônica do par para `partner_codes`: menor id primeiro, comparando a string UUID em
 * minúsculas (mesma ordem de bytes do tipo `uuid` do Postgres, que o CHECK usa).
 */
export function orderPair(x: string, y: string): readonly [string, string] {
  const a = normalizeId(x);
  const b = normalizeId(y);
  if (a === b) throw new InvalidInputError('Um usuário não forma par consigo mesmo.');
  return a < b ? [a, b] : [b, a];
}

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) throw new InvalidInputError('limit inválido.');
  return Math.min(limit, max);
}

export interface MatchCursor {
  readonly endedAt: Date;
  readonly id: string;
}

export function encodeCursor(cursor: MatchCursor): string {
  return Buffer.from(`${cursor.endedAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): MatchCursor {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [iso, id, ...rest] = text.split('|');
  const endedAt = iso === undefined ? new Date(NaN) : new Date(iso);
  if (rest.length > 0 || id === undefined || !UUID_RE.test(id) || Number.isNaN(endedAt.getTime())) {
    throw new InvalidInputError('Cursor inválido.');
  }
  return { endedAt, id };
}

/** `2026-11-04` (diária) ou `2026-W45` (semanal); mesma regra do CHECK `user_missions_period_key_format_check`. */
const PERIOD_KEY_RE = /^[0-9]{4}-(W[0-9]{2}|[0-9]{2}-[0-9]{2})$/;

export function assertPeriodKey(key: unknown): string {
  if (typeof key !== 'string' || !PERIOD_KEY_RE.test(key)) {
    throw new InvalidInputError('Chave de período inválida.');
  }
  return key;
}

function assertCount(value: unknown, max: number, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new InvalidInputError(`${what} inválido.`);
  }
  return value;
}

/** Meta de missão: inteiro de 1 a `PROGRESS_DELTA_MAX` (mesma regra do CHECK `target > 0`). */
export function assertMissionTarget(target: unknown): number {
  const n = assertCount(target, PROGRESS_DELTA_MAX, 'Meta');
  if (n < 1) throw new InvalidInputError('Meta inválida.');
  return n;
}

export function assertMissionId(id: unknown): MissionId {
  if (!isMissionId(id)) throw new InvalidInputError('Missão fora do catálogo.');
  return id;
}

/**
 * Valida as entradas de `applyMatchProgress` (as duas implementações) e devolve cópia canônica: ids
 * normalizados, ordem determinística (usuário, conquista, missão: a mesma ordem de bloqueio nas escritas, o
 * que evita deadlock entre partidas simultâneas) e sem repetição. Datas inválidas viram `InvalidInputError`.
 */
export function assertProgressDeltas(
  deltas: readonly UserProgressDelta[],
): readonly UserProgressDelta[] {
  const seenUsers = new Set<string>();
  const out = deltas.map((d): UserProgressDelta => {
    const userId = normalizeId(d.userId);
    if (seenUsers.has(userId)) throw new InvalidInputError('Usuário repetido na progressão.');
    seenUsers.add(userId);
    if (d.variant !== 'paulista' && d.variant !== 'mineiro') {
      throw new InvalidInputError('Variante inválida.');
    }
    const played = assertCount(d.played, PROGRESS_DELTA_MAX, 'played');
    const won = assertCount(d.won, PROGRESS_DELTA_MAX, 'won');
    if (won > played) throw new InvalidInputError('won maior que played.');
    const seenA = new Set<string>();
    const achievements = d.achievements.map((a): AchievementDelta => {
      if (!isAchievementId(a.achievementId)) {
        throw new InvalidInputError('Conquista fora do catálogo.');
      }
      if (seenA.has(a.achievementId)) throw new InvalidInputError('Conquista repetida.');
      seenA.add(a.achievementId);
      if ((a.progressDelta === undefined) === (a.progressSet === undefined)) {
        throw new InvalidInputError('Informe progressDelta ou progressSet.');
      }
      if (a.progressDelta !== undefined) assertCount(a.progressDelta, PROGRESS_DELTA_MAX, 'Delta');
      if (a.progressSet !== undefined) assertCount(a.progressSet, PROGRESS_CAP, 'Progresso');
      if (a.unlockedAt !== undefined) assertDate(a.unlockedAt);
      return a;
    });
    const seenM = new Set<string>();
    const missions = d.missions.map((m): MissionDelta => {
      assertMissionId(m.missionId);
      assertPeriodKey(m.periodKey);
      assertMissionTarget(m.target);
      assertCount(m.progressDelta, PROGRESS_DELTA_MAX, 'Delta');
      if (m.completedAt !== undefined) assertDate(m.completedAt);
      const k = `${m.missionId}|${m.periodKey}`;
      if (seenM.has(k)) throw new InvalidInputError('Missão repetida.');
      seenM.add(k);
      return m;
    });
    return {
      ...d,
      userId,
      achievements: [...achievements].sort((x, y) => cmp(x.achievementId, y.achievementId)),
      missions: [...missions].sort(
        (x, y) => cmp(x.missionId, y.missionId) || cmp(x.periodKey, y.periodKey),
      ),
    };
  });
  return out.sort((x, y) => cmp(x.userId, y.userId));
}

function assertDate(value: unknown): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new InvalidInputError('Data inválida.');
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
