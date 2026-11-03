# Protocolo cliente ↔ servidor

Referência curta do contrato entre o cliente (`apps/mobile`, Fase 3) e o servidor (`apps/server`). Fonte da verdade: `packages/protocol` (tipos, catálogos e `parseClientMessage`), `apps/server/src/http/` (REST) e `apps/server/src/rooms/TrucoRoom.ts` (sala). Operação, variáveis de ambiente e limites detalhados: `apps/server/README.md`. Versão do protocolo: `PROTOCOL_VERSION = 3` (`GET /health` devolve `{ "status": "ok", "protocol": 3 }`).

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
- **Refresh recusado** (`401 INVALID_REFRESH_TOKEN`): a sessão acabou. A camada de rede do app sintetiza `TOKEN_EXPIRED` e cria um convidado novo (`apps/mobile/src/net/`).

## 2. REST: autenticação e perfil

Toda resposta de erro tem o formato `{ "error": { "code": "..." } }`. Corpo JSON de até 8 KB e `Content-Type: application/json`.

| Rota                                | Auth   | Sucesso                                                                | Erros (status e código)                                                                                            |
| ----------------------------------- | ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `POST /auth/guest`                  | não    | `201 { user: { id, nickname }, accessToken, refreshToken, expiresIn }` | `429 RATE_LIMITED` (por IP/h e global/h), `503 SERVICE_UNAVAILABLE`                                                |
| `POST /auth/refresh`                | não    | `200 { accessToken, refreshToken, expiresIn }`                         | `400 INVALID_BODY`; `401 INVALID_REFRESH_TOKEN` (desconhecido, expirado, reuso, revogado); `429`; `503`            |
| `POST /auth/logout`                 | Bearer | `204` sem corpo. Corpo `{ refreshToken }` ou `{ all: true }`           | `400 INVALID_BODY`; `401 UNAUTHORIZED`; `429`; `503`. Refresh inválido ou de outro usuário também dá `204`         |
| `POST /auth/link`                   | Bearer | —                                                                      | `401 UNAUTHORIZED`; `501 NOT_IMPLEMENTED` (stub, Fase 3)                                                           |
| `POST /auth/google`, `/auth/apple`  | não    | —                                                                      | `501 NOT_IMPLEMENTED` (stub, Fase 3)                                                                               |
| `GET /me`                           | Bearer | `200 { id, nickname, provider, avatar, createdAt }`                    | `401 UNAUTHORIZED`                                                                                                 |
| `PUT /me`                           | Bearer | `200 { nickname }`                                                     | `400 INVALID_BODY` ou `INVALID_NICKNAME`; `409 NICKNAME_TAKEN`                                                     |
| `PUT /me/avatar`                    | Bearer | `200 { avatar }`                                                       | `400 INVALID_BODY` ou `INVALID_AVATAR` (fora do catálogo de partes, ver "Avatar")                                  |
| `GET /me/partners/:partnerId/codes` | Bearer | `200 { codes }`                                                        | `400 INVALID_PARTNER` (sem partida finalizada juntos devolve `{ codes: {} }`, sem 403: nada vaza)                  |
| `PUT /me/partners/:partnerId/codes` | Bearer | `200 { codes }`                                                        | `400 INVALID_PARTNER`, `INVALID_BODY` ou `INVALID_CODES` (texto recusado pela limpeza do chat); `403 NOT_PARTNERS` |
| `GET /health`                       | não    | `200 { status, protocol }`                                             | —                                                                                                                  |

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
| `setCode`     | `{ signalId, meaning }`                                          | Combinado da dupla: significado de um sinal (vazio apaga). Ver "Combinado da dupla"          |
| `ready`       | `{}`                                                             | Não inicia a partida. O cliente o envia ao ligar os handlers; o servidor reenvia `codes`     |

Mensagem fora do formato é `error INVALID_PAYLOAD` e conta para a expulsão (seção 8). Id fora do catálogo: `INVALID_SIGNAL` ou `INVALID_SFX`.

## 6. Mensagens Colyseus: servidor → cliente

| Tipo        | Payload                                            | Quando                                                                                |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `event`     | `{ seq, at, event }` (`event` é `PublicGameEvent`) | Cada evento do motor, um envio por cliente. A carta coberta alheia vem sem identidade |
| `signal`    | `{ seat, signalId, at }`                           | Sinal de um assento, para os 4                                                        |
| `sfx`       | `{ seat, sfxId, at }`                              | Efeito sonoro, para os 4                                                              |
| `chat`      | `{ scope, seat, text \| phraseId, at }`            | `partner`: só a dupla e o eco ao remetente. `table`: os 4                             |
| `codes`     | `{ codes, by, at }`                                | Combinado da dupla, SÓ aos 2 assentos do time (ver "Combinado da dupla")              |
| `presence`  | `{ seat, status: 'online' \| 'away' \| 'bot' }`    | Mudança de presença de um assento                                                     |
| `turnTimer` | `{ seat, deadlineAt }`                             | Prazo do turno atual (epoch ms). Turno de 20 s                                        |
| `error`     | `{ code }` (só `code`; sem texto de erro)          | Mensagem recusada. O estado não muda                                                  |

