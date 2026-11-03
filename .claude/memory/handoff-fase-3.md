**Handoff para continuar em outra máquina ou ambiente** (atualizado em 2026-11-02, depois do bloco 3J). Último commit de código: `dd8ab6e` (3I). O commit de docs da 3J é feito pelo orquestrador. Leia este arquivo, depois `CLAUDE.md`, `docs/plano-desenvolvimento.md` (Fases 3 e 4), `docs/specs/2026-11-02-fase-3-relatorio.md` e `docs/protocolo-servidor.md`.

## Como retomar

1. `git clone https://github.com/mcdtecbr/trucaco.git && git checkout develop`. Node 22 (`.nvmrc`), pnpm 9.15.9 via corepack (`corepack enable --install-directory ~/.local/bin pnpm`; no Windows com Git Bash, ver armadilhas).
2. `pnpm install --frozen-lockfile`; verificação completa: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Para contagens reais use `pnpm exec turbo run test --force` (sem `--force` o turbo devolve o cache: `FULL TURBO`).
3. Modo Git: **commit e push direto na `develop`, sem PR, sem tocar na `master`**, até o usuário avisar. Commit e push a cada etapa verificada; nunca commitar trabalho parcial de agente. Commits em pt-BR `tipo(escopo): descrição`.
4. O orquestrador (sessão principal) delega aos 12 agentes de `.claude/agents/` (ver `CLAUDE.md`), verifica por conta própria (suíte, `test:int`, `test:e2e`, leitura de screenshots) e só então commita. Revisão: `rita-revisora` (Codex) se funcionar; sem Codex, `rita-revisora-claude` (opus). `vitor-seguranca` em blocos de auth, rede, chat e projeção de estado.
5. Preferências do usuário: veracidade acima de tudo, sinalizar incerteza, análise crítica (não validação), responder em pt-BR. Quando disser "padrões", aceita todos os padrões propostos.

## Estado por fase

- **Fase 0 e 1** (fundação, motor `packages/rules`): concluídas. Revisadas só por agente Claude (Rita-C).
- **Fase 2** (servidor): concluída com ressalvas (blocos 2A a 2I). Ver `docs/plano-desenvolvimento.md`, `CHANGELOG.md`, `apps/server/README.md`.
- **Fase 3** (cliente jogável): **concluída com ressalvas em 2026-11-02**, blocos 3A a 3J. Relatório: `docs/specs/2026-11-02-fase-3-relatorio.md`. Commits principais: 4eb871e (3A), 32dd67e e 70c6bb9 (3B), a533cd8 (3C), 63c15fb (3D), 613ccb6 (3E), 9370620 (3F/3G), 8bed41d (3G2), c7a3d3a e 7cbe481 (3H1), d5f71c1 (3H2), 9779e86 (3H3), b6bd137 e f09565e (revanche), dd8ab6e (3I), e o commit de docs da 3J.
  - Entregue: contrato HTTP e snapshot em `protocol`, `POST /auth/logout`, Expo SDK 58 com Router, camada de rede (refresh em fila única, lock entre abas, JWT em `trucaco.bearer`), telas de entrada e lobby, `packages/ui` (cartas, leque, vira, placar em camadas, anúncios), mesa completa (mão de ferro às cegas, onze/dez com `partnerCards`, coberta, histórico, fim de partida e série, voto de cancelar, chat de texto, balão, chat na espera), revanche "Jogar de novo", E2E Playwright com 5 cenários e job `e2e-web`.
  - Servidor publica `hand.manilhaRank`, `manilhaCards`, `nextBetValue`, `pendingValue` e `actingSeat` (todos públicos e aditivos; `PROTOCOL_VERSION` segue 2). Documentado em `docs/protocolo-servidor.md`, seção "Campos públicos de `hand`".
  - Revanche: `voteRematch`, `rematchVotes`, `rematchDeadlineAt`, `matchNumber`, erro `REMATCH_NOT_AVAILABLE`. Detalhes na seção "Revanche" do protocolo.
