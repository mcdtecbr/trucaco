/**
 * Contratos de persistência usados pelos blocos 2G (auth/REST) e 2H (lobby/persistência).
 * Só assinaturas e tipos de domínio: sem lógica de auth. Implementações: Prisma (produção) e
 * memória (testes de sala). Modelo e política de retenção: docs/banco-de-dados.md.
 */
import type { AvatarParts } from '@trucaco/protocol';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export type AuthProviderId = 'guest' | 'google' | 'apple';
export type VariantId = 'paulista' | 'mineiro';
export type MatchFormatId = 'single' | 'bo3';
export type VisibilityId = 'public' | 'private';
export type MatchStatusId = 'finished' | 'cancelled';
export type ReportReasonId =
  | 'cheating'
  | 'abusive_chat'
  | 'offensive_nickname'
  | 'harassment'
  | 'other';

/** Falhas esperadas (o chamador as traduz em resposta HTTP). Qualquer outro erro é bug ou infra. */
export class NicknameTakenError extends Error {
  constructor() {
    super('Apelido já em uso.');
    this.name = 'NicknameTakenError';
  }
}

export class ProviderSubjectTakenError extends Error {
  constructor() {
    super('Conta do provedor já cadastrada.');
    this.name = 'ProviderSubjectTakenError';
  }
}

/**
 * Entrada que o banco recusaria (tamanho, par inválido, cursor malformado, id que não é UUID,
 * usuário inexistente, apelido fora da política). O 2G mapeia para HTTP 400. Quando vem de uma
 * constraint do banco, `constraint` traz só o NOME dela (nunca valores ou linhas).
 */
export class InvalidInputError extends Error {
  readonly constraint: string | null;
  constructor(message: string, constraint: string | null = null) {
    super(message);
    this.name = 'InvalidInputError';
    this.constraint = constraint;
  }
}

/** `savePartnerCodes` sem vínculo: os dois nunca jogaram juntos (mesma dupla) numa partida finalizada. O 2G mapeia para 403. */
export class NotPartnersError extends Error {
  constructor() {
    super('Os jogadores nunca formaram dupla numa partida finalizada.');
    this.name = 'NotPartnersError';
  }
}

/**
 * Falha inesperada de persistência (infra ou bug), já SANEADA: só o código Prisma/driver e o nome
 * da constraint. Sem `cause`, `meta`, `detail` nem valores (o erro bruto do Prisma carrega a linha
 * inteira, incluindo `deals`). O chamador NUNCA deve logar o erro bruto do Prisma.
 */
export class PersistenceError extends Error {
  readonly code: string;
  readonly constraint: string | null;
  constructor(code: string, constraint: string | null) {
    super(`Falha de persistência (${code}${constraint === null ? '' : `, ${constraint}`}).`);
    this.name = 'PersistenceError';
    this.code = code;
    this.constraint = constraint;
  }
}

export interface UserRecord {
  readonly id: string;
  readonly provider: AuthProviderId;
  readonly providerSubject: string;
  readonly nickname: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
}

export interface NewGuestInput {
  /** Identificador aleatório gerado pelo servidor (não é segredo de sessão). */
  readonly providerSubject: string;
  readonly nickname: string;
}

export interface NewReportInput {
  readonly reporterId: string;
  readonly reportedId: string;
  readonly matchId?: string | undefined;
  readonly reason: ReportReasonId;
  /** Até 500 caracteres. */
  readonly text?: string | undefined;
}

export interface ReportRecord {
  readonly id: string;
  readonly reporterId: string | null;
  readonly reportedId: string | null;
  readonly matchId: string | null;
  readonly reason: ReportReasonId;
  readonly text: string | null;
  readonly status: 'open' | 'reviewed' | 'dismissed';
  readonly createdAt: Date;
}

/** `signalId -> significado` (até 140 caracteres cada). */
export type PartnerCodesMap = { readonly [signalId: string]: string };

/**
 * Todo `id` recebido pelos repositórios é validado como UUID e normalizado para minúsculas;
 * qualquer outra coisa lança `InvalidInputError` (nunca chega crua ao banco).
 */
export interface UserRepository {
  /** Lança `NicknameTakenError` (apelido repetido, sem diferenciar caixa) ou `InvalidInputError`. */
  createGuest(input: NewGuestInput): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  findByProvider(provider: AuthProviderId, providerSubject: string): Promise<UserRecord | null>;
  touchLastSeen(id: string, at: Date): Promise<void>;
  /** Troca o apelido (`validateNickname`). `NicknameTakenError` se já existe (sem diferenciar caixa); `InvalidInputError` se inválido ou usuário inexistente. */
  updateNickname(id: string, nickname: string): Promise<void>;

