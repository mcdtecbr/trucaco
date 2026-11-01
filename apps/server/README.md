# @trucaco/server

Servidor de jogo em tempo real do Trucaco (Colyseus). **Estado atual (Fase 2, bloco 2B):** runtime executável (Colyseus + `WebSocketTransport` + express) com `GET /health`. Salas, REST e persistência entram nos próximos blocos. `src/index.ts` tem os exports puros (`buildHealth`, `createServer`); `src/main.ts` é a entrada que sobe o processo.

## Variáveis de ambiente

Definidas em `.env.example` na raiz do repositório. Copie para `.env` (nunca versionado).

| Variável                                                                | Uso                                              | Exemplo (dev)                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Postgres do `infra/docker-compose.yml`           | `trucaco` / `trucaco_dev_only` / `trucaco` / `5432`            |
| `DATABASE_URL`                                                          | Conexão Prisma (Fase 2)                          | `postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco` |
| `REDIS_PORT`                                                            | Porta do Redis no host                           | `6380` (a 6379 pode estar ocupada por outro Redis local)       |
| `REDIS_URL`                                                             | Conexão Redis (Fase 2)                           | `redis://localhost:6380`                                       |
| `PORT`                                                                  | Porta HTTP/WebSocket do servidor (padrão `2567`) | `2567`                                                         |
| `JWT_SECRET`                                                            | Segredo do JWT próprio (Fase 2). Só por ambiente | valor longo e aleatório                                        |

## Chaves Redis

A definir pela `dalva-dba` na Fase 2 (sessões, refresh tokens, filas, presença), documentando prefixo, TTL, quem escreve e quem lê.

## Comandos

```bash
pnpm --filter @trucaco/server dev         # tsx watch src/main.ts
pnpm --filter @trucaco/server build       # tsup -> dist/main.js (bundle ESM, @trucaco/* embutidos)
pnpm --filter @trucaco/server start       # node dist/main.js (rode o build antes)
pnpm --filter @trucaco/server test        # Vitest
pnpm --filter @trucaco/server typecheck
```

`pnpm build` na raiz builda `protocol` e `rules` antes (Turborepo, `dependsOn: ^build`). O `dev` não builda os pacotes do workspace: rode `pnpm build` uma vez antes.

## Health

`GET /health` responde `{"status":"ok","protocol":<PROTOCOL_VERSION>}`. SIGTERM e SIGINT fazem desligamento limpo (matchmaker, WebSocket, HTTP).

## Docker

`infra/Dockerfile.server` (multi-stage, Node 22 alpine, usuário não-root, `HEALTHCHECK` em `/health`, porta 2567). Build a partir da raiz:

```bash
docker build -f infra/Dockerfile.server -t trucaco-server .
docker run --rm -p 2567:2567 trucaco-server
```
