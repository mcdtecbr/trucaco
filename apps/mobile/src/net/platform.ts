/**
 * Como a sessão guarda o refresh. Padrão (nativo, testes, SSR): no corpo, persistido pelo `TokenStorage`.
 * `platform.web.ts` troca por `true`: cookie httpOnly emitido pelo servidor (Fase 7A). A diferença de
 * plataforma fica aqui, em arquivo por extensão, e não em `if` espalhado.
 */
export const usesCookieSession = false as boolean;
