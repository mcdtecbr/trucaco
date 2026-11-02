# @trucaco/mobile

App Expo (SDK 58) com Expo Router: web, iOS e Android. O cliente não tem regra de jogo; o estado vem do servidor Colyseus.

## Comandos

Na raiz, `pnpm build` antes da primeira execução (os pacotes `@trucaco/*` são resolvidos pelo `dist/`).

| Comando                                    | O que faz                                      |
| ------------------------------------------ | ---------------------------------------------- |
| `pnpm --filter @trucaco/mobile dev`        | `expo start --web` (Metro, porta 8081)         |
| `pnpm --filter @trucaco/mobile start`      | `expo start` (QR para Expo Go)                 |
| `pnpm --filter @trucaco/mobile export:web` | SPA estática em `apps/mobile/dist` (sem SSR)   |
| `pnpm --filter @trucaco/mobile test`       | Vitest com `react-native-web` no lugar de RN   |
| `pnpm --filter @trucaco/mobile test:int`   | Integração contra o servidor real (abaixo)     |
| `pnpm test:e2e` (raiz) ou `test:e2e` aqui  | E2E web com Playwright, 4 navegadores (abaixo) |

## Variáveis

- `EXPO_PUBLIC_SERVER_URL`: URL do servidor (padrão de dev `http://localhost:2567`). Vai para o bundle: nunca coloque segredo. Em build de produção (`NODE_ENV=production` ou `__DEV__ === false`) só `https:` é aceito (o `wss:` deriva dela), salvo `localhost`, `127.0.0.1` e `10.x`; `getServerUrl()` lança caso contrário.
- `EXPO_PUBLIC_E2E`: `1` liga a sonda oculta `table-state` da mesa (só testes E2E). Vazio nas demais execuções. O E2E (`e2e/globalSetup.ts`) define esta variável sozinho ao construir o web; não a use em build de produção. A sonda é um texto `fase|turn=<actingSeat>|hand=<n>|act=<canAct>|plays=<n>|match=<n>|me=<assento>`.

## Servidor local

`pnpm db:up` e `pnpm --filter @trucaco/server dev`, depois o app web.

## Camada de rede (`src/net/`)

Sem UI; as telas (bloco 3E) consomem estes módulos.

- `api.ts`: cliente REST tipado por `@trucaco/protocol`. Refresh em fila única, uma repetição por requisição, 503/rede/timeout nunca descartam a sessão (`ApiError.isUnavailable`). Nada é logado.
- `tokenStorage.{ts,web.ts,native.ts}`: refresh token e metadados mínimos (`localStorage` na web, `expo-secure-store` no nativo, memória como degradação). O access token vive só em memória.
- `session.ts`: restaurar, convidado se não houver, `ensureAccessToken()` (renova com menos de 60 s, ajustável por `refreshAheadMs`), logout que sempre limpa o armazenamento local (e invalida um `start()` em voo).
- **Várias abas (web)**: o refresh é rotativo com detecção de reuso, então a renovação roda dentro de `navigator.locks` (`refreshLock.ts`, lock `trucaco-refresh`) e, antes de cada POST, relê o armazenamento e adota o refresh que outra aba já rotacionou. O evento `storage` também atualiza o refresh em memória sem renovar. No nativo (processo único) não há lock.
- **Refresh perdido**: timeout, rede ou corpo inválido em `/auth/refresh` repetem UMA vez na hora com o mesmo refresh (dentro da graça de 20 s do servidor); se a repetição falhar, a sessão fica `unavailable` e o refresh antigo é mantido. Limite conhecido: com a rede fora por mais de 20 s depois de uma resposta perdida, a próxima tentativa é reuso e o servidor revoga a família (mitigação futura: graça maior no servidor). Um refresh bem-sucedido depois disso volta o estado para `authenticated`.
- `colyseus.ts`: `createGameClient(session)`, `joinWithReservation`, `reconnect`, `trackEvents` (salto de `seq` marca `desynced`). **O JWT do upgrade do WebSocket vai SEMPRE em `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>`**, via transporte próprio no lugar do transporte do SDK: o SDK 0.18.9 não entrega o JWT no upgrade no navegador nem no React Native (ver o comentário no topo do arquivo). Nunca use `client.auth.token` nem ponha JWT na URL (o cliente força `http.authToken` indefinido para não vazar `_authToken` do `localStorage` do SDK).

  Erros que a UI vê de `joinWithReservation`/`reconnect` (`GameClientError.code`): `SESSION_REQUIRED` (sem sessão local: ir ao início), `TOKEN_EXPIRED` (refresh recusado: sessão morta, novo convidado), `ROOM_NOT_FOUND` (sala descartada ou token de reconexão inválido), `UNAVAILABLE` (falha de rede/servidor na conexão, tentar de novo), `JOIN_FAILED` (reserva recusada). Indisponibilidade durante o refresh sobe como `ApiError` (`isUnavailable`), sem descartar a sessão.