`PublicGameEvent` (camelCase, igual ao motor): `gameStarted`, `handStarted` (com `special`: `normal`, `maoDeOnze` ou `maoDeFerro`), `cardPlayed` (`card` é `null` se coberta), `trickDecided`, `betCalled`, `betAccepted`, `betRaised`, `betRun`, `specialDecided`, `handDecided`, `gameDecided`, `seriesDecided`, `seriesCancelled`. O aceite implícito em `betRaised` não gera `betAccepted` (o cliente infere).

### Estado (schema da mesa)

`TableState` vai por patch. Cada cliente recebe o estado compartilhado (`roomCode`, `options`, `phase`, `players[4]`, `series`, `game`, `hand`, `turnDeadlineAt`, `cancelVotes`, `rematchVotes`, `rematchDeadlineAt`, `matchNumber`) e, no bloco `privates`, só o do próprio assento (`StateView`): `hand` (cartas), `legalActions` (ids como `play:<rank><suit>`, `playCovered:…`, `playBlind:<i>`, `bet`, `accept`, `run`, `specialPlay`, `specialRun`), `partnerCards` (decisão de onze/dez) e `ownCovered` (identidade das próprias cartas cobertas). Na mão de ferro, `hand` fica vazio e vale só `handSize`. `userId` não está no estado.

#### Campos públicos de `hand` (aditivos, visíveis a todos)

Vêm no estado compartilhado, para os 4 assentos. Fonte: `apps/server/src/game/projection.ts` e `schema.ts`; tipo em `packages/protocol/src/state.ts`.

