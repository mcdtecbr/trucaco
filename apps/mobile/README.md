# @trucaco/mobile

App Expo (SDK 58) com Expo Router: web, iOS e Android. O cliente não tem regra de jogo; o estado vem do servidor Colyseus.

## Comandos

Na raiz, `pnpm build` antes da primeira execução (os pacotes `@trucaco/*` são resolvidos pelo `dist/`).

| Comando                                    | O que faz                                                        |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `pnpm --filter @trucaco/mobile dev`        | `expo start --web` (Metro, porta 8081)                           |
| `pnpm --filter @trucaco/mobile start`      | `expo start` (QR para Expo Go)                                   |
| `pnpm --filter @trucaco/mobile export:web` | SPA estática em `apps/mobile/dist` (sem SSR)                     |
| `pnpm --filter @trucaco/mobile test`       | Vitest com `react-native-web` no lugar de RN (sem servidor)      |
| `pnpm --filter @trucaco/mobile test:int`   | Integração contra o servidor real (abaixo)                       |
| `pnpm test:e2e` (raiz) ou `test:e2e` aqui  | E2E web com Playwright (Chromium, 4 contextos por teste, abaixo) |

## Variáveis

- `EXPO_PUBLIC_SERVER_URL`: URL do servidor (padrão de dev `http://localhost:2567`). Vai para o bundle: nunca coloque segredo. Em build de produção (`NODE_ENV=production` ou `__DEV__ === false`) só `https:` é aceito (o `wss:` deriva dela), salvo `localhost`, `127.0.0.1` e `10.x`; `getServerUrl()` lança caso contrário.
- `EXPO_PUBLIC_E2E`: `1` liga a sonda oculta `table-state` da mesa (só testes E2E). Vazio nas demais execuções. O E2E (`e2e/globalSetup.ts`) define esta variável sozinho ao construir o web; não a use em build de produção. A sonda é um texto `fase|turn=<actingSeat>|hand=<n>|act=<canAct>|plays=<n>|match=<n>|me=<assento>` (`TableView.tsx`).

## Servidor local

`pnpm db:up` e `pnpm --filter @trucaco/server dev`, depois o app web.

## Estrutura

| Pasta                | Conteúdo                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `app/`               | Rotas Expo Router, finas: `_layout.tsx`, `index.tsx` (boot), `home.tsx`, `settings.tsx`, `table/[code].tsx` |
| `src/screens/`       | Telas: `XScreen` (hooks e rede) e `XView` (só props, testável com `renderToStaticMarkup`)                   |
| `src/net/`           | REST, tokens, sessão e cliente Colyseus (abaixo)                                                            |
| `src/lobby/`         | Criar mesa, entrar por código, fila pública, apelido (validação de UX)                                      |
| `src/room/`          | `roomService.ts`: uma sala por vez                                                                          |
| `src/table/`         | Mesa: projeção pura do estado, controller, relógio, presença, `tableStore`                                  |
| `src/store/`         | Zustand só para UI: `sessionStore`, `lobbyStore`, `roomStore` (sala de espera)                              |
| `src/services/`      | `app.ts`: monta rede, sessão e salas sob demanda                                                            |
| `src/platform/`      | Compartilhar o código da mesa (nativo: `Share`; web: copiar)                                                |
| `src/i18n/errors.ts` | Código de erro para texto pt-BR (teste garante cobertura de todo `HTTP_ERROR_CODES`)                        |
| `src/ui/`            | Primitivos de tela (`Button`, `TextField`, `Choice`, `Screen`, `Typography`)                                |
| `e2e/`               | Playwright: setup, fixtures e `table.spec.ts`                                                               |

Cores, espaçamentos e raios vêm de `@trucaco/ui` (`tokens.ts`), que também tem as cartas e os componentes da mesa.

## Camada de rede (`src/net/`)

Sem UI; as telas consomem estes módulos.

