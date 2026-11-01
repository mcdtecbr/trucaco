import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@trucaco/protocol';

export type RandomIntFn = (min: number, max: number) => number;

/** Um código de sala: `ROOM_CODE_LENGTH` símbolos de `ROOM_CODE_ALPHABET`, sorteados por `crypto.randomInt`. */
export function randomRoomCode(rand: RandomIntFn = randomInt): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET.charAt(rand(0, ROOM_CODE_ALPHABET.length));
  }
  return code;
}

export const CODE_MAX_TRIES = 20;

/**
 * Código ainda não usado. A unicidade é verificada por `isTaken` (diretório em memória, que também guarda
 * os códigos reservados e ainda sem sala) e há nova tentativa em colisão. Lança só se esgotar as tentativas
 * (espaço de 31^8 códigos: na prática, bug ou RNG quebrado).
 */
export function generateUniqueRoomCode(
  isTaken: (code: string) => boolean,
  rand: RandomIntFn = randomInt,
  maxTries: number = CODE_MAX_TRIES,
): string {
  for (let i = 0; i < maxTries; i++) {
    const code = randomRoomCode(rand);
    if (!isTaken(code)) return code;
  }
  throw new Error('Não foi possível gerar um código de sala único.');
}