| Campo                        | Valor                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hand.manilhaRank`           | Paulista: rank da manilha, derivada da vira (vira + 1). `''` no Mineiro e antes da primeira mão.                                                                                                                                                         |
| `hand.manilhaCards`          | Mineiro: as 4 manilhas fixas em `<rank><suit>`, da mais forte para a mais fraca (ex.: `4paus`). Vazio no Paulista.                                                                                                                                       |
| `hand.nextBetValue`          | Valor que a dupla de quem age ganha ao pedir ou aumentar agora (degrau da escada da variante). `0` = indisponível (escada esgotada, ou a mão não aceita aposta neste momento). Em aposta pendente, é o degrau seguinte ao pendente (o aumento).          |
| `hand.pendingValue`          | Valor da aposta pendente (degrau de `pending.toLevel`). `0` se não há aposta pendente.                                                                                                                                                                   |
| `hand.actingSeat`            | Assento cuja decisão é esperada agora. Em aposta pendente é `pending.responderSeat`. `-1` na decisão de onze/dez (dois decidem) e se ninguém age.                                                                                                        |
| `hand.pending.responderSeat` | Único assento que responde (aceita, corre ou aumenta) a aposta pendente. Truco: o assento seguinte ao de quem pediu; aumento (retruco etc.): quem fez o pedido anterior. O parceiro dele e a dupla de quem pediu só assistem (`NOT_YOUR_TURN`). Aditivo. |
| `hand.specialAccepted`       | Onze/dez: assentos da dupla que já aceitaram jogar (público). Vazio fora de `phase === 'specialDecision'`. Aditivo.                                                                                                                                      |

Semântica de `actingSeat`:

- No turno normal, `actingSeat` é igual a `hand.turn`.
- **Aposta pendente**: `actingSeat === pending.responderSeat` (NÃO é `turn`). Só esse assento tem `accept`, `run` e `bet` (aumento) em `legalActions`; os demais recebem `error NOT_YOUR_TURN` e o estado não muda. A UI não mostra botões de resposta ao parceiro do respondedor (texto sugerido: "Seu parceiro responde") nem a quem pediu.
- **Decisão de onze/dez** (`phase === 'specialDecision'`, `special === 'maoDeOnze'`): os DOIS da dupla (`specialTeam`) decidem, em qualquer ordem. `actingSeat` é `-1`. Cada um tem `specialPlay` e `specialRun` até aceitar; `specialAccepted` lista quem já aceitou (quem aceitou fica sem ações e vê "Aguardando o parceiro"). A mão só vira `playing` quando os dois aceitam. `specialRun` de quem ainda não aceitou encerra a mão na hora (a dupla corre). Cada aceite emite `specialDecided { decision: 'play' }`; o primeiro NÃO muda `phase`.
- **Mão de ferro** (`special === 'maoDeFerro'`) não tem decisão: `phase` é `playing`, `actingSeat` é `turn` e as cartas são às cegas.
- O cliente habilita botões pelo `legalActions` do próprio assento, não por `turn` nem por `actingSeat`.
- **Prazo**: o `turnTimer` da decisão de onze/dez traz o menor assento que ainda não decidiu, mas o prazo vale para os dois; ao estourar, o motor joga (`playSpecial`) por todos os que faltam. Em aposta pendente o prazo é do respondedor (estourar = correr). Cada ação aceita reinicia o prazo.
- **Bot de ausência**: age pelo respondedor da aposta e por cada decisor-bot pendente do onze/dez (`botAction`: correr da aposta, aceitar o onze/dez; nunca pede nem aumenta).

`partnerCards` (privado): só na decisão de onze/dez sem ferro, e os DOIS da dupla que decide veem as cartas um do outro (inclusive depois de o primeiro aceitar, até o segundo aceitar). Fora da decisão fica vazio; na mão de ferro nunca há cartas visíveis. Adversários nunca recebem cartas alheias.

Compatibilidade: `pending.responderSeat` e `hand.specialAccepted` são aditivos; `PROTOCOL_VERSION` segue 2. O que mudou é só a semântica de `actingSeat` na decisão de onze/dez (agora `-1`) e de quem tem ação legal (um respondedor em vez de dois).

### Revanche ("Jogar de novo")

Contrato aditivo (`PROTOCOL_VERSION` segue 2). Quando a série termina COM vencedor (`seriesDecided`), a sala abre uma janela de `rematchWindowMs` (padrão `DEFAULT_REMATCH_WINDOW_MS` = 30 s) e publica `rematchDeadlineAt` (epoch ms; 0 = sem janela). Série cancelada ou abandonada não abre janela: a sala fecha após `finishDelayMs` como antes.

Confirmado pelo usuário em 2026-11-02: o **rodízio do pé** vale na revanche e entre jogos da série `bo3` (ver `docs/regras-truco.md`). A janela de 30 s, o mínimo de 2 humanos conectados e a unanimidade foram **confirmados pelo usuário** em 2026-11-02.

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

| Limite                                                                | Valor                                                  | Resposta                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Sinal por assento                                                     | 3 s (`SIGNAL_COOLDOWN_MS`)                             | `error RATE_LIMITED` ao remetente; sem strike                                   |
| Efeito sonoro por assento                                             | 5 s (`SFX_COOLDOWN_MS`)                                | `error RATE_LIMITED`; sem strike                                                |
| Chat por assento (partner e table)                                    | 2 s (`CHAT_COOLDOWN_MS`)                               | `error RATE_LIMITED`; texto recusado também consome o cooldown                  |
| Combinado (`setCode`) por assento                                     | 1 s (`CODES_COOLDOWN_MS`)                              | `error RATE_LIMITED`; texto recusado (`CHAT_BLOCKED`) também consome o cooldown |
| Intervalo entre ações do mesmo assento                                | 150 ms (`ACTION_MIN_INTERVAL_MS`)                      | `error RATE_LIMITED`                                                            |
| `ready` (reenvio de `codes`) por assento                              | 500 ms (`READY_MIN_INTERVAL_MS`, só no servidor)       | excesso ignorado em silêncio; não consome nem sofre o limite de 150 ms          |
| Mensagens por segundo por conexão                                     | 30                                                     | acima disso o core derruba a conexão (`CloseCode.WITH_ERROR`)                   |
| Tamanho máximo de mensagem                                            | 1024 bytes (`MAX_MESSAGE_BYTES`, limite do transporte) | conexão cai acima disso                                                         |
| Payload inválido (`INVALID_PAYLOAD`, `INVALID_SIGNAL`, `INVALID_SFX`) | 5 em 10 s                                              | expulsão com código 1008 e assento vai para o bot, sem janela                   |

`voteRematch` também passa por esse limite de 150 ms (o servidor aplica o controle antes de tratar `voteCancel` e `voteRematch`). Pendência de produto: isentar o voto de revanche.

**Bot sinaliza (só bot de verdade).** O bot de ausência (assento de humano que caiu e virou bot, que mantém apelido e avatar do humano) NÃO sinaliza; o cooldown do humano também não é gasto por bot. Ao começar cada mão (`handStarted`), cada assento de bot de vaga (bot desde o início) sorteia com 30 % de chance (`DEFAULT_BOT_SIGNAL_CHANCE`) 1 sinal aleatório de `SIGNAL_IDS` e o transmite como qualquer `signal`, com o `seat` do bot. Respeita o mesmo cooldown de 3 s do assento (em cooldown, não sinaliza) e só vale com a série em jogo. O sorteio não usa o RNG da partida (baralho e replay não mudam). O bot continua sem pedir nem aumentar aposta. **Hoje o sorteio não dispara:** nenhum caminho do servidor cria vaga de bot (`botSeats` só recebe o bot de ausência), então nenhum bot sinaliza.

Sinal e sfx só valem em `playing` (série em andamento); fora disso são ignorados em silêncio, sem erro e sem gastar cooldown. O chat da mesa vale em qualquer fase. O chat da dupla vale na espera (antes da série existir) e em `playing`; depois do fim da série é ignorado. `setCode` vale em qualquer fase com a dupla humana sentada.

## 9. Chat e texto livre

- Texto: até 140 caracteres (`CHAT_MAX_LENGTH`). Valide na UI com `parseClientMessage` de `@trucaco/protocol`, passando `{ type: 'chat', scope, text }` (é a mesma função que o servidor usa). A validação do cliente é só UX: o servidor decide de novo.
- Texto recusado (controle, formatação e zero-width, como ZWJ, marcas bidi, mais de 3 marcas combinantes seguidas, ou vazio depois da limpeza) responde `error CHAT_BLOCKED`. Não é abuso: não conta strike nem expulsa.
- **Renderize chat só como `<Text>` (texto puro)**. Nunca HTML, `dangerouslySetInnerHTML`, WebView nem Markdown. O servidor não escapa o texto (ele chega como foi digitado, já limpo de controles).
- Texto de chat nunca vai a log, ao schema, ao replay ou ao banco.

### Combinado da dupla (`setCode` e `codes`)

A sala de espera é a "preparação": a dupla combina o significado dos sinais por chat da dupla (já liberado na espera) e pelo combinado, e o combinado também pode ser editado durante a partida.

- `setCode { signalId, meaning }`: `signalId` de `SIGNAL_IDS` (fora do catálogo: `INVALID_PAYLOAD`, com strike); `meaning` passa pela MESMA limpeza do chat com teto `PARTNER_CODE_MAX_LENGTH` (60 code points). `meaning` vazio (ou só espaços) apaga o combinado daquele sinal. Texto recusado (controle, ZWJ, bidi, zalgo, acima de 60): `error CHAT_BLOCKED`, sem strike. `seat` no payload é `INVALID_PAYLOAD`. Cooldown por assento `CODES_COOLDOWN_MS` (1 s): `RATE_LIMITED`.
- `codes { codes, by, at }`: `codes` é o mapa COMPLETO `{ [signalId]?: string }` da dupla; `by` é o assento que editou, ou `-1` quando veio do banco, de reconexão ou do `ready`. Vai SÓ aos sockets vivos dos 2 assentos do time (destino pelo `teamOf` do servidor, inclusive o eco a quem editou). Adversário nunca recebe; bot de ausência e assento caído não recebem e nada é enfileirado. Nunca há espectadores.
- Quando chega: ao formar o par humano na mesa (carrega `partner_codes` do banco; sem registro, mapa vazio), a cada edição, ao reconectar ou retomar o assento e quando o cliente envia `ready` (o baseline enviado no `onJoin` pode chegar antes de o cliente ligar o handler: envie `ready` depois de registrar `onMessage('codes')`). Se um dos dois assentos é liberado na espera, o parceiro que ficou recebe `codes` vazio (`by: -1`) e o par novo recarrega.
- Sem parceiro humano sentado quando o par se forma (parceiro ausente ou vazio), `setCode` é ignorado em silêncio. Se o parceiro cai DEPOIS e vira bot de ausência, o par continua: a edição do humano que ficou é aceita, ecoada só a ele e gravada (quando o par já está vinculado). Edição de assento que virou bot é ignorada.
- Persistência: par que já jogou uma partida finalizada junto grava (upsert em `partner_codes`) a cada edição, em segundo plano. Par novo grava ao fim da 1ª partida finalizada (série cancelada não grava). Falha do banco é logada (sem ids nem texto) e não afeta a mesa. A gravação é coalescida: no máximo 1 em voo por par; edições feitas durante ela só marcam o par como sujo e a rodada seguinte grava o estado mais recente. A sala grava SÓ as chaves editadas nesta mesa, aplicadas por cima do mapa atual do banco (lido na hora da gravação), então um `PUT /me/partners/:partnerId/codes` feito durante a partida não é desfeito (o contrário não vale: o PUT substitui o mapa inteiro). Valores legados recusados pela limpeza do chat (bidi, ZWJ, controle, acima de 60) são descartados na leitura do banco, no `codes` enviado ao parceiro e na gravação. O eco `codes` sai antes da gravação; se a gravação falhar, ou a leitura do banco falhou ao formar o par (a sala então nunca grava), o último assento que editou recebe `error { code: 'CODE_NOT_SAVED' }` (sem detalhe do banco): o combinado vale só nesta mesa. Aditivo; o cliente deve mostrar "não foi salvo". A rota REST `PUT /me/partners/:partnerId/codes` usa a mesma limpeza (teto 60): recusa com `400 INVALID_CODES`, vazio apaga a chave e a resposta traz o mapa limpo. A rota `GET` devolve o que está gravado sem reaplicar a limpeza: um valor legado de até 140 caracteres volta inteiro (só leitura; a sala é que o descarta).
- O texto do combinado nunca vai a log, ao schema, ao `eventLog`, ao replay nem ao banco da partida (`matches`). Renderize como `<Text>`. `PROTOCOL_VERSION` segue 2 (mudança aditiva).

## 10. Erros (`error { code }`)

**`ErrorCode` do protocol** (`packages/protocol/src/errors.ts`):

- Espelho do motor (`RuleErrorCode`): `INVALID_SEAT`, `HAND_FINISHED`, `NOT_YOUR_TURN`, `CARD_NOT_IN_HAND`, `COVERED_NOT_ALLOWED`, `BLIND_ONLY`, `NOT_BLIND_HAND`, `BET_NOT_ALLOWED`, `BET_PENDING`, `NO_PENDING_BET`, `SPECIAL_DECISION_PENDING`, `NO_SPECIAL_DECISION`, `GAME_FINISHED`, `SERIES_FINISHED`.
- Do servidor: `NOT_SEATED`, `ROOM_FULL`, `INVALID_PAYLOAD`, `RATE_LIMITED`, `INVALID_SIGNAL`, `INVALID_SFX`, `CHAT_BLOCKED`, `REMATCH_NOT_AVAILABLE` (voto de revanche com a série sem vencedor, janela fechada ou menos de 2 humanos conectados; não conta strike).
- Reservados ao cliente (o servidor nunca os emite pelo WebSocket): `ROOM_NOT_FOUND` (sala descartada ou token de reconexão inválido) e `TOKEN_EXPIRED` (401 na reconexão ou refresh recusado). O cliente os sintetiza. Decisão assumida por padrão, a confirmar com o usuário. `UNAUTHORIZED` e `INVALID_CODE` também estão nesse tipo, mas só saem em respostas REST.

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

## Avatar

`AvatarParts` (`packages/protocol/src/avatar.ts`): 11 partes inteiras, índice `0..n-1`, mais `voice` opcional. Contagens (`AVATAR_PART_COUNTS`): `face_shape` 4, `skin` 8, `hair` 8, `eyes` 4, `mouth` 4, `outfit` 6, `accessory` 3, `bg_color` 8, `hair_color` 8, `eye_color` 3, `outfit_color` 11; `voice` em `VOICE_IDS` (Fase 5b). O catálogo só cresce.

- `PUT /me/avatar { parts }`: validado por `parseAvatarParts` (chaves exatas, sem chave extra, inteiros no intervalo, `voice` do catálogo). Qualquer outra coisa (texto livre incluso) é `400 INVALID_AVATAR`. A resposta devolve a cópia canônica.
- `GET /me`: `avatar` é `AvatarParts | null`. Avatar gravado fora do catálogo (formato antigo) volta como `null`, sem erro; o cliente usa `DEFAULT_AVATAR_PARTS`. A migração `20261103150000_avatar_accessory_3` leva `accessory` 3/4 gravados (catálogo antigo, com óculos) para 0, preservando as outras partes; a coluna `parts` (JSON) não mudou de formato. A migração `20261104120000_avatar_cores` acrescenta `hair_color` 0, `eye_color` 0 e `outfit_color` (cópia de `outfit`) aos avatares gravados, porque `parseAvatarParts` recusa o avatar inteiro se faltar chave (ADR 0004). `PROTOCOL_VERSION` foi a 3 por isso.
- `players[i].avatar` no estado da mesa segue sendo o JSON em texto das partes do banco (`'{}'` sem avatar ou com avatar inválido). O cliente faz `parseAvatarParts(JSON.parse(...)) ?? DEFAULT_AVATAR_PARTS`.
