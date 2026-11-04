import { createMemoryRepositories } from './memoryRepositories';
import { progressionContract } from './progressionContract';

let repos = createMemoryRepositories();

progressionContract('memória', () => ({
  users: repos.users,
  matches: repos.matches,
  progression: repos.progression,
  reset: async () => {
    repos = createMemoryRepositories();
  },
}));
