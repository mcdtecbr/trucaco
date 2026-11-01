# Trucaco

Truco online (Paulista e Mineiro) para web, iOS e Android. Mesa de 4 jogadores (6 na fase 8), avatar animado em Rive que faz sinais de truco visíveis a toda a mesa, chat privado da dupla para combinar sinais, balões de conversa na mesa.

## Memória do projeto

Importada automaticamente no início de toda sessão (estado das fases, ambiente de dev, regras de Git). Ao aprender algo que não está no código, grave um arquivo em `.claude/memory/`, adicione-o ao índice `MEMORY.md` e, se for importante, importe-o aqui com `@`.

@.claude/memory/MEMORY.md
@.claude/memory/projeto-trucaco.md
@.claude/memory/feedback_git_convencao.md
@.claude/memory/trucaco-ambiente-dev.md

Documentos de referência, leia antes de qualquer tarefa não trivial:

- `docs/specs/2026-11-01-trucaco-design.md`: arquitetura, componentes, fluxo de dados, decisões.
- `docs/plano-desenvolvimento.md`: fases, entregas e agente responsável por etapa.
- `docs/regras-truco.md`: regras de Paulista e Mineiro no detalhe que o motor implementa.
- `docs/sinais.md`: catálogo de sinais e gatilhos Rive.
- `docs/audio.md`: vozes dos avatares, gritos por tipo de aposta, efeitos engraçados, licenças.
- `docs/gamificacao.md`: conquistas, missões diárias (Fase 6) e ranking competitivo (Fase 9).

## Time de agentes

| Agente            | Papel                                                                                                                                                            | Escreve código? |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `artur-arquiteto` | Arquitetura, contratos entre pacotes, plano por etapa                                                                                                            | Não             |
| `tales-regras`    | Motor de regras do Truco em `packages/rules` (Paulista, Mineiro, série `bo3`, `GameEvent`) + testes                                                              | Sim             |
| `caio-colyseus`   | Servidor Colyseus em `apps/server`: lobby, salas, série, schema de estado, reconexão, sinais, efeitos `sfx`, chat, `onAuth`, REST, conquistas, missões e ranking | Sim             |
| `fabio-frontend`  | Cliente Expo/RN em `apps/mobile` e `packages/ui`: telas, mesa, placar em camadas, cartas, estado, cliente Colyseus, player de áudio, perfil                      | Sim             |
| `rai-avatar`      | Rive em `packages/avatar` e `assets/rive`: rig, state machine, catálogo de sinais, vozes e efeitos sonoros (`assets/audio`), integração RN/web                   | Sim             |
| `dalva-dba`       | Postgres (Prisma), Redis, migrações, índices                                                                                                                     | Sim             |
| `catia-qa`        | Testes unitários (Vitest), de sala (`@colyseus/testing`) e E2E (Maestro, Playwright)                                                                             | Sim (só testes) |
| `duda-debugger`   | Reproduz bugs, causa raiz, correção mínima com teste de regressão                                                                                                | Sim             |
| `rita-revisora`   | Revisão de diff via Codex CLI, uma vez antes do commit                                                                                                           | Não             |
| `vitor-seguranca` | Auth, anti-trapaça, rate limit, moderação, segredos, dependências                                                                                                | Não             |
| `diego-devops`    | Docker, GitHub Actions, Fly.io, Expo EAS, ambientes                                                                                                              | Sim             |
| `teo-docs`        | README, ADRs, changelog, docs de regras e sinais                                                                                                                 | Sim (só docs)   |

## Fluxo padrão para uma funcionalidade nova

1. **artur-arquiteto** analisa e entrega o plano com etapas e agente responsável por cada uma. Contratos que cruzam cliente/servidor vão primeiro para `packages/protocol`.
2. Agentes de implementação executam as etapas. Ordem típica: **tales-regras** (regra nova) → **dalva-dba** (schema) → **caio-colyseus** (servidor) → **fabio-frontend** / **rai-avatar** (cliente). Cliente e servidor podem andar em paralelo depois que o contrato em `protocol` está definido.
3. **catia-qa** cobre o que foi implementado e roda a suíte completa.
4. **rita-revisora** revisa o diff. Achados voltam para o agente que implementou.
5. **vitor-seguranca** audita quando a mudança toca autenticação, autorização, mensagens do cliente, chat, sinais, rate limit, segredos ou dependências.
6. **teo-docs** atualiza docs conforme o impacto.

## Fluxo para bug

1. **duda-debugger** reproduz, isola a causa e corrige com teste de regressão.
2. **rita-revisora** revisa a correção.

