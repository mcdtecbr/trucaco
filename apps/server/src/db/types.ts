/**
 * Contratos de persistência usados pelos blocos 2G (auth/REST) e 2H (lobby/persistência).
 * Só assinaturas e tipos de domínio: sem lógica de auth. Implementações: Prisma (produção) e
 * memória (testes de sala). Modelo e política de retenção: docs/banco-de-dados.md.
 */
import type { AchievementId, AvatarParts, MissionId } from '@trucaco/protocol';

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

export interface BlockedUserRecord {
  readonly userId: string;
  readonly nickname: string;
}

/** `signalId -> significado` (até 60 caracteres cada). */
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

  /** `AvatarParts` como JSON (objeto plano validado por `parseAvatarParts` de `@trucaco/protocol`: exatamente as chaves de `AVATAR_PART_KEYS` com índices inteiros do catálogo e `voice` opcional). */
  getAvatar(userId: string): Promise<AvatarParts | null>;
  saveAvatar(userId: string, parts: AvatarParts): Promise<void>;

  /** Idempotente. `InvalidInputError` se blocker === blocked ou usuário inexistente. */
  addBlock(blockerId: string, blockedId: string): Promise<void>;
  removeBlock(blockerId: string, blockedId: string): Promise<void>;
  /** Quem `userId` bloqueou. */
  listBlockedIds(userId: string): Promise<readonly string[]>;
  /** Quem bloqueou `userId` (o sorteio de mesa pública checa os dois sentidos). */
  listBlockerIds(userId: string): Promise<readonly string[]>;

  /** Bloqueados de `userId` com o apelido atual (mais antigos primeiro). */
  listBlocks(userId: string): Promise<readonly BlockedUserRecord[]>;

  createReport(input: NewReportInput): Promise<ReportRecord>;
  /**
   * Denúncia equivalente já existe? Com `matchId`: qualquer denúncia do mesmo (denunciante, denunciado,
   * partida). Sem `matchId`: uma denúncia sem partida do mesmo par nas últimas 24 h.
   */
  hasReport(reporterId: string, reportedId: string, matchId: string | null): Promise<boolean>;

  /**
   * Apaga o usuário. Cascatas do banco: avatar, bloqueios (nos dois sentidos) e combinados somem;
   * `match_players.user_id` e `reports.reporter_id/reported_id` viram NULL (anonimização; denúncias contra
   * a conta ficam). `true` se existia. Sessões (Redis) são revogadas por quem chama.
   */
  deleteUser(id: string): Promise<boolean>;

  /** Existe partida `finished` em que os dois foram jogadores da MESMA dupla (`team`). */
  havePlayedTogether(userA: string, userB: string): Promise<boolean>;

  /** O par é ordenado internamente: (a, b) e (b, a) leem o mesmo registro. */
  getPartnerCodes(userId: string, partnerId: string): Promise<PartnerCodesMap | null>;
  /**
   * Upsert. `InvalidInputError` se o `signalId` não for do catálogo, algum significado passar de
   * 60 caracteres ou userId === partnerId; `NotPartnersError` se não houver vínculo
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
  /** `userId`s humanos (não nulos) da partida; `null` se não existe. Só valida denúncias (opcional: sem ele, denúncia com `matchId` é recusada). */
  participantIds?(matchId: string): Promise<readonly string[] | null>;
}

/**
 * Progressão (Fase 6, bloco 6C): conquistas, missões e estatísticas. O catálogo (ids, metas, níveis) fica
 * em código (`@trucaco/protocol`); aqui só o estado gravado. SEM regra de conquista: quem decide o que
 * conta é a avaliação da partida (bloco 6D). Ver docs/adr/0009.
 */
export interface AchievementDelta {
  readonly achievementId: AchievementId;
  /** Soma ao progresso atual (inteiro 0 a `PROGRESS_DELTA_MAX`). Exclusivo com `progressSet`. */
  readonly progressDelta?: number;
  /** Define o progresso (ex.: sequência). Exclusivo com `progressDelta`. */
  readonly progressSet?: number;
  /** Instante do desbloqueio do nível 1; padrão = agora. Só vale na primeira vez. */
  readonly unlockedAt?: Date;
}

export interface MissionDelta {
  readonly missionId: MissionId;
  /** `2026-11-04` ou `2026-W45`. */
  readonly periodKey: string;
  /** Meta do período; usada só se a linha ainda não existir (a gravada nunca muda). */
  readonly target: number;
  readonly progressDelta: number;
  /** Instante da conclusão; padrão = agora. Só vale ao concluir. */
  readonly completedAt?: Date;
}

