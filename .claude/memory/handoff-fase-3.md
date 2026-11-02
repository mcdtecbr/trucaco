**Handoff para continuar em outra máquina ou ambiente** (escrito em 2026-11-02, último commit de código `7cbe481` na `develop`, remoto sincronizado). Leia este arquivo, depois `CLAUDE.md`, `docs/plano-desenvolvimento.md`, `docs/specs/2026-11-02-fase-3-cliente-plano.md` e `docs/protocolo-servidor.md`.

## Como retomar

1. `git clone https://github.com/mcdtecbr/trucaco.git && git checkout develop`. Node 22 (`.nvmrc`), pnpm 9.15.9 via corepack (`corepack enable --install-directory ~/.local/bin pnpm`; no Windows com Git Bash).
2. `pnpm install --frozen-lockfile`; verificação completa: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. O estado atual passa tudo (ver contagens abaixo).
3. Modo Git: **commit e push direto na `develop`, sem PR, sem tocar na `master`**, até o usuário avisar. Commit e push a cada etapa verificada; nunca commitar trabalho parcial de agente. Commits em pt-BR `tipo(escopo): descrição`.
4. O orquestrador (sessão principal) delega aos 12 agentes de `.claude/agents/` (ver `CLAUDE.md`), verifica por conta própria (suíte, 3 execuções do servidor, leitura de screenshots) e só então commita. Revisão: `rita-revisora` (Codex) se existir; sem Codex (nuvem) usar `rita-revisora-claude` (opus). `vitor-seguranca` em blocos de auth, rede, chat e projeção de estado.
5. Preferências do usuário: veracidade acima de tudo, sinalizar incerteza, análise crítica (não validação), responder em pt-BR. Quando disser "padrões", aceita todos os padrões propostos.

## Estado por fase

- **Fase 0 e 1** (fundação, motor `packages/rules`): concluídas. Revisadas só por agente Claude. Recomendado rodar a Rita/Codex na máquina Windows sobre `acf118a..HEAD`.
- **Fase 2** (servidor): concluída com ressalvas (blocos 2A a 2I). Ver `docs/plano-desenvolvimento.md`, `CHANGELOG.md`, `apps/server/README.md`.
- **Fase 3** (cliente jogável, em andamento). Plano em `docs/specs/2026-11-02-fase-3-cliente-plano.md` (blocos 3A a 3J). Feitos e commitados:
  - 3A contrato HTTP e snapshot em `packages/protocol` (`http.ts` com 33 códigos, `state.ts`).
  - 3B servidor: `POST /auth/logout`, teste do handshake com subprotocolo `trucaco.bearer`, `TRUCO_SEED` (só development/test). Rodada de correção: logout revoga o `lastJti`; o guard recusa `Sec-WebSocket-Protocol` cujo primeiro item não é `trucaco.bearer`.
  - 3C esqueleto Expo SDK 58 (web via Metro, export estático validado no Chromium).
  - 3D camada de rede `apps/mobile/src/net/*`: REST com refresh em fila única e lock entre abas, `TokenStorage` (SecureStore no nativo, localStorage no web), sessão, cliente Colyseus (`@colyseus/sdk@0.18.9`) com transporte que envia `['trucaco.bearer', jwt]`. O risco do plano (SDK não envia o JWT na reconexão) foi **confirmado**: sem o transporte a reconexão falha com 401 no navegador; no RN é leitura de código, não testado em dispositivo.
  - 3E telas de auth e lobby (splash, home, sala de espera, configurações) com Zustand.
  - 3F e 3G `packages/ui`: tokens, Card, HandFan, PlayedCards, Vira, AvatarPlaceholder, TurnTimer, BetButtons, ChatText, ScoreLayers, LiveRegion, `announcementFor` (13 eventos), fila de anúncios.
  - 3G2 e 3H1b servidor: `hand.manilhaRank`, `manilhaCards`, `nextBetValue`, `pendingValue`, `actingSeat` (todos públicos e aditivos; `PROTOCOL_VERSION` segue 2).
  - 3H1 mesa jogável básica (`apps/mobile/src/table/*`, `TableRoomScreen`, `TableView`): projeção pura, controller que só envia ação presente em `legalActions`, offset de relógio, reconexão visível, layout celular e web larga.
- Contagens de testes no último estado verde: rules 138, protocol 44, server 409, ui 74, mobile 312 (mais `test:int` do mobile: 16 passam, 1 pulado `INT_SLOW`), avatar 1.

## Pendências imediatas (próximo passo: 3H2)

Entregar em UMA rodada ao `fabio-frontend`, depois Rita-C + Vitor, depois rodada de correção, commit e push:

