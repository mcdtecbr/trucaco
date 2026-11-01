/**
 * Contratos de persistência usados pelos blocos 2G (auth/REST) e 2H (lobby/persistência).
 * Só assinaturas e tipos de domínio: sem lógica de auth. Implementações: Prisma (produção) e
 * memória (testes de sala). Modelo e política de retenção: docs/banco-de-dados.md.
 */

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

/** Entrada que o banco recusaria (tamanho, par inválido, cursor malformado, usuário inexistente). */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
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

export interface UserRepository {
  /** Lança `NicknameTakenError` (apelido repetido, sem diferenciar caixa) ou `InvalidInputError`. */
  createGuest(input: NewGuestInput): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  findByProvider(provider: AuthProviderId, providerSubject: string): Promise<UserRecord | null>;
  touchLastSeen(id: string, at: Date): Promise<void>;

  /** `AvatarParts` como JSON; a validação do conteúdo é do servidor (2G), não do banco. */
  getAvatar(userId: string): Promise<JsonObject | null>;
  saveAvatar(userId: string, parts: JsonObject): Promise<void>;

  /** Idempotente. `InvalidInputError` se blocker === blocked ou usuário inexistente. */
  addBlock(blockerId: string, blockedId: string): Promise<void>;
  removeBlock(blockerId: string, blockedId: string): Promise<void>;
  /** Quem `userId` bloqueou. */
  listBlockedIds(userId: string): Promise<readonly string[]>;
  /** Quem bloqueou `userId` (o sorteio de mesa pública checa os dois sentidos). */
  listBlockerIds(userId: string): Promise<readonly string[]>;

  createReport(input: NewReportInput): Promise<ReportRecord>;

  /** O par é ordenado internamente: (a, b) e (b, a) leem o mesmo registro. */
  getPartnerCodes(userId: string, partnerId: string): Promise<PartnerCodesMap | null>;
  /** Upsert. `InvalidInputError` se algum significado passar de 140 caracteres ou userId === partnerId. */
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