export interface UserProgressDelta {
  readonly userId: string;
  readonly variant: VariantId;
  /** Soma a `played` (normalmente 1). */
  readonly played: number;
  /** Soma a `won` (0 ou 1; não pode passar de `played`). */
  readonly won: number;
  readonly achievements: readonly AchievementDelta[];
  readonly missions: readonly MissionDelta[];
}

export interface AchievementUnlock {
  readonly userId: string;
  readonly achievementId: AchievementId;
  /** Nível antes (0 = estava bloqueada) e depois desta partida. */
  readonly previousLevel: number;
  readonly level: number;
  readonly progress: number;
}

export interface MissionCompletion {
  readonly userId: string;
  readonly missionId: MissionId;
  readonly periodKey: string;
}

export interface ApplyProgressResult {
  /** `false` se o `matchId` já tinha sido aplicado (nada foi escrito). */
  readonly applied: boolean;
  /** Níveis novos desta aplicação (vazio se `applied` é `false`). */
  readonly unlocked: readonly AchievementUnlock[];
  readonly missionsCompleted: readonly MissionCompletion[];
}

export interface AchievementRecord {
  readonly achievementId: AchievementId;
  readonly level: number;
  readonly progress: number;
  readonly unlockedAt: Date | null;
}

export interface MissionRecord {
  readonly missionId: MissionId;
  readonly periodKey: string;
  readonly target: number;
  readonly progress: number;
  readonly completedAt: Date | null;
}

export interface StatsRecord {
  readonly variant: VariantId;
  readonly played: number;
  readonly won: number;
}

/** Agregados do perfil público (6E): sem progresso, datas, histórico nem provedor. */
export interface PublicProfileRecord {
  readonly userId: string;
  readonly nickname: string;
  readonly avatar: AvatarParts | null;
  /** Só as desbloqueadas (`level > 0`). */
  readonly achievements: readonly {
    readonly achievementId: AchievementId;
    readonly level: number;
  }[];
  readonly stats: readonly StatsRecord[];
}

/** Teto de um incremento de progresso numa só partida (barra valores absurdos). */
export const PROGRESS_DELTA_MAX = 1000;
/** Teto de contadores acumulados (cabe em int4 do Postgres). */
export const PROGRESS_CAP = 2_000_000_000;

export interface ProgressionRepository {
  /**
   * Aplica a progressão de UMA partida a todos os usuários, numa transação, e é IDEMPOTENTE por `matchId`:
   * a primeira chamada grava e devolve `applied: true` com os desbloqueios novos; qualquer outra (inclusive
   * simultânea) devolve `applied: false` sem escrever. O nível de cada conquista é derivado do progresso
   * final (`achievementLevelFor`) e nunca diminui (`progressSet` também só sobe: `GREATEST`). Missão: progresso limitado à meta, conclusão marcada uma vez.
   * `InvalidInputError` se `matchId` não existir, usuário inexistente, id fora do catálogo, `periodKey`
   * inválido, delta negativo/fracionário ou `won > played`. Tudo ou nada.
   */
  applyMatchProgress(
    matchId: string,
    deltas: readonly UserProgressDelta[],
  ): Promise<ApplyProgressResult>;
  /** Linhas existentes (conquistas sem linha ainda não foram tocadas: o chamador completa pelo catálogo). */
  listAchievements(userId: string): Promise<readonly AchievementRecord[]>;
  /** Missões dos períodos pedidos (`GET /me/missions`). */
  listMissions(userId: string, periodKeys: readonly string[]): Promise<readonly MissionRecord[]>;
  /** Uma linha por variante já jogada. */
  getStats(userId: string): Promise<readonly StatsRecord[]>;
  /**
   * Partidas `finished` que os dois venceram juntos (mesma dupla, dupla vencedora) e que JÁ foram aplicadas
   * (`progression_applied`), sem bot em nenhum assento. Alimenta `dupla_afinada`. A partida em avaliação ainda
   * NÃO está marcada: quem chama soma 1.
   */
  countWinsTogether(userA: string, userB: string): Promise<number>;
  /** `null` se o usuário não existe (mesmo resultado para apagado). */
  getPublicProfile(userId: string): Promise<PublicProfileRecord | null>;
  /**
   * Cria as linhas do período que faltam (progresso 0) e devolve TODAS as do período. Determinístico e
   * idempotente (chamadas simultâneas não duplicam); a meta de linha já existente não muda.
   * `InvalidInputError` se o usuário não existe ou os argumentos são inválidos.
   */
  ensureMissions(
    userId: string,
    periodKey: string,
    defs: readonly { readonly missionId: MissionId; readonly target: number }[],
  ): Promise<readonly MissionRecord[]>;
}
