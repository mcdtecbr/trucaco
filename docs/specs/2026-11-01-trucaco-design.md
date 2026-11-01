# Trucaco: especificação de design

Data: 2026-11-01. Status: aprovada no brainstorming inicial.

## 1. Objetivo

Produto público de truco online (Paulista e Mineiro) para web, iOS e Android. Mesa de 4 jogadores em dispositivos separados, cada um com avatar animado que executa **sinais de truco** visíveis a toda a mesa; chat privado da dupla no início da partida para combinar os sinais; balões de conversa na mesa durante o jogo. Mesa de 6 na fase 8.

Fora do escopo do MVP: mesa de 6, matchmaking público ranqueado, loja/monetização, voz, variantes regionais além de Paulista e Mineiro.

## 2. Decisões de stack

| Decisão  | Escolha                                                       | Alternativas descartadas e motivo                                                                                                     |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente  | React Native + Expo (web/iOS/Android), TypeScript             | PWA só (sem loja de apps); Flutter (stack fora do ecossistema JS/.NET do time); Unity (WebGL pesado, avatares 3D além da necessidade) |
| Servidor | Node + TypeScript + Colyseus                                  | Socket.IO puro (reescreveria salas, sync e reconexão); .NET SignalR (regras não compartilhariam código com o cliente)                 |
| Avatar   | Rive, rig único com partes trocáveis e state machine          | Lottie (sem state machine, customização difícil); 3D (pesado); spritesheets (muita arte manual)                                       |
| Dados    | PostgreSQL via Prisma; Redis                                  | —                                                                                                                                     |
| Auth     | Google, Apple e convidado; JWT próprio                        | E-mail/senha (atrito e responsabilidade); só convidado (sem persistência entre dispositivos)                                          |
| Infra    | GitHub (`mcdtecbr/trucaco`), GitHub Actions, Fly.io, Expo EAS | Azure DevOps + Container Apps (custo e complexidade iniciais)                                                                         |
| MVP      | Paulista e Mineiro, mesa de 4                                 | —                                                                                                                                     |

## 3. Arquitetura

Monorepo pnpm + Turborepo:

```
apps/mobile      Expo: UI, mesa, avatar Rive, chat, cliente Colyseus
apps/server      Colyseus: LobbyRoom, TrucoRoom, auth, REST, persistência
packages/rules   Motor de regras puro (sem I/O): applyAction(state, action) → state
packages/protocol Tipos, schemas e constantes compartilhados
packages/avatar  Catálogo de partes do avatar e de sinais → gatilhos Rive
packages/ui      Componentes visuais compartilhados (cartas, mesa, balões)
assets/rive      avatar.riv
infra            Dockerfile, fly.toml, docker-compose local
```

Dependências permitidas: `rules` e `protocol` não dependem de nada interno. `avatar` e `ui` dependem de `protocol`. `server` depende de `rules` e `protocol`. `mobile` depende de `protocol`, `avatar`, `ui` (e nunca de `rules`: o cliente não decide regra).

**Princípio**: o servidor é a única fonte de verdade. O cliente envia intenções, recebe estado filtrado e renderiza.

## 4. Motor de regras (`packages/rules`)

- Estado imutável `HandState` (mão em curso) e `MatchState` (placar, pé, variante, mão especial).
- `applyAction(state, action): Result<state, RuleError>`. Ações: `PLAY_CARD`, `PLAY_COVERED`, `CALL_BET`, `ACCEPT_BET`, `RAISE_BET`, `FOLD`, `SPECIAL_HAND_PLAY`, `SPECIAL_HAND_FOLD`.
- `Variant` parametriza o que difere entre Paulista e Mineiro (ver `docs/regras-truco.md`, seção "Parametrização"). Nada mais usa `if (variant)`.
- `seats` parametrizado (4 agora, 6 na fase 8).
- Determinismo: embaralhar recebe um RNG injetado para testes reproduzíveis.
- `legalActions(state, seat)` para o servidor validar e para o bot de desconexão escolher jogada.

## 5. Servidor (`apps/server`)

- **`LobbyRoom`**: criar mesa (variante, pública/privada, código de 6 caracteres), entrar por código, fila pública simples (FIFO por variante), sorteio de parcerias ou duplas fixas (quem entrou junto).
- **`TrucoRoom`** (4 assentos): instancia o motor, aplica ações, mantém `@colyseus/schema` com **visão filtrada por assento** (`@filter`: cartas próprias visíveis, alheias como contagem). O estado filtrado de cada assento inclui `legalActions` daquele assento, para o cliente habilitar botões sem conhecer regra. Timer de turno 20 s; `allowReconnection(client, 60)`; bot assume após expirar.
- **Sinais**: mensagem `signal { signalId }` → validação (catálogo, rate limit 1/3 s) → broadcast `signal { seat, signalId, at }` → log.
- **Chat**: `chat.partner` (só para o parceiro) e `chat.table` (broadcast). Texto até 140 caracteres, filtro de palavrões, rate limit 1 msg/2 s. Frases rápidas por id.
- **Auth**: `onAuth` valida JWT emitido pelo próprio servidor. REST (Express dentro do Colyseus): `POST /auth/google`, `POST /auth/apple`, `POST /auth/guest`, `POST /auth/link`, `GET/PUT /me`, `GET/PUT /me/avatar`, `GET /me/partners/:id/codes`, `PUT /me/partners/:id/codes`, `GET /matches`.
- **Persistência**: Postgres (Prisma): `users`, `avatars`, `matches`, `match_players`, `partner_codes`, `reports`, `blocks`. Redis: presença, filas de matchmaking, `@colyseus/redis-driver` para múltiplas instâncias.