**Correções do 3H1 (achados já revisados, ainda NÃO aplicados):**

- P2 (Rita-C): o cliente usa `hand.turn` como "de quem é a vez"; em aposta pendente e em decisão de onze/dez/ferro quem age é `hand.actingSeat` (publicado no 3H1b). Em decisão especial `actingSeat` é o MENOR assento da dupla que decide e os dois da dupla têm ação legal: a UI deve usar `legalActions` próprio e mostrar "Sua dupla decide". Refazer fixtures (`projectTable.test.ts:136`, `tableView.test.tsx:76`) e o invariante do `table.int.test.ts` (o driver nunca aposta, então o int não pega isso; incluir aposta pendente).
- P3 Rita-C: asserção tautológica no `table.int.test.ts:299`; `accessibilityLabel="Manilhas fixas"` esconde as cartas do leitor de tela; diálogo "Sair da mesa?" sem foco/trap (Modal ou aria-hidden); a vaza some quando a 4ª carta é jogada (manter a última vaza por um instante); apelidos truncados indistinguíveis e a faixa de presença empurra o layout; possível servidor órfão no `integrationServer.ts` (limpeza só por `process.once('exit')`, o tinypool mata por SIGTERM; usar finally/SIGTERM/globalSetup); código morto no `tableStore` (`desynced`, `lastSeq`, `PendingView.value`, `busyTimer` no `onReconnected`).
- Baixos Vitor: sonda `table-state` (data-testid oculto) só em modo E2E; replay de reconexão não deve entrar no offset de relógio nem nos anúncios; `error` do servidor deve ser correlacionado à ação (destrava `busy` só por código de ação).

**Escopo do 3H2:** mão de ferro às cegas (`playBlind:<i>`), decisão de onze/dez com `partnerCards` (só renderizar em `specialDecision`), carta coberta jogável (hoje não há botão "Cobrir"), histórico detalhado, fim de partida/série (hoje `FinishedView` é placeholder), voto de cancelar, chat de texto (sempre `<Text>`, validar com função do protocol). Se vier grande demais, dividir em 3H3 em vez de forçar.

**Depois do 3H:** 3I (E2E Playwright e job `e2e-web` no CI, build web como artefato; rascunho de E2E de 4 contextos está só em `/tmp` do ambiente antigo, refazer), 3J (docs: `docs/protocolo-servidor.md` §novos campos `manilhaRank/manilhaCards/nextBetValue/pendingValue/actingSeat`, README do mobile, CHANGELOG, plano), relatório final da Fase 3.

## Decisões do usuário (confirmadas)

Mão de ferro é opção da sala (padrão ligada); Mineiro com mão de 10; bot nunca pede nem aumenta aposta (pode dar sinal); código de sala com 8 caracteres; mão de ferro com carta escolhida às cegas e visível ao ser jogada; respostas "padrões" às decisões da Fase 3: refresh no `localStorage` no web (atrás de `TokenStorage`, cookie httpOnly na Fase 6), chat de texto já na Fase 3, `POST /auth/logout` agora, bundle/scheme `com.mcdtec.trucaco` e `trucaco://`, `TRUCO_SEED` só dev/test, usuário valida iOS/Android no Expo Go.

## Decisões assumidas por padrão (pedir confirmação ao usuário)

`voteCancel` unânime entre humanos conectados (zerado por mão); ban por sala em memória após strikes; texto de chat com ZWJ rejeitado (`CHAT_BLOCKED`, sem expulsão); cooldown de 60 s para reentrar na fila após casar e não sentar; janela de graça do refresh de 20 s (sucessor irmão uma vez; `REFRESH_REUSE_GRACE_SECONDS=0` desliga); "Nós" azul fixo e "Eles" laranja fixo; jogar carta = selecionar e confirmar; `typedRoutes` DESLIGADO (gerar `router.d.ts` no typecheck exigia subir o Metro, não portável ao Windows); estilo do baralho provisório (`cardColors` em `packages/ui`); textos de acessibilidade sem revisão de UX; **rodízio do pé entre jogos da série: NUNCA confirmado pelo usuário**; `TOKEN_EXPIRED`/`ROOM_NOT_FOUND` ficam em `ERROR_CODES` como reservados ao cliente.

## O que NÃO foi validado (só o usuário ou o CI conseguem)

