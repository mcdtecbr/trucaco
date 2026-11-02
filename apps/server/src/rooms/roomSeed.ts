/**
 * `TRUCO_SEED`: semente fixa do baralho, SÓ para dev/test (E2E determinístico). Fora de
 * `NODE_ENV=development|test` a variável é ignorada (com um aviso, sem o valor). A semente continua
 * gravada em `matches.seed` como qualquer outra.
 */
import { log } from '../logger';
import type { TrucoRoomConfig } from './TrucoRoom';

const UINT32_MAX = 2 ** 32 - 1;
let warnedIgnored = false;

/** Só para testes: libera o aviso "uma vez por processo". */
export function resetSeedWarningForTests(): void {
  warnedIgnored = false;
}

/**
 * @returns a semente a usar, ou `undefined` (sorteio seguro por sala).
 * @throws se definida em dev/test mas não for um inteiro uint32 (falha cedo, como as demais envs).
 */
export function resolveTrucoSeed(
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const raw = env['TRUCO_SEED'];
  if (raw === undefined || raw === '') return undefined;
  const nodeEnv = env['NODE_ENV'];
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    if (!warnedIgnored) {
      warnedIgnored = true;
      log.warn('TRUCO_SEED ignorada: só vale com NODE_ENV=development|test');
    }
    return undefined;
  }
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > UINT32_MAX) {
    throw new Error('TRUCO_SEED inválida: esperado inteiro entre 0 e 4294967295');
  }
  return Number(raw);
}

/** Configuração da sala derivada do ambiente (hoje só a semente). */
export function roomConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): TrucoRoomConfig {
  const rngSeed = resolveTrucoSeed(env);
  return rngSeed === undefined ? {} : { rngSeed };
}
