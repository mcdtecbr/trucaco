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

## Variáveis

- `EXPO_PUBLIC_SERVER_URL`: URL do servidor (padrão de dev `http://localhost:2567`). Vai para o bundle: nunca coloque segredo.

## Servidor local

`pnpm db:up` e `pnpm --filter @trucaco/server dev`, depois o app web.

## Limites

Nada nativo (iOS/Android) é testado na nuvem: sem simulador nem EAS. Validação em Expo Go fica com o usuário.
