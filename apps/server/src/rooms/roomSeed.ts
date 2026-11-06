/**
 * `TRUCO_SEED`: semente fixa do baralho, SÓ para dev/test (E2E determinístico). Fora de
 * `NODE_ENV=development|test` a variável é ignorada (com um aviso, sem o valor). A semente continua
 * gravada em `matches.seed` como qualquer outra.
 */
import { log } from '../logger';
import { NO_EFFORT_POLICY } from '../progression/achievements';
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

/**
 * `TRUCO_PROGRESSION_RELAXED=1`: política de progressão SEM anti-farm, SÓ para dev/test (o E2E joga
 * partidas rápidas de 4 convidados, que a política padrão não pontua). Falha FECHADO: fora de
 * `NODE_ENV=development|test` o servidor recusa subir, como `AUTH_TEST_IDENTITY`.
 */
export function resolveRelaxedProgression(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const raw = env['TRUCO_PROGRESSION_RELAXED'];
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw !== '1') throw new Error('TRUCO_PROGRESSION_RELAXED deve ser 1 ou ficar vazia.');
  const nodeEnv = env['NODE_ENV'];
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('TRUCO_PROGRESSION_RELAXED só é permitido em development/test.');
  }
  return true;
}

/** Configuração da sala derivada do ambiente (semente e política de progressão de teste). */
export function roomConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): TrucoRoomConfig {
  const rngSeed = resolveTrucoSeed(env);
  const relaxed = resolveRelaxedProgression(env);
  return {
    ...(rngSeed === undefined ? {} : { rngSeed }),
    ...(relaxed ? { progressionPolicy: NO_EFFORT_POLICY } : {}),
  };
}
