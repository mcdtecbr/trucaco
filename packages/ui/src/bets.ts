import type { LegalActionId } from '@trucaco/protocol';
import { betCry, parseLegalAction } from '@trucaco/protocol';

export type BetButtonTone = 'primary' | 'danger' | 'neutral';

export interface BetButtonSpec {
  readonly id: LegalActionId;
  readonly kind: 'bet' | 'accept' | 'run' | 'specialPlay' | 'specialRun';
  readonly label: string;
  /** Linha pequena sob o rótulo (ex.: "vale 6"). */
  readonly detail?: string;
  readonly tone: BetButtonTone;
  readonly accessibilityLabel: string;
}

export interface BetContext {
  /** Já há aposta pendente: o botão `bet` é "Aumentar" e não "Truco". */
  readonly raising?: boolean;
  /** Valor da próxima aposta (do servidor/estado). O cliente não o infere: ausente = não mostra valor. */
  readonly nextValue?: number | undefined;
  /** Valor em jogo se aceitar a aposta pendente. */
  readonly pendingValue?: number | undefined;
}

const ORDER: Readonly<Record<BetButtonSpec['kind'], number>> = {
  specialPlay: 0,
  specialRun: 1,
  accept: 2,
  bet: 3,
  run: 4,
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Botões de aposta derivados SOMENTE dos ids de `legalActions` (bet, accept, run, specialPlay,
 * specialRun). Ações de carta são ignoradas aqui; ids repetidos viram um botão; id desconhecido some.
 */
export function betButtons(legalActions: readonly string[], ctx: BetContext = {}): BetButtonSpec[] {
  const kinds = new Set<BetButtonSpec['kind']>();
  for (const id of legalActions) {
    const a = parseLegalAction(id);
    if (
      a !== null &&
      (a.kind === 'bet' ||
        a.kind === 'accept' ||
        a.kind === 'run' ||
        a.kind === 'specialPlay' ||
        a.kind === 'specialRun')
    ) {
      kinds.add(a.kind);
    }
  }
  const out: BetButtonSpec[] = [];
  for (const kind of [...kinds].sort((x, y) => ORDER[x] - ORDER[y])) {
    out.push(spec(kind, ctx));
  }
  return out;
}

function spec(kind: BetButtonSpec['kind'], ctx: BetContext): BetButtonSpec {
  const next = ctx.nextValue;
  const cry = next === undefined ? undefined : betCry(next);
  switch (kind) {
    case 'bet': {
      // Rótulo e fala derivam do grito do valor que o servidor/estado informou (Paulista 3/6/9/12,
      // Mineiro 2/4/6/8/10/12); sem valor conhecido, texto genérico.
      const label =
        cry !== undefined ? `${cap(cry)}!` : ctx.raising === true ? 'Aumentar' : 'Truco!';
      const detail = next === undefined ? undefined : `vale ${next}`;
      const spoken = label.replace('!', '');
      return {
        id: 'bet',
        kind,
        label,
        ...(detail !== undefined ? { detail } : {}),
        tone: 'primary',
        accessibilityLabel: detail !== undefined ? `${spoken}, ${detail}` : spoken,
      };
    }
    case 'accept': {
      const detail = ctx.pendingValue === undefined ? undefined : `vale ${ctx.pendingValue}`;
      return {
        id: 'accept',
        kind,
        label: 'Aceitar',
        ...(detail !== undefined ? { detail } : {}),
        tone: 'primary',
        accessibilityLabel: detail !== undefined ? `Aceitar, ${detail}` : 'Aceitar',
      };
    }
    case 'run':
      return {
        id: 'run',
        kind,
        label: 'Correr',
        tone: 'danger',
        accessibilityLabel: 'Correr da aposta',
      };
    case 'specialPlay':
      return {
        id: 'specialPlay',
        kind,
        label: 'Jogar a mão',
        tone: 'primary',
        accessibilityLabel: 'Jogar a mão',
      };
    case 'specialRun':
      return {
        id: 'specialRun',
        kind,
        label: 'Correr da mão',
        tone: 'danger',
        accessibilityLabel: 'Correr da mão',
      };
  }
}
