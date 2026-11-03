**Handoff para continuar em outra máquina ou ambiente** (atualizado em 2026-11-02, depois do bloco 4J). Último commit de código: `e3eea18` (4I). O commit de docs da 4J é feito pelo orquestrador. Leia este arquivo, depois `CLAUDE.md`, `docs/plano-desenvolvimento.md` (Fases 4 e 5), `docs/specs/2026-11-02-fase-4-relatorio.md`, `docs/adr/` e `docs/protocolo-servidor.md`.

## Como retomar

1. `git clone https://github.com/mcdtecbr/trucaco.git && git checkout develop`. `.nvmrc` pede Node 22. Nesta máquina (Windows) só há Node 24 (WinGet); ver armadilhas. pnpm 9.15.9 via corepack (`corepack enable --install-directory ~/.local/bin pnpm`).
2. `pnpm install --frozen-lockfile`; verificação completa: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Para contagens reais use `pnpm exec turbo run test --force` (sem `--force` o turbo devolve o cache: `FULL TURBO`).
3. Modo Git: **commit e push direto na `develop`, sem PR, sem tocar na `master`**, até o usuário avisar. Commit e push a cada etapa verificada; nunca commitar trabalho parcial de agente. Commits em pt-BR `tipo(escopo): descrição`.
4. O orquestrador (sessão principal) delega aos 12 agentes de `.claude/agents/` (ver `CLAUDE.md`), verifica por conta própria (suíte, `test:int`, `test:e2e`, leitura de screenshots) e só então commita. Revisão: `rita-revisora` (Codex) se funcionar; sem Codex, `rita-revisora-claude` (opus). `vitor-seguranca` em blocos de auth, rede, chat, sinais e projeção de estado.
5. Preferências do usuário: veracidade acima de tudo, sinalizar incerteza, análise crítica (não validação), responder em pt-BR. Quando disser "padrões", aceita todos os padrões propostos.

## Estado por fase

- **Fase 0 e 1** (fundação, motor `packages/rules`): concluídas. Revisadas só por agente Claude (Rita-C).
- **Fase 2** (servidor): concluída com ressalvas (blocos 2A a 2I). Ver `docs/plano-desenvolvimento.md`, `CHANGELOG.md`, `apps/server/README.md`.
- **Fase 3** (cliente jogável): concluída com ressalvas em 2026-11-02 (blocos 3A a 3J). Relatório: `docs/specs/2026-11-02-fase-3-relatorio.md`.
- **Fase 4** (avatar e sinais): **concluída com ressalvas em 2026-11-02**, blocos 4A a 4F, 4I e 4J. Relatório: `docs/specs/2026-11-02-fase-4-relatorio.md`. Commits: 63f861c (4A e 4B: contrato `AvatarParts` e validação no servidor), ef53540 (4C e 4D: catálogos, contrato do rig e `<Avatar>` vetorial), d24a5bd (4E e 4F: sinais na mesa, avatares nos assentos, criador de avatar), 948f3d5 (correções da revisão), 08a7705 (teste do bot de ausência), e3eea18 (script de FPS fora da suíte).
  - **Não feito**: 4G (Rive web) e 4H (Rive nativo), que esperam `assets/rive/avatar.riv` (a arte fica com o usuário ou ilustrador, a partir de `docs/avatar-rig.md`) e, para o nativo, um dev build.
  - **Renderizador de produção: vetorial** (`View` e `Animated`), ver ADR 0002. `<Avatar>` fica em `packages/avatar`, não em `ui` (ADR 0001); divergência anotada na spec §7.
  - **Bot que sinaliza**: o código existe (`botSignals` em `TrucoRoom.ts`), mas **o servidor não cria vagas de bot**. `botSeats` só recebe o bot de ausência, que não sinaliza. Na prática, nenhum bot sinaliza. Decidir se e quando criar vagas de bot.
  - **Desempenho no web**: 4 avatares a 1x de CPU ficam em 59,6 a 60 FPS; com CPU 4x e 4 sinais simultâneos caem para 14,6 a 21,7 FPS. A causa mais provável é o `Animated` sem driver nativo na web (`useNativeDriver` é `false` fora do nativo). Números informados pelo orquestrador, não medidos em aparelho. A meta de 50 FPS em aparelho intermediário segue aberta.