- **Contagens** (`turbo --force`, 2026-11-02): rules 138, protocol 44, avatar 1, ui 75, mobile 390, server 419. `test:int` do mobile: 18 passam e 1 pulado (`INT_SLOW`). `test:e2e`: 5 passam (Chromium).
- **CI do GitHub em `dd8ab6e`**: `verify`, `integration` e `e2e-web` verdes (run 41499226931, consultado pela API).
- **Dockerfile do servidor**: buildado pela primeira vez em 2026-11-02 com Docker Desktop 29.9.2. Falhou no `corepack prepare`; corrigido com `npm install -g pnpm@9.15.9`. Build ok (imagem ~616 MB), `GET /health` 200, healthcheck `healthy`, `POST /auth/guest` ok com Postgres 16 e Redis reais após `db:deploy`. Não testado: Fly.io real, WebSocket de sala dentro do contêiner.

## Próximo passo: Fase 4 (avatar Rive e sinais)

Conforme `docs/plano-desenvolvimento.md`. Ponto de partida real: **não existe `assets/rive`** e `packages/avatar` tem só um stub (`index.ts` e um teste). `docs/sinais.md` tem o catálogo (12 gatilhos e estados ociosos). Fluxo: plano do `artur-arquiteto` antes (contrato em `packages/protocol` se cruzar cliente/servidor), depois `rai-avatar` (rig `avatar.riv`, state machine `Main`, triggers, catálogos, componente `<Avatar>` `.native.tsx`/`.web.tsx`), `fabio-frontend` e `caio-colyseus` (criador de avatar e `PUT /me/avatar`), painel de sinais na mesa, e `duda-debugger` (FPS). Não começar sem o plano. As vozes e os efeitos são da Fase 5b.

## Pendências (pedir ao usuário ou decidir antes do beta)

- **Reload da página da mesa** não retoma o assento: o token de reconexão fica só em memória (o app volta para `/home`). Persistir ou aceitar.
- **Botões de aposta do parceiro** em aposta pendente e em decisão de onze/dez: os dois da dupla veem os botões (o motor dá ação legal aos dois). O servidor aceita a primeira ação. Decidir se a UI esconde os do parceiro.
- **`voteRematch` e o limite de 150 ms** (`ACTION_MIN_INTERVAL_MS`): hoje o voto de revanche também é barrado. Isentar ou manter.
- **Revisão por Codex nunca feita.** Fases 1 a 3 revisadas só pela Rita-C (Claude opus). O Codex CLI instalado no Windows falha com **erro 1332 do sandbox**. Antes do beta, rodar a Rita/Codex sobre `acf118a..HEAD` quando o Codex funcionar.
- Itens de revisão do 3H1 (P3) não reconferidos um a um. Ver a nota no relatório da fase.
- Pendências antigas do servidor (Fase 2) seguem em `docs/plano-desenvolvimento.md`, Fase 2.

## Decisões do usuário (confirmadas)

Mão de ferro é opção da sala (padrão ligada); Mineiro com mão de 10; bot nunca pede nem aumenta aposta (pode dar sinal); código de sala com 8 caracteres; mão de ferro com carta escolhida às cegas e visível ao ser jogada; respostas "padrões" às decisões da Fase 3: refresh no `localStorage` no web (atrás de `TokenStorage`, cookie httpOnly na Fase 6), chat de texto já na Fase 3, `POST /auth/logout` agora, bundle/scheme `com.mcdtec.trucaco` e `trucaco://`, `TRUCO_SEED` só dev/test, usuário valida iOS/Android no Expo Go.

**Em 2026-11-02**: o usuário criou a **revanche** ("Jogar de novo") e confirmou o **rodízio do pé na revanche** (o pé é o assento seguinte ao pé da última mão). Também confirmou o rodízio entre jogos da série `bo3` e os padrões da revanche (janela de 30 s, mínimo de 2 humanos conectados, unanimidade). Ver `.claude/memory/decisao_rodizio_pe_revanche.md`.

