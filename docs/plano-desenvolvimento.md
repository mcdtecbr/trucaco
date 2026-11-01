# Plano de desenvolvimento

Fases ordenadas; cada uma termina com critério de pronto verificável e revisão da `rita-revisora`. Estimativas em semanas de trabalho de uma pessoa orquestrando agentes. Cada fase vira um ou mais branches `feature/*` com PR para `develop`.

## Fase 0: fundação (1 semana)

| Etapa                                                                                   | Agente                                       | Pronto quando                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Monorepo pnpm + Turborepo, TS estrito, ESLint/Prettier, Vitest                          | `diego-devops`                               | `pnpm lint && pnpm typecheck && pnpm test` passam na raiz com pacotes vazios |
| Esqueleto de `packages/protocol`, `rules`, `avatar`, `ui`, `apps/server`, `apps/mobile` | `artur-arquiteto` (desenho) → `diego-devops` | Cada pacote builda e tem um teste trivial                                    |
| Docker Compose local: Postgres + Redis                                                  | `diego-devops`                               | `docker compose up` sobe e `server` conecta                                  |
| GitHub Actions: lint, typecheck, test, build em PR                                      | `diego-devops`                               | Pipeline verde em PR de exemplo                                              |
| README e `apps/server/README.md` com setup em 5 minutos                                 | `teo-docs`                                   | Alguém novo roda local seguindo o doc                                        |

## Fase 1: motor de regras (2 semanas)

| Etapa                                                                       | Agente         | Pronto quando                                                  |
| --------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| Tipos de carta, baralho, `Variant` Paulista e Mineiro em `protocol`/`rules` | `tales-regras` | Hierarquia e manilhas testadas por variante                    |
| `HandState`, vazas, empates, vencedor da mão                                | `tales-regras` | Todos os cenários de empate de `docs/regras-truco.md` cobertos |
| Escada de apostas: pedir, aceitar, correr, aumentar, quem pode aumentar     | `tales-regras` | Testes para ambas as escadas                                   |
| Mão de onze/dez e mão de ferro                                              | `tales-regras` | Testes incluindo decisão de jogar/correr                       |
| `MatchState`, placar, rotação de pé, fim de jogo em 12                      | `tales-regras` | Partida completa simulada com RNG fixo                         |
| `legalActions` e bot mínimo (carta mais fraca, corre a truco)               | `tales-regras` | Bot termina 1000 partidas simuladas sem ação ilegal            |
| Revisão de cobertura e casos de borda                                       | `catia-qa`     | Cobertura ≥ 90% em `rules`                                     |

## Fase 2: servidor Colyseus (2–3 semanas)

| Etapa                                                                                                                 | Agente                              | Pronto quando                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Schema Prisma: `users`, `avatars`, `matches`, `match_players`, `partner_codes`, `reports`, `blocks`; migração inicial | `dalva-dba`                         | `prisma migrate dev` aplica em local limpo                          |
| `protocol`: mensagens cliente→servidor e servidor→cliente, schema Colyseus da mesa                                    | `artur-arquiteto` → `caio-colyseus` | Tipos compartilhados compilam nos dois lados                        |
| `TrucoRoom`: integra motor, filtro por assento, timer de turno                                                        | `caio-colyseus`                     | 4 clientes de teste jogam uma mão completa                          |
| Reconexão e bot de ausência                                                                                           | `caio-colyseus`                     | Teste: cliente cai, reconecta em 60 s e continua; expira e bot joga |
| `LobbyRoom`: criar/entrar por código, fila pública FIFO, parcerias                                                    | `caio-colyseus`                     | Testes de sala                                                      |
| Sinais: validação, rate limit, broadcast, log                                                                         | `caio-colyseus`                     | Teste: 2 sinais em 1 s → segundo rejeitado                          |
| Chat da dupla e da mesa: filtro, rate limit, frases rápidas                                                           | `caio-colyseus`                     | Teste: mensagem de parceiro não chega ao adversário                 |
| Auth: guest, JWT, `onAuth`, refresh em Redis                                                                          | `caio-colyseus`                     | Teste de integração de login e entrada em sala                      |
| Auditoria de auth, filtro de cartas, rate limit                                                                       | `vitor-seguranca`                   | Sem achado crítico ou alto em aberto                                |

## Fase 3: cliente jogável (3 semanas)

| Etapa                                                                                        | Agente           | Pronto quando                               |
| -------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------- |
| Expo Router, telas de entrada (convidado), início, criar/entrar mesa                         | `fabio-frontend` | Fluxo roda no web e no Expo Go              |
| Cliente Colyseus, store de UI, reconexão no cliente                                          | `fabio-frontend` | Partida de teste com 4 abas/dispositivos    |
| Componentes em `packages/ui`: carta, mão, pilha da vaza, placar, vira                        | `fabio-frontend` | Testes de componente                        |
| Mesa: jogar carta, carta coberta, botões de truco contextuais, mão de onze/dez, mão de ferro | `fabio-frontend` | Partida completa jogável por humanos no web |
| Avatar placeholder (círculo com apelido) nas 4 posições                                      | `fabio-frontend` | —                                           |
| E2E web: convidado → sala → partida até o fim                                                | `catia-qa`       | Playwright verde no CI                      |