`test:int` sobe `apps/server/dist/main.js` (rode `pnpm build` antes; em memória, porta aleatória, `NODE_ENV=test`), cria 4 convidados, entra por código e reconecta com o SDK real. O 401 real é provado com um access de assinatura válida e `exp` no passado (o teste conhece o `JWT_SECRET` que passa ao servidor), na REST e na reconexão. `INT_SLOW=1` liga o caso em que o TTL mínimo do servidor (60 s) expira de verdade durante a queda (cerca de 65 s).

## E2E web (Playwright, `e2e/`)

Cada teste abre **4 contextos de navegador** (Chromium, um convidado por jogador, storage isolado), cria uma mesa privada, entra pelo código de 8 caracteres e joga pela UI real contra o **servidor compilado** (`apps/server/dist/main.js`, `NODE_ENV=test`, `TRUCO_SEED` fixo). Esperas são sempre por estado: a sonda `table-state` (`EXPO_PUBLIC_E2E=1`) e `data-testid`/papéis, nunca por tempo. Cenários em `e2e/table.spec.ts`: mesa criada e iniciada, cartas jogadas guiadas por `actingSeat`/`canAct`, chat da mesa (texto literal e balão), chat da dupla que não chega ao adversário e rate limit, partida decidida numa mão com revanche até `matchNumber` 2, queda do WebSocket com reconexão.

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

Variáveis do E2E: `E2E_SKIP_BUILD=1` reaproveita o `dist-e2e/` (iteração rápida; reconstrua depois de mexer no app), `E2E_SERVER_PORT`, `E2E_WEB_PORT`, `TEST_DATABASE_URL`, `TEST_REDIS_URL`. Em falha, os screenshots dos 4 jogadores são anexados ao teste (relatório HTML: `pnpm exec playwright show-report`; no CI vai como artefato `playwright-report`). O trace do Playwright só cobre o contexto padrão, não os 4 criados pelo fixture. Observação de produto: recarregar a página da mesa não retoma o assento (o app não persiste o token de reconexão e volta para `/home`), então a queda testada é a do WebSocket, não o reload.

## Telas e estado (bloco 3E)

Rotas em `app/` (finas) e telas em `src/screens/` (`XScreen` com hooks e rede, `XView` só props, testável com `renderToStaticMarkup`): `/` (boot: restaura a sessão ou cria convidado; `unavailable` com "Tentar de novo" sem criar convidado), `/home` (criar mesa privada, entrar por código, fila pública), `/table/[code]` (sala de espera e, quando a partida começa, placeholder da mesa), `/settings` (apelido via `PUT /me`, sair, versões). Deep link `trucaco://table/CODE` só preenche o campo de código em `/home`: nunca entra sozinho.

- `src/store/`: Zustand só para UI (`sessionStore` espelha `session.ts`; `lobbyStore` = fila/busy/erro; `roomStore` = projeção da sala de espera). Sem regra de jogo; a fonte continua sendo `room.state`.
- `src/lobby/lobbyController.ts`: criar/entrar/fila (validação antes da rede, anti duplo clique, polling de 2 s cancelável, guards de resposta). `src/room/roomService.ts`: uma sala por vez, `leave(true)`, reconexão manual quando o SDK desiste. `src/services/app.ts` monta tudo sob demanda.
- `src/i18n/errors.ts`: código de erro para texto pt-BR (teste garante cobertura de todo `HTTP_ERROR_CODES`). `src/theme.ts`: tokens simples (contraste AA testado); migram para `packages/ui` no 3F.
- Política de apelido no cliente (`src/lobby/nickname.ts`) é só UX e espelha `apps/server/src/db/validation.ts`, que não está no protocol.
- `typedRoutes` está DESLIGADO de propósito. Só o `expo start` gera `.expo/types/router.d.ts` (o `expo export` não), e um arquivo velho quebra o `typecheck` (7 erros medidos ao adicionar rotas). Gerar o arquivo dentro do `typecheck` exigia subir o Metro e matar processos por grupo (não portável para o Windows e nunca validado no CI), então a checagem de `router.push`/`Redirect` fica por conta dos testes das funções de rota. Reavaliar quando o CI do GitHub rodar.

## Reserva, saída e a verificar

- A reserva de assento é validada antes de qualquer rede (`isSafeReservation`): ids `[A-Za-z0-9_-]+` e `publicAddress`, se vier, com o mesmo host do servidor; o transporte também recusa host diferente. Reserva adulterada vira `JOIN_FAILED` sem enviar o JWT.
- Sair da tela inicial, abrir Configurações (desabilitado na fila) e logout saem da fila no servidor (`leaveQueue` antes do logout, com o token ainda válido; resposta tardia de um POST em voo também sai).
- **A verificar (Fase 7, builds nativos):** App Links/Universal Links (o `trucaco://` não autentica o domínio: `assetlinks.json` e `apple-app-site-association`); se o backup do SecureStore (Android Auto Backup, iCloud) leva o refresh token para outro aparelho e se isso precisa ser desligado; permissões Android e `AndroidManifest` gerados pelo `expo prebuild` (nenhuma além de internet é esperada).

## Limites

Nada nativo (iOS/Android) é testado na nuvem: sem simulador nem EAS. Validação em Expo Go fica com o usuário.
