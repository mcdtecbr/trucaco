import type { FinishedMatchInput } from './types';

/**
 * Entradas de `saveMatch` que o banco recusa. O MESMO conjunto roda contra o Prisma (db.int.test)
 * e contra a memória (memory.test): as duas implementações têm de lançar `InvalidInputError`.
 * `valid` é uma partida aceita; `userId` existe; `ghostId` é um UUID sem usuário.
 */
export function invalidMatchCases(
  valid: FinishedMatchInput,
  userId: string,
  ghostId: string,
): readonly { readonly name: string; readonly input: FinishedMatchInput }[] {
  const seat = (
    seatNo: number,
    team: 0 | 1,
    id: string | null = userId,
    botFrom: number | null = null,
  ): FinishedMatchInput['players'][number] => ({ seat: seatNo, userId: id, team, botFrom });
  const withPlayers = (
    players: FinishedMatchInput['players'],
  ): { readonly input: FinishedMatchInput } => ({ input: { ...valid, players } });
  return [
    { name: 'userId inexistente', ...withPlayers([seat(0, 0, ghostId)]) },
    { name: 'userId que não é UUID', ...withPlayers([seat(0, 0, 'xyz')]) },
    { name: 'dupla incoerente com o assento', ...withPlayers([seat(1, 0)]) },
    { name: 'assento 4', ...withPlayers([seat(4, 0)]) },
    { name: 'assento negativo', ...withPlayers([seat(-1, 1)]) },
    { name: 'assento repetido', ...withPlayers([seat(0, 0), seat(0, 0, null, 0)]) },
    { name: 'botFrom negativo', ...withPlayers([seat(0, 0, null, -1)]) },
    {
      name: 'início depois do fim',
      input: { ...valid, startedAt: new Date(valid.endedAt.getTime() + 1) },
    },
    { name: 'finished sem vencedor', input: { ...valid, status: 'finished', winnerTeam: null } },
    { name: 'cancelled com vencedor', input: { ...valid, status: 'cancelled', winnerTeam: 1 } },
    { name: 'seed negativa', input: { ...valid, seed: -1 } },
    { name: 'seed acima de uint32', input: { ...valid, seed: 4294967296 } },
    { name: 'seed fracionária', input: { ...valid, seed: 1.5 } },
    { name: 'roomCode com 9 caracteres', input: { ...valid, roomCode: 'ABCDEFGH1' } },
    {
      name: 'events com mais de 2 MB',
      input: { ...valid, events: [{ seq: 1, at: 1, event: 'x'.repeat(2_200_000) }] },
    },
    { name: 'deals com mais de 1 MB', input: { ...valid, deals: ['x'.repeat(1_100_000)] } },
  ];
}
