# Relatório da Fase 6: contas, perfil, conquistas e missões

Data: 2026-11-05. Branch `develop`, direto (sem PR), conforme o modo atual do projeto. Plano de execução: `docs/specs/2026-11-04-fase-6-plano.md` (seção 7 traz o status por bloco). Estado da fase: `docs/plano-desenvolvimento.md`. Contrato e rotas: `docs/protocolo-servidor.md`. Servidor: `apps/server/README.md` (seções "Progressão" e "Login social e vínculo"). Cliente: `apps/mobile/README.md` (seções "Perfil e moderação" e "Login, vínculo, conquistas e missões"). Decisões de arquitetura: ADR 0009 (catálogo em código e idempotência) e ADR 0010 (elegibilidade anti-conluio e denúncia única).

Resumo: a Fase 6 entregou o contrato, o histórico, o bloqueio, a denúncia, o apagar conta, a progressão (conquistas, missões e estatísticas) e o login social e o vínculo no servidor, com as telas correspondentes no cliente. A fase fica **concluída com ressalvas**. Três pontos pesam na decisão: (1) **nenhum login Google ou Apple funciona de ponta a ponta**: o app não registra SDK e o servidor ainda não emite nonce; (2) **o E2E web fecha em 23 de 24**, com uma falha reproduzida em duas execuções (ver "Lacunas"); (3) a correção da auditoria 6I (anti-farm e unicidade da denúncia) está na árvore **sem commit**.

## Blocos e commits

