/**
 * Significados fixos que a dupla pode combinar para um sinal. O servidor guarda o texto (até 60
 * caracteres), então o cliente envia o `label` como está; "Nada" envia texto vazio (limpa o combinado).
 */
import type { SignalId } from '@trucaco/protocol';

export interface CodeMeaning {
  readonly id: string;
  /** Texto enviado ao servidor (`''` = nada). */
  readonly label: string;
}

export const NOTHING_ID = 'nada';

export const CODE_MEANINGS: readonly CodeMeaning[] = [
  { id: 'zap', label: 'ZAP / manilha de paus' },
  { id: 'copas', label: 'Sete Copas / manilha de copas' },
  { id: 'espadao', label: 'Espadão / manilha de espadas' },
  { id: 'ouros', label: '7 de ouros / manilha de ouros' },
  { id: 'tres', label: '3' },
  { id: 'dois', label: '2' },
  { id: NOTHING_ID, label: '' },
];

/** Texto exibido da opção ("Nada" para o vazio). */
export const meaningText = (m: CodeMeaning): string => (m.label === '' ? 'Nada' : m.label);

/** O servidor guarda o texto em NFC e sem bordas: compara na mesma forma. */
const clean = (s: string): string => s.normalize('NFC').trim();

/** Opção da lista que corresponde ao texto salvo, ou `null` (vazio = "Nada"; outro texto = personalizado). */
export function selectedMeaning(saved: string): CodeMeaning | null {
  const s = clean(saved);
  return CODE_MEANINGS.find((m) => m.label === s) ?? null;
}

/** Texto livre antigo que não está na lista (nunca vazio). */
export function customText(saved: string): string | null {
  const s = clean(saved);
  return s !== '' && selectedMeaning(s) === null ? s : null;
}

/**
 * Opções oferecidas a um sinal: tudo que NÃO está em uso por OUTRO sinal ("Nada" sempre cabe, e o
 * significado do próprio sinal continua). Trocar libera o anterior porque `codes` vem do servidor.
 */
export function optionsFor(
  signal: SignalId,
  codes: Readonly<Partial<Record<SignalId, string>>>,
): readonly CodeMeaning[] {
  const usedElsewhere = new Set(
    Object.entries(codes)
      .filter(([id, text]) => id !== signal && typeof text === 'string' && text !== '')
      .map(([, text]) => clean(text as string)),
  );
  return CODE_MEANINGS.filter((m) => m.label === '' || !usedElsewhere.has(m.label));
}