## Regras para o orquestrador (sessão principal)

- Delegue implementação, revisão e testes aos agentes. Não faça tudo na sessão principal.
- Ao delegar, passe contexto suficiente: objetivo, arquivos exatos, o que já foi decidido, critério de pronto. O agente só sabe o que estiver no prompt.
- Etapas independentes podem rodar em paralelo (cliente e servidor após contrato definido; rita-revisora e vitor-seguranca sobre o mesmo diff).
- Nunca considere uma tarefa concluída sem a suíte passando e sem revisão da **rita-revisora**.
- Agentes somente leitura (artur-arquiteto, rita-revisora, vitor-seguranca) reportam. A correção é delegada ao agente da área.
- **O servidor é a única fonte de verdade.** Nenhuma regra de jogo no cliente além de validação de UX. Nenhum cliente recebe carta de outro jogador.
- Responda em português do Brasil.

## Economia de tokens

- **Faça direto na sessão principal** o que cabe em poucas chamadas: correção pontual, ajuste de texto, mudança em um arquivo. Agente só quando há exploração ampla, trabalho independente que vale paralelizar, ou revisão que precisa de olhar não enviesado.
- **Fluxo por tamanho.** Pequena: sessão principal. Média: um dev e depois rita-revisora. Grande: artur-arquiteto, devs, catia-qa, rita-revisora, vitor-seguranca só se tocar auth, mensagens do cliente ou segredos.
- **Um agente de julgamento por tarefa** (artur-arquiteto, vitor-seguranca). Rodam em modelos caros. A rita-revisora é barata do lado do Claude: o custo dela é a cota do Codex.
- **Ao delegar, passe arquivos exatos** e o que já foi decidido.
- **Peça relatório curto**: até 20 linhas, só o que muda a decisão.
- **Sem paralelismo por padrão.** Dois agentes ao mesmo tempo dobram o gasto.
- **Arquivos grandes**: `grep` antes de `Read`, `Read` com offset e limit.
- **Sessão nova para tarefa sem relação.**

## Convenções do projeto

- **Linguagem**: TypeScript estrito em todo o monorepo (`strict: true`, sem `any` implícito). Sem JavaScript solto.
- **Gerenciador**: pnpm workspaces + Turborepo. Scripts na raiz: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format`, `pnpm db:up`/`db:down`. O script de E2E (`test:e2e`) nasce na Fase 3. No Windows com Git Bash, `pnpm` vem de `corepack enable --install-directory ~/.local/bin pnpm`.
- **Testes**: Vitest em `packages/*` e `apps/server`; `@colyseus/testing` para salas; Maestro (mobile) e Playwright (web) para E2E. Arquivo de teste ao lado do código: `nome.test.ts`.
- **Lint e formato**: ESLint + Prettier, configuração única na raiz.
- **Pastas**: ver `README.md`. `packages/rules` não importa nada de rede, banco ou UI. `packages/protocol` só tipos, schemas e constantes.
- **Nomes**: código em inglês (`playCard`, `callTruco`), termos do jogo mantidos em português quando não há tradução natural (`manilha`, `vira`, `zap`, `maoDeOnze`). Docs e commits em português.
- **Commits**: `tipo(escopo): descrição` em pt-BR (`feat`, `fix`, `chore`, `docs`, `test`, `build`, `ci`). Escopos: `rules`, `server`, `mobile`, `avatar`, `protocol`, `ui`, `infra`, `docs`, `agents`.
- **Git, modo atual (desde 2026-11-01)**: trabalhar, commitar e dar push **direto na `develop`**, sem branch de feature e **sem PR**, até o usuário avisar para abrir PR. Isso substitui a regra padrão abaixo enquanto durar; nunca mexer na `master`. Detalhes em `.claude/memory/feedback_git_convencao.md`.
- **Git, regra padrão**: segue a skill `convencao-git` do usuário (Git Flow adaptado: `feature/*` → `develop` por PR; `develop` → `master` por PR só quando o usuário pedir). **Ajuste deste projeto**: remoto é o GitHub (`mcdtecbr/trucaco`), PRs pela API REST do GitHub (o `gh` não está instalado; ver `.claude/memory/trucaco-ambiente-dev.md`), não pela API do Azure DevOps.
- **Variáveis de ambiente**: toda variável nova entra em `.env.example` com valor de exemplo seguro e na seção de ambiente do `apps/server/README.md`. `.env` nunca versionado.
- **Dependência nova**: só com justificativa no relatório do agente.
