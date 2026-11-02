/**
 * Schema Colyseus da mesa (`@colyseus/schema` 5: `schema()`/`t.*`, sem decoradores).
 *
 * Este arquivo e `projection.ts` são os únicos que tocam a API do schema; o resto do servidor usa
 * as funções exportadas aqui. Convenções:
 * - Estado compartilhado (todos os clientes): tudo fora de `privates`.
 * - Estado privado por assento: `privates` é `.view()`; cada cliente recebe só a entrada do próprio
 *   assento, via `StateView` (`client.view`). Ver `createSeatView`.
 * - `HandState.hands` do motor NUNCA entra aqui.
 * - "Ausente" usa string vazia (cartas) ou -1 (assento/dupla/índice), pois o schema não tem null.
 */
import { StateView, schema, t } from '@colyseus/schema';
import type { Format, Seat, VariantId, Visibility } from '@trucaco/protocol';

/** Carta aberta. `rank`/`suit` vazios = sem identidade pública. */
export const CardSchema = schema({ rank: t.string(), suit: t.string() }, 'Card');

/** Carta jogada na mesa. Coberta de outro jogador: `covered: true` com `rank`/`suit` vazios. */
export const PlayedCardSchema = schema(
  { seat: t.int8(), covered: t.boolean(), rank: t.string(), suit: t.string() },
  'PlayedCard',
);

export const TrickSchema = schema(
  {
    starter: t.int8(),
    winnerSeat: t.int8(),
    winnerTeam: t.int8(),
    plays: t.array(PlayedCardSchema),
  },
  'Trick',
);

export const PendingBetSchema = schema(
  { fromSeat: t.int8(), fromTeam: t.int8(), toLevel: t.int8() },
  'PendingBet',
);

export const HandSchema = schema(
  {
    /** Vazio quando a variante não usa vira (Mineiro). */
    viraRank: t.string().default(''),
    viraSuit: t.string().default(''),
    /**
     * Manilha pública (derivada do motor). Paulista: `manilhaRank` = rank da manilha (vira + 1),
     * `manilhaCards` vazio. Mineiro: `manilhaRank` '' e `manilhaCards` = as 4 fixas, da mais forte à
     * mais fraca, no formato `<rank><suit>` (ex.: '4paus'). Vazios antes da primeira mão.
     * Aditivo (PROTOCOL_VERSION não muda).
     */
    manilhaRank: t.string().default(''),
    manilhaCards: t.array('string'),
    /** Valor se a dupla da vez pedir/aumentar agora (escada do motor); 0 = indisponível. */
    nextBetValue: t.uint8().default(0),
    /** Valor da aposta pendente (`pending.toLevel` na escada); 0 se não há. */
    pendingValue: t.uint8().default(0),
    special: t.string().default(''),
    specialTeam: t.int8(),
    /** '' antes da primeira mão. */
    phase: t.string().default(''),
    turn: t.int8(),
    value: t.uint8().default(0),
    level: t.int8(),
    pending: t.ref(PendingBetSchema).optional(),
    tricks: t.array(TrickSchema),
    current: t.array(PlayedCardSchema),
  },
  'Hand',
);

export const GameSchema = schema(
  { scores: t.array('uint8'), handNumber: t.uint16(), pe: t.int8() },
  'Game',
);

export const SeriesSchema = schema(
  {
    format: t.string(),
    games: t.array('uint8'),
    gameNumber: t.uint8(),
    /** -1 enquanto a série corre ou se foi cancelada. */
    winnerTeam: t.int8(),
  },
  'Series',
);

export const OptionsSchema = schema(
  { variant: t.string(), format: t.string(), ironHand: t.boolean(), visibility: t.string() },
  'Options',
);

export const PlayerSchema = schema(
  {
    seat: t.int8(),
    nickname: t.string().default(''),
    /** JSON do avatar (partes escolhidas). */
    avatar: t.string().default(''),
    status: t.string().default('empty'),
    handSize: t.uint8().default(0),
    isBot: t.boolean().default(false),
  },
  'Player',
);

/** Carta coberta jogada pelo próprio dono: a identidade real, visível só a ele. */
export const OwnCoveredSchema = schema(
  {
    /** Índice em `hand.tricks`, ou -1 se a jogada ainda está em `hand.current`. */
    trick: t.int8(),
    rank: t.string(),
    suit: t.string(),
  },
  'OwnCovered',
);

