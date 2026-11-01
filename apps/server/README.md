# @trucaco/server

Servidor de jogo em tempo real do Trucaco (Colyseus). **Estado atual (Fase 0):** só o esqueleto; `buildHealth()` em `src/index.ts`. Colyseus, salas, REST e persistência entram na Fase 2.

## Variáveis de ambiente

Definidas em `.env.example` na raiz do repositório. Copie para `.env` (nunca versionado).

| Variável                                                                | Uso                                              | Exemplo (dev)                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Postgres do `infra/docker-compose.yml`           | `trucaco` / `trucaco_dev_only` / `trucaco` / `5432`            |
| `DATABASE_URL`                                                          | Conexão Prisma (Fase 2)                          | `postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco` |
| `REDIS_PORT`                                                            | Porta do Redis no host                           | `6380` (a 6379 pode estar ocupada por outro Redis local)       |
| `REDIS_URL`                                                             | Conexão Redis (Fase 2)                           | `redis://localhost:6380`                                       |
| `PORT`                                                                  | Porta do servidor Colyseus (Fase 2)              | `2567`                                                         |
| `JWT_SECRET`                                                            | Segredo do JWT próprio (Fase 2). Só por ambiente | valor longo e aleatório                                        |

## Chaves Redis

A definir pela `dalva-dba` na Fase 2 (sessões, refresh tokens, filas, presença), documentando prefixo, TTL, quem escreve e quem lê.

## Comandos

```bash
pnpm --filter @trucaco/server test        # Vitest
pnpm --filter @trucaco/server typecheck
pnpm --filter @trucaco/server build
```