- `api.ts`: cliente REST tipado por `@trucaco/protocol`. Refresh em fila única, uma repetição por requisição, 503/rede/timeout nunca descartam a sessão (`ApiError.isUnavailable`). Nada é logado.
- `tokenStorage.{ts,web.ts,native.ts}`: refresh token e metadados mínimos (`localStorage` na web, `expo-secure-store` no nativo, memória como degradação). O access token vive só em memória.
- `session.ts`: restaurar, convidado se não houver, `ensureAccessToken()` (renova com menos de 60 s, ajustável por `refreshAheadMs`), logout que sempre limpa o armazenamento local (e invalida um `start()` em voo).
- **Várias abas (web)**: o refresh é rotativo com detecção de reuso, então a renovação roda dentro de `navigator.locks` (`refreshLock.ts`, lock `trucaco-refresh`) e, antes de cada POST, relê o armazenamento e adota o refresh que outra aba já rotacionou. O evento `storage` também atualiza o refresh em memória sem renovar. No nativo (processo único) não há lock.
- **Refresh perdido**: timeout, rede ou corpo inválido em `/auth/refresh` repetem UMA vez na hora com o mesmo refresh (dentro da graça de 20 s do servidor); se a repetição falhar, a sessão fica `unavailable` e o refresh antigo é mantido. Limite conhecido: com a rede fora por mais de 20 s depois de uma resposta perdida, a próxima tentativa é reuso e o servidor revoga a família (mitigação futura: graça maior no servidor). Um refresh bem-sucedido depois disso volta o estado para `authenticated`.
- `colyseus.ts`: `createGameClient(session)`, `joinWithReservation`, `reconnect`, `trackEvents` (salto de `seq` marca `desynced`). **O JWT do upgrade do WebSocket vai SEMPRE em `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>`**, via transporte próprio no lugar do transporte do SDK: o SDK 0.18.9 não entrega o JWT no upgrade no navegador nem no React Native (ver o comentário no topo do arquivo). Nunca use `client.auth.token` nem ponha JWT na URL (o cliente força `http.authToken` indefinido para não vazar `_authToken` do `localStorage` do SDK).

  Erros que a UI vê de `joinWithReservation`/`reconnect` (`GameClientError.code`): `SESSION_REQUIRED` (sem sessão local: ir ao início), `TOKEN_EXPIRED` (refresh recusado: sessão morta, novo convidado), `ROOM_NOT_FOUND` (sala descartada ou token de reconexão inválido), `UNAVAILABLE` (falha de rede/servidor na conexão, tentar de novo), `JOIN_FAILED` (reserva recusada). Indisponibilidade durante o refresh sobe como `ApiError` (`isUnavailable`), sem descartar a sessão.

`test:int` sobe `apps/server/dist/main.js` (rode `pnpm build` antes; em memória, porta aleatória, `NODE_ENV=test`), cria 4 convidados, entra por código e reconecta com o SDK real. O 401 real é provado com um access de assinatura válida e `exp` no passado (o teste conhece o `JWT_SECRET` que passa ao servidor), na REST e na reconexão. `INT_SLOW=1` liga o caso em que o TTL mínimo do servidor (60 s) expira de verdade durante a queda (cerca de 65 s).

## Mesa, chat e revanche (`src/table/`, `src/screens/`)

- `projectTable.ts`: projeção pura do `room.state` em `TableViewModel`. Sem regra de jogo: quem decide o que é legal é o servidor (`legalActions` do próprio assento).
- `tableController.ts`: envia uma ação só se ela estiver em `legalActions` do próprio assento, barra o duplo clique e detecta a revanche pela mudança de `matchNumber`. Carta coberta própria vem em `privates[seat].ownCovered`.
- `clockOffset.ts` (offset do relógio para o prazo do turno), `presence.ts` (presença por assento), `tableStore.ts` (estado de UI da mesa: balões, notícias, histórico).
- Visões de `/table/[code]`, escolhidas por `roomViewFor(phase)`:
  - `waiting`: `WaitingRoomView`, com o código grande para compartilhar e os 4 assentos; o chat da mesa já funciona aqui.
  - `playing`: `TableView`, com leque de cartas, mesa, placar em camadas, histórico das mãos, botões de aposta por `legalActions`, mão de ferro às cegas (`playBlind`), carta coberta (modo "Cobrir"), voto de cancelar e "Sair da mesa" (com diálogo de confirmação).
  - `finished`: `FinishedView`, com o resultado e o botão "Jogar de novo".
- Chat (`ChatPanel.tsx`): abas "Mesa" e "Dupla". Texto sempre como `<Text>`, validado com `parseClientMessage` de `@trucaco/protocol` (a validação é só UX; o servidor decide de novo). Balão sobre o avatar por 4 s.
- Dupla que decide em aposta pendente ou em mão de onze/dez: a UI mostra "Sua dupla decide" (`actingSeat` no protocolo: `docs/protocolo-servidor.md`).
- **Revanche**: o botão "Jogar de novo" aparece quando a série termina com vencedor e a janela de `rematchDeadlineAt` está aberta. Mostra "Aguardando a mesa (N votaram)" depois do voto, e "O tempo para jogar de novo acabou." quando a janela fecha. A mudança de `matchNumber` reinicia o placar e a mesa na partida nova.
- Deep link `trucaco://table/CODE`: sem mesa ativa, leva a `/home` com o código preenchido; entrar na mesa é sempre ação do usuário.

