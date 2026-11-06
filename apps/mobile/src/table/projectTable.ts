/**
 * Projeção PURA do estado da mesa para a tela (`TableViewModel`). Entrada: o `room.state.toJSON()`
 * (desconhecido, tolerante a campo ausente) e o assento do jogador local. Saída: dados prontos para
 * desenhar. NENHUMA regra de jogo aqui: o que é jogável vem de `privates[mySeat].legalActions`, o valor
 * da próxima aposta de `hand.nextBetValue`, as manilhas de `hand.manilhaRank`/`hand.manilhaCards`.
 */
import {
  ABSENT,
  SUITS,
  isHandPhaseId,
  isTablePhase,
  parseLegalAction,
  type AvatarParts,
  type CardSnapshot,
  type HandPhaseId,
  type LegalActionId,
  type Rank,
  type Suit,
  type TablePhase,
} from '@trucaco/protocol';
import { avatarPartsOf } from './avatarParts';
import { asAvatarStatus, asRank, asSuit, screenPosition } from '@trucaco/ui';
import type { AvatarStatus, ScreenPosition } from '@trucaco/ui';

export const TABLE_SEATS = 4;

export interface SeatView {
  readonly seat: number;
  readonly position: ScreenPosition;
  readonly nickname: string;
  readonly status: AvatarStatus;
  readonly isBot: boolean;
  /** Partes do avatar (objeto estável por texto, ver `avatarPartsOf`). */
  readonly avatar: AvatarParts;
  readonly handSize: number;
  readonly team: 0 | 1;
  /** Perspectiva: minha dupla (azul) ou adversária (laranja). */
  readonly side: 'mine' | 'theirs';
  readonly isMe: boolean;
  readonly isTurn: boolean;
}

export interface PlayedView {
  readonly seat: number;
  readonly rank: string;
  readonly suit: string;
  readonly covered: boolean;
}

export interface TrickView {
  readonly starter: number;
  readonly winnerSeat: number;
  readonly winnerTeam: number;
  readonly plays: readonly PlayedView[];
}

export interface PendingView {
  readonly fromSeat: number;
  readonly fromTeam: number;
  readonly toLevel: number;
  /** A aposta pendente é da minha dupla (eu aguardo a resposta). */
  readonly fromMyTeam: boolean;
  /** Único assento que responde (`pending.responderSeat`); `-1` se o servidor não publicou. */
  readonly responderSeat: number;
}

