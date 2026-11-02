# Protocolo cliente ↔ servidor

Referência curta do contrato entre o cliente (`apps/mobile`, Fase 3) e o servidor (`apps/server`). Fonte da verdade: `packages/protocol` (tipos, catálogos e `parseClientMessage`), `apps/server/src/http/` (REST) e `apps/server/src/rooms/TrucoRoom.ts` (sala). Operação, variáveis de ambiente e limites detalhados: `apps/server/README.md`. Versão do protocolo: `PROTOCOL_VERSION = 2` (`GET /health` devolve `{ "status": "ok", "protocol": 2 }`).

Ao divergir deste texto, o código vence e este documento deve ser corrigido. Itens marcados **a confirmar** dependem de decisão ou de validação ainda não feita.

## 1. Autenticação do cliente

- **Access token**: JWT HS256 de 15 min (`ACCESS_TOKEN_TTL_SECONDS`). O servidor aceita o JWT só em:
  - cabeçalho `Authorization: Bearer <jwt>` (REST, `POST /matchmake/*` e o upgrade do WebSocket em Node e React Native);
  - subprotocolo `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>` (navegador, que não põe cabeçalho no WebSocket).
    O `trucaco.bearer` DEVE vir primeiro (`new WebSocket(url, ['trucaco.bearer', jwt])`): o servidor seleciona e ecoa só `trucaco.bearer` no 101 (o JWT nunca volta); com a ordem invertida (ou qualquer outro subprotocolo na frente) o upgrade é recusado com 400 antes do handshake, em qualquer entrada (join comum ou reconexão), para o `ws` nunca ecoar o JWT. Coberto por `apps/server/src/rooms/wsHandshake.test.ts`.
- **Nunca** envie o JWT em `client.auth.token` nem na query. O SDK copia esse valor para `_authToken` na URL (vaza em log de proxy), e o servidor o ignora como credencial.
- Com o SDK Colyseus 0.18: `client.http.options.headers = { authorization: 'Bearer <jwt>' }`.
- **Refresh token**: opaco, rotativo a cada uso. Guarde o par novo assim que `/auth/refresh` responder: o token antigo morre.
  - Faça refresh em **fila única** (um por vez). Refresh simultâneos além do par original + irmão derrubam a família.
  - Janela de graça de 20 s (`REFRESH_REUSE_GRACE_SECONDS`): a segunda reapresentação de um token recém-rotacionado conta como reuso. **a confirmar**: o valor de 20 s é padrão assumido, não confirmado pelo usuário.
  - Teto absoluto da família: 90 dias (`REFRESH_FAMILY_MAX_SECONDS`). Depois disso o refresh responde `401 INVALID_REFRESH_TOKEN`.
- **503 não é logout**: `503 SERVICE_UNAVAILABLE` significa Redis ou banco fora do ar. Mantenha a sessão e tente de novo depois.
- **401 na reconexão**: o access expirou durante a queda. O cliente chama `/auth/refresh`, atualiza o cabeçalho e chama `sdk.reconnect(reconnectionToken)` de novo.
- **Refresh recusado** (`401 INVALID_REFRESH_TOKEN`): a sessão acabou. Volte à entrada. **a confirmar**: a UX dessa tela fica para a Fase 3.

## 2. REST: autenticação e perfil

Toda resposta de erro tem o formato `{ "error": { "code": "..." } }`. Corpo JSON de até 8 KB e `Content-Type: application/json`.