## Telas e estado

Rotas em `app/` (finas) e telas em `src/screens/`:

- `/` (boot): restaura a sessão ou cria convidado; `unavailable` mostra "Tentar de novo" sem criar convidado.
- `/home`: criar mesa privada (variante, formato `single` ou `bo3`, mão de ferro), entrar por código, fila pública.
- `/table/[code]`: espera, mesa e resultado (visões acima). Rota protegida por `RequireSession`: sem sessão pronta, volta a `/`.
- `/settings`: apelido via `PUT /me`, sair (sai da fila no servidor antes), versões.

- `src/store/`: Zustand só para UI. `sessionStore` espelha `session.ts`; `lobbyStore` = fila/busy/erro; `roomStore` = conexão e projeção da sala de espera. A fonte continua sendo `room.state`.
- `src/lobby/lobbyController.ts`: criar/entrar/fila (validação antes da rede, anti duplo clique, polling de 2 s cancelável, guards de resposta). `src/room/roomService.ts`: uma sala por vez, `leave(true)`, reconexão manual quando o SDK desiste.
- Política de apelido no cliente (`src/lobby/nickname.ts`) é só UX e espelha `apps/server/src/db/validation.ts`, que não está no protocol.
- `typedRoutes` está DESLIGADO de propósito. Só o `expo start` gera `.expo/types/router.d.ts` (o `expo export` não), e um arquivo velho quebra o `typecheck` (7 erros medidos ao adicionar rotas). Gerar o arquivo dentro do `typecheck` exigia subir o Metro e matar processos por grupo (não portável para o Windows e nunca validado no CI), então a checagem de `router.push`/`Redirect` fica por conta dos testes das funções de rota. Reavaliar quando o CI do GitHub rodar.

## E2E web (Playwright, `e2e/`)

Cada teste abre **4 contextos de navegador** (Chromium, um convidado por jogador, storage isolado), cria uma mesa privada, entra pelo código de 8 caracteres e joga pela UI real contra o **servidor compilado** (`apps/server/dist/main.js`, `NODE_ENV=test`, `TRUCO_SEED=12345`). Esperas são sempre por estado: a sonda `table-state` (`EXPO_PUBLIC_E2E=1`) e `data-testid`/papéis, nunca por tempo. Cenários em `e2e/table.spec.ts` (5):

1. Convidados criam a mesa, entram pelo código e a partida começa.
2. Cartas jogadas pelos botões da UI, guiadas por `actingSeat` e `canAct`.
3. Mensagem do chat da mesa aparece como texto e balão; a da dupla não chega ao adversário.
4. Série decidida numa mão: todos jogam de novo e a partida 2 começa (`matchNumber` 2).
5. Queda do WebSocket de um jogador: reconecta, volta à mesa e consegue jogar.

`e2e/globalSetup.ts` faz tudo e desmonta no fim (o servidor é derrubado por PID, também em `process.exit`): (1) `expo export --platform web --output-dir dist-e2e` com `EXPO_PUBLIC_E2E=1` e `EXPO_PUBLIC_SERVER_URL=http://127.0.0.1:2587`; (2) servidor do jogo na porta `2587` com CORS para a origem do web; (3) servidor estático do `dist-e2e/` (SPA, fallback para `index.html`) na porta `8087`. As portas são fixas porque a URL do servidor entra no bundle; troque com `E2E_SERVER_PORT` e `E2E_WEB_PORT`.

**Pré-requisito:** `pnpm build` na raiz (precisa de `apps/server/dist/main.js` e do `dist/` dos pacotes `@trucaco/*`) e o Chromium do Playwright (uma vez por máquina). O E2E **não** entra em `pnpm test`.

Linux ou macOS:

```bash
pnpm build
pnpm --filter @trucaco/mobile exec playwright install --with-deps chromium   # só na primeira vez
pnpm test:e2e
```

Windows (Git Bash ou PowerShell; os comandos são os mesmos, sem `--with-deps`):

```bash
pnpm build
pnpm --filter @trucaco/mobile exec playwright install chromium
pnpm test:e2e
```

