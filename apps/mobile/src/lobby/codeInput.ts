/** Máscara e normalização do código de mesa digitado (8 símbolos de `ROOM_CODE_ALPHABET`). */
import { ROOM_CODE_LENGTH, isValidRoomCode } from '@trucaco/protocol';

/** Maiúsculas, só letras/números (cola com espaço ou hífen funciona), no máximo 8. */
export function normalizeCodeInput(text: string): string {
  return text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

/** `ABCD-EFGH` para exibição no campo. */
export function formatCodeDisplay(raw: string): string {
  const code = normalizeCodeInput(raw);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Código pronto para a rede, ou `null` (nenhuma chamada deve ser feita). */
export function codeForNetwork(text: string): string | null {
  const code = normalizeCodeInput(text);
  return isValidRoomCode(code) ? code : null;
}