export interface TableViewModel {
  readonly roomCode: string;
  /** `''` quando o estado ainda não chegou ou a fase é desconhecida. */
  readonly phase: TablePhase | '';
  readonly variant: string;
  readonly format: string;
  readonly ironHand: boolean;
  readonly mySeat: number;
  readonly myTeam: 0 | 1;
  /** Assento do host (`-1` = sem host); só ele mexe nos bots de vaga na espera. */
  readonly hostSeat: number;
  /** Eu sou o host (só UX: o servidor valida). */
  readonly isHost: boolean;
  /** `private` | `public` | `''`. Bots de vaga só existem em mesa privada. */
  readonly visibility: string;
  /** Sempre 4 entradas, por assento. */
  readonly seats: readonly SeatView[];
  readonly byPosition: Readonly<Record<ScreenPosition, SeatView>>;
  readonly myHand: readonly CardSnapshot[];
  /** Mão de ferro: quantas cartas às cegas (a mão aberta fica vazia). 0 fora disso. */
  readonly blindCount: number;
  /** Mão de onze/dez: cartas do parceiro (só a dupla que decide as recebe). */
  readonly partnerCards: readonly CardSnapshot[];
  /** Só os ids que `parseLegalAction` reconhece, na ordem do servidor. */
  readonly legalActions: readonly LegalActionId[];
  readonly handPhase: HandPhaseId | '';
  readonly special: string;
  readonly handNumber: number;
  /** Assento do pé (quem embaralha); -1 se o servidor ainda não publicou. */
  readonly pe: number;
  readonly handValue: number;
  readonly vira: { readonly rank: string; readonly suit: string };
  /** Cartas manilha (para destaque). Paulista: todas as de `manilhaRank`; Mineiro: as fixas. */
  readonly manilhas: readonly { readonly rank: Rank; readonly suit: Suit }[];
  /** Paulista: rank da manilha (ex.: `3`); `undefined` fora disso. */
  readonly manilhaLabel: string | undefined;
  readonly current: readonly PlayedView[];
  readonly tricks: readonly TrickView[];
  /** Identidade da minha carta coberta na vaza em curso, se houver. */
  readonly ownCoveredCurrent: CardSnapshot | null;
  /** Minhas cartas cobertas já decididas, por índice de vaza (`trick` >= 0). */
  readonly ownCoveredByTrick: readonly (CardSnapshot & { readonly trick: number })[];
  /**
   * Assento cuja decisão é esperada (`hand.actingSeat`, o mesmo do timer). NÃO é `hand.turn`: em aposta
   * pendente é o `pending.responderSeat`. Em decisão de onze/dez os DOIS da dupla decidem e vale `-1`:
   * use `canAct`/`legalActions` e `specialAccepted`. `-1` = ninguém.
   */
  readonly actingSeat: number;
  /** Decisão de onze/dez em curso: a dupla que decide (`-1` fora disso). */
  readonly decidingTeam: number;
  /** Onze/dez sem ferro: assentos que já aceitaram jogar (`hand.specialAccepted`). */
  readonly specialAccepted: readonly number[];
  /** Já aceitei jogar a mão de onze/dez. */
  readonly iAccepted: boolean;
  /** Há ação legal para mim (o servidor decide; em decisão especial os dois da dupla têm ação). */
  readonly canAct: boolean;
  readonly turnDeadlineAt: number;
  readonly pending: PendingView | null;
  /** Valor da próxima aposta; `undefined` = indisponível (o servidor mandou 0). */
  readonly nextBetValue: number | undefined;
  readonly pendingValue: number | undefined;
  readonly scores: readonly [number, number];
  readonly series: {
    readonly format: string;
    readonly games: readonly [number, number];
    readonly gameNumber: number;
    readonly winnerTeam: number;
  };
  readonly cancelVotes: readonly number[];
  /** Eu já votei para cancelar. */
  readonly iVotedCancel: boolean;
  /** Assentos que votaram "Jogar de novo" (servidor). */
  readonly rematchVotes: readonly number[];
  /** Prazo da janela de revanche (epoch do servidor); 0 = sem janela (servidor antigo, cancelada). */
  readonly rematchDeadlineAt: number;
  /** Partida atual da sala (1 na primeira; sobe a cada revanche). Servidor antigo = 1. */
  readonly matchNumber: number;
  readonly iVotedRematch: boolean;
  /** Janela de revanche aberta: fim de série com vencedor E prazo publicado. Só então se envia `voteRematch`. */
  readonly rematchOpen: boolean;
}

// ------------------------------------------------------------------ leitura tolerante

type Rec = Record<string, unknown>;

function rec(x: unknown): Rec {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Rec) : {};
}
function list(x: unknown): readonly unknown[] {
  return Array.isArray(x) ? x : [];
}
function str(x: unknown, d = ''): string {
  return typeof x === 'string' ? x : d;
}
function num(x: unknown, d = 0): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : d;
}
function bool(x: unknown, d = false): boolean {
  return typeof x === 'boolean' ? x : d;
}

function card(x: unknown): CardSnapshot {
  const c = rec(x);
  return { rank: str(c['rank']), suit: str(c['suit']) };
}

function played(x: unknown): PlayedView {
  const p = rec(x);
  return {
    seat: num(p['seat'], ABSENT),
    rank: str(p['rank']),
    suit: str(p['suit']),
    covered: bool(p['covered']),
  };
}

function pair(x: unknown): readonly [number, number] {
  const a = list(x);
  return [num(a[0]), num(a[1])];
}

/** `<rank><suit>` (ex.: `4paus`) -> carta; formato inesperado é descartado. */
function cardKey(text: unknown): { rank: Rank; suit: Suit } | null {
  if (typeof text !== 'string') return null;
  const rank = asRank(text.slice(0, 1));
  const suit = asSuit(text.slice(1));
  return rank === null || suit === null ? null : { rank, suit };
}