- **Contagens** (`turbo --force`, 2026-11-02): rules 174, protocol 54, avatar 26, ui 75, mobile 489, server 430. `test:e2e`: 11 cenários (`table.spec.ts` 8, `avatar.spec.ts` 3), Chromium. `test:int` do mobile: 23 passam e 1 pulado (`INT_SLOW`), em 4 arquivos.
- **CI do GitHub**: não consultado para a Fase 4. Os jobs `verify`, `integration` e `e2e-web` rodaram verdes em `dd8ab6e` (Fase 3, run 41499226931).
- **Dockerfile do servidor**: buildado em 2026-11-02 (Fase 3). Imagem ~616 MB, `GET /health` 200, `POST /auth/guest` ok com Postgres 16 e Redis reais após `db:deploy`. Não testado: Fly.io real, WebSocket de sala dentro do contêiner.

## Próximo passo: Fase 5 (chat da dupla e balões)

Conforme `docs/plano-desenvolvimento.md`, Fase 5 (1 a 2 semanas). Antes de começar, e como nas fases anteriores, um plano curto do `artur-arquiteto` (`docs/specs/`), porque a tela de preparação cruza cliente e servidor. Parte do que a Fase 5 pede **já existe**, então o plano deve partir do código:

- **Balão de chat sobre o avatar (4 s)**: feito na Fase 3 (3H3, commit 9779e86). Confirmar se "frases rápidas" (`QUICK_PHRASES` em `packages/protocol/src/catalogs.ts`, já validado pelo servidor) basta para o critério "frases rápidas".
- **Chat da dupla na mesa**: aba "Dupla" do `ChatPanel` (Fase 3). Falta a **tela de preparação** (antes da partida): chat da dupla e catálogo de sinais com anotação de significado. Não existe tela com esse nome em `apps/mobile/src/screens/`.
- **`partner_codes`**: a rota `GET`/`PUT /me/partners/:partnerId/codes` já existe (Fase 2, `apps/server/src/http/rest.ts`), com `403 NOT_PARTNERS` sem partida finalizada na mesma dupla. Falta o uso no cliente e a verificação de que o combinado reaparece quando a dupla joga de novo.
- **Auditoria de chat** (`vitor-seguranca`): filtro, rate limit e vazamento entre canais. Obrigatória pelo plano; a Fase 4 não a fez.

Depois da Fase 5 vem a **Fase 5b** (áudio), que depende de decisões do usuário (serviço de voz e licença, `docs/audio.md`). A Fase 4 não precisou dela.

## Pendências (pedir ao usuário ou decidir antes do beta)

- **Arte do `.riv`** (4G e 4H): quem produz é o usuário ou um ilustrador, a partir de `docs/avatar-rig.md`. Nenhum agente consegue produzir ou validar o arquivo.
- **Dev build para Rive nativo** (4H): sem decisão do usuário. O plano recomenda a Fase 7, junto do EAS.
- **Vagas de bot**: decidir se o servidor passa a criar vagas de bot (hoje não cria, e o sorteio de sinal do bot nunca dispara).
- **Desempenho do avatar no web**: escolher entre rebaixar a respiração e o olhar ociosos no web, ou Rive web (4G). Medir em aparelho intermediário antes do beta.
- **Revisão por Codex nunca feita.** Fases 1 a 4 revisadas só pela Rita-C (Claude opus). O Codex CLI instalado no Windows falha com **erro 1332 do sandbox**. Antes do beta, rodar a Rita/Codex sobre `acf118a..HEAD` quando o Codex funcionar.
- **`vitor-seguranca` não revisou a Fase 4** (decisão do usuário). A fase toca `PUT /me/avatar` e sinais; a auditoria fica pendente.
- **Pendências antigas do servidor (Fase 2)**: seguem em `docs/plano-desenvolvimento.md`, Fase 2 (retenção, estado em Redis, moderação, ban persistente, janela do JWT, e outras).

