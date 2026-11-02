# Trucaço

Truco online, Paulista e Mineiro, para web, iOS e Android. Mesas de 4 (e depois 6) jogadores, cada um no seu dispositivo, com avatar animado que faz os **sinais de truco** para toda a mesa ver, chat privado da dupla para combinar os sinais e balões de conversa durante a partida.

## Estado

Fase 0 (fundação) concluída: monorepo, CI e Docker local prontos. Os pacotes são esqueletos com um teste cada; o motor de regras começa na Fase 1.

- Especificação: [docs/specs/2026-11-01-trucaco-design.md](docs/specs/2026-11-01-trucaco-design.md)
- Plano de desenvolvimento: [docs/plano-desenvolvimento.md](docs/plano-desenvolvimento.md)
- Regras do jogo (referência para o motor): [docs/regras-truco.md](docs/regras-truco.md)
- Catálogo de sinais: [docs/sinais.md](docs/sinais.md)
- Vozes, gritos de truco e efeitos sonoros: [docs/audio.md](docs/audio.md)
- Conquistas, missões e ranking: [docs/gamificacao.md](docs/gamificacao.md)

## Stack decidida

| Camada                         | Tecnologia                                                       |
| ------------------------------ | ---------------------------------------------------------------- |
| Cliente (web, iOS, Android)    | React Native + Expo, TypeScript                                  |
| Avatares e animações de sinais | Rive (`rive-react-native` / `@rive-app/react-canvas`)            |
| Servidor de jogo em tempo real | Node.js + TypeScript + Colyseus                                  |
| Persistência                   | PostgreSQL (Prisma) e Redis                                      |
| Autenticação                   | Google, Apple e convidado (JWT próprio)                          |
| Monorepo                       | pnpm workspaces + Turborepo                                      |
| Hospedagem                     | Fly.io (servidor), Expo EAS (builds mobile), GitHub Actions (CI) |

## Rodando em 5 minutos

Pré-requisitos: Node 22+ (`.nvmrc`), pnpm 9.15.9 (via `corepack enable`) e Docker.

```bash
pnpm install
cp .env.example .env     # valores de desenvolvimento local
pnpm db:up               # Postgres 16 (5432) e Redis 7 (6380) em Docker
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm db:down
```

Scripts da raiz: `dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`, `db:up`, `db:down`. O CI (`.github/workflows/ci.yml`) roda `format:check`, `lint`, `typecheck`, `test` e `build` em todo PR para `develop`/`master`.

## Estrutura planejada

```
trucaco/
├── apps/
│   ├── mobile/          # Expo: UI, mesa, avatar Rive, chat (web, iOS, Android)
│   └── server/          # Colyseus: lobby, salas, partida, sinais, chat, auth, REST
├── packages/
│   ├── rules/           # Motor de regras puro: Paulista e Mineiro
│   ├── protocol/        # Tipos e schemas compartilhados cliente/servidor
│   ├── avatar/          # Catálogo de partes do avatar e de sinais → gatilhos Rive
│   └── ui/              # Componentes visuais compartilhados (cartas, mesa, balões)
├── assets/rive/         # Arquivos .riv
├── docs/                # Specs, plano, regras, ADRs
├── infra/               # Dockerfile, fly.toml, docker-compose local
└── .claude/agents/      # Time de agentes especialistas do Claude Code
```

## Time de agentes

Ver [CLAUDE.md](CLAUDE.md). Abra o Claude Code nesta pasta e os agentes carregam automaticamente.
