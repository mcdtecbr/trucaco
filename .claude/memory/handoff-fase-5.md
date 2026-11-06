**Handoff para continuar em outra máquina ou ambiente** (atualizado em 2026-11-05, depois da Fase 6). Último commit de código da Fase 6: `a37c759` (6H, PR #26). Estão **sem commit** na branch `docs/fase-6-fechamento`: a auditoria 6I (correções em `apps/server`, migração `20261106100000_reports_unique`, `docs/gamificacao.md`) e os docs de fechamento (relatório, CHANGELOG, plano, ADR 0010, README do mobile). O orquestrador commita, depois de resolver a falha de E2E abaixo. Leia este arquivo, depois `CLAUDE.md`, `docs/plano-desenvolvimento.md`, `docs/specs/2026-11-05-fase-6-relatorio.md`, `docs/adr/` e `docs/protocolo-servidor.md`.

## Como retomar

1. `git clone https://github.com/mcdtecbr/trucaco.git && git checkout develop`. `.nvmrc` pede Node 22. Nesta máquina (Windows) só há Node 24 (WinGet); ver armadilhas. pnpm 9.15.9 via corepack (`corepack enable --install-directory ~/.local/bin pnpm`); ver a armadilha do `pnpm` no Windows abaixo.
2. `pnpm install --frozen-lockfile`; verificação completa: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Para contagens reais use `pnpm exec turbo run test --force` (sem `--force` o turbo devolve o cache: `FULL TURBO`).
3. Testes de integração: `pnpm db:up`; criar o banco `trucaco_test` no Postgres do compose (`docker exec trucaco-postgres-1 psql -U trucaco -d trucaco -c "CREATE DATABASE trucaco_test;"`); migrar com `DATABASE_URL=postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test pnpm exec prisma migrate deploy` em `apps/server`; depois `TEST_DATABASE_URL=postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test TEST_REDIS_URL=redis://localhost:6380/15 pnpm --filter @trucaco/server test:int` e o mesmo com `@trucaco/mobile` (exige `pnpm build` antes). `pnpm test:e2e` também exige `pnpm build`.
4. Modo Git: **commit e push direto na `develop`, sem PR, sem tocar na `master`**, até o usuário avisar. Commit e push a cada etapa verificada; nunca commitar trabalho parcial de agente. Commits em pt-BR `tipo(escopo): descrição`. Hoje o trabalho da Fase 6 está numa branch `docs/fase-6-fechamento`: confirmar com o usuário antes de fazer merge ou PR.
5. O orquestrador (sessão principal) delega aos agentes de `.claude/agents/` (ver `CLAUDE.md`), verifica por conta própria (suíte, `test:int`, `test:e2e`) e só então commita. Revisão: `rita-revisora` (Codex) se funcionar; sem Codex, `rita-revisora-claude` (opus). `vitor-seguranca` em blocos de auth, rede, chat, sinais e projeção de estado.
6. Preferências do usuário: veracidade acima de tudo, sinalizar incerteza, análise crítica (não validação), responder em pt-BR. Quando disser "padrões", aceita todos os padrões propostos.

## Próximo passo

1. **Antes de qualquer commit da 6I**: resolver `apps/mobile/e2e/progress.spec.ts:38` ("quem vence recebe o aviso e a medalha da primeira vitória"). Falha em duas execuções seguidas (isolada e na suíte completa). O cenário 1 do mesmo arquivo passa e mostra a estatística gravada, então a causa não é só a regra 6I. Hipóteses não verificadas: a regra 6I (duração abaixo de 3 min e mesa privada só de convidados) e o observador de conquistas no cliente (`apps/mobile/src/room/achievementWatch.ts`: foto inicial nula sai cedo; três leituras em ~13,5 s). Dono: `duda-debugger`, com `catia-qa`.
2. Depois: commit da 6I e dos docs (um commit por bloco, `docs(...)` para os docs). Antes do commit, `pnpm format:check` (o `pnpm format` ainda não foi rodado sobre os docs da 6J).
3. Próxima fase: **Fase 7 (publicação beta) ou áudio real (5b)**. Confirmar com o usuário. A Fase 7 depende de decisões dele (credenciais Google e Apple, domínio, serviço de voz e licença dos efeitos). Monetização segue sem implantar (decisão de 2026-11-04, só no fim do projeto).

## Estado por fase

- **Fases 0 a 5** (fundação, motor, servidor, cliente, avatar e sinais, chat da dupla): concluídas com ressalvas. Relatórios em `docs/specs/` (Fase 3, Fase 4, Fase 5) e em `docs/plano-desenvolvimento.md`.
- **Fase 5b** (áudio): concluída com ressalvas em 2026-11-04. **Todo o áudio é placeholder silencioso**; serviço de voz e fonte dos efeitos seguem a definir pelo usuário, com licença comercial antes de qualquer arquivo real (`assets/audio/README.md`). Vozes `masc_2`, `masc_3`, `fem_2` e `fem_3` sem arquivo; `trig_shout` não existe no `avatar.riv` e não é disparado.
- **Catálogo do avatar** fechado (PRs #12 a #19: cores, bocas, rosto, cabelo, barba, chapéu e sombreado). Estado do `.riv` em `docs/avatar-rive-estado.md`.
- **Fase 6** (contas, perfil, conquistas e missões): **concluída com ressalvas em 2026-11-05**. Blocos 6A a 6H commitados e mesclados (PRs #21 a #26); 6I (auditoria) e 6J (docs) sem commit. Relatório: `docs/specs/2026-11-05-fase-6-relatorio.md`. Plano e status por bloco: `docs/specs/2026-11-04-fase-6-plano.md` (seção 7).
  - **Feito**: `GET /matches`; bloqueio nos dois sentidos na fila e na mesa privada; denúncia com `UNIQUE` e teto; `DELETE /me`; progressão (conquistas, missões e estatísticas) em tabelas próprias, idempotente por partida (ADR 0009); login social e vínculo no servidor (JWKS, `aud`, `iss`, `exp`, uso único do idToken); telas de login, vínculo, conquistas, missões, perfil e histórico; anti-farm (ADR 0010, na 6I, sem commit).
  - **Não feito**: nenhum SDK social registrado no app (`registerIdentityProvider` não é chamado; `expo-auth-session` não é dependência), então o login Google e Apple não funciona de ponta a ponta; nonce emitido pelo servidor; bloquear e denunciar pelo menu do assento; backfill de estatísticas; `entitlements` (Fase 10); cookie httpOnly (Fase 7).
  - **Contagens** (`pnpm exec turbo run test --force`, 2026-11-05, com a árvore da 6I): protocol 97, rules 174, ui 77, avatar 102, mobile 715, server 658. Total 1823. `test:int`: servidor 95; mobile 36 passam e 1 pulado (`INT_SLOW`). E2E web: **23 de 24** (falha acima).
  - **Verificado nesta sessão**: suíte unitária, `test:int` dos dois pacotes, `prisma migrate deploy` em banco limpo (8 migrações), `prisma migrate diff` vazio, `pnpm build`, `pnpm lint`, `pnpm typecheck`, E2E.
  - **Revisão**: Rita-C (Claude opus) registrada para o 6B (1 P2, 6 P3, todos corrigidos ou aceitos). `vitor-seguranca`: 6B, 6F e 6I. Codex nunca revisou (erro 1332). Para os blocos 6A e 6C a 6H não há registro escrito de revisão.

## Pendências (pedir ao usuário ou decidir antes do beta)

- **Falha do E2E `progress.spec.ts:38`**: ver "Próximo passo", item 1.
- **Credenciais Google e Apple** (usuário): Google Cloud (client IDs web, iOS e Android; tela de consentimento) e Apple Developer (Service ID, chave Sign in with Apple, bundle). Sem elas o login social fica desligado (`SOCIAL_LOGIN_DISABLED`).
- **Nonce emitido pelo servidor** (`GET /auth/nonce`): obrigatório antes de habilitar `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` em produção. Dono: `caio-colyseus`.
- **SDK social no app** (Google web com `expo-auth-session`; Apple na Fase 7): dono `fabio-frontend`.
- **Bloquear e denunciar pelo menu do assento**: exige `userId` público em `PublicPlayer` (decisão do usuário, com `artur-arquiteto` e `vitor-seguranca`).
- **Limites anti-farm e de denúncia**: padrões assumidos, a recalibrar no beta (ADR 0010). Confirmar com o usuário.
- **Griefing por conta apagada ou bot no meio da partida**: a elegibilidade é da partida inteira. Avaliar por assento.
- **Retenção de denúncias**: sem política de prazo.
- **Hash do `sub` de conta banida** (Fase 8, com o painel de moderação).
- **Custo de CPU da fila com listas de bloqueio** (`QueueEntry.avoid`): medir.
- **Multi-instância**: `blockBus`, lista evitada, derrubada de sockets e limitadores são em memória (pede Redis pub/sub).
- **Retomada da mesa da fila pública depois de 60 s**: não há rota. `POST /tables/join` serve só mesa privada.
- **Vagas de bot**: o servidor não cria; o sorteio de sinal do bot nunca dispara.
- **Arte do `.riv`** (4G e 4H): nenhum agente produz ou valida o arquivo. Dev build para Rive nativo: sem decisão (recomendação: Fase 7).
- **Áudio real** (5b): serviço de voz, fonte dos efeitos e licença comercial, com decisão do usuário.
- **P3 da revisão da Fase 5**: P3-5 (significado em cinza no painel de sinais da mesa e aviso "combinado salvo para esta dupla"); o outro P3 aberto não foi identificado.
- **Comentário de `CODE_NOT_SAVED`** em `packages/protocol/src/errors.ts`: corrigir o texto (sem mudança de comportamento).
- **Pendências antigas do servidor (Fase 2)**: retenção de partidas e convidados inativos (job do `diego-devops`), estado em Redis, moderação, ban persistente, janela do JWT e outras, em `docs/plano-desenvolvimento.md`.
- **Revisão por Codex**: nunca feita (erro 1332 no Windows). Antes do beta, rodar a Rita/Codex sobre o diff acumulado quando o Codex funcionar.
- **Não validado em aparelho**: iOS, Android, leitor de tela, Safari, Firefox. O E2E roda só em Chromium.

## Riscos (antes do beta)

Estado em memória por processo (lobby, fila, `JoinGuard`, limitadores, `blockBus`, combinado da sala); sem job de retenção ou expurgo; convidados nunca expiram e cada logout cria um novo; combinado de convidado some ao sair da conta; gravação da partida só no fim (queda do processo perde a partida em andamento, e a progressão daquela partida também); access JWT de 15 min continua válido depois de revogação (exceto o `lastJti`); usuário órfão se o Redis falhar em `createGuest`; sair e entrar repetidamente pode contornar a punição por ausência (hipótese não confirmada); `@colyseus/core` 0.18.10 com wrappers frágeis a upgrade; `jose` 6.2.12 (6.2.14 existe); `pnpm audit --prod` aponta 2 moderados em ferramenta de build; logout não derruba WebSocket já aberto; deep link só por scheme customizado; Redis de produção precisa de `noeviction` + AOF; `TRUCO_SEED`/`devAuth` só em dev e test.

## Armadilhas de ambiente (aprendidas)

**Windows com Git Bash (máquina do usuário):**

- `node` não está no PATH do Git Bash. Usar o Node 24 do WinGet: `export PATH="/c/Users/Marcelo Marvin/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64:$PATH"`. Não há Node 22 nesta máquina (o `.nvmrc` pede 22).
- **O `~/.local/bin/pnpm` global aponta para um Node do fnm que não existe mais**, e falha com `Cannot find module ...corepack\dist\pnpm.js`. Isso quebra o `turbo run`: o turbo chama `pnpm.CMD` pelo PATH. Solução que funcionou: um `pnpm.cmd` numa pasta de scratch na frente do PATH, que chama `node.exe` com o `pnpm.cjs` do corepack. `pnpm -v` tem que dar `9.15.9`. Para uso permanente, corrigir o `~/.local/bin/pnpm` ou reinstalar via corepack. Nesta sessão de 2026-11-05 o `pnpm` funcionou com `export PATH="$HOME/.local/bin:$PATH"`.
- **`python3` é o alias da Microsoft Store** e falha ("Python was not found"). Usar o Python real: `/c/Users/marce/AppData/Local/Programs/Python/Python312/python`.
- **Heredoc com aspas no Git Bash** pode quebrar ("unexpected EOF while looking for matching"). Para escrever arquivos com texto longo, usar a ferramenta Write.
- **Prisma 7**: `prisma migrate diff` não aceita `--from-url` nem `--to-schema-datamodel`. Usar `DATABASE_URL=... pnpm exec prisma migrate diff --from-config-datasource --to-schema ./prisma/schema.prisma --script --exit-code` (no diretório `apps/server`).
- `ps -eo` não existe neste Git Bash. Para achar processo, usar `tasklist` ou `Get-CimInstance Win32_Process` no PowerShell; e matar pelo PID.
- Identidade do git NÃO está configurada na máquina. Passar `-c user.name=... -c user.email=...` no comando de commit (não gravar e-mail em arquivo versionado).
- Docker Desktop disponível: `pnpm db:up` sobe Postgres 16.6 (5432) e Redis 7.4 (6380). Não mexer no Redis da 6379 (é do portal Fiori).
- Codex CLI: falha com **erro 1332 do sandbox** no Windows. A Rita/Codex não roda até isso ser resolvido.
- Playwright: o Chromium `chromium-1248` já está em `%LOCALAPPDATA%\ms-playwright` nesta máquina.
- **Resíduos fora do repositório** (apagar à mão): `/scratch.sh` na raiz do Git Bash, vazio, criado por um agente. Conferir o conteúdo antes de apagar se aparecer outro.

**Servidor e testes:**

- Vitest do server: `pool:'threads'`, `fileParallelism:false`, porta 2568 fixa nos testes de sala: nunca rodar dois conjuntos de testes do servidor em paralelo.
- **Teste do servidor que espera patch de estado precisa de `until` (condição), não de `settle`**.
- **Ruído esperado em `TrucoRoom.test.ts`**: `@colyseus/sdk: onMessage() not registered for type 'codes'` em stderr. Não é falha.
- `pnpm --filter @trucaco/mobile test:int` sobe o `dist/main.js` do servidor (precisa de `pnpm build`); pode deixar processo órfão se for cancelado.
- `pnpm test:e2e` sobe o servidor compilado (`dist/main.js`) e o web estático nas portas 2587 e 8087; precisa de `pnpm build` antes. `E2E_SKIP_BUILD=1` reaproveita o `dist-e2e/`. Para repetir um cenário: `cd apps/mobile && E2E_SKIP_BUILD=1 pnpm exec playwright test e2e/progress.spec.ts -g "quem vence"`.
- Colyseus 0.18.10: `onAuth` NÃO roda na reconexão (por isso `beforeUpgrade` e `checkReconnectionToken`); `client.view` criado no `onJoin`; o SDK 0.18 coloca o token em `_authToken` na query. O matchmaker tem estado global: um `Server` por arquivo de teste.
- **Bots de vaga ainda não existem no servidor.** O caminho `botSignals` é testado injetando um assento em `botSeats`.
- Dockerfile: usa `npm install -g pnpm@9.15.9`. `pnpm deploy --prod` para a imagem (copiar só `node_modules` quebra por causa dos symlinks do pnpm).
- Expo SDK 58: Metro resolve o monorepo pnpm sozinho; pacotes `@trucaco/*` resolvem pelo `dist/` (precisa `pnpm build`).
- **Testes de integração** (`test:int`) truncam tabelas e apagam chaves `trucaco:v1:`: só com `TEST_DATABASE_URL` e `TEST_REDIS_URL` de banco e DB do Redis descartáveis (as travas recusam host não local, banco sem "test"/"verif" e DB 0 do Redis).

**Avatar Rive**: ver `docs/avatar-rive-estado.md` e `.claude/memory/avatar-rive-estado.md`. Editor Rive por automação: `.claude/memory/rive-editor-receitas.md`.