Resolvidas desde o handoff da Fase 3 (não são mais pendência):

- **Reload da página da mesa** retoma o assento (ffdc1d6). Só pela mesa privada depois dos 60 s; ver `apps/mobile/README.md`.
- **Botões de aposta do parceiro**: na aposta pendente, só o respondedor tem botões; o parceiro vê "Seu parceiro responde" (222d633, e7b3d39, 3968e85). No onze/dez, os dois da dupla decidem, por decisão do usuário.
- **`voteRematch` e o limite de 150 ms**: mantido como está, por decisão do usuário em 2026-11-02.

## Decisões do usuário (confirmadas)

Mão de ferro é opção da sala (padrão ligada); Mineiro com mão de 10; bot nunca pede nem aumenta aposta; código de sala com 8 caracteres; mão de ferro com carta escolhida às cegas e visível ao ser jogada; refresh no `localStorage` no web (atrás de `TokenStorage`, cookie httpOnly na Fase 6); chat de texto já na Fase 3; `POST /auth/logout`; bundle/scheme `com.mcdtec.trucaco` e `trucaco://`; `TRUCO_SEED` só dev/test; usuário valida iOS/Android no Expo Go.

**Em 2026-11-02**: o usuário criou a **revanche** ("Jogar de novo") e confirmou o **rodízio do pé na revanche** e entre jogos da série `bo3`. Também confirmou os padrões da revanche (janela de 30 s, mínimo de 2 humanos conectados, unanimidade). Ver `.claude/memory/decisao_rodizio_pe_revanche.md`.

**Fase 4 (2026-11-02)**: só o fallback vetorial nesta fase, Rive web depois. Bot de ausência não sinaliza; só bot de vaga pode, e hoje nenhum existe. Catálogo de partes 4/6/8/4/4/6/5/8. `voice` fica para a 5b.

## Decisões assumidas por padrão (pedir confirmação ao usuário)

`voteCancel` unânime entre humanos conectados (zerado por mão); ban por sala em memória após strikes; texto de chat com ZWJ rejeitado (`CHAT_BLOCKED`, sem expulsão); cooldown de 60 s para reentrar na fila após casar e não sentar; janela de graça do refresh de 20 s (sucessor irmão uma vez; `REFRESH_REUSE_GRACE_SECONDS=0` desliga); "Nós" azul fixo e "Eles" laranja fixo; jogar carta = selecionar e confirmar; `typedRoutes` DESLIGADO (gerar `router.d.ts` no typecheck exigia subir o Metro, não portável ao Windows); estilo do baralho provisório (`cardColors` em `packages/ui`); textos de acessibilidade sem revisão de UX; `TOKEN_EXPIRED`/`ROOM_NOT_FOUND` ficam em `ERROR_CODES` como reservados ao cliente; borda branca como destaque de sinal com movimento reduzido; fila de sinal de 1 posição por assento, no cliente (`tableController`). Lista completa no `CHANGELOG.md`, "Decisões a confirmar".

## O que NÃO foi validado (só o usuário ou um aparelho consegue)