## 6. Cliente (`apps/mobile`)

- Expo Router. Telas: Entrada (login/convidado) → Início (criar/entrar/jogar) → Criador de avatar → Preparação da partida (chat da dupla + catálogo de sinais) → Mesa → Resultado.
- Estado: Zustand para UI local; estado da partida vem do `Room` do Colyseus (`room.state`), sem duplicar lógica.
- Mesa: 4 avatares em posições fixas (eu embaixo, parceiro em cima, adversários nos lados), cartas na mão, pilha da vaza, vira (Paulista), placar, botões de truco contextuais (só quando `legalActions` inclui).
- Painel de sinais: toque/clique e segure. Balão de chat sobre o avatar por 4 s.
- Web e mobile compartilham código; diferenças via `Platform` e componentes `.web.tsx` quando inevitável (Rive usa pacotes diferentes).

## 7. Avatar (`packages/avatar`, `assets/rive`)

- `avatar.riv` com artboard único, camadas trocáveis por input numérico/booleano: `face_shape`, `skin`, `hair`, `eyes`, `mouth`, `outfit`, `accessory`, `bg_color`. Perfil salva `AvatarParts` como JSON.
- State machine `Main`: layer `Idle` (respirar, piscar aleatório, olhar) e layer `Signals` com um trigger por sinal (`docs/sinais.md`). Sinal interrompe e volta ao idle.
- Componente `<Avatar parts signalQueue />` em `packages/ui` com implementação `.native.tsx` (`rive-react-native`) e `.web.tsx` (`@rive-app/react-canvas`).
- Arte inicial cartoon flat feita no editor Rive; evolução ou encomenda depois.

## 8. Autenticação e perfil

- Expo AuthSession (Google) e `expo-apple-authentication`. Backend valida token do provedor, cria/encontra `user`, emite JWT (15 min) + refresh (30 dias, rotativo, em Redis).
- Convidado: `POST /auth/guest` cria `user` com `provider = guest` e apelido. `POST /auth/link` troca o owner para a conta social, preservando avatar, histórico e códigos de dupla.
- Perfil: apelido único (3–16 caracteres), `AvatarParts`, estatísticas (partidas, vitórias por variante), duplas frequentes e seus códigos.

## 9. Erro, abuso e resiliência

- Ações inválidas rejeitadas pelo motor com `RuleError` tipado; o servidor responde `error { code }` e não altera estado.
- Desconexão: reconexão em 60 s; bot (carta mais fraca, nunca pede truco, corre a truco) depois disso.
- Anti-trapaça: filtro de schema por assento; validação exclusiva no servidor; log de partida para auditoria.
- Moderação: denúncia na mesa (`reports`), bloqueio (`blocks`, não sorteia na mesma mesa pública), filtro de texto, rate limit em chat e sinais, banimento manual.

## 10. Testes

- `rules`: Vitest, cobertura alta; casos por variante (hierarquia, manilha fixa × vira, todos os empates, mão de onze/dez, mão de ferro, escada de apostas, quem pode aumentar).
- `server`: `@colyseus/testing` com 4 clientes simulados: mão completa, truco aceito/corrido/aumentado, reconexão, bot, sinais com rate limit, chat de parceiro não vaza.
- `mobile`/`ui`: testes de componente (cartas, balão, painel de sinais, avatar com mock do Rive).
- E2E: Playwright (web) para fluxo login convidado → sala → partida; Maestro (mobile) nos builds EAS.
- CI (GitHub Actions): lint, typecheck, test, build do server, preview web em PR.

## 11. Riscos e mitigação

| Risco                                      | Mitigação                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Arte Rive leva mais tempo que o código     | Fase 4 começa com rig simples; avatar placeholder até lá; `packages/avatar` desacopla catálogo de arte |
| Regras regionais divergentes geram disputa | `docs/regras-truco.md` é normativo; mudanças por ADR                                                   |
| Rive em RN e web usa pacotes diferentes    | Componente com `.native.tsx`/`.web.tsx` e API única                                                    |
| Latência/reconexão em mobile               | Colyseus `allowReconnection`, estado completo re-enviado ao reconectar, bot                            |
| Toxicidade no chat                         | Filtro, rate limit, denúncia, bloqueio desde o MVP                                                     |

## 12. Fases

Ver `docs/plano-desenvolvimento.md`.