/** Assento do jogador local a partir do bloco `privates` (que só traz o próprio). `-1` se ausente. */
export function mySeatOf(roomState: unknown): number {
  for (const v of Object.values(rec(rec(roomState)['privates']))) {
    const seat = rec(v)['seat'];
    if (typeof seat === 'number' && Number.isInteger(seat) && seat >= 0) return seat;
  }
  return -1;
}

/** Projeta o estado da sala. `mySeat` omitido = deduzido de `privates`. Nunca lança. */
export function projectTable(roomState: unknown, mySeat?: number): TableViewModel {
  const s = rec(roomState);
  const me = mySeat ?? mySeatOf(roomState);
  // Sem assento (espectador/estado parcial): perspectiva do assento 0, sem ações.
  const view = me >= 0 ? me : 0;
  const myTeam: 0 | 1 = view % 2 === 1 ? 1 : 0;

  const hand = rec(s['hand']);
  const handPhase = isHandPhaseId(hand['phase']) ? hand['phase'] : '';
  const actingSeat = num(hand['actingSeat'], ABSENT);
  const special = str(hand['special'], 'normal');

  const playersRaw = list(s['players']).map(rec);
  const seats: SeatView[] = Array.from({ length: TABLE_SEATS }, (_, i) => {
    const p = playersRaw.find((x) => x['seat'] === i) ?? {};
    const team: 0 | 1 = i % 2 === 1 ? 1 : 0;
    const isBot = bool(p['isBot']);
    const status = asAvatarStatus(str(p['status'], 'empty'));
    return {
      seat: i,
      position: screenPosition(view, i),
      nickname: str(p['nickname']),
      status: isBot && status !== 'empty' ? 'bot' : status,
      isBot,
      avatar: avatarPartsOf(p['avatar']),
      handSize: Math.max(0, num(p['handSize'])),
      team,
      side: team === myTeam ? 'mine' : 'theirs',
      isMe: i === me,
      // Em decisão especial os dois da dupla decidem: ninguém recebe o destaque de "vez".
      isTurn:
        i === actingSeat &&
        handPhase !== 'finished' &&
        handPhase !== '' &&
        handPhase !== 'specialDecision',
    };
  });
  const at = (pos: ScreenPosition): SeatView => seats.find((x) => x.position === pos) as SeatView;
  const byPosition = {
    self: at('self'),
    right: at('right'),
    partner: at('partner'),
    left: at('left'),
  };

  const mine = rec(rec(s['privates'])[String(me)]);
  const myHand = list(mine['hand']).map(card);
  const legalActions = list(mine['legalActions']).filter(
    (id): id is LegalActionId => parseLegalAction(id) !== null,
  );
  const mySeatView = seats[view] as SeatView;
  const blindCount =
    special === 'maoDeFerro' && myHand.length === 0 && handPhase !== 'finished'
      ? Math.min(3, mySeatView.handSize)
      : 0;

  const current = list(hand['current']).map(played);
  const ownCovered = list(mine['ownCovered']).map(rec);
  // `trick: -1` = a carta coberta ainda está na vaza em curso.
  const ownCurrent = ownCovered.find((c) => num(c['trick'], ABSENT) === ABSENT);

  const manilhaRank = asRank(hand['manilhaRank']);
  const manilhas: { rank: Rank; suit: Suit }[] =
    manilhaRank !== null
      ? SUITS.map((suit) => ({ rank: manilhaRank, suit }))
      : list(hand['manilhaCards'])
          .map(cardKey)
          .filter((c): c is { rank: Rank; suit: Suit } => c !== null);

  const pendingRaw = hand['pending'];
  const pendingValue = num(hand['pendingValue']);
  const pending: PendingView | null =
    pendingRaw === undefined || pendingRaw === null
      ? null
      : {
          fromSeat: num(rec(pendingRaw)['fromSeat'], ABSENT),
          fromTeam: num(rec(pendingRaw)['fromTeam'], ABSENT),
          toLevel: num(rec(pendingRaw)['toLevel']),
          fromMyTeam: num(rec(pendingRaw)['fromTeam'], ABSENT) === myTeam,
          responderSeat: num(rec(pendingRaw)['responderSeat'], ABSENT),
        };

  const specialAccepted = list(hand['specialAccepted']).filter(
    (x): x is number => typeof x === 'number',
  );
  const cancelVotes = list(s['cancelVotes']).filter((x): x is number => typeof x === 'number');
  const series = rec(s['series']);
  const game = rec(s['game']);
  const options = rec(s['options']);
  const hostSeat = Math.trunc(num(s['hostSeat'], ABSENT));
  const phaseRaw = s['phase'];
  const phase: TablePhase | '' = isTablePhase(phaseRaw) ? phaseRaw : '';
  const rematchVotes = list(s['rematchVotes']).filter((x): x is number => typeof x === 'number');
  const rematchDeadlineAt = Math.max(0, num(s['rematchDeadlineAt']));
  const seriesWinner = num(series['winnerTeam'], ABSENT);

  return {
    roomCode: str(s['roomCode']),
    phase,
    variant: str(options['variant'], 'paulista'),
    format: str(options['format'], 'single'),
    ironHand: bool(options['ironHand']),
    mySeat: me,
    myTeam,
    hostSeat,
    isHost: me >= 0 && hostSeat === me,
    visibility: str(options['visibility']),
    seats,
    byPosition,
    myHand,
    blindCount,
    partnerCards: list(mine['partnerCards']).map(card),
    legalActions,
    handPhase,
    special,
    handNumber: num(game['handNumber']),
    pe: num(game['pe'], ABSENT),
    handValue: num(hand['value']),
    vira: { rank: str(hand['viraRank']), suit: str(hand['viraSuit']) },
    manilhas,
    manilhaLabel: manilhaRank ?? undefined,
    current,
    tricks: list(hand['tricks']).map((t) => {
      const r = rec(t);
      return {
        starter: num(r['starter'], ABSENT),
        winnerSeat: num(r['winnerSeat'], ABSENT),
        winnerTeam: num(r['winnerTeam'], ABSENT),
        plays: list(r['plays']).map(played),
      };
    }),
    ownCoveredCurrent: ownCurrent === undefined ? null : card(ownCurrent),
    ownCoveredByTrick: ownCovered
      .map((c) => ({ ...card(c), trick: num(c['trick'], ABSENT) }))
      .filter((c) => c.trick >= 0),
    actingSeat,
    decidingTeam: handPhase === 'specialDecision' ? num(hand['specialTeam'], ABSENT) : ABSENT,
    specialAccepted,
    iAccepted: me >= 0 && specialAccepted.includes(me),
    canAct: legalActions.length > 0,
    turnDeadlineAt: Math.max(0, num(s['turnDeadlineAt'])),
    pending,
    nextBetValue: num(hand['nextBetValue']) > 0 ? num(hand['nextBetValue']) : undefined,
    pendingValue: pendingValue > 0 ? pendingValue : undefined,
    scores: pair(game['scores']),
    series: {
      format: str(series['format'], 'single'),
      games: pair(series['games']),
      gameNumber: Math.max(1, num(series['gameNumber'], 1)),
      winnerTeam: num(series['winnerTeam'], ABSENT),
    },
    cancelVotes,
    iVotedCancel: me >= 0 && cancelVotes.includes(me),
    rematchVotes,
    rematchDeadlineAt,
    matchNumber: Math.max(1, num(s['matchNumber'], 1)),
    iVotedRematch: me >= 0 && rematchVotes.includes(me),
    rematchOpen: phase === 'finished' && seriesWinner >= 0 && rematchDeadlineAt > 0,
  };
}

/** Assinatura barata do que muda quando uma ação é aceita (destrava o anti duplo clique). */
export function actionSignature(vm: TableViewModel): string {
  return [
    vm.legalActions.join(','),
    vm.handNumber,
    vm.handPhase,
    vm.actingSeat,
    vm.current.length,
    vm.tricks.length,
    vm.pending?.toLevel ?? 0,
    vm.specialAccepted.length,
    vm.myHand.length,
  ].join('|');
}