- **iOS e Android:** nada nativo testado (sem simulador na nuvem). Validar no Expo Go: transporte do JWT no RN, SecureStore, deep link, leitor de tela, layout e o painel de sinais com dedo real.
- **Aparência do avatar:** nenhum screenshot foi revisado. Os testes checam estrutura, estado e marcadores.
- **Leitor de tela:** textos de acessibilidade e anúncios dos sinais não foram ouvidos.
- **Safari, Firefox e outros navegadores:** o E2E roda só em Chromium (`apps/mobile/playwright.config.ts`).
- **Proxies (Fly):** se repassam `Sec-WebSocket-Protocol` e `Host`. Verificar no deploy.
- **Fly.io real** e WebSocket de sala dentro do contêiner.
- **Cobertura automatizada:** a cola de efeito dos hooks (`useAnnouncer`, `useLayoutMode`) não tem teste. Mão de ferro, onze, `bo3` e aposta pendente têm teste de projeção e render estático, não partida completa por humanos.

## Riscos conhecidos (antes do beta)

Estado do lobby, fila, `JoinGuard` e limitadores são em memória por processo (precisa Redis para multi-instância); sem job de retenção/expurgo; convidados nunca expiram e cada logout cria um novo; Redis de produção precisa de `noeviction` + AOF; `TRUCO_SEED`/`devAuth` só em dev/test; sem moderação (silenciar/bloquear/denunciar), chat da mesa liberado na espera; homóglifos Latin Extended no apelido; gravação da partida só no fim (queda do processo perde a partida em andamento); access JWT de 15 min continua válido após revogação (exceto o `lastJti`); usuário órfão se o Redis falhar em `createGuest`; hipótese não confirmada: sair e entrar repetidamente (`resume` faz `timeouts.set(seat, 0)`) pode contornar a punição por ausência e `reconnectCount` pode não ter teto; `@colyseus/core` 0.18.10 (0.18.24 existe) e wrappers frágeis a upgrade do core (`invokeMethod`, `beforeUpgrade`), com testes de regressão; `jose@6.2.12` (6.2.14 existe, escolha deliberada por idade mínima); `pnpm audit --prod` aponta só 2 moderados (glob, minimatch via `@expo/cli`, ferramenta de build); logout não derruba WebSocket já aberto; deep link só por scheme customizado (App Links/Universal Links na Fase 7); backup do SecureStore e permissões Android do prebuild a verificar; revanche sem teto de partidas; avatar com desenho vetorial no web pode cair de FPS com CPU limitada (ver Fase 4).

## Armadilhas de ambiente (aprendidas)

**Windows com Git Bash (máquina do usuário, 2026-11-02):**

- `node` não está no PATH do Git Bash. Usar o Node 24 do WinGet: `export PATH="/c/Users/Marcelo Marvin/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64:$PATH"`. Não há Node 22 instalado nesta máquina (o `.nvmrc` pede 22).
- **O `~/.local/bin/pnpm` global aponta para um Node do fnm que não existe mais** (`...\fnm\node-versions\v22.23.4\...`), e falha com `Cannot find module ...corepack\dist\pnpm.js`. Solução usada: um wrapper `pnpm` em `sh` no diretório de scratch da sessão, que chama `node` no `pnpm.cjs` do corepack: `%LOCALAPPDATA%\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs`. Ele vale só para a sessão (o diretório de scratch muda a cada uma). `pnpm -v` tem que dar `9.15.9`. Para uso permanente, corrigir o `~/.local/bin/pnpm` ou reinstalar via corepack.
- `ps -eo` não existe neste Git Bash ("unknown option -- o"). Para achar processo, usar `tasklist` ou `Get-CimInstance Win32_Process` no PowerShell; e matar pelo PID.
- Identidade do git NÃO está configurada na máquina. Passar `-c user.name=... -c user.email=...` no comando de commit, com a identidade do usuário (não gravar e-mail em arquivo versionado).
- Docker Desktop 29.9.2 disponível: `pnpm db:up` funciona (Postgres em 5432, Redis em 6380). Não mexer no Redis da 6379 (é do portal Fiori).
- Codex CLI: falha com **erro 1332 do sandbox** no Windows. Não é cota nem rede: a Rita/Codex não roda até isso ser resolvido.
- Playwright: o Chromium `chromium-1248` já está em `%LOCALAPPDATA%\ms-playwright` nesta máquina.
- **Resíduo fora do repositório**: `/scratch.sh` (vazio) na raiz do Git Bash, criado por um agente. Apagar à mão. Não está no repositório.

