import { SIGNAL_IDS, type SignalId } from '@trucaco/protocol';

/** Nome do input trigger da state machine Rive para cada sinal (docs/sinais.md). */
export const SIGNAL_TRIGGERS = Object.fromEntries(
  SIGNAL_IDS.map((id) => [id, id === 'wink' ? 'trig_wink_l' : `trig_${id}`]),
) as Record<SignalId, string>;

export function signalTrigger(id: SignalId): string {
  return SIGNAL_TRIGGERS[id];
}

export interface SignalInfo {
  readonly id: SignalId;
  /** Nome exibido (painel de sinais, anúncio de acessibilidade). */
  readonly name: string;
  /** Input trigger da state machine Rive. */
  readonly trigger: string;
  /** Duração da animação até voltar ao ocioso. Sempre <= `MAX_SIGNAL_DURATION_MS`. */
  readonly durationMs: number;
  /** Significado tradicional (só sugestão para o chat da dupla). */
  readonly meaning: string;
}

/** Teto de duração de qualquer sinal (animação volta ao ocioso em até 1,2 s). */
export const MAX_SIGNAL_DURATION_MS = 1200;

type Row = readonly [SignalId, string, number, string];

const ROWS: readonly Row[] = [
  ['wink', 'Piscar um olho', 900, 'Tenho o zap (4♣ / manilha de paus)'],
  ['eyebrow', 'Levantar sobrancelhas', 900, 'Tenho o sete copas / manilha de copas'],
  ['lip_bite', 'Morder o lábio', 1000, 'Tenho o espadão / manilha de espadas'],
  ['cheek_puff', 'Inflar a bochecha', 1000, 'Tenho o sete ouros / manilha de ouros'],
  ['tongue', 'Mostrar a língua', 1000, 'Tenho um 3'],
  ['nose_twitch', 'Mexer o nariz', 900, 'Tenho um 2'],
  ['shrug', 'Encolher os ombros', 1000, 'Não tenho nada'],
  ['nod', 'Acenar com a cabeça', 1000, 'Pede truco / aceita'],
  ['head_shake', 'Balançar a cabeça', 1000, 'Não peça / corre'],
  ['chin_up', 'Levantar o queixo', 1000, 'Pode aumentar'],
  ['look_away', 'Olhar para o lado', 1000, 'Joga a carta mais fraca'],
  ['smile', 'Sorriso contido', 1000, 'Blefe / livre'],
  ['wink_r', 'Piscar o olho direito', 900, 'Livre: a dupla combina'],
  ['mouth_l', 'Torcer a boca para a esquerda', 1000, 'Livre: a dupla combina'],
  ['mouth_r', 'Torcer a boca para a direita', 1000, 'Livre: a dupla combina'],
  ['mouth_open', 'Abrir a boca', 1000, 'Livre: a dupla combina'],
];

/** Catálogo de sinais (fonte: docs/sinais.md). Um item por `SignalId`, na ordem de `SIGNAL_IDS`. */
export const SIGNALS: readonly SignalInfo[] = SIGNAL_IDS.map((id) => {
  const row = ROWS.find((r) => r[0] === id);
  if (row === undefined) throw new Error(`sinal sem entrada no catálogo: ${id}`);
  return {
    id,
    name: row[1],
    trigger: SIGNAL_TRIGGERS[id],
    durationMs: row[2],
    meaning: row[3],
  };
});

const BY_ID: ReadonlyMap<SignalId, SignalInfo> = new Map(SIGNALS.map((s) => [s.id, s]));

export function signalInfo(id: SignalId): SignalInfo {
  const info = BY_ID.get(id);
  if (info === undefined) throw new Error(`sinal desconhecido: ${id}`);
  return info;
}
