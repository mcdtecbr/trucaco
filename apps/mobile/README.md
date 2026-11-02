# @trucaco/mobile

App Expo (SDK 58) com Expo Router: web, iOS e Android. O cliente não tem regra de jogo; o estado vem do servidor Colyseus.

## Comandos

Na raiz, `pnpm build` antes da primeira execução (os pacotes `@trucaco/*` são resolvidos pelo `dist/`).

| Comando                                    | O que faz                                    |
| ------------------------------------------ | -------------------------------------------- |
| `pnpm --filter @trucaco/mobile dev`        | `expo start --web` (Metro, porta 8081)       |
| `pnpm --filter @trucaco/mobile start`      | `expo start` (QR para Expo Go)               |
| `pnpm --filter @trucaco/mobile export:web` | SPA estática em `apps/mobile/dist` (sem SSR) |
| `pnpm --filter @trucaco/mobile test`       | Vitest com `react-native-web` no lugar de RN |
| `pnpm --filter @trucaco/mobile test:int`   | Integração contra o servidor real (abaixo)   |

## Variáveis

- `EXPO_PUBLIC_SERVER_URL`: URL do servidor (padrão de dev `http://localhost:2567`). Vai para o bundle: nunca coloque segredo. Em build de produção (`NODE_ENV=production` ou `__DEV__ === false`) só `https:` é aceito (o `wss:` deriva dela), salvo `localhost`, `127.0.0.1` e `10.x`; `getServerUrl()` lança caso contrário.

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

## Limites

Nada nativo (iOS/Android) é testado na nuvem: sem simulador nem EAS. Validação em Expo Go fica com o usuário.