  /** `AvatarParts` como JSON (objeto plano, até 32 chaves, valores escalares curtos); o significado das partes é do servidor (2G). */
  getAvatar(userId: string): Promise<AvatarParts | null>;
  saveAvatar(userId: string, parts: AvatarParts): Promise<void>;

  /** Idempotente. `InvalidInputError` se blocker === blocked ou usuário inexistente. */
  addBlock(blockerId: string, blockedId: string): Promise<void>;
  removeBlock(blockerId: string, blockedId: string): Promise<void>;
  /** Quem `userId` bloqueou. */
  listBlockedIds(userId: string): Promise<readonly string[]>;
  /** Quem bloqueou `userId` (o sorteio de mesa pública checa os dois sentidos). */
  listBlockerIds(userId: string): Promise<readonly string[]>;

  createReport(input: NewReportInput): Promise<ReportRecord>;

  /** Existe partida `finished` em que os dois foram jogadores da MESMA dupla (`team`). */
  havePlayedTogether(userA: string, userB: string): Promise<boolean>;

  /** O par é ordenado internamente: (a, b) e (b, a) leem o mesmo registro. */
  getPartnerCodes(userId: string, partnerId: string): Promise<PartnerCodesMap | null>;
  /**
   * Upsert. `InvalidInputError` se o `signalId` não for do catálogo, algum significado passar de
   * 140 caracteres ou userId === partnerId; `NotPartnersError` se não houver vínculo
   * (`havePlayedTogether`).
   */
  savePartnerCodes(userId: string, partnerId: string, codes: PartnerCodesMap): Promise<void>;
}

export interface MatchEventLogEntry {
  readonly seq: number;
  readonly at: number;
  /** Evento em visão PÚBLICA (`publicEvent`): nunca carta coberta alheia. */
  readonly event: JsonValue;
}

export interface MatchPlayerRecord {
  readonly seat: number;
  /** `null` = bot desde o início. */
  readonly userId: string | null;
  readonly team: 0 | 1;
  /** `seq` do evento em que um bot assumiu; `null` = humano até o fim. */
  readonly botFrom: number | null;
}

export interface FinishedMatchInput {
  readonly variant: VariantId;
  readonly format: MatchFormatId;
  readonly ironHand: boolean;
  readonly visibility: VisibilityId;
  readonly roomCode: string | null;
  /** uint32 (`TrucoRoom.seed`). */
  readonly seed: number;
  readonly options: JsonObject;
  readonly events: readonly MatchEventLogEntry[];
  /** Mãos de todos, só auditoria. Nunca devolvido por listagens. */
  readonly deals: readonly JsonValue[] | null;
  readonly winnerTeam: 0 | 1 | null;
  readonly games: readonly JsonValue[];
  readonly status: MatchStatusId;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly players: readonly MatchPlayerRecord[];
}

export interface MatchSummaryPlayer {
  readonly seat: number;
  readonly team: 0 | 1;
  readonly userId: string | null;
  /** `null` para bot ou usuário removido. */
  readonly nickname: string | null;
  readonly botFrom: number | null;
}

/** Item de `GET /matches`: sem `events`, `deals` nem `seed`. */
export interface MatchSummary {
  readonly id: string;
  readonly variant: VariantId;
  readonly format: MatchFormatId;
  readonly ironHand: boolean;
  readonly visibility: VisibilityId;
  readonly status: MatchStatusId;
  readonly winnerTeam: 0 | 1 | null;
  readonly games: readonly JsonValue[];
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly players: readonly MatchSummaryPlayer[];
}

export interface MatchPage {
  readonly items: readonly MatchSummary[];
  /** `null` na última página. Opaco para o cliente. */
  readonly nextCursor: string | null;
}

export const MATCH_PAGE_DEFAULT = 20;
export const MATCH_PAGE_MAX = 50;

export interface MatchRepository {
  /** Grava partida finalizada ou cancelada, com jogadores, de forma atômica. Devolve o id. */
  saveMatch(input: FinishedMatchInput): Promise<string>;
  /** Mais recentes primeiro, paginação por cursor (endedAt, id). `InvalidInputError` se o cursor for inválido. */
  listForUser(
    userId: string,
    options?: { readonly limit?: number; readonly cursor?: string },
  ): Promise<MatchPage>;
}
