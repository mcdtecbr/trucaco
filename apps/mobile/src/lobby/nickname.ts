/**
 * Validação de apelido SÓ para UX (o servidor decide de novo: `validateNickname` em
 * `apps/server/src/db/validation.ts`, que NÃO está no protocol). Espelho da política: NFC, 3 a 16 code
 * points, letras latinas, dígitos, `_`, `.` e `-`. Se a política mudar no servidor, o 400/409 ainda
 * é tratado pela UI.
 */
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
const NICKNAME_PATTERN = /^[0-9A-Za-z_.À-ÖØ-öø-ɏ-]+$/;

export function checkNickname(raw: string): { ok: true; nickname: string } | { ok: false } {
  const nickname = raw.trim().normalize('NFC');
  const n = [...nickname].length;
  if (n < NICKNAME_MIN || n > NICKNAME_MAX || !NICKNAME_PATTERN.test(nickname))
    return { ok: false };
  return { ok: true, nickname };
}
