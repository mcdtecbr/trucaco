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

- `EXPO_PUBLIC_SERVER_URL`: URL do servidor (padrão de dev `http://localhost:2567`). Vai para o bundle: nunca coloque segredo.

## Servidor local

`pnpm db:up` e `pnpm --filter @trucaco/server dev`, depois o app web.

## Camada de rede (`src/net/`)

Sem UI; as telas (bloco 3E) consomem estes módulos.

- `api.ts`: cliente REST tipado por `@trucaco/protocol`. Refresh em fila única, uma repetição por requisição, 503/rede/timeout nunca descartam a sessão (`ApiError.isUnavailable`). Nada é logado.
- `tokenStorage.{ts,web.ts,native.ts}`: refresh token e metadados mínimos (`localStorage` na web, `expo-secure-store` no nativo, memória como degradação). O access token vive só em memória.
- `session.ts`: restaurar, convidado se não houver, `ensureAccessToken()` (renova com menos de 60 s), logout que sempre limpa o armazenamento local.
- `colyseus.ts`: `createGameClient(session)`, `joinWithReservation`, `reconnect`, `trackEvents` (salto de `seq` marca `desynced`). **O JWT do upgrade do WebSocket vai SEMPRE em `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>`**, via transporte próprio no lugar do transporte do SDK: o SDK 0.18.9 não entrega o JWT no upgrade no navegador nem no React Native (ver o comentário no topo do arquivo). Nunca use `client.auth.token` nem ponha JWT na URL.

`test:int` sobe `apps/server/dist/main.js` (rode `pnpm build` antes; em memória, porta aleatória, `NODE_ENV=test`), cria 4 convidados, entra por código e reconecta com o SDK real. `INT_SLOW=1` liga o caso de JWT expirado durante a queda (cerca de 65 s).

## Limites

Nada nativo (iOS/Android) é testado na nuvem: sem simulador nem EAS. Validação em Expo Go fica com o usuário.