| Rota                                | Auth   | Sucesso                                                                | Erros (status e código)                                                                                    |
| ----------------------------------- | ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /auth/guest`                  | não    | `201 { user: { id, nickname }, accessToken, refreshToken, expiresIn }` | `429 RATE_LIMITED` (por IP/h e global/h), `503 SERVICE_UNAVAILABLE`                                        |
| `POST /auth/refresh`                | não    | `200 { accessToken, refreshToken, expiresIn }`                         | `400 INVALID_BODY`; `401 INVALID_REFRESH_TOKEN` (desconhecido, expirado, reuso, revogado); `429`; `503`    |
| `POST /auth/logout`                 | Bearer | `204` sem corpo. Corpo `{ refreshToken }` ou `{ all: true }`           | `400 INVALID_BODY`; `401 UNAUTHORIZED`; `429`; `503`. Refresh inválido ou de outro usuário também dá `204` |
| `POST /auth/link`                   | Bearer | —                                                                      | `401 UNAUTHORIZED`; `501 NOT_IMPLEMENTED` (stub, Fase 3)                                                   |
| `POST /auth/google`, `/auth/apple`  | não    | —                                                                      | `501 NOT_IMPLEMENTED` (stub, Fase 3)                                                                       |
| `GET /me`                           | Bearer | `200 { id, nickname, provider, avatar, createdAt }`                    | `401 UNAUTHORIZED`                                                                                         |
| `PUT /me`                           | Bearer | `200 { nickname }`                                                     | `400 INVALID_BODY` ou `INVALID_NICKNAME`; `409 NICKNAME_TAKEN`                                             |
| `PUT /me/avatar`                    | Bearer | `200 { avatar }`                                                       | `400 INVALID_BODY` ou `INVALID_AVATAR` (objeto plano, até 32 chaves)                                       |
| `GET /me/partners/:partnerId/codes` | Bearer | `200 { codes }`                                                        | `400 INVALID_PARTNER`; `403 NOT_PARTNERS` (sem partida finalizada juntos)                                  |
| `PUT /me/partners/:partnerId/codes` | Bearer | `200 { codes }`                                                        | `400 INVALID_PARTNER`, `INVALID_BODY` ou `INVALID_CODES`; `403 NOT_PARTNERS`                               |
| `GET /health`                       | não    | `200 { status, protocol }`                                             | —                                                                                                          |

`GET /matches` NÃO existe como rota (o repositório tem `listForUser`, mas nenhuma rota o chama). **a confirmar**: se o histórico entra no REST na Fase 3 ou na 6.

## 3. REST: lobby (mesas por código e fila pública)

Todas as rotas exigem `Authorization: Bearer`. Opções aceitas: só `RoomOptions` (`variant`, `format`, `ironHand`, `visibility`); campo extra é rejeitado com `400 INVALID_OPTIONS`. `bo3` só com `visibility: 'private'` (`BO3_REQUIRES_PRIVATE`). Semente, prazos e assentos nunca vêm do cliente.

| Rota                | Corpo                                     | Sucesso                                                                        | Erros (status e código)                                                                                                                                                                                             |
| ------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /tables`      | `RoomOptions` com `visibility: 'private'` | `201 { code, reservation }` (o criador é o 1º assento)                         | `400 INVALID_OPTIONS`; `409 ALREADY_IN_TABLE`; `429 RATE_LIMITED`; `503 UNAVAILABLE`                                                                                                                                |
| `POST /tables/join` | `{ code }` (8 caracteres)                 | `200 { reservation }`                                                          | `400 INVALID_CODE` (formato, sem consulta); `404 TABLE_UNAVAILABLE` (inexistente, cheia, em partida ou fechada: o MESMO erro para todos); `409 ALREADY_IN_TABLE`; `429` com `Retry-After` (bloqueio por tentativas) |
| `POST /queue`       | `RoomOptions` `public` + `single`         | `200 { status }` (`queued` ou já `matched`)                                    | `400 INVALID_OPTIONS`; `429 QUEUE_COOLDOWN` (com `Retry-After`); `503 QUEUE_FULL`; `409 ALREADY_IN_TABLE`                                                                                                           |
| `GET /queue`        | —                                         | `200 { status }`: `idle`, `queued`, `matched` (traz `reservation`) ou `seated` | `401 UNAUTHORIZED`                                                                                                                                                                                                  |
| `POST /queue/leave` | —                                         | `200 { status }` (o estado real depois de sair)                                | `401 UNAUTHORIZED`                                                                                                                                                                                                  |