## Decisões assumidas por padrão (pedir confirmação ao usuário)

`voteCancel` unânime entre humanos conectados (zerado por mão); ban por sala em memória após strikes; texto de chat com ZWJ rejeitado (`CHAT_BLOCKED`, sem expulsão); cooldown de 60 s para reentrar na fila após casar e não sentar; janela de graça do refresh de 20 s (sucessor irmão uma vez; `REFRESH_REUSE_GRACE_SECONDS=0` desliga); **revanche: janela de 30 s, mínimo de 2 humanos conectados e unanimidade**; "Nós" azul fixo e "Eles" laranja fixo; jogar carta = selecionar e confirmar; `typedRoutes` DESLIGADO (gerar `router.d.ts` no typecheck exigia subir o Metro, não portável ao Windows); estilo do baralho provisório (`cardColors` em `packages/ui`); textos de acessibilidade sem revisão de UX; `TOKEN_EXPIRED`/`ROOM_NOT_FOUND` ficam em `ERROR_CODES` como reservados ao cliente. (O rodízio do pé deixou de estar aqui: foi confirmado.)

## O que NÃO foi validado (só o usuário ou um aparelho consegue)

- **iOS e Android:** nada nativo testado (sem simulador na nuvem). Validar no Expo Go: transporte do JWT no RN, SecureStore, deep link, leitor de tela, layout em aparelho.
- **Safari e outros navegadores:** o E2E roda só em Chromium (`apps/mobile/playwright.config.ts`).
- **Leitor de tela:** textos de acessibilidade e anúncios não foram ouvidos.
- **Proxies (Fly):** se repassam `Sec-WebSocket-Protocol` e `Host`. Verificar no deploy. O subprotocolo `trucaco.bearer` foi provado em Node (`ws`, undici) e no Chromium.
- **Fly.io real** e WebSocket de sala dentro do contêiner.
- **Windows:** `pnpm build` do mobile sem variáveis inline (ajustado). `pnpm typecheck` do mobile não gera mais route types.
- **Cobertura automatizada:** a cola de efeito dos hooks (`useAnnouncer`, `useLayoutMode`) não tem teste. Mão de ferro, onze, `bo3` e aposta pendente têm teste de projeção e render estático, não partida completa por humanos.

## Riscos conhecidos (antes do beta)

Estado do lobby, fila, `JoinGuard` e limitadores são em memória por processo (precisa Redis para multi-instância); sem job de retenção/expurgo; convidados nunca expiram e cada logout cria um novo; Redis de produção precisa de `noeviction` + AOF; `TRUCO_SEED`/`devAuth` só em dev/test; sem moderação (silenciar/bloquear/denunciar), chat da mesa liberado na espera; homóglifos Latin Extended no apelido (`ı`, `ǀ`); gravação da partida só no fim (queda do processo perde a partida em andamento); access JWT de 15 min continua válido após revogação (exceto o `lastJti`); usuário órfão se o Redis falhar em `createGuest`; hipótese não confirmada: sair e entrar repetidamente (`resume` faz `timeouts.set(seat, 0)`) pode contornar a punição por ausência e `reconnectCount` pode não ter teto; `@colyseus/core` 0.18.10 (0.18.24 existe) e wrappers frágeis a upgrade do core (`invokeMethod`, `beforeUpgrade`), com testes de regressão; `jose@6.2.12` (6.2.14 existe, escolha deliberada por idade mínima); `pnpm audit --prod` aponta só 2 moderados (glob, minimatch via `@expo/cli`, ferramenta de build); logout não derruba WebSocket já aberto; deep link só por scheme customizado (App Links/Universal Links na Fase 7); backup do SecureStore e permissões Android do prebuild a verificar; revanche sem teto de partidas.

## Armadilhas de ambiente (aprendidas)

**Windows com Git Bash (máquina do usuário, 2026-11-02):**