**Nuvem (ambiente antigo):** sem Docker, sem Codex CLI, sem `gh` (PR por REST com token do `git credential fill`), `pkill -f` NUNCA (matou o próprio shell uma vez; usar `ps -eo pid,args | grep [x]` + `kill <pid>`), `sleep` bloqueado em foreground, removais em caminho de sistema bloqueados pelo safety check (não contornar). Postgres 16 em `/usr/lib/postgresql/16/bin` (rodar como `postgres` via `runuser -u postgres --`, banco UTF8, porta alta, nome contendo `test`); `redis-server` disponível. Testes de integração: `TEST_DATABASE_URL` e `TEST_REDIS_URL` (guardas: host local, nome do banco com test/verif, DB lógico do Redis != 0). Resíduo: `/rg.bak` (criado por engano por um agente); apagar à mão se reencontrar.

**Servidor e testes:**

- Vitest do server: `pool:'threads'`, `fileParallelism:false`, porta 2568 fixa nos testes de sala: nunca rodar dois conjuntos de testes do servidor em paralelo (nem `pnpm test` da raiz junto com um loop de 3x).
- **Teste do servidor que espera patch de estado precisa de `until` (condição), não de `settle`** (espera fixa): o patch chega ao cliente depois do evento. Exemplo: `TrucoRoom.test.ts`, onze/dez com `specialAccepted` (08a7705).
- `pnpm --filter @trucaco/mobile test:int` sobe o `dist/main.js` do servidor (precisa de `pnpm build` antes); pode deixar processo órfão se o teste for cancelado: achar pelo PID e matar.
- `pnpm test:e2e` sobe o servidor compilado (`dist/main.js`) e o web estático nas portas 2587 e 8087; precisa de `pnpm build` antes. O `globalSetup` desmonta os dois processos no fim. `E2E_SKIP_BUILD=1` reaproveita o `dist-e2e/`.
- Script de FPS (`apps/mobile/e2e/perf`): fora do `testMatch` do E2E (`*.spec.ts`) e do `package.json`; comando no `apps/mobile/README.md`. Mesmas portas do E2E: não rodar junto. A saída vai para `apps/mobile/test-results-perf/`, agora ignorada em `.gitignore` e `.prettierignore` (antes aparecia como arquivo não rastreado e o `format:check` reclamava).
- Colyseus 0.18.10 (`@colyseus/core`, `ws-transport 0.18.4`, schema 5.0.43): `onAuth` NÃO roda na reconexão (por isso `beforeUpgrade` e `checkReconnectionToken`); `client.view` criado no `onJoin`; o SDK 0.18 coloca o token em `_authToken` na query (não usar `client.auth.token`); `credentials: 'include'` por padrão no SDK (fixado em `omit`). O matchmaker tem estado global: um `Server` por arquivo de teste.
- **Bots de vaga ainda não existem no servidor.** `botSeats.add` só acontece no bot de ausência. O caminho `botSignals` é testado em `TrucoRoom.test.ts` (4B) injetando um assento em `botSeats` e chamando `botSignals()` direto, com `botSignalChance` 1. Nenhum teste cobre um bot de vaga numa partida real, porque ele não existe.
- Expo SDK 58: Metro resolve o monorepo pnpm sozinho; pacotes `@trucaco/*` resolvem pelo `dist/` (precisa `turbo build`, que `pnpm build` já faz); `ws` é trocado por stub só dentro de `@colyseus/sdk` (`metro.config.js`); Prettier ignora `expo-env.d.ts`.
- Dockerfile: usa `npm install -g pnpm@9.15.9` (corepack do `node:22.12.0` falha com "Cannot find matching keyid"). `pnpm deploy --prod` para a imagem (copiar só `node_modules` quebra por causa dos symlinks do pnpm).
