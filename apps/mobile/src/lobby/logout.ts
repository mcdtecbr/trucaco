/**
 * Sair da conta. Ordem importa: o `leaveQueue` precisa do token ainda válido, então vem ANTES de
 * `session.logout()`; só depois os stores são zerados. Falha de rede no `leaveQueue` não impede o logout.
 */
export interface LogoutDeps {
  beginLogout(): void;
  leaveQueue(): Promise<unknown>;
  logout(): Promise<void>;
  resetLobby(): void;
}

export async function performLogout(deps: LogoutDeps): Promise<void> {
  deps.beginLogout();
  try {
    await deps.leaveQueue();
  } catch {
    // Melhor esforço: o servidor expira a entrada sozinho.
  }
  try {
    await deps.logout();
  } finally {
    deps.resetLobby();
  }
}