- `node` não está no PATH do Git Bash. Usar o Node 24 do WinGet: `export PATH="/c/Users/Marcelo Marvin/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64:$PATH"`.
- O shim `pnpm` não funciona direto no Git Bash com Node 24 sem corepack. Solução usada: um wrapper `pnpm` em `sh` no PATH que chama `node` no `pnpm.cjs` do corepack (`.../node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs`). O `pnpm -v` tem que dar `9.15.9`.
- `ps -eo` não existe neste Git Bash ("unknown option -- o"). Para achar processo, usar `tasklist` ou `Get-CimInstance Win32_Process` no PowerShell; e matar pelo PID.
- Identidade do git NÃO está configurada na máquina. Passar `-c user.name=... -c user.email=...` no comando de commit, com a identidade do usuário (não gravar e-mail em arquivo versionado).
- Docker Desktop 29.9.2 disponível: `pnpm db:up` funciona (Postgres em 5432, Redis em 6380). Não mexer no Redis da 6379 (é do portal Fiori).
- Codex CLI: falha com **erro 1332 do sandbox** no Windows. Não é cota nem rede: a Rita/Codex não roda até isso ser resolvido.
- Playwright: o Chromium `chromium-1248` já está em `%LOCALAPPDATA%\ms-playwright` nesta máquina.

**Nuvem (ambiente antigo):** sem Docker, sem Codex CLI, sem `gh` (PR por REST com token do `git credential fill`), `pkill -f` NUNCA (matou o próprio shell uma vez; usar `ps -eo pid,args | grep [x]` + `kill <pid>`), `sleep` bloqueado em foreground, removais em caminho de sistema bloqueados pelo safety check (não contornar). Postgres 16 em `/usr/lib/postgresql/16/bin` (rodar como `postgres` via `runuser -u postgres --`, banco UTF8, porta alta, nome contendo `test`); `redis-server` disponível. Testes de integração: `TEST_DATABASE_URL` e `TEST_REDIS_URL` (guardas: host local, nome do banco com test/verif, DB lógico do Redis != 0).

**Servidor e testes:**

- Vitest do server: `pool:'threads'`, `fileParallelism:false`, porta 2568 fixa nos testes de sala: nunca rodar dois conjuntos de testes do servidor em paralelo (nem `pnpm test` da raiz junto com um loop de 3x).
- `pnpm --filter @trucaco/mobile test:int` sobe o `dist/main.js` do servidor (precisa de `pnpm build` antes); pode deixar processo órfão se o teste for cancelado: achar pelo PID e matar.
- `pnpm test:e2e` sobe o servidor compilado (`dist/main.js`) e o web estático nas portas 2587 e 8087; precisa de `pnpm build` antes. O `globalSetup` desmonta os dois processos no fim.
- Colyseus 0.18.10 (`@colyseus/core`, `ws-transport 0.18.4`, schema 5.0.43): `onAuth` NÃO roda na reconexão (por isso `beforeUpgrade` e `checkReconnectionToken`); `client.view` criado no `onJoin`; o SDK 0.18 coloca o token em `_authToken` na query (não usar `client.auth.token`); `credentials: 'include'` por padrão no SDK (fixado em `omit`). O matchmaker tem estado global: um `Server` por arquivo de teste.
- Expo SDK 58: Metro resolve o monorepo pnpm sozinho; pacotes `@trucaco/*` resolvem pelo `dist/` (precisa `turbo build`, que `pnpm build` já faz); `ws` é trocado por stub só dentro de `@colyseus/sdk` (`metro.config.js`); Prettier ignora `expo-env.d.ts`.
- Dockerfile: usa `npm install -g pnpm@9.15.9` (corepack do `node:22.12.0` falha com "Cannot find matching keyid"). `pnpm deploy --prod` para a imagem (copiar só `node_modules` quebra por causa dos symlinks do pnpm).
- Resíduo fora do repositório no ambiente antigo: `/rg.bak` (4,7 KB, criado por engano por um agente); apagar à mão se reencontrar.
