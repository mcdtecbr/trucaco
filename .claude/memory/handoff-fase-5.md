**Handoff para continuar em outra máquina ou ambiente** (atualizado em 2026-11-04, depois da Fase 5b). Último commit de código: `d1dcbc7` (6A, contrato da Fase 6); o 6B está sem commit (ver "Fase 6: 6A e 6B"). Os docs da Fase 5 (`docs/sinais.md`, `apps/mobile/README.md`, `docs/plano-desenvolvimento.md`, `CHANGELOG.md`, relatório e este handoff) estavam **sem commit** ao fim da sessão de documentação: o orquestrador commita. Leia este arquivo, depois `CLAUDE.md`, `docs/plano-desenvolvimento.md`, `docs/specs/2026-11-03-fase-5-relatorio.md`, `docs/adr/` e `docs/protocolo-servidor.md`.

## Como retomar

1. `git clone https://github.com/mcdtecbr/trucaco.git && git checkout develop`. `.nvmrc` pede Node 22. Nesta máquina (Windows) só há Node 24 (WinGet); ver armadilhas. pnpm 9.15.9 via corepack (`corepack enable --install-directory ~/.local/bin pnpm`), mas ver a armadilha do `pnpm` no Windows abaixo.
2. `pnpm install --frozen-lockfile`; verificação completa: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Para contagens reais use `pnpm exec turbo run test --force` (sem `--force` o turbo devolve o cache: `FULL TURBO`).
3. Modo Git: **commit e push direto na `develop`, sem PR, sem tocar na `master`**, até o usuário avisar. Commit e push a cada etapa verificada; nunca commitar trabalho parcial de agente. Commits em pt-BR `tipo(escopo): descrição`.
4. O orquestrador (sessão principal) delega aos 12 agentes de `.claude/agents/` (ver `CLAUDE.md`), verifica por conta própria (suíte, `test:int`, `test:e2e`, leitura de screenshots) e só então commita. Revisão: `rita-revisora` (Codex) se funcionar; sem Codex, `rita-revisora-claude` (opus). `vitor-seguranca` em blocos de auth, rede, chat, sinais e projeção de estado.
5. Preferências do usuário: veracidade acima de tudo, sinalizar incerteza, análise crítica (não validação), responder em pt-BR. Quando disser "padrões", aceita todos os padrões propostos.

## Estado por fase

- **Fase 0 e 1** (fundação, motor `packages/rules`): concluídas. Revisadas só por agente Claude (Rita-C).
- **Fase 2** (servidor): concluída com ressalvas (blocos 2A a 2I). Ver `docs/plano-desenvolvimento.md`, `CHANGELOG.md`, `apps/server/README.md`.
- **Fase 3** (cliente jogável): concluída com ressalvas em 2026-11-02 (blocos 3A a 3J). Relatório: `docs/specs/2026-11-02-fase-3-relatorio.md`.
- **Fase 4** (avatar e sinais): concluída com ressalvas em 2026-11-02. Relatório: `docs/specs/2026-11-02-fase-4-relatorio.md`. Pendências: 4G (Rive web) e 4H (Rive nativo) sem `assets/rive/avatar.riv`; bot de vaga não existe; FPS no web não medido em aparelho.
- **Fase 5** (chat da dupla e combinado de sinais): **concluída com ressalvas em 2026-11-03**. Relatório: `docs/specs/2026-11-03-fase-5-relatorio.md`. Plano: `docs/specs/2026-11-02-fase-5-chat-dupla-plano.md`. Commits: `6bd8e6a` (plano), `edd6f93` (5A e 5B: protocolo e servidor), `c0db943` (5C, 5D e testes de cliente), `296741d` (testes de sala e `mutedStore`), `738b363` (limite de `ready`), `278afb6` e `debe97b` (correções da revisão e da auditoria).
  - **Feito**: sala de espera é a "preparação" (sem fase nova, sem timer); chat das abas Mesa e Dupla na espera; painel "Combinar sinais" na espera e na mesa, com até 60 caracteres por sinal; combinado sob o sinal no painel de sinais; aviso do sinal do parceiro por 5 s; combinado gravado em `partner_codes` (par que já jogou junto a cada edição; par novo ao fim da 1ª partida `finished`); `CODE_NOT_SAVED` quando a leitura ou a gravação falha; silenciar um jogador só neste aparelho. Balões de 4 s e frases rápidas já existiam (Fase 3).
  - **Divergências conhecidas** (documentadas, não corrigidas): (1) [resolvido no 6B: `guest` agora vem do provider da sessão]; (2) o comentário de `CODE_NOT_SAVED` em `packages/protocol/src/errors.ts` diz "gravação desligada", mas o servidor não emite o erro quando não há banco; (3) a rota REST `GET /me/partners/:partnerId/codes` não reaplica a limpeza (valor legado de até 140 caracteres volta inteiro).
  - **Não feito**: P3-5 da Rita (significado tradicional em cinza no painel de sinais da mesa; aviso "combinado salvo para esta dupla"); retomada da mesa da fila pública depois de 60 s (não há rota).