Sem banco, o servidor roda em memória (usuários e refresh tokens), o que basta para o dia a dia. Para exercitar Postgres e Redis reais, como o CI faz, suba `pnpm db:up`, crie e migre um banco descartável e exporte as duas variáveis (só hosts locais são aceitos):

```bash
docker exec trucaco-postgres-1 psql -U trucaco -d trucaco -c "CREATE DATABASE trucaco_test"
DATABASE_URL=postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test pnpm --filter @trucaco/server db:deploy
export TEST_DATABASE_URL=postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test
export TEST_REDIS_URL=redis://localhost:6380/15
pnpm test:e2e
```

Variáveis do E2E: `E2E_SKIP_BUILD=1` reaproveita o `dist-e2e/` (iteração rápida; reconstrua depois de mexer no app), `E2E_SERVER_PORT`, `E2E_WEB_PORT`, `TEST_DATABASE_URL`, `TEST_REDIS_URL`. Em falha, os screenshots dos 4 jogadores são anexados ao teste (relatório HTML: `pnpm exec playwright show-report`; no CI vai como artefato `playwright-report`). O trace do Playwright só cobre o contexto padrão, não os 4 criados pelo fixture. O E2E cobre a queda do WebSocket e o **reload da página** (mesa em jogo e sala de espera), ver "Retomar a mesa depois de recarregar" abaixo.

## Retomar a mesa depois de recarregar

Recarregar a página da mesa (web) ou reabrir o app (nativo) devolve o jogador ao assento:

- **O que é guardado** (`src/net/resumeStorage*.ts`): `{ reconnectionToken, code, userId }`, gravado pelo `roomService` a cada token novo do Colyseus (entrada e cada reconexão). Web: `sessionStorage` (por aba; morre com a aba; **nunca** `localStorage`). Nativo: `expo-secure-store`. Qualquer falha do armazenamento degrada para memória, sem lançar.
- **Quando é apagado**: saída de propósito, logout ou sessão perdida, saída consentida vinda do servidor, mesa encerrada sem revanche aberta, e toda falha da retomada. Registro de outro `userId` é descartado sem uso.
- **Retomada** (`src/room/tableResume.ts`, chamada pela splash `BootScreen` antes de qualquer ida ao `/home`): com a sessão válida e registro do mesmo usuário, mostra "Reconectando à mesa…" (visível e anunciado) e tenta (1) `reconnect` pelo token, dentro da janela de 60 s do servidor; (2) se o token foi recusado (janela fechada e o bot assumiu, ou saída na sala de espera), entra de novo por `POST /tables/join` com o código guardado, que devolve o assento ao dono (mesmo `userId`) em **mesa privada**. Até 3 rodadas com 600 ms entre elas (o servidor pode demorar a notar o socket antigo morto). Falhou: apaga o registro, vai ao início com aviso claro.
- **Limite conhecido**: mesa da **fila pública** não tem o caminho (2) (`POST /tables/join` só serve mesa privada). Reload dentro dos 60 s funciona nas duas; depois disso, só na privada.
- O token nunca vai na URL, em log ou em mensagem de erro; a rota continua `/table/<código>` (o código da mesa já é público para quem convida).

## Reserva, saída e a verificar

- A reserva de assento é validada antes de qualquer rede (`isSafeReservation`): ids `[A-Za-z0-9_-]+` e `publicAddress`, se vier, com o mesmo host do servidor; o transporte também recusa host diferente. Reserva adulterada vira `JOIN_FAILED` sem enviar o JWT.
- Sair da tela inicial, abrir Configurações (desabilitado na fila) e logout saem da fila no servidor (`leaveQueue` antes do logout, com o token ainda válido; resposta tardia de um POST em voo também sai).
- **A verificar (Fase 7, builds nativos):** App Links/Universal Links (o `trucaco://` não autentica o domínio: `assetlinks.json` e `apple-app-site-association`); se o backup do SecureStore (Android Auto Backup, iCloud) leva o refresh token para outro aparelho e se isso precisa ser desligado; permissões Android e `AndroidManifest` gerados pelo `expo prebuild` (nenhuma além de internet é esperada).

## Limites

Nada nativo (iOS/Android) é testado na nuvem: sem simulador nem EAS. Validação em Expo Go, em aparelho real, com leitor de tela e no Safari fica com o usuário. Pendências e ressalvas da Fase 3: `docs/plano-desenvolvimento.md`.