/** Dados de um assento, enviados só ao dono (e jamais a outro cliente). */
export const SeatPrivateSchema = schema(
  {
    seat: t.int8(),
    /** Cartas na mão. Vazio na mão de ferro (o dono só vê `handSize`). */
    hand: t.array(CardSchema),
    /** Ids: `play:<rank><suit>`, `playCovered:<rank><suit>`, `playBlind:<i>`, `bet`, `accept`, ... */
    legalActions: t.array('string'),
    /** Mão de onze/dez: cartas do parceiro, só para a dupla que decide. */
    partnerCards: t.array(CardSchema),
    /** Identidade das próprias cartas cobertas já jogadas nesta mão. */
    ownCovered: t.array(OwnCoveredSchema),
  },
  'SeatPrivate',
);

export const TableStateSchema = schema(
  {
    roomCode: t.string(),
    options: t.ref(OptionsSchema),
    /** waiting | playing | finished */
    phase: t.string(),
    players: t.array(PlayerSchema),
    series: t.ref(SeriesSchema),
    game: t.ref(GameSchema),
    hand: t.ref(HandSchema),
    /** Epoch ms em que o turno atual expira; 0 se não há prazo. */
    turnDeadlineAt: t.float64().default(0),
    /** Assentos que votaram para cancelar a mesa. */
    cancelVotes: t.array('uint8'),
    /** Privado por assento (chave = número do assento como string). `.view()`: nunca vai a todos. */
    privates: t.map(SeatPrivateSchema).view(),
  },
  'TableState',
);

export type CardNode = InstanceType<typeof CardSchema>;
export type PlayedCardNode = InstanceType<typeof PlayedCardSchema>;
export type TrickNode = InstanceType<typeof TrickSchema>;
export type HandNode = InstanceType<typeof HandSchema>;
export type PlayerNode = InstanceType<typeof PlayerSchema>;
export type OwnCoveredNode = InstanceType<typeof OwnCoveredSchema>;
export type SeatPrivateNode = InstanceType<typeof SeatPrivateSchema>;
export type TableState = InstanceType<typeof TableStateSchema>;

export interface TableOptions {
  readonly variant: VariantId;
  readonly format: Format;
  readonly ironHand: boolean;
  readonly visibility: Visibility;
}

export type PlayerStatus = 'empty' | 'connected' | 'away' | 'bot';

export const TABLE_SEATS = 4;

/** Estado inicial (fase `waiting`, 4 assentos vazios, um bloco privado por assento). */
export function createTableState(roomCode: string, options: TableOptions): TableState {
  const state = new TableStateSchema();
  state.roomCode = roomCode;
  state.options.variant = options.variant;
  state.options.format = options.format;
  state.options.ironHand = options.ironHand;
  state.options.visibility = options.visibility;
  state.phase = 'waiting';
  state.series.format = options.format;
  state.series.gameNumber = 0;
  state.series.winnerTeam = -1;
  state.series.games.push(0, 0);
  state.game.scores.push(0, 0);
  state.game.pe = -1;
  state.hand.specialTeam = -1;
  state.hand.turn = -1;
  state.hand.level = -1;
  for (let seat = 0; seat < TABLE_SEATS; seat++) {
    const p = new PlayerSchema();
    p.seat = seat;
    p.status = 'empty';
    state.players.push(p);
    const priv = new SeatPrivateSchema();
    priv.seat = seat;
    state.privates.set(String(seat), priv);
  }
  return state;
}

export interface PlayerInfo {
  readonly nickname?: string;
  readonly avatar?: string;
  readonly status?: PlayerStatus;
  readonly isBot?: boolean;
}

/** Atualiza os campos informados do jogador do assento (os demais ficam como estão). */
export function setPlayer(state: TableState, seat: Seat, info: PlayerInfo): void {
  const p = state.players[seat];
  if (p === undefined) return;
  if (info.nickname !== undefined) p.nickname = info.nickname;
  if (info.avatar !== undefined) p.avatar = info.avatar;
  if (info.status !== undefined) p.status = info.status;
  if (info.isBot !== undefined) p.isBot = info.isBot;
}

export function setTablePhase(state: TableState, phase: 'waiting' | 'playing' | 'finished'): void {
  state.phase = phase;
}

/** Assentos que votaram para cancelar (substitui a lista). */
export function setCancelVotes(state: TableState, seats: readonly Seat[]): void {
  state.cancelVotes.clear();
  for (const s of seats) state.cancelVotes.push(s);
}

/**
 * Cria a `StateView` do cliente sentado em `seat` (atribuir a `client.view`). Ela enxerga só o
 * bloco privado desse assento. Criar uma view nova a cada (re)conexão e `dispose()` ao sair.
 */
export function createSeatView(state: TableState, seat: Seat): StateView {
  const view = new StateView();
  const priv = state.privates.get(String(seat));
  if (priv === undefined) throw new Error(`assento inexistente: ${seat}`);
  view.add(priv);
  return view;
}