- **iOS e Android:** nada nativo testado (sem simulador na nuvem). Validar no Expo Go: transporte do JWT no RN, SecureStore, deep link, leitor de tela.
- **CI do GitHub nunca rodou** nas mudanças: job `verify` e `integration` (Postgres 16.6 + Redis 7.4 como services, assumindo `noeviction`), e o futuro `e2e-web`. Primeiro push na `develop` mostra.
- **`infra/Dockerfile.server` nunca foi construído** (sem Docker na nuvem).
- **Windows:** `pnpm build` do mobile sem variáveis inline (já ajustado), mas não testado lá; `pnpm typecheck` do mobile não gera mais route types.
- Subprotocolo `trucaco.bearer` só provado em Node (`ws`, undici); navegador/Safari/RN reais pendentes. Proxies (Fly) podem registrar `Sec-WebSocket-Protocol` e a query: verificar no deploy.
- Hooks sem teste automatizado da cola de efeito (`useAnnouncer`, `useLayoutMode`); mão de ferro, onze, `bo3` e aposta pendente só em teste unitário/render estático no cliente.

## Riscos conhecidos (antes do beta)

Estado do lobby, fila, `JoinGuard` e limitadores são em memória por processo (precisa Redis para multi-instância); sem job de retenção/expurgo; convidados nunca expiram e cada logout cria um novo; Redis de produção precisa de `noeviction` + AOF; `TRUCO_SEED`/`devAuth` só em dev/test; sem moderação (silenciar/bloquear/denunciar), chat da mesa liberado na espera; homóglifos Latin Extended no apelido (`ı`, `ǀ`) e avatar aceita texto livre de até 140 caracteres; gravação da partida só no fim (queda do processo perde a partida em andamento); access JWT de 15 min continua válido após revogação (exceto o `lastJti`); usuário órfão se o Redis falhar em `createGuest`; hipótese não confirmada: sair e entrar repetidamente (`resume` faz `timeouts.set(seat, 0)`) pode contornar a punição por ausência e `reconnectCount` pode não ter teto; `@colyseus/core` 0.18.10 (0.18.24 existe) e wrappers frágeis a upgrade do core (`invokeMethod`, `beforeUpgrade`), com testes de regressão; `jose@6.2.12` (6.2.14 existe, escolha deliberada por idade mínima); `pnpm audit --prod` aponta só 2 moderados (glob, minimatch via `@expo/cli`, ferramenta de build); logout não derruba WebSocket já aberto; deep link só por scheme customizado (App Links/Universal Links na Fase 7); backup do SecureStore e permissões Android do prebuild a verificar.

## Armadilhas de ambiente (aprendidas)

- Nuvem: sem Docker, sem Codex CLI, sem `gh` (PR por REST com token do `git credential fill`), `pkill -f` NUNCA (matou o próprio shell uma vez; usar `ps -eo pid,args | grep [x]` + `kill <pid>`), `sleep` bloqueado em foreground, removais em caminho de sistema bloqueados pelo safety check (não contornar).
- Postgres 16 em `/usr/lib/postgresql/16/bin` (rodar como `postgres` via `runuser -u postgres --`, banco UTF8, porta alta, nome contendo `test`); `redis-server` disponível. Testes de integração: `TEST_DATABASE_URL` e `TEST_REDIS_URL` (guardas: host local, nome do banco com test/verif, DB lógico do Redis != 0).
- Vitest do server: `pool:'threads'`, `fileParallelism:false`, porta 2568 fixa nos testes de sala: nunca rodar dois conjuntos de testes do servidor em paralelo (nem `pnpm test` da raiz junto com um loop de 3x).
- Mobile: `pnpm --filter @trucaco/mobile test:int` sobe o `dist/main.js` do servidor (precisa de `pnpm build` antes); pode deixar processo órfão se o teste for cancelado: `ps -eo pid,args | grep [d]ist/main.js` e `kill <pid>`.
- Colyseus 0.18.10 (`@colyseus/core`, `ws-transport 0.18.4`, schema 5.0.43): `onAuth` NÃO roda na reconexão (por isso `beforeUpgrade` e `checkReconnectionToken`); `client.view` criado no `onJoin`; o SDK 0.18 coloca o token em `_authToken` na query (não usar `client.auth.token`); `credentials: 'include'` por padrão no SDK (fixado em `omit`).
- Expo SDK 58: Metro resolve o monorepo pnpm sozinho; pacotes `@trucaco/*` resolvem pelo `dist/` (precisa `turbo build`, que `pnpm build` já faz); `ws` é trocado por stub só dentro de `@colyseus/sdk` (`metro.config.js`); Prettier ignora `expo-env.d.ts`.
- Resíduo fora do repositório no ambiente antigo: `/rg.bak` (4,7 KB, criado por engano por um agente); apagar à mão se reencontrar.