## Fase 4: avatar Rive e sinais (3 semanas)

| Etapa                                                                                 | Agente                             | Pronto quando                                                      |
| ------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Rig `avatar.riv`: partes trocáveis, state machine `Main`, idle                        | `rai-avatar`                       | Arquivo abre no editor e no runtime web                            |
| 12 gatilhos de sinais conforme `docs/sinais.md`                                       | `rai-avatar`                       | Cada trigger anima e volta ao idle                                 |
| `packages/avatar`: catálogo de partes, catálogo de sinais, mapeamento de triggers     | `rai-avatar`                       | Testes de catálogo                                                 |
| Componente `<Avatar>` `.native.tsx` e `.web.tsx`                                      | `rai-avatar`                       | Renderiza igual em web, iOS, Android                               |
| Criador de avatar (tela) e `PUT /me/avatar`                                           | `fabio-frontend` + `caio-colyseus` | Avatar salvo reaparece após login                                  |
| Painel de sinais na mesa (segurar para enviar) e animação sincronizada nos 4 avatares | `fabio-frontend`                   | Sinal de um jogador aparece nos outros 3 em < 500 ms em rede local |
| Revisão de desempenho em mobile (FPS com 4 avatares)                                  | `duda-debugger`                    | ≥ 50 FPS em aparelho intermediário                                 |

## Fase 5: chat da dupla e balões (1–2 semanas)

| Etapa                                                                              | Agente                        | Pronto quando                                    |
| ---------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| Tela de preparação: chat da dupla + catálogo de sinais com anotação de significado | `fabio-frontend`              | Dupla combina e o combinado fica visível na mesa |
| `partner_codes`: salvar/recuperar combinado por par                                | `caio-colyseus` + `dalva-dba` | Reaparece quando a mesma dupla joga de novo      |
| Balões de chat da mesa sobre o avatar (4 s), frases rápidas                        | `fabio-frontend`              | —                                                |
| Auditoria de chat: filtro, rate limit, vazamento entre canais                      | `vitor-seguranca`             | Sem achado alto                                  |

## Fase 6: contas, perfil e histórico (2 semanas)

| Etapa                                                       | Agente                             | Pronto quando                           |
| ----------------------------------------------------------- | ---------------------------------- | --------------------------------------- | ------------------------------------------- |
| Login Google e Apple (Expo AuthSession), `POST /auth/google | apple`, vínculo de convidado       | `fabio-frontend` + `caio-colyseus`      | Convidado vincula e mantém avatar/histórico |
| Perfil, estatísticas, histórico de partidas                 | `fabio-frontend` + `caio-colyseus` | —                                       |
| Denúncia, bloqueio, filtro na fila pública                  | `caio-colyseus`                    | Bloqueado não cai na mesma mesa pública |
| Auditoria completa de auth e autorização                    | `vitor-seguranca`                  | Sem achado crítico ou alto              |

## Fase 7: publicação beta (2 semanas)

| Etapa                                                                   | Agente          | Pronto quando                       |
| ----------------------------------------------------------------------- | --------------- | ----------------------------------- |
| Dockerfile do server, `fly.toml`, Postgres e Redis gerenciados, secrets | `diego-devops`  | Servidor acessível com health check |
| Deploy web (Expo export estático)                                       | `diego-devops`  | URL pública abre o jogo             |
| EAS Build iOS/Android, TestFlight e teste interno Play                  | `diego-devops`  | Build instalável nos dois           |
| Maestro E2E nos builds                                                  | `catia-qa`      | Fluxo básico verde                  |
| Observabilidade: logs estruturados, métricas de salas, alertas          | `diego-devops`  | Dashboard mínimo                    |
| Beta fechado com 8–12 jogadores, ciclo de correções                     | `duda-debugger` | Zero bug bloqueante aberto          |

## Fase 8: mesa de 6 e matchmaking público (3 semanas)

| Etapa                                                         | Agente                             | Pronto quando           |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| ADR com regras da mesa de 6 (assentos, distribuição, empates) | `artur-arquiteto` + usuário        | ADR aprovado            |
| Motor com `seats = 6`                                         | `tales-regras`                     | Testes da variante de 6 |
| `TrucoRoom` para 6, layout da mesa para 6                     | `caio-colyseus` + `fabio-frontend` | Partida de 6 jogável    |
| Matchmaking público com nível e bloqueios                     | `caio-colyseus`                    | —                       |
| Painel de moderação mínimo                                    | `fabio-frontend` + `caio-colyseus` | —                       |

## Convenções do plano

- Toda etapa que cria tipos compartilhados passa primeiro por `packages/protocol`.
- Ao fim de cada fase: `catia-qa` roda a suíte completa, `rita-revisora` revisa, `teo-docs` atualiza README/changelog, PR `feature/*` → `develop`.
- `develop` → `master` por PR apenas quando o usuário pedir (marcos: fim da fase 3, fim da fase 7).
