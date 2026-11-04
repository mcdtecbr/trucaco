import { createMemoryRepositories } from './memoryRepositories';
import { userLinkContract } from './userLinkContract';

let repos = createMemoryRepositories();

userLinkContract('memória', () => ({
  users: repos.users,
  matches: repos.matches,
  reset: async () => {
    repos = createMemoryRepositories();
  },
}));