- **Contagens** (`pnpm exec turbo run test --force`, 2026-11-03): rules 174 (12 arquivos), protocol 61 (9), avatar 26 (3), ui 75 (9), mobile 546 (37), server 456 (28). Total 1338 testes unitários. `test:e2e` e `test:int` não foram rodados nesta sessão de documentação. Fase 4 tinha `test:e2e` com 11 cenários (`table.spec.ts`, `avatar.spec.ts`); a Fase 5 acrescentou `codes.spec.ts` (2 cenários). `test:int` do mobile: `codes.int.test.ts` (3 casos) além dos da Fase 4.
- **Fase 5b** (áudio, vozes e efeitos): **concluída com ressalvas em 2026-11-04**, branch `feat/audio-5b`, mesclada (PR #20). Status por etapa em `docs/plano-desenvolvimento.md`; uso em `apps/mobile/README.md` (seção Áudio) e `docs/audio.md`.
  - **Feito**: catálogos de vozes e efeitos em `packages/avatar` (com manifesto gerado); `AvatarParts.voice` usado no criador e salvo; `AudioService` com `expo-audio` (pré-carga de 1 take por evento + LRU de 12); diretor de fala e legenda; soundboard (cliente trata `sfx`; servidor sem mudança); configurações de som; silenciar jogador (reuso do `mutedStore`).
  - **Não é áudio real**: todos os arquivos são placeholders silenciosos. Serviço de voz e fonte dos efeitos seguem **A DEFINIR** (decisão do usuário; licença comercial antes de qualquer arquivo real).
  - **Não feito**: vozes `masc_2`, `masc_3`, `fem_2`, `fem_3` sem arquivo (tocam a do mesmo grupo); `trig_shout` não existe no `avatar.riv` e não é disparado (ponto de extensão `store.speech[seat].event`; pedir ao `rai-avatar`); E2E de soundboard e voz não escrito; validação em iOS, Android e Safari; latência e memória no Android; mesas de 6 (fase 8).
  - **Divergências aceitas**: replay de reconexão e retomada por token são silenciosos; legenda sempre aparece; primeiro som de cada efeito engraçado pode sair mudo. Falas da `rai-avatar` além do repertório e "Meio pau!" em `seis` aguardam revisão do usuário.
  - **Contagens** (2026-11-04): protocol 70, rules 174, ui 77, mobile 622, server 456, avatar 102. E2E: 13 de 13 passaram.
  - **Revisão**: Codex não lê o diff nesta máquina (erro 740), então Rita-C (Claude opus): 2 P2 corrigidos (`venceu_serie` em partida `single`; replay na retomada por token) e 4 P3 corrigidos. Auditoria do Vitor: 1 média (permissões do plugin `expo-audio`, corrigida) e 3 baixas corrigidas; nada crítico ou alto.
- **Catálogo do avatar fechado** (PRs #12 a #19, 2026-11-04 e 2026-11-05): cores, bocas, rosto, cabelo/barba/chapéu, sombreado e correções de franja. Detalhes em `docs/avatar-rive-estado.md` e `CHANGELOG.md`.
- **CI do GitHub**: não consultado para a Fase 5. Os jobs `verify`, `integration` e `e2e-web` rodaram verdes em `dd8ab6e` (Fase 3, run 41499226931).
- **Dockerfile do servidor**: buildado em 2026-11-02 (Fase 3). Imagem ~616 MB, `GET /health` 200, `POST /auth/guest` ok com Postgres 16 e Redis reais após `db:deploy`. Não testado: Fly.io real, WebSocket de sala dentro do contêiner.

## Próximo passo

## Fase 6: 6A e 6B (2026-11-04)

- **6A** (contrato, `d1dcbc7`) e **6B** (bloqueio, denúncia, histórico, apagar conta) feitos na branch `feat/fase-6b-social`. O 6B estava sem commit no fechamento da documentação; o orquestrador commita.
- Fora do 6B: bloquear e denunciar pelo menu do assento (o `PublicPlayer` não tem `userId`; decisão pendente), estatísticas (6E), `UNIQUE` em `reports` e checagem atômica de bloqueios (`dalva-dba`), E2E novo (6H).
- Status, contagens e limites: `docs/specs/2026-11-04-fase-6-plano.md` (seção 7), `docs/protocolo-servidor.md` e `apps/server/README.md`.

## Próximo passo

**6C** (banco, `dalva-dba`): `user_achievements`, `user_missions`, `user_stats` e `users.linked_at`; o catálogo fica em código (ADR 0009, previsto no plano). Depois, **6D** (avaliação, `caio-colyseus`) e **6E** (rotas de perfil) em paralelo. **6F** (login social) e **6G** (cliente) podem andar juntos; as credenciais do Google e da Apple são do usuário (decisão 1 do plano), e sem elas o login social fica desligado (`SOCIAL_LOGIN_DISABLED`).

A Fase 5b já foi mesclada (PR #20); o áudio real continua dependendo de decisões do usuário (serviço de voz e fonte dos efeitos, com licença comercial, `assets/audio/README.md`).

Sempre que começar uma fase, um plano curto do `artur-arquiteto` em `docs/specs/` (como nas fases 2, 3, 4 e 5).

## Pendências (pedir ao usuário ou decidir antes do beta)

- **P3 da revisão da Fase 5**: P3-5 (significado em cinza no painel de sinais da mesa e aviso "combinado salvo para esta dupla"). A Rita-C reportou 5 P3 e corrigiu 3, o que deixa 2 abertos, mas só o P3-5 foi nomeado. Confirmar o outro com a Rita.
- **Retomada da mesa da fila pública depois de 60 s**: não há rota no servidor. `POST /tables/join` serve só mesa privada. Decidir se a fila pública ganha uma rota de retomada.
- **Aviso de convidado**: resolvido no 6B (`guest` lê o provedor da sessão).
- **Comentário de `CODE_NOT_SAVED`** em `packages/protocol/src/errors.ts`: corrigir o texto (sem mudança de comportamento).
- **Arte do `.riv`** (4G e 4H): quem produz é o usuário ou um ilustrador, a partir de `docs/avatar-rig.md`. Nenhum agente consegue produzir ou validar o arquivo.
- **Dev build para Rive nativo** (4H): sem decisão do usuário. O plano recomenda a Fase 7, junto do EAS.
- **Vagas de bot**: decidir se o servidor passa a criar vagas de bot (hoje não cria, e o sorteio de sinal do bot nunca dispara).
- **Desempenho do avatar no web**: escolher entre rebaixar a respiração e o olhar ociosos no web, ou Rive web (4G). Medir em aparelho intermediário antes do beta.
- **Revisão por Codex nunca feita.** Fases 1 a 5 revisadas só pela Rita-C (Claude opus). O Codex CLI instalado no Windows falha com **erro 1332 do sandbox**. Antes do beta, rodar a Rita/Codex sobre `acf118a..HEAD` quando o Codex funcionar.
- **`vitor-seguranca` não revisou a Fase 4** (decisão do usuário). A fase toca `PUT /me/avatar` e sinais; a auditoria fica pendente. A Fase 5 foi auditada (2 rodadas, 0 achado alto ou médio).
- **Pendências antigas do servidor (Fase 2)**: seguem em `docs/plano-desenvolvimento.md`, Fase 2 (retenção, estado em Redis, moderação, ban persistente, janela do JWT, e outras).

Resolvidas desde o handoff da Fase 4 (não são mais pendência):

- **Chat da dupla na espera**: liberado (Fase 5, `edd6f93` e `c0db943`).
- **Combinado de sinais e `partner_codes`**: cliente e servidor, com gravação e recarga (Fase 5).
- **Reload da página da mesa** retoma o assento (ffdc1d6). Só pela mesa privada depois dos 60 s; ver `apps/mobile/README.md`.
- **Botões de aposta do parceiro**: na aposta pendente, só o respondedor tem botões; o parceiro vê "Seu parceiro responde" (222d633, e7b3d39, 3968e85). No onze/dez, os dois da dupla decidem, por decisão do usuário.
- **`voteRematch` e o limite de 150 ms**: mantido como está, por decisão do usuário em 2026-11-02.

## Decisões do usuário (confirmadas)

Mão de ferro é opção da sala (padrão ligada); Mineiro com mão de 10; bot nunca pede nem aumenta aposta; código de sala com 8 caracteres; mão de ferro com carta escolhida às cegas e visível ao ser jogada; refresh no `localStorage` no web (atrás de `TokenStorage`, cookie httpOnly na Fase 6); chat de texto já na Fase 3; `POST /auth/logout`; bundle/scheme `com.mcdtec.trucaco` e `trucaco://`; `TRUCO_SEED` só dev/test; usuário valida iOS/Android no Expo Go.

**Em 2026-11-02**: o usuário criou a **revanche** ("Jogar de novo") e confirmou o **rodízio do pé na revanche** e entre jogos da série `bo3`. Também confirmou os padrões da revanche (janela de 30 s, mínimo de 2 humanos conectados, unanimidade). Ver `.claude/memory/decisao_rodizio_pe_revanche.md`.

**Fase 4 (2026-11-02)**: só o fallback vetorial nesta fase, Rive web depois. Bot de ausência não sinaliza; só bot de vaga pode, e hoje nenhum existe. Catálogo de partes 4/6/8/4/4/6/5/8. `voice` fica para a 5b.

**Fase 5 (2026-11-03)**: a sala de espera é a preparação, sem fase nova nem timer. Combinado de até **60 caracteres** (único teto). Par novo grava ao fim da 1ª partida terminada; série cancelada não grava. Silenciar só local, sem filtro de palavrões (bloqueio e denúncia na Fase 6). Convidado perde o combinado ao sair da conta, com aviso.

**Fase 5b (2026-11-04)**: código e testes antes do áudio real (placeholders silenciosos). Serviço de voz e fonte dos efeitos a definir pelo usuário, com licença comercial antes de qualquer arquivo real. Falas da `rai-avatar` além do repertório e "Meio pau!" em `seis` a revisar.

## Decisões assumidas por padrão (pedir confirmação ao usuário)

`voteCancel` unânime entre humanos conectados (zerado por mão); ban por sala em memória após strikes; texto de chat com ZWJ rejeitado (`CHAT_BLOCKED`, sem expulsão); cooldown de 60 s para reentrar na fila após casar e não sentar; janela de graça do refresh de 20 s (sucessor irmão uma vez; `REFRESH_REUSE_GRACE_SECONDS=0` desliga); "Nós" azul fixo e "Eles" laranja fixo; jogar carta = selecionar e confirmar; `typedRoutes` DESLIGADO (gerar `router.d.ts` no typecheck exigia subir o Metro, não portável ao Windows); estilo do baralho provisório (`cardColors` em `packages/ui`); textos de acessibilidade sem revisão de UX; `TOKEN_EXPIRED`/`ROOM_NOT_FOUND` ficam em `ERROR_CODES` como reservados ao cliente; borda branca como destaque de sinal com movimento reduzido; fila de sinal de 1 posição por assento, no cliente (`tableController`); `codes` reenviado no `ready` com limite de 500 ms por assento; silenciar por apelido normalizado (`trucaco.muted.v1`, até 50). Lista completa no `CHANGELOG.md`, "Decisões a confirmar".

## O que NÃO foi validado (só o usuário ou um aparelho consegue)

- **iOS e Android:** nada nativo testado (sem simulador na nuvem). Validar no Expo Go: transporte do JWT no RN, SecureStore (inclusive o silenciar, que usa `expo-secure-store`), deep link, leitor de tela, layout e o painel de sinais com dedo real.
- **Aparência do avatar e do combinado:** nenhum screenshot foi revisado. Os testes checam estrutura, estado e marcadores. O painel "Combinar sinais" com 12 campos em tela estreita não foi visto.
- **Leitor de tela:** textos de acessibilidade e anúncios dos sinais e do combinado não foram ouvidos.
- **Safari, Firefox e outros navegadores:** o E2E roda só em Chromium (`apps/mobile/playwright.config.ts`).
- **Proxies (Fly):** se repassam `Sec-WebSocket-Protocol` e `Host`. Verificar no deploy.
- **Fly.io real** e WebSocket de sala dentro do contêiner.
- **Cobertura automatizada:** a cola de efeito dos hooks (`useAnnouncer`, `useLayoutMode`) não tem teste. Mão de ferro, onze, `bo3` e aposta pendente têm teste de projeção e render estático, não partida completa por humanos. O combinado tem teste de sala, de integração com o servidor real e E2E, mas não partida completa com quatro humanos reais.
- **Postgres lento e multi-instância** com o combinado: não medidos.

## Riscos conhecidos (antes do beta)

Estado do lobby, fila, `JoinGuard`, limitadores e o combinado da sala (`pairs`, fila de gravação) são em memória por processo (precisa Redis para multi-instância); sem job de retenção/expurgo; convidados nunca expiram e cada logout cria um novo; **combinado de convidado some ao sair da conta e `partner_codes` de pares órfãos não é expurgado**; gravação do combinado do par novo só ao fim da 1ª partida (queda do processo antes disso perde o combinado); Redis de produção precisa de `noeviction` + AOF; `TRUCO_SEED`/`devAuth` só em dev/test; sem moderação (silenciar local existe; bloquear/denunciar não), chat da mesa liberado na espera; homóglifos Latin Extended no apelido; gravação da partida só no fim (queda do processo perde a partida em andamento); access JWT de 15 min continua válido após revogação (exceto o `lastJti`); usuário órfão se o Redis falhar em `createGuest`; hipótese não confirmada: sair e entrar repetidamente (`resume` faz `timeouts.set(seat, 0)`) pode contornar a punição por ausência e `reconnectCount` pode não ter teto; `@colyseus/core` 0.18.10 (0.18.24 existe) e wrappers frágeis a upgrade do core (`invokeMethod`, `beforeUpgrade`), com testes de regressão; `jose@6.2.12` (6.2.14 existe, escolha deliberada por idade mínima); `pnpm audit --prod` aponta só 2 moderados (glob, minimatch via `@expo/cli`, ferramenta de build); logout não derruba WebSocket já aberto; deep link só por scheme customizado (App Links/Universal Links na Fase 7); backup do SecureStore e permissões Android do prebuild a verificar; revanche sem teto de partidas; avatar com desenho vetorial no web pode cair de FPS com CPU limitada (ver Fase 4).

## Armadilhas de ambiente (aprendidas)

**Windows com Git Bash (máquina do usuário, 2026-11-02 e 2026-11-03):**

- `node` não está no PATH do Git Bash. Usar o Node 24 do WinGet: `export PATH="/c/Users/Marcelo Marvin/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.20.0-win-x64:$PATH"`. Não há Node 22 instalado nesta máquina (o `.nvmrc` pede 22).
- **O `~/.local/bin/pnpm` global aponta para um Node do fnm que não existe mais** (`...\fnm\node-versions\v22.23.4\...`), e falha com `Cannot find module ...corepack\dist\pnpm.js`. **Isso quebra o `turbo run` mesmo com o `pnpm` certo no shell**: o turbo chama `pnpm.CMD` pelo PATH e pega o do `~/.local/bin` (em 2026-11-03 o `db:generate` falhou por isso). Solução que funcionou: um `pnpm.cmd` numa pasta de scratch colocada **na frente** do PATH, que chama `node.exe` (Node 24) com o `pnpm.cjs` do corepack, `%LOCALAPPDATA%\node\corepack\v1\pnpm\9.15.9\bin\pnpm.cjs`. Ele vale só para a sessão. `pnpm -v` tem que dar `9.15.9`. Para uso permanente, corrigir o `~/.local/bin/pnpm` ou reinstalar via corepack.
- `ps -eo` não existe neste Git Bash ("unknown option -- o"). Para achar processo, usar `tasklist` ou `Get-CimInstance Win32_Process` no PowerShell; e matar pelo PID.
- Identidade do git NÃO está configurada na máquina. Passar `-c user.name=... -c user.email=...` no comando de commit, com a identidade do usuário (não gravar e-mail em arquivo versionado).
- Docker Desktop 29.9.2 disponível: `pnpm db:up` funciona (Postgres em 5432, Redis em 6380). Não mexer no Redis da 6379 (é do portal Fiori).
- Codex CLI: falha com **erro 1332 do sandbox** no Windows. Não é cota nem rede: a Rita/Codex não roda até isso ser resolvido.
- Playwright: o Chromium `chromium-1248` já está em `%LOCALAPPDATA%\ms-playwright` nesta máquina.
- **Resíduos fora do repositório** (apagar à mão; não estão no repositório): `/scratch.sh` na raiz do Git Bash, **vazio** (0 bytes), criado por um agente. Em 2026-11-03 o `/scratch_edit.txt` não foi encontrado nesta máquina (só o `/scratch.sh` existe); se aparecer, conferir o conteúdo antes de apagar.

**Vitest no pacote (2026-11-04):** `vitest` só está na raiz (hoisting). Um `packages/avatar/node_modules/.bin/vitest` antigo apontava para um caminho inexistente e `pnpm --filter @trucaco/avatar test` falhava; `pnpm install --frozen-lockfile --force` resolveu (102 testes passaram).

**Cobertura:** o `apps/mobile` não tem provider de cobertura (`@vitest/coverage-v8` não está instalado no pacote; só `packages/rules` tem o script `test:coverage`). Não há `test:coverage` para o mobile até instalar o provider.

**Nuvem (ambiente antigo):** sem Docker, sem Codex CLI, sem `gh` (PR por REST com token do `git credential fill`), `pkill -f` NUNCA (matou o próprio shell uma vez; usar `ps -eo pid,args | grep [x]` + `kill <pid>`), `sleep` bloqueado em foreground, removais em caminho de sistema bloqueados pelo safety check (não contornar). Postgres 16 em `/usr/lib/postgresql/16/bin` (rodar como `postgres` via `runuser -u postgres --`, banco UTF8, porta alta, nome contendo `test`); `redis-server` disponível. Testes de integração: `TEST_DATABASE_URL` e `TEST_REDIS_URL` (guardas: host local, nome do banco com test/verif, DB lógico do Redis != 0). Resíduo: `/rg.bak` (criado por engano por um agente); apagar à mão se reencontrar.

**Servidor e testes:**

- Vitest do server: `pool:'threads'`, `fileParallelism:false`, porta 2568 fixa nos testes de sala: nunca rodar dois conjuntos de testes do servidor em paralelo (nem `pnpm test` da raiz junto com um loop de 3x).
- **Teste do servidor que espera patch de estado precisa de `until` (condição), não de `settle`** (espera fixa): o patch chega ao cliente depois do evento. Exemplo: `TrucoRoom.test.ts`, onze/dez com `specialAccepted` (08a7705).
- **Ruído esperado no log de `TrucoRoom.test.ts`**: `@colyseus/sdk: onMessage() not registered for type 'codes'` aparece em stderr quando o teste manda `ready` antes de ligar o handler. Não é falha (a suíte passa).
- `pnpm --filter @trucaco/mobile test:int` sobe o `dist/main.js` do servidor (precisa de `pnpm build` antes); pode deixar processo órfão se o teste for cancelado: achar pelo PID e matar.
- `pnpm test:e2e` sobe o servidor compilado (`dist/main.js`) e o web estático nas portas 2587 e 8087; precisa de `pnpm build` antes. O `globalSetup` desmonta os dois processos no fim. `E2E_SKIP_BUILD=1` reaproveita o `dist-e2e/`.
- Script de FPS (`apps/mobile/e2e/perf`): fora do `testMatch` do E2E (`*.spec.ts`) e do `package.json`; comando no `apps/mobile/README.md`. Mesmas portas do E2E: não rodar junto. A saída vai para `apps/mobile/test-results-perf/`, ignorada em `.gitignore` e `.prettierignore`.
- Colyseus 0.18.10 (`@colyseus/core`, `ws-transport 0.18.4`, schema 5.0.43): `onAuth` NÃO roda na reconexão (por isso `beforeUpgrade` e `checkReconnectionToken`); `client.view` criado no `onJoin`; o SDK 0.18 coloca o token em `_authToken` na query (não usar `client.auth.token`); `credentials: 'include'` por padrão no SDK (fixado em `omit`). O matchmaker tem estado global: um `Server` por arquivo de teste.
- **Bots de vaga ainda não existem no servidor.** `botSeats.add` só acontece no bot de ausência. O caminho `botSignals` é testado em `TrucoRoom.test.ts` (4B) injetando um assento em `botSeats` e chamando `botSignals()` direto, com `botSignalChance` 1. Nenhum teste cobre um bot de vaga numa partida real, porque ele não existe.
- Expo SDK 58: Metro resolve o monorepo pnpm sozinho; pacotes `@trucaco/*` resolvem pelo `dist/` (precisa `turbo build`, que `pnpm build` já faz); `ws` é trocado por stub só dentro de `@colyseus/sdk` (`metro.config.js`); Prettier ignora `expo-env.d.ts`.
- Dockerfile: usa `npm install -g pnpm@9.15.9` (corepack do `node:22.12.0` falha com "Cannot find matching keyid"). `pnpm deploy --prod` para a imagem (copiar só `node_modules` quebra por causa dos symlinks do pnpm).