- **Reserva de assento**: `reservation` é consumida no cliente com `client.consumeSeatReservation(reservation)` (SDK 0.18). Consuma em até 15 s; depois disso o `GET /queue` emite outra. O `ticket` de entrada por código vale 16 s.
- **Código de mesa**: 8 símbolos do alfabeto `ROOM_CODE_ALPHABET` (31 símbolos, sem `0`, `O`, `1`, `I`, `L`). Use `isValidRoomCode` do protocol para validar na UI.
- **Fila**: uma entrada por usuário; entrar de novo é idempotente. Quem casa e não senta, ou desiste depois de casar, entra em cooldown de 60 s (`QUEUE_REENTRY_COOLDOWN_SECONDS`) **a confirmar**: valor padrão assumido.
- **Piso de latência**: as recusas de `POST /tables/join` esperam um tempo mínimo (`JOIN_MIN_LATENCY_MS`, 150 ms mais jitter), para não revelar se a mesa existe.
- **Direto no matchmaker**: `POST /matchmake/create|join|joinOrCreate/truco` responde `403 USE_LOBBY` (depois de validar o JWT: `401 UNAUTHORIZED` ou `503`).

## 4. Entrada na sala (`POST /matchmake/*` e WebSocket)

| Momento                                                           | Status e código                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /matchmake/*` sem JWT válido                                | `401 UNAUTHORIZED` (ou `503 SERVICE_UNAVAILABLE` se a dependência caiu)  |
| Limite por IP (`MATCHMAKE_RATE_LIMIT_PER_MIN`)                    | `429 RATE_LIMITED` com `Retry-After`                                     |
| `POST /matchmake/reconnect` com token de assento de outro usuário | `403 FORBIDDEN`                                                          |
| Concessão de lobby inválida (`onCreate`)                          | `403 FORBIDDEN`                                                          |
| Upgrade de reconexão sem JWT ou com JWT expirado                  | `401` (o cliente renova em `/auth/refresh` e reconecta)                  |
| Upgrade de reconexão de outro `userId`                            | `403`                                                                    |
| Upgrade com `Host` inválido ou sem sessão/sala válida             | `400`                                                                    |
| Usuário banido da mesa (expulso por abuso)                        | `403 BANNED` (em memória da sala)                                        |
| Mesa cheia, ou assento que não é do dono no retorno               | `409 ROOM_FULL`                                                          |
| Entrada num assento que não está com bot, ou sala sem série       | `409 ALREADY_SEATED`                                                     |
| Opções inválidas na criação da sala                               | `400` com o código do erro (`INVALID_OPTIONS` ou `BO3_REQUIRES_PRIVATE`) |

Quem não é o dono de um assento não o recupera: o servidor recusa antes de gastar a vaga.

## 5. Mensagens Colyseus: cliente → servidor

Enviadas com `room.send(tipo, payload)`. O payload NUNCA leva `seat`: o servidor deriva o assento da sessão, e um campo extra (inclusive `seat`) resulta em `error INVALID_PAYLOAD`.

| Tipo          | Payload                                                          | Observação                                                                                   |
| ------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `play`        | `{ card: { rank, suit }, covered? }`                             | `covered: true` joga carta coberta (a partir da 2ª vaza)                                     |
| `playBlind`   | `{ index }` (0 a 2)                                              | Mão de ferro: carta escolhida às cegas, por posição                                          |
| `bet`         | `{}`                                                             | O servidor escolhe `callBet` ou `raiseBet` pelo estado. Quem pede ou aumenta é sempre humano |
| `accept`      | `{}`                                                             | Aceita o truco pendente                                                                      |
| `run`         | `{}`                                                             | Corre do truco pendente (a decisão da mão de onze/dez é `special`)                           |
| `special`     | `{ decision: 'play' \| 'run' }`                                  | Decisão da mão de onze/dez                                                                   |
| `signal`      | `{ signalId }`                                                   | Sinal de truco, público na mesa. Id de `SIGNAL_IDS`                                          |
| `sfx`         | `{ sfxId }`                                                      | Efeito sonoro. Id de `SFX_IDS`                                                               |
| `chat`        | `{ scope: 'partner' \| 'table', text }` ou `{ scope, phraseId }` | Texto OU frase rápida, nunca os dois. Ver seção 9                                            |
| `voteCancel`  | `{}`                                                             | Voto para cancelar a série (unanimidade dos humanos conectados)                              |
| `voteRematch` | `{}`                                                             | Voto por "Jogar de novo" na janela de revanche (ver abaixo). Chave extra: `INVALID_PAYLOAD`  |
| `ready`       | `{}`                                                             | Aceito e ignorado pelo servidor (reservado)                                                  |

Mensagem fora do formato é `error INVALID_PAYLOAD` e conta para a expulsão (seção 8). Id fora do catálogo: `INVALID_SIGNAL` ou `INVALID_SFX`.

## 6. Mensagens Colyseus: servidor → cliente

| Tipo        | Payload                                            | Quando                                                                                |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `event`     | `{ seq, at, event }` (`event` é `PublicGameEvent`) | Cada evento do motor, um envio por cliente. A carta coberta alheia vem sem identidade |
| `signal`    | `{ seat, signalId, at }`                           | Sinal de um assento, para os 4                                                        |
| `sfx`       | `{ seat, sfxId, at }`                              | Efeito sonoro, para os 4                                                              |
| `chat`      | `{ scope, seat, text \| phraseId, at }`            | `partner`: só a dupla e o eco ao remetente. `table`: os 4                             |
| `presence`  | `{ seat, status: 'online' \| 'away' \| 'bot' }`    | Mudança de presença de um assento                                                     |
| `turnTimer` | `{ seat, deadlineAt }`                             | Prazo do turno atual (epoch ms). Turno de 20 s                                        |
| `error`     | `{ code }` (só `code`; sem texto de erro)          | Mensagem recusada. O estado não muda                                                  |

`PublicGameEvent` (camelCase, igual ao motor): `gameStarted`, `handStarted` (com `special`: `normal`, `maoDeOnze` ou `maoDeFerro`), `cardPlayed` (`card` é `null` se coberta), `trickDecided`, `betCalled`, `betAccepted`, `betRaised`, `betRun`, `specialDecided`, `handDecided`, `gameDecided`, `seriesDecided`, `seriesCancelled`. O aceite implícito em `betRaised` não gera `betAccepted` (o cliente infere).

### Estado (schema da mesa)

`TableState` vai por patch. Cada cliente recebe o estado compartilhado (`roomCode`, `options`, `phase`, `players[4]`, `series`, `game`, `hand`, `turnDeadlineAt`, `cancelVotes`, `rematchVotes`, `rematchDeadlineAt`, `matchNumber`) e, no bloco `privates`, só o do próprio assento (`StateView`): `hand` (cartas), `legalActions` (ids como `play:<rank><suit>`, `playCovered:…`, `playBlind:<i>`, `bet`, `accept`, `run`, `specialPlay`, `specialRun`), `partnerCards` (decisão de onze/dez) e `ownCovered` (identidade das próprias cartas cobertas). Na mão de ferro, `hand` fica vazio e vale só `handSize`. `userId` não está no estado.

### Revanche ("Jogar de novo")

Contrato aditivo (`PROTOCOL_VERSION` segue 2). Quando a série termina COM vencedor (`seriesDecided`), a sala abre uma janela de `rematchWindowMs` (padrão `DEFAULT_REMATCH_WINDOW_MS` = 30 s) e publica `rematchDeadlineAt` (epoch ms; 0 = sem janela). Série cancelada ou abandonada não abre janela: a sala fecha após `finishDelayMs` como antes.

- `voteRematch` vale da abertura da janela até `rematchDeadlineAt`; `rematchVotes` lista os assentos votantes (ordenados). Votam os humanos conectados; bot e assento em reconexão não votam nem bloqueiam. Voto idempotente, sem "desvoto". Mínimo `REMATCH_MIN_HUMANS` = 2 humanos conectados; fora disso: `error { code: 'REMATCH_NOT_AVAILABLE' }`.
- Quem sai na janela vira bot e o voto dele é descartado; a unanimidade dos que restam (mínimo 2) inicia a revanche. Vale também em mesa da fila pública (formato segue `single`). Sem teto de revanches.
- Unanimidade: mesma sala, assentos e duplas; placares e `series` zerados; `matchNumber` +1 (1 na primeira partida); `rematchVotes` limpo e `rematchDeadlineAt = 0`; nova semente (nunca vai ao cliente); o pé da 1ª mão é `nextSeat` do pé da última mão da partida anterior (rodízio). `seq` e `eventLog` continuam; a nova partida começa com `gameStarted`, `handStarted` etc. como a primeira, e `phase` volta a `playing`.
- Expirando sem unanimidade, a sala fecha.
- Persistência: cada partida vira uma linha em `matches` (mesmo `roomCode`, semente própria, `options.matchNumber`). Sem migração.
- Reconexão na janela: o estado completo traz `rematchVotes` e `rematchDeadlineAt`.
- Assento em reconexão (socket caído) NÃO bloqueia nem vota: o humano caído pode voltar numa partida para a qual não votou (estado completo com `matchNumber` 2 e replay dos eventos perdidos). Quem já era bot ao começar a partida grava `botFrom` desde o início dela.
- O teto de reconexões por assento (`maxReconnects`) zera a cada partida. Não há teto de `matchNumber`.

## 7. Presença, replay e salto de `seq`

- **Presença**: `online` (conectado), `away` (queda na janela de 60 s, ou 2 expirações seguidas do turno), `bot` (o servidor joga pelo assento). Uma ação aceita volta a `online`.
- **Reconexão**: a `sessionId` é a mesma. O servidor envia o estado completo filtrado, depois os eventos com `seq` maior que o último recebido por aquele assento (em ordem), depois os `presence` dos demais assentos e o `turnTimer`.
- **`seq`**: contador por sala, sem reinício. Um salto de `seq` no cliente é pedido de **resincronização pelo estado**, não de espera: o replay é do log em memória, com teto de 5000 eventos. Acima do teto os antigos saem e não há replay parcial.
- **Entrega em socket morto**: evento enviado a um socket que já caiu conta como entregue. Por isso o salto de `seq` é o sinal confiável.
- **Carta própria coberta** nunca vem pelo replay: vem em `privates[seat].ownCovered` no estado completo.

## 8. Cooldowns, limites e expulsão

| Limite                                                                | Valor                                                  | Resposta                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Sinal por assento                                                     | 3 s (`SIGNAL_COOLDOWN_MS`)                             | `error RATE_LIMITED` ao remetente; sem strike                  |
| Efeito sonoro por assento                                             | 5 s (`SFX_COOLDOWN_MS`)                                | `error RATE_LIMITED`; sem strike                               |
| Chat por assento (partner e table)                                    | 2 s (`CHAT_COOLDOWN_MS`)                               | `error RATE_LIMITED`; texto recusado também consome o cooldown |
| Intervalo entre ações do mesmo assento                                | 150 ms (`ACTION_MIN_INTERVAL_MS`)                      | `error RATE_LIMITED`                                           |
| Mensagens por segundo por conexão                                     | 30                                                     | acima disso o core derruba a conexão (`CloseCode.WITH_ERROR`)  |
| Tamanho máximo de mensagem                                            | 1024 bytes (`MAX_MESSAGE_BYTES`, limite do transporte) | conexão cai acima disso                                        |
| Payload inválido (`INVALID_PAYLOAD`, `INVALID_SIGNAL`, `INVALID_SFX`) | 5 em 10 s                                              | expulsão com código 1008 e assento vai para o bot, sem janela  |

Sinal, sfx e chat da dupla só valem em `playing` (série em andamento). Fora disso, são ignorados em silêncio, sem erro e sem gastar cooldown. O chat da mesa vale em qualquer fase.

## 9. Chat e texto livre

- Texto: até 140 caracteres (`CHAT_MAX_LENGTH`). Valide na UI com `parseClientMessage` de `@trucaco/protocol`, passando `{ type: 'chat', scope, text }` (é a mesma função que o servidor usa). A validação do cliente é só UX: o servidor decide de novo.
- Texto recusado (controle, formatação e zero-width, como ZWJ, marcas bidi, mais de 3 marcas combinantes seguidas, ou vazio depois da limpeza) responde `error CHAT_BLOCKED`. Não é abuso: não conta strike nem expulsa.
- **Renderize chat só como `<Text>` (texto puro)**. Nunca HTML, `dangerouslySetInnerHTML`, WebView nem Markdown. O servidor não escapa o texto (ele chega como foi digitado, já limpo de controles).
- Texto de chat nunca vai a log, ao schema, ao replay ou ao banco.

## 10. Erros (`error { code }`)

**`ErrorCode` do protocol** (`packages/protocol/src/errors.ts`):

- Espelho do motor (`RuleErrorCode`): `INVALID_SEAT`, `HAND_FINISHED`, `NOT_YOUR_TURN`, `CARD_NOT_IN_HAND`, `COVERED_NOT_ALLOWED`, `BLIND_ONLY`, `NOT_BLIND_HAND`, `BET_NOT_ALLOWED`, `BET_PENDING`, `NO_PENDING_BET`, `SPECIAL_DECISION_PENDING`, `NO_SPECIAL_DECISION`, `GAME_FINISHED`, `SERIES_FINISHED`.
- Do servidor: `NOT_SEATED`, `ROOM_FULL`, `INVALID_PAYLOAD`, `RATE_LIMITED`, `INVALID_SIGNAL`, `INVALID_SFX`, `CHAT_BLOCKED`, `REMATCH_NOT_AVAILABLE` (voto de revanche com a série sem vencedor, janela fechada ou menos de 2 humanos conectados; não conta strike).
- Declarados mas NÃO emitidos pela sala hoje: `ROOM_NOT_FOUND` e `TOKEN_EXPIRED`. **a confirmar**: se ficam, são reservados para o cliente. `UNAUTHORIZED` e `INVALID_CODE` também estão nesse tipo, mas só saem em respostas REST.

**Só do servidor, em respostas HTTP** (não estão no `ErrorCode` do WebSocket): `USE_LOBBY`, `ALREADY_IN_TABLE`, `TABLE_UNAVAILABLE`, `QUEUE_COOLDOWN`, `QUEUE_FULL`, `UNAVAILABLE`, `INVALID_OPTIONS`, `BO3_REQUIRES_PRIVATE`, `INVALID_REFRESH_TOKEN`, `NICKNAME_TAKEN`, `INVALID_NICKNAME`, `INVALID_AVATAR`, `INVALID_PARTNER`, `INVALID_CODES`, `NOT_PARTNERS`, `INVALID_BODY`, `INVALID_JSON`, `INVALID_INPUT`, `NOT_IMPLEMENTED`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE` (415), `PAYLOAD_TOO_LARGE` (413), `CORS_FORBIDDEN` (403), `FORBIDDEN`, `BANNED`, `ALREADY_SEATED`, `INTERNAL` (500, genérico).

**Regra geral**: o servidor nunca repassa stack, mensagem de exceção nem eco da entrada. Quem traduz o código para texto é o cliente.

## 11. Checklist para o cliente (Fase 3)

1. JWT só em `Authorization` ou `trucaco.bearer`. Nunca `client.auth.token`.
2. Refresh em fila única; persista o par novo antes de qualquer outra chamada.
3. `503` mantém a sessão; `401` na reconexão dispara refresh + `sdk.reconnect`.
4. Envie só o payload do catálogo, sem `seat`.
5. Salto de `seq` → resincronizar pelo estado.
6. Chat com `<Text>`, validado com `parseClientMessage`.
7. Não guarde nem exiba `userId` como identidade da mesa: a identidade pública é `seat` + `nickname`.