| Bloco | Commit (PR)   | Entrega                                                                                                                                                                                                                                |
| ----- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plano | PR #21        | `docs/specs/2026-11-04-fase-6-plano.md` (artur-arquiteto, somente leitura)                                                                                                                                                             |
| 6A    | d1dcbc7 (#21) | Contrato em `packages/protocol`: `http.ts`, `gamification.ts` (9 conquistas, 6 missões), 7 códigos HTTP. `PROTOCOL_VERSION` 6                                                                                                          |
| 6B    | c401a03 (#22) | `GET /matches`; bloqueios; `POST /reports`; `DELETE /me`; filtro na fila pública e na mesa privada; cliente: histórico, bloquear e denunciar pelo histórico, lista de bloqueados, apagar conta                                         |
| 6C    | c692afc (#23) | Migração `20261105140000_fase6_progressao`: `user_achievements`, `user_missions`, `user_stats`, `progression_applied`, `users.linked_at`; `ProgressionRepository` (Prisma e memória); ADR 0009                                         |
| 6D    | 6f6297e (#24) | Avaliação pura (`achievements.ts`, `missions.ts`, `period.ts`) e `applyMatchProgression` depois de `saveMatch`, idempotente por partida                                                                                                |
| 6E    | 6f6297e (#24) | `GET /me/achievements`, `GET /me/missions`, `GET /users/:id`; `stats` em `GET /me`                                                                                                                                                     |
| 6F    | d2738ab (#25) | `POST /auth/google`, `/auth/apple`, `/auth/link`; `JwksIdentityVerifier` (JWKS, `jose`) e `TestIdentityVerifier` (só dev e test); `GET /health` com `socialProviders`                                                                  |
| 6G    | d2738ab (#25) | Telas `login`, "Vincular conta", `achievements`, `missions`, `profile/[id]`; conquistas em `FinishedView`; missões em `HomeView`                                                                                                       |
| 6H    | a37c759 (#26) | 11 cenários E2E (`account.spec.ts`, `progress.spec.ts`); `test:int` de vínculo com Redis real (`userLink`, `redisTokenStore`, `socialAuth`); `PENDING_PHASE6` vazio                                                                    |
| 6I    | sem commit    | Auditoria do `vitor-seguranca` e correções na árvore: `UNIQUE (reporter_id, reported_id, match_id)` (migração `20261106100000_reports_unique`); anti-farm por conluio; janela de 7 dias para denúncia sem partida; teto de 10 por hora |
| 6J    | sem commit    | Este fechamento: relatório, CHANGELOG, plano, ADR 0010, README do mobile (6G), handoff e memória                                                                                                                                       |

Nenhuma variável de ambiente nova além das de login social (`GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_IDS`, `AUTH_SOCIAL_PER_IP_PER_MIN`, `AUTH_TEST_IDENTITY`), já em `.env.example` e em `apps/server/README.md`. Os limites de progressão e de denúncia são constantes de código, não variáveis.

## Decisões do usuário

- **Padrões da seção 3 do plano aceitos em 2026-11-04** (o plano registra a aceitação): login social atrás de `IdentityVerifier` e desligado sem client ID; recompensa cosmética fica para a Fase 10 (`entitlements`); conquistas e missões em código (ADR 0009); sem XP; denúncia e bloqueio persistentes; `DELETE /me` imediato; cookie httpOnly na Fase 7; fusão de contas fora; `corredor_esperto` fora.
- **Assumidos por padrão, a confirmar** (ADR 0010 e `CHANGELOG.md`, "Decisões a confirmar"): mínimo de 4 mãos e 3 min para pontuar; teto de 5 partidas pontuadas por par em 24 h; mesa privada só de convidados não pontua; janela de 7 dias para denúncia sem partida; teto de 10 denúncias por hora contra o mesmo denunciado.
- **Pendente do usuário**: bloquear e denunciar pelo menu do assento na mesa (exige `userId` público em `PublicPlayer`). Decisão de produto, com `artur-arquiteto` e `vitor-seguranca`.

## Revisão

- **Rita-C** (`rita-revisora-claude`, opus; o Codex não funciona nesta máquina) revisou todos os blocos antes de cada commit: 6B (1 P2, 6 P3), 6C (0 P1/P2, 5 P3), 6D e 6E (1 P2, 4 P3), 6F e 6G (2 P2, 4 P3) e as correções da auditoria 6I (2 P2, 4 P3). Todos os P1/P2/P3 foram corrigidos, ou aceitos e registrados (ver `apps/server/README.md`). O 6H (só testes) não teve revisão própria.
- **vitor-seguranca**: 6B (6 baixas, nenhuma crítica ou alta, corrigidas), 6F (sem crítico ou alto; 2 médios e 4 baixos corrigidos, exceto o nonce emitido pelo servidor, que fica como pendência) e 6I, auditoria da fase inteira (nenhum crítico ou alto; 3 médios e 3 baixos: farm por conluio, denúncia falsa em massa e texto de denúncia na exclusão de conta foram corrigidos; enumeração por bloqueio corrigida; griefing por conta apagada, `sub` banido na Fase 8 e custo da fila ficam como pendência).
- Revisão por Codex: **nunca feita** (pendência antiga, ver handoff).

## Verificado nesta sessão (2026-11-05)

- `pnpm exec turbo run test --force` (sem cache): 11 tarefas com sucesso, 2 min 18 s, com a árvore atual (inclusive a 6I não commitada). Contagens: protocol 97 (11 arquivos), rules 174 (12), ui 77 (10), avatar 102 (8), mobile 715 (54), server 658 (39). Total: 1823 testes unitários.
- `pnpm db:up`: Postgres 16.6 e Redis 7.4 do `infra/docker-compose.yml`, saudáveis. Banco `trucaco_test` criado.
- `prisma migrate deploy` em `trucaco_test` (banco limpo): 8 migrações aplicadas, incluindo `20261106100000_reports_unique`.
- `prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --script --exit-code` (no diretório `apps/server`): exit 0, script vazio. O schema e as migrações batem.
- `pnpm build`: 7 tarefas com sucesso (5 do cache do turbo).
- `pnpm lint`: 7 tarefas com sucesso (cache do turbo, chaveado pelo conteúdo). `pnpm typecheck`: 11 tarefas com sucesso (10 do cache).
- `pnpm --filter @trucaco/server test:int` (com `TEST_DATABASE_URL` e `TEST_REDIS_URL`): 95 testes passam em 4 arquivos.
- `pnpm --filter @trucaco/mobile test:int`: 36 passam e 1 é pulado, em 6 arquivos. O pulado é o teste de JWT expirado durante a queda (`reconnect.int.test.ts`), que roda só com `INT_SLOW=1`.
- `pnpm test:e2e`: **23 de 24 passam** (6,4 min). Falha: `progress.spec.ts:38`, ver "Lacunas".
- Conferido por leitura do código e `grep`: `PROTOCOL_VERSION` = 6 (`packages/protocol/src/catalogs.ts`); `PENDING_PHASE6` vazio (`httpContract.test.ts`); `MIN_HANDS_FOR_PROGRESSION` = 4, `MIN_MATCH_DURATION_MS` = 3 min, `PAIR_DAILY_PROGRESSION_LIMIT` = 5 (`achievements.ts`); `REPORTS_PER_REPORTED_PER_HOUR` = 10 e `REPORT_SHARED_MATCH_WINDOW_MS` = 7 dias (`rest.ts`); teto por par conta só partidas com `progression_applied` (`countMatchesTogether`); `registerIdentityProvider` não é chamado no app e `expo-auth-session` não é dependência.

## Não validado

- **Login Google e Apple de ponta a ponta**: nenhum SDK está ligado e nenhum token real foi testado. O E2E de vínculo chama `POST /auth/link` pela API com o idToken de teste (`test:<sub>`) e confere a tela depois; o clique no botão social não é exercitado.
- **iOS e Android**: nada nativo testado (sem simulador na nuvem).
- **Leitor de tela, Safari e Firefox**: o E2E roda só em Chromium.
- **Aparência**: as telas novas (perfil, histórico, conquistas, missões) não foram vistas renderizadas por humano.
- **Custo de CPU**: a progressão faz consultas extras por partida terminada (um `countGuests`, até seis `countMatchesTogether` e as de `countWinsTogether` para `dupla_afinada`), e a fila lê a lista de bloqueio em cada entrada. Nada foi medido.
- **Postgres lento e multi-instância**: não medidos. Limitadores, `blockBus` e lista evitada são em memória de processo.
- **Partida completa com quatro humanos reais**: o E2E usa quatro convidados em mesa privada.

## Lacunas e pendências

- **E2E: `progress.spec.ts:38` falha (reproduzido em duas execuções seguidas).** O cenário "quem vence recebe o aviso e a medalha da primeira vitória" não vê `finished-achievements` em 25 s. O cenário 1 do mesmo arquivo passa e confere `Paulista: 1 partidas, 1 vitórias` em `profile-stats`, que vem de `user_stats` (`GET /me`). Ou seja, a progressão foi aplicada naquela partida. A regra 6I (não commitada) é a suspeita natural, porque a partida E2E dura muito menos que 3 min e a mesa é privada só de convidados, mas **essas duas condições deveriam bloquear o cenário 1 também**, e ele passa. A causa não está identificada. Hipótese secundária, não verificada: o observador de conquistas (`apps/mobile/src/room/achievementWatch.ts`) sai cedo se a foto inicial (`baseline`) for nula, e faz só três leituras, com esperas de 1,5 s, 4 s e 8 s entre elas (cerca de 13,5 s no total). Dono: `duda-debugger` (reproduzir, achar a causa raiz, correção mínima com teste de regressão) e `catia-qa`. **Não commitar a 6I antes disso.**
- **Login social real**: falta o SDK (Google web com `expo-auth-session`; Apple na Fase 7), registrado no app com `registerIdentityProvider`. Dono: `fabio-frontend`. Depende das credenciais do usuário (Google Cloud e Apple Developer).
- **Nonce emitido pelo servidor**: obrigatório antes de habilitar `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` em produção (`GET /auth/nonce`, uso único, TTL curto, exigido nas três rotas). Dono: `caio-colyseus`.
- **Bloquear e denunciar pelo menu do assento**: decisão do usuário (ver "Decisões").
- **Griefing por conta apagada ou bot no meio da partida** (auditoria 6I): a elegibilidade é da partida inteira, não por assento. Hoje partida com bot não pontua para ninguém. Avaliar progressão por assento.
- **Custo de CPU da fila** com muitas listas de bloqueio (`QueueEntry.avoid`): medir.
- **Recalibrar os limites anti-farm** no beta, com dados reais (ADR 0010).
- **Retenção de denúncias**: sem política de prazo. Denúncias contra conta apagada ficam anonimizadas; o texto livre das denúncias escritas pelo titular é apagado.
- **Backfill de estatísticas** das partidas anteriores à migração: opcional, não feito (ADR 0009, ponto 6).
- **Hash do `sub` de conta banida** (ban sobreviver a apagar e recriar a conta): Fase 8, com o painel de moderação.
- **Fora da fase**: conquista `corredor_esperto`; missões de parceiro da véspera; `entitlements` e posse de cosmético (Fase 10); fusão de contas.
- **Revisão por Codex**: nunca feita (erro 1332 do sandbox no Windows). Antes do beta, rodar a Rita/Codex sobre o diff da fase quando o Codex funcionar.
- **Data**: o relatório, o ADR 0010 e as entradas do CHANGELOG usam 2026-11-05, conforme o pedido. O relógio da sessão marcava 2026-11-04.

## Riscos

- **Consistência**: a progressão roda depois de `saveMatch`, no mesmo processo. Queda entre os dois perde a progressão daquela partida (a marca de idempotência só impede duplicar). Mesmo risco aceito de `partner_codes`.
- **Conluio**: os limites reduzem, mas não eliminam, o farm com contas novas. Conta nova de convidado é barata. Revisão na Fase 9, junto do ranking.
- **Convidados nunca expiram**: suas linhas de progressão também não (pendência de retenção, Fase 2).
- **Estado em memória**: `blockBus`, lista evitada da fila, derrubada de sockets e limitadores. Multi-instância exige Redis pub/sub e limitadores compartilhados.
- **Login social**: o JWKS remoto precisa de saída de rede para `googleapis.com` e `appleid.apple.com`. Ligar ou desligar um provedor exige reiniciar o servidor.
- **Dependências**: `jose` 6.2.12 (6.2.14 existe, escolha deliberada por idade mínima); `pnpm audit --prod` aponta 2 moderados em ferramenta de build (registrado no handoff de memória).
- **Aparelho**: depois de apagar a conta, `trucaco.muted.v1` (silenciados) e o `sessionStorage` continuam no aparelho.
