---
name: trucaco-ambiente-dev
description: Ambiente de dev do Trucaco nesta máquina — pnpm via corepack, Redis na 6380, sem gh, Prettier nos md
metadata:
  type: reference
---

- **pnpm** não está instalado globalmente: `corepack enable --install-directory ~/.local/bin pnpm` e `export PATH="$HOME/.local/bin:$PATH"` (Git Bash). O repo fixa `pnpm@9.15.9` em `packageManager`; o corepack baixa sozinho.
- **Redis do Trucaco na porta 6380** no host: a 6379 é do container `mcd-ups-fiori-redis` do portal Fiori. Não mexer nele. Postgres do Trucaco na 5432. Subir e derrubar: `pnpm db:up` e `pnpm db:down`.
- **`gh` não está instalado.** PR no GitHub: REST API `POST https://api.github.com/repos/mcdtecbr/trucaco/pulls` com o token de `git credential fill` (host github.com), sem imprimir o token. Funcionou em 2026-11-01 (PR #1).
- **Prettier** roda sobre os `.md` também (`pnpm format`). Rodar antes de commitar para o `format:check` do CI passar.
- **Pacotes**: `@trucaco/{protocol,rules,avatar,ui,server,mobile}`. `apps/mobile` ainda sem Expo (entra na Fase 3). O bundler do servidor (ex.: tsup) fica para a Fase 2, porque os pacotes são ESM sem extensão nos imports.
- **Verificação completa**: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- **Servidor (bloco 2B)**: pacotes reais são `@colyseus/core@0.18.10` + `@colyseus/ws-transport@0.18.4` (o umbrella `colyseus` não instala aqui: puxa uWebSockets.js por git/ssh). Build com `tsup` (bundle ESM com `@trucaco/*` dentro); `pnpm dev` exige `protocol` e `rules` buildados. `new Server({gracefullyShutdown:false})` é obrigatório (o `main.ts` trata SIGTERM/SIGINT). **Vitest do server usa `pool:'threads'`**: o `@colyseus/core` importa `@pm2/io`, que quebra o IPC do pool padrão; testes de sala devem manter isso. O matchmaker tem estado global: um `Server` por arquivo de teste. **Docker não existe no container da nuvem**: `infra/Dockerfile.server` não foi buildado. Ele usa `pnpm deploy --prod` (copiar só `apps/server/node_modules` quebra por causa dos symlinks do pnpm).
