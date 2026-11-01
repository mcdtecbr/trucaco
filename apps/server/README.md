# @trucaco/server

Servidor de jogo em tempo real do Trucaco (Colyseus). **Estado atual (Fase 2, blocos 2D a 2H):** runtime executável (Colyseus + `WebSocketTransport` + express) com `GET /health` e a sala `truco` (`src/rooms/TrucoRoom.ts`). Auth e REST (2G) e lobby + persistência (2H) estão descritos nas seções próprias abaixo. `src/index.ts` tem os exports puros (`buildHealth`, `createServer`); `src/main.ts` é a entrada que sobe o processo.

## Variáveis de ambiente

Definidas em `.env.example` na raiz do repositório. Copie para `.env` (nunca versionado).

| Variável                                                                | Uso                                                                      | Exemplo (dev)                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Postgres do `infra/docker-compose.yml`                                   | `trucaco` / `trucaco_dev_only` / `trucaco` / `5432`                 |
| `DATABASE_URL`                                                          | Conexão Prisma (Fase 2)                                                  | `postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco`      |
| `TEST_DATABASE_URL`                                                     | Banco descartável do `test:int` (host local, nome com `test`/`verif`)    | `postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test` |
| `REDIS_PORT`                                                            | Porta do Redis no host                                                   | `6380` (a 6379 pode estar ocupada por outro Redis local)            |
| `REDIS_URL`                                                             | Refresh tokens (obrigatório fora de dev/test; sem ele, memória)          | `redis://localhost:6380`                                            |
| `PORT`                                                                  | Porta HTTP/WebSocket do servidor (padrão `2567`)                         | `2567`                                                              |
| `MATCHMAKE_RATE_LIMIT_PER_MIN`                                          | Limite de `POST /matchmake/*` por IP/min (padrão `20`)                   | `20`                                                                |
| `TRUST_PROXY`                                                           | `true` só atrás de proxy que define `X-Forwarded-For` (padrão `false`)   | `false`                                                             |
| `JWT_SECRET`                                                            | Segredo HS256 do JWT. OBRIGATÓRIO (>= 32 bytes) fora de dev/test         | `openssl rand -base64 48`                                           |
| `JWT_ISSUER` / `JWT_AUDIENCE`                                           | `iss` e `aud` do JWT (padrões)                                           | `trucaco` / `trucaco-api`                                           |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS`                | Validade do access (60-3600) e do refresh (3600-7776000)                 | `900` / `2592000`                                                   |
| `CORS_ORIGINS`                                                          | Origens CORS (lista exata, vírgulas). Vazio = nenhuma                    | `https://app.trucaco.com`                                           |
| `REFRESH_REUSE_GRACE_SECONDS`                                           | Janela de graça do refresh (0-60 s; 0 desliga). Ver "Auth e REST"        | `20`                                                                |
| `REFRESH_FAMILY_MAX_SECONDS`                                            | Teto absoluto de vida da família de refresh (3600-31536000 s)            | `7776000`                                                           |
| `AUTH_GUEST_PER_IP_PER_HOUR` / `AUTH_GUEST_GLOBAL_PER_HOUR`             | `POST /auth/guest` por IP/h e teto do servidor inteiro/h                 | `10` / `2000`                                                       |
| `AUTH_REFRESH_PER_IP_PER_MIN`                                           | `POST /auth/refresh` por IP/min                                          | `30`                                                                |
| `REST_PER_IP_PER_MIN` / `REST_PER_USER_PER_MIN`                         | Qualquer rota REST por IP/min; rotas autenticadas por usuário/min        | `120` / `60`                                                        |
| `LOBBY_QUEUE_TTL_SECONDS` / `LOBBY_FILL_SECONDS`                        | Validade da entrada na fila (padrão 120) e prazo para os 4 sentarem (45) | `120` / `45`                                                        |
| `JOIN_ATTEMPTS_PER_USER_PER_MIN` / `JOIN_ATTEMPTS_PER_IP_PER_MIN`       | Tentativas de entrar por código por usuário/min (10) e IP/min (30)       | `10` / `30`                                                         |
| `JOIN_FAIL_LOCK_THRESHOLD` / `JOIN_LOCK_SECONDS`                        | Falhas que bloqueiam o usuário (6) e duração do bloqueio (600 s)         | `6` / `600`                                                         |
| `TEST_REDIS_URL`                                                        | Redis descartável do `test:int` (host local e DB lógico diferente de 0)  | `redis://localhost:6380/15`                                         |

## Sala `truco`

Mesa de 4 jogadores, registrada em `createServer` com `server.define('truco', ...)` (`defineTrucoRoom`).

**Opções de criação** (validadas por `validateRoomOptions` de `@trucaco/protocol`; campo extra ou inválido rejeita a criação): `variant` (`paulista`|`mineiro`), `format` (`single`|`bo3`; `bo3` só com `visibility: 'private'`), `ironHand` (boolean), `visibility` (`public`|`private`). Semente do RNG, prazos e placar inicial NÃO são opções do cliente: vêm de `TrucoRoomConfig`, injetada só por código do servidor/teste (`defineTrucoRoom(server, config)`); a semente padrão sai de `crypto.randomInt` e fica em `room.seed`.

**Entrada** (`static onAuth`, ver "Auth e REST (2G)"): a autenticação é o `static onAuth(token, options, context)` da sala, que o matchmaker roda ANTES de criar a sala ou reservar assento (`create`, `join`, `joinById`, `joinOrCreate`); o `onAuth` de instância do core 0.18 só roda depois do `onCreate` e por isso não é usado. O retorno vira `client.auth` e chega ao `onJoin(client, options, auth)`. Sem credencial válida nenhuma sala é criada. A credencial é o JWT de acesso no cabeçalho `Authorization: Bearer` do `POST /matchmake/*`; `userId`, apelido e avatar vêm do BANCO, nunca do payload. `devAuth` (`{ userId, nickname }` nas opções, sem prova) só existe com a flag explícita `allowDevAuth` em `buildColyseusServer`/`createServer` E `NODE_ENV` `development`/`test` (o `pnpm dev` passa `--dev`); sem a flag, `production` (o que o Dockerfile define) e `NODE_ENV` ausente rejeitam tudo. Assento por ordem de chegada (0..3), guardado no servidor (`sessionId -> assento`); o 4º jogador tranca a sala e inicia a série (pé no assento 0). O `userId` fica só em memória do servidor (mapa por assento) e NUNCA vai ao estado compartilhado; a identidade pública na mesa é `seat` + `nickname`. Se alguém sai antes do início, o assento é liberado (sem herdar strikes ou rate limit), a sala destranca e a série só começa com 4 jogadores sentados. Mensagens inválidas (`INVALID_PAYLOAD`, `INVALID_SIGNAL`, `INVALID_SFX`) contam para a expulsão (5 em 10 s); o log é limitado a 1 `warn` por assento a cada 5 s, com o total suprimido. Cada cliente tem `client.view` própria: só recebe o bloco `privates[seuAssento]`.

**Mensagens do cliente** (todas passam por `parseClientMessage`; falha -> `error { code }`, estado intacto; o assento nunca vem da mensagem): `play`, `playBlind`, `bet` (o servidor escolhe `callBet`/`raiseBet`), `accept`, `run`, `special`, `voteCancel` (unanimidade dos humanos conectados cancela a série). `signal`, `sfx` e `chat`: ver a seção abaixo. `ready` é aceito e ignorado (log debug). Rate limit de ações: `ACTION_MIN_INTERVAL_MS` por assento (`RATE_LIMITED`); 5 `INVALID_PAYLOAD` em 10 s expulsam o cliente (código 1008); tamanho máximo por mensagem `MAX_MESSAGE_BYTES` (limite do transporte, a conexão cai acima disso); 30 mensagens/s por conexão.

**Servidor -> cliente:** `event { seq, at, event }` (um por cliente, `publicEvent` por assento; carta coberta alheia sem identidade), `turnTimer { seat, deadlineAt }`, `presence { seat, status: 'online'|'away'|'bot' }`, `error { code }`. O estado (`TableState`) segue por patch com visão por assento. O log de eventos em memória (`room.eventLog`, visão pública) serve ao replay de reconexão; a gravação em `matches` usa o `MatchRecorder` (ver 2H).

**Timer de turno:** `TURN_TIMEOUT_MS` (20 s), reiniciado a cada ação aceita. Ao estourar, `botAction` do motor joga POR ele (nunca pede nem aumenta aposta); 2 expirações seguidas marcam o assento `away` (uma ação aceita volta a `connected`). Ao fim da série (`phase: 'finished'`, `winnerTeam`) o timer é cancelado e a sala fecha após `finishDelayMs` (15 s por padrão).

## Sinais, sfx e chat (bloco 2F)

O assento do remetente vem SEMPRE do servidor (`seatBySession`); `seat` no payload do cliente é rejeitado (`INVALID_PAYLOAD`). Todo texto passa por `parseClientMessage` (limpeza e limite de 140 code points; controle, bidi e ZWJ são rejeitados com `error CHAT_BLOCKED`). Nada disto entra no estado compartilhado (schema), em `eventLog`, no replay de reconexão, no banco ou em log.

| Cliente envia                               | Servidor entrega                                                                    | Cooldown por assento       |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `signal { signalId }`                       | `signal { seat, signalId, at }` a TODOS os 4 (público, adversários veem)            | `SIGNAL_COOLDOWN_MS` (3 s) |
| `sfx { sfxId }`                             | `sfx { seat, sfxId, at }` a todos os 4                                              | `SFX_COOLDOWN_MS` (5 s)    |
| `chat { scope: 'partner', text\|phraseId }` | `chat { scope, seat, text\|phraseId, at }` SÓ à dupla (`teamOf`) e eco ao remetente | `CHAT_COOLDOWN_MS` (2 s)   |
| `chat { scope: 'table', text\|phraseId }`   | o mesmo `chat` aos 4                                                                | `CHAT_COOLDOWN_MS` (2 s)   |

- **Dentro do cooldown:** `error { code: 'RATE_LIMITED' }` ao remetente, nada é enviado, sem strike. Os contadores são mapas por ASSENTO e sobrevivem a queda, reconexão e retomada do bot (sair e voltar não zera); também não são zerados quando alguém sai na espera (de propósito: cooldowns de sinal/sfx/chat ficam por assento; só strikes e contadores de ação são limpos). O limite global de mensagens por segundo (`maxMessagesPerSecond`) e os strikes de payload inválido (`INVALID_SIGNAL`, `INVALID_SFX`, `INVALID_PAYLOAD`, 5 em 10 s expulsam) continuam valendo.
- **Fases:** `signal`, `sfx` e chat da dupla só em `playing` (com série em andamento); fora disso são IGNORADOS em silêncio (sem erro, sem gastar cooldown). Chat da mesa vale em qualquer fase (inclusive na espera antes dos 4 sentarem e após o fim da série).
- **Quem envia/recebe:** só humano com socket vivo. Assento expulso, caído ou com bot não envia. Parceiro bot ou com socket caído (janela de reconexão) NÃO recebe: a mensagem é descartada em silêncio e NADA é reenviado quando ele volta. Bots não recebem chat (e ainda não sinalizam; o broadcast aceita um assento de bot no futuro).
- **Texto de chat recusado (`CHAT_BLOCKED`):** não é INVALID_PAYLOAD e NÃO conta strike nem expulsa (emoji com ZWJ é comum no celular). Para não virar spam grátis, a rejeição consome o MESMO cooldown de chat (`CHAT_COOLDOWN_MS`): dentro dele responde `RATE_LIMITED`; um texto válido logo após um rejeitado também recebe `RATE_LIMITED`. Payload malformado de verdade (chaves extras como `seat`, tipo errado, `scope` inválido) segue `INVALID_PAYLOAD` com strike.
- **Logs:** `signal`/`sfx` em `info` (assento e id); chat só metadados em `debug` (assento, escopo, tamanho), nunca o texto.
- **Moderação (extensão):** `canReceiveChat(from, to)` em `TrucoRoom` é o ponto para silenciar/bloquear entre jogadores (Fase 3).
- **Config só do servidor:** `signalCooldownMs`, `sfxCooldownMs`, `chatCooldownMs` em `TrucoRoomConfig` (padrões vêm de `@trucaco/protocol`). Sem variável de ambiente nova.

### Moderação pendente

- Silenciar, bloquear e denunciar por `userId` (ponto de extensão `canReceiveChat`) antes do beta público.
- Avaliar desligar o chat da mesa em `waiting` na fila pública (hoje sem moderação). A mesa da fila admite só os 4 sorteados, mas dentro dela o chat da mesa vale.
- Política de retenção de chat para denúncias: decisão futura (hoje nada de chat é persistido).

## Lobby, mesas por código, fila pública e persistência (bloco 2H)

**Desenho e por que.** REST + `matchMaker` (rotas em `src/http/lobbyRoutes.ts`, estado em `src/lobby/lobby.ts`) e NÃO `LobbyRoom` do core: a `LobbyRoom` publica a lista de salas a quem entra (haveria mesas privadas e jogadores no meio), exige uma sala por cliente só para escutar e não tem fila nem tickets. Criar mesa por `matchmake/create` direto também foi descartado: o `onAuth` roda, mas não há onde aplicar código único, limite por usuário, vínculo "um usuário, uma mesa" nem a regra "bo3 só privada, pública só pela fila". As rotas autenticam (JWT no `Authorization`), decidem e devolvem uma RESERVA DE ASSENTO; o cliente a consome com `client.consumeSeatReservation(reservation)` do SDK 0.18. `POST /matchmake/create|join|joinOrCreate/truco` agora responde `403 USE_LOBBY` (depois de validar o JWT; `401`/`503` como antes); `deps.directMatchmake` (só testes) o reabre. `joinById` e `reconnect` continuam, protegidos pela admissão da sala.

| Rota (todas com `Authorization: Bearer`) | Corpo                                  | Resposta                                                                        |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /tables`                           | `RoomOptions` com `visibility:private` | `201 { code, reservation }`; o criador é o 1º assento                           |
| `POST /tables/join`                      | `{ code }` (8 caracteres)              | `200 { reservation }`                                                           |
| `POST /queue`                            | `RoomOptions` `public` + `single`      | `200 { status }` (`queued` ou já `matched`)                                     |
| `GET /queue`                             | -                                      | `{ status: idle \| queued \| matched \| seated }`; `matched` traz `reservation` |
| `POST /queue/leave`                      | -                                      | `200 { status: 'idle' }` (POST porque o CORS só lista GET/POST/PUT)             |

- **Opções:** só `RoomOptions` (`validateRoomOptions`: campo extra é rejeitado). Semente, prazos, `roomId` e concessão do lobby nunca vêm do cliente: a concessão é um token aleatório que só o servidor conhece (`__lobbyGrant`); token desconhecido em `onCreate` = `403`.
- **Código:** 8 símbolos de `ROOM_CODE_ALPHABET` por `crypto.randomInt`; único (diretório em memória com reserva do código antes da sala, nova tentativa em colisão, até 20).
- **Entrar por código:** formato inválido = `400 INVALID_CODE` (sem consulta). Código inexistente, mesa cheia, em partida, de outro tipo (mesa da fila) ou fechada = o MESMO `404 TABLE_UNAVAILABLE` (sem oráculo de existência; a sala também recusa a reserva sem o código certo, mesmo com o `roomId` conhecido). Quem já está em outra mesa/fila recebe `409 ALREADY_IN_TABLE` (estado dele, não da mesa consultada). Mesa privada: ninguém além do criador entra antes de ele sentar.
- **Limites (por processo, em memória, com teto de chaves):** `JoinGuard` (`src/lobby/joinGuard.ts`) conta tentativas por usuário e por IP (cada falha conta à parte); `JOIN_FAIL_LOCK_THRESHOLD` falhas bloqueiam o USUÁRIO por `JOIN_LOCK_SECONDS` (`429` com `Retry-After`, até com o código certo); falhas demais por IP limitam o IP. Rotas de lobby têm ainda limite geral por IP e por usuário e `createPerUserPerMin`. Com mais de uma instância o limite efetivo multiplica: a migração para Redis (`rl:`) fica para o deploy multi-instância.
- **Um userId, uma mesa:** estado por usuário (`queued` -> `ticket` -> `table`). Quem tem vínculo não enfileira, não cria nem entra em outra mesa (a sala checa em `_reserveSeat` e de novo no `onJoin`); um humano não segura mais de uma reserva por sala. O vínculo se mantém na queda e na reconexão; é liberado quando o bot assume o assento (saída definitiva) ou a sala fecha.
- **Fila FIFO** (`src/lobby/matchQueue.ts`): compatível = mesma variante e mesma `ironHand`; os 4 mais antigos de cada chave formam a mesa (dupla = assentos 0/2 e 1/3, na ordem de chegada; sem habilidade). Mesa pública `single`, `private` no matchmaker, admitindo SÓ os 4 sorteados. A reserva é emitida em `GET /queue` (consumir em até 15 s; depois de 16 s sem sentar o `GET` emite outra). Entrada expira em `LOBBY_QUEUE_TTL_SECONDS` (volta `idle`); se a mesa não encher em `LOBBY_FILL_SECONDS`, ela fecha, quem sentou volta à fila na POSIÇÃO ORIGINAL e o ausente fica livre. Falha ao criar a sala devolve todos à posição original. Segunda entrada do mesmo usuário (até com outra variante) é idempotente.
- **Limpeza:** criador que não senta em 30 s fecha a mesa; mesa privada em espera por 30 min fecha; sala vazia fecha (`autoDispose`). Nenhuma lista de mesas é exposta; a contagem agregada existe só em `lobby.stats()` (interno).
- **Fora desta entrega:** `partnerUserId` (existe em `JoinOptions`, mas nada o usa: dupla escolhida fica para depois); filtro de bloqueados no sorteio (`listBlockedIds`/`listBlockerIds` já existem no repositório).

**Persistência.** `MatchRecorder` (`src/rooms/matchRecorder.ts`) recebe do `emitEvents` SÓ eventos do motor em visão pública (chat, sinais e sfx nunca passam por ele) e, a cada `handStarted`, o sorteio de todos (`deals`, só auditoria; nenhuma rota o devolve, `listForUser` não traz `events`/`deals`/`seed`). Ao fim da série (terminada, cancelada por voto ou por abandono) ou no `onDispose` com a série em andamento, grava UMA vez em `matches`/`match_players` pelo `MatchRepository` (idempotente), em segundo plano: até 3 tentativas (250 ms, 500 ms), erro de entrada do banco não repete, e falha NUNCA derruba nem trava a sala (log com nome do erro, código Prisma e constraint, sem `userId`, carta ou texto; o `onDispose` espera no máximo 3 s). Status: `finished` (com vencedor) ou `cancelled`; `options.endReason` distingue `finished`, `cancelled` (voto) e `abandoned` (ninguém ficou ou sala fechada no meio), porque o enum do banco só tem `finished`/`cancelled`. `match_players`: `seat`, `userId` e `botFrom` (`seq` em que o bot assumiu; o primeiro vale). Buffer próprio com teto de 6000 eventos e 1,5 MB (CHECK do banco: 2 MiB); estourou, descarta o excedente e marca `options.logTruncated` e `options.eventsDropped`. Tamanho: bo3 medida com bots (300 sementes) = no máximo 883 eventos / 112 KB; pior caso teórico (23 mãos por jogo, 3 jogos, ~26 eventos por mão com apostas) ~1800 eventos / ~270 KB. A gravação é no fim, não evento a evento (o repositório só tem `saveMatch` atômico): queda do processo no meio perde a partida em andamento. Em desenvolvimento sem `DATABASE_URL` usa o repositório em memória.

## Reconexão e bot de ausência (bloco 2E)

API real do `@colyseus/core` 0.18 (confirmada nos fontes): `onDrop(client, code)` roda na queda SEM consentimento e é onde se chama `allowReconnection(client, seconds)`; `onReconnect(newClient)` roda quando o token de reconexão volta; `onLeave(client, code)` roda só na saída DEFINITIVA (consentida, `code 4000`, janela expirada ou sem direito a janela). A `sessionId` é a MESMA na reconexão (só o objeto `Client` e o token mudam, o token gira); o core copia `auth`, `userData` e a `view` ANTIGA para o novo `Client`. O core NÃO roda `onAuth` ao reconectar.

**Fluxo.** Queda não consentida durante a partida: assento `away` (`presence { seat, status: 'away' }`, `players[seat].status = 'away'`), `allowReconnection(client, reconnectSeconds)` e, enquanto isso, o timer de turno normal (20 s) joga por ele com `botAction` (nunca pede nem aumenta aposta). Voltou na janela (`onReconnect` -> `resume`): `client.view` antiga é descartada (`dispose()`) e recriada (`createSeatView`), o core envia o estado completo filtrado, o servidor reenvia os eventos perdidos (`seq` maior que o último enviado àquele assento, em ordem, via `eventLog` em visão pública sem assento), `presence` dos demais assentos e o `turnTimer`; o assento volta a `connected`. A identidade da PRÓPRIA carta coberta NÃO vem do replay: vem do estado completo (`privates[seat].ownCovered`). Eventos enviados a um socket já morto antes de o servidor notar a queda contam como entregues; o cliente deve tratar salto de `seq` como pedido de resincronização pelo estado. Janela expirada: `onLeave` -> o assento vira bot (`isBot: true`, `status: 'bot'`, `presence 'bot'`), que age nos turnos dele após `botThinkMs` por `botAction` + `applySeriesAction` (a mesma porta das ações humanas; um timer de segurança de turno segue armado). Saída consentida (`room.leave()`) durante a partida: bot na hora, sem janela. O dono volta a qualquer momento por um novo join com o mesmo `userId` (a sala é destrancada quando o bot assume): substitui o bot, que tem a ação pendente cancelada (o `sync` rearma só o relógio do humano). Quem não é o dono recebe `ROOM_FULL`. Antes da partida (`waiting`) nada muda: sair libera o assento.

**Segurança da retomada.** Duas camadas. (1) O core valida o token de reconexão POR SESSÃO (`hasReservedSeat`/`checkReconnectionToken`): token de um assento não abre outro. (2) `reconnectUpgradeGuard` (`src/rooms/reconnectGuard.ts`, `beforeUpgrade` do `WebSocketTransport`) exige o JWT de acesso no upgrade da reconexão e recusa com 401 se ele falta, expirou ou é inválido (o cliente renova em `/auth/refresh` e reconecta) e com 403 se o `userId` não é o do assento da sessão (`TrucoRoom.authorizeReconnect`). O JWT só vale em `Authorization: Bearer` ou no subprotocolo `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>`; o `_authToken` da QUERY (que o SDK põe na URL) NUNCA vale como JWT. O guard lê a URL como o transporte (base fixa, ignora o Host), recusa com 400 Host fora de `[A-Za-z0-9.:[]-]` e reconexão sem `sessionId`/sala válidos. `POST /matchmake/reconnect`: o core não repassa identidade a `TrucoRoom.checkReconnectionToken`, então um wrapper em `controller.invokeMethod` (`src/server.ts`) valida o JWT (401) e, se a sala é local, que o token de reconexão pertença a um assento do mesmo `userId` (403, `authorizeReconnectionToken`); `checkReconnectionToken` só vale para janela aberta e nunca derruba cliente conectado. Expulso por strikes (`INVALID_PAYLOAD` x5) não ganha janela: o bot assume e o `userId` não reentra naquela sala (`BANNED`, só em memória). A sala em série é privada (`setPrivate`) para `joinOrCreate` de estranhos; o dono reentra por `joinById`. Retomada e reconexão não reiniciam o prazo do turno. `eventLog` tem teto (`eventLogMax`, padrão 5000): acima dele os antigos saem (`eventsEvicted`) e, havendo lacuna, não há replay parcial (vale o estado completo; a gravação em `matches` não depende dele (ver 2H)). Rate limit, strikes (`INVALID_PAYLOAD`) e contadores vivem por assento e sobrevivem à reconexão e à retomada. Teto de `maxReconnects` (20) reconexões/retomadas por assento: acima disso a queda vai direto para o bot e o dono não retoma.

**Abandono.** Sem nenhum humano conectado por `abandonMs` (padrão: a janela de reconexão), ou quando todos os humanos saíram de vez, a série é cancelada (`seriesCancelled`, `phase: 'finished'`, sem vencedor) e a sala fecha após `finishDelayMs`.

**`voteCancel`.** Vale a unanimidade dos humanos CONECTADOS (bot não vota; ausente não conta). O voto zera a cada `handStarted` e é descartado quando o votante cai ou vira bot; se a queda deixa só votantes entre os conectados, a série cancela.

**Config só do servidor** (`TrucoRoomConfig`, nada vem do cliente): `reconnectSeconds` (padrão `RECONNECT_SECONDS` = 60; aceita fração em teste), `botThinkMs` (600), `abandonMs` (= janela), `maxReconnects` (20), `eventLogMax` (5000). Sem variável de ambiente nova.

## Limite por IP no matchmaking

`POST /matchmake/*` (criar/entrar em sala) tem janela deslizante em memória por IP: padrão 20 req/min, configurável só pelo servidor (`MATCHMAKE_RATE_LIMIT_PER_MIN`); excesso responde `429` com `Retry-After`. O IP vem do socket. Atrás de proxy reverso o socket é o do proxy: defina `TRUST_PROXY=true` para usar o último item de `X-Forwarded-For` (só se todo o tráfego passa pelo proxy; DESLIGADO por padrão). É por processo: com várias instâncias o limite efetivo é multiplicado (Redis fica para depois). O `ctx.ip` do Colyseus confia em cabeçalhos forjáveis e não é usado.

## Auth e REST (bloco 2G)

**Access token.** JWT HS256 (`jose` 6.2.12), 15 min por padrão. Claims `iss`, `aud`, `sub` (UUID do usuário), `jti`, `iat`, `exp`. A verificação (`src/auth/jwt.ts`) SEMPRE restringe `algorithms: ['HS256']` (recusa `alg:none`, HS384/512 e RS256 com assinatura HMAC), confere `iss`, `aud`, `exp` (tolerância de 5 s) e exige `sub` UUID e `jti`. HS256 foi escolhido porque só este servidor emite e verifica (um processo, sem terceiros verificando); ES256 só compensaria com verificadores externos. `jti` revogado (`trucaco:v1:jti:revoked:{jti}`) é checado na entrada de sala e no REST.

**Refresh token.** Opaco (32 bytes aleatórios, base64url), rotativo a cada uso; só o SHA-256 vai ao Redis (`RedisTokenStore`, `src/auth/redisTokenStore.ts`; chaves em `docs/banco-de-dados.md`). A rotação é UM script Lua (família + `HSETNX usedAt` + novo token + `lastJti` + TTLs). Reapresentar um token já rotacionado revoga a FAMÍLIA inteira e o access vigente (`lastJti`), com `warn` de segurança (sem token). **Janela de graça** (`REFRESH_REUSE_GRACE_SECONDS`, padrão 20 s): resposta perdida ou duas abas reapresentam o token que acabou de rotacionar. Como só o hash fica guardado, não dá para reemitir o MESMO sucessor (guardá-lo, ainda que cifrado, deixaria um token utilizável no Redis). Dentro da janela, UMA vez por token, nasce um sucessor irmão e o primeiro segue válido (a cadeia bifurca; o ramo perdido é inofensivo). Trade-off: quem roubou o token antigo e o usa nos primeiros segundos ganha um ramo; limitado a uma vez e à janela. Fora da janela, ou na segunda reapresentação, é reuso e a família inteira cai (com o access vigente); o access do primeiro sucessor segue valendo até expirar (15 min). O usuário é validado ANTES de rotacionar (banco fora do ar não gasta o token). `REFRESH_FAMILY_MAX_SECONDS` (padrão 90 dias) é o teto absoluto da família: rotacionar não a renova além dele. Refresh simultâneos além do par original+irmão derrubam a família: o cliente deve fazer refresh em fila única. `TokenStore` tem implementação em memória (dev/testes de sala). Em produção o `REDIS_URL` é obrigatório; Redis fora do ar vira `503 SERVICE_UNAVAILABLE` (REST) ou `ServerError 503` (`onAuth` da sala, sem a mensagem do erro), nunca 401; o `userfam:<id>` é podado de famílias expiradas a cada criação/revogação. Configure o Redis com `appendonly yes` e `maxmemory-policy noeviction`.

**Falha fechado no boot.** `JWT_SECRET` (>= 32 bytes e >= 8 símbolos distintos: um caractere repetido é recusado) é obrigatório e sem valor padrão; sem ele, ou com o valor de exemplo do `.env.example`, o servidor não sobe, SALVO com `NODE_ENV` explícito `development`/`test` (segredo efêmero em memória, tokens morrem no restart). `NODE_ENV` ausente NÃO conta como dev. Fora de dev/test também são obrigatórios `REDIS_URL` e `DATABASE_URL`.

**Rotas.** Todas respondem `{ "error": { "code" } }` com códigos estáveis em erro; corpo JSON de até 8 KB e `Content-Type: application/json` estrito (415 caso contrário); cabeçalhos de segurança (`nosniff`, `X-Frame-Options`, CSP `default-src 'none'`, `Cache-Control: no-store`, HSTS em produção); sem CORS por padrão (`CORS_ORIGINS`, origem exata; vale também para `/matchmake/*`, sem credenciais). Quem responde ao preflight é o roteador do `@colyseus/core` (antes do express): métodos `GET, POST, PUT, OPTIONS`, cabeçalhos `Authorization, Content-Type`; origem fora da lista recebe 403 sem nenhum `Access-Control-*`; 404/405/500 genéricos, sem stack nem eco da entrada.

| Rota                                      | Auth   | Corpo -> resposta                                                                                                                                                                                                                               |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/guest`                        | não    | (vazio) -> `201 { user: { id, nickname }, accessToken, refreshToken, expiresIn }`                                                                                                                                                               |
| `POST /auth/refresh`                      | não    | `{ refreshToken }` -> `200 { accessToken, refreshToken, expiresIn }`; `401 INVALID_REFRESH_TOKEN` (desconhecido, expirado, reuso, revogado)                                                                                                     |
| `POST /auth/link`                         | Bearer | STUB `501`. Contrato (Fase 3): `{ provider: 'google'\|'apple', idToken }`; valida no provedor, grava (provider, subject) no convidado, `409 PROVIDER_TAKEN`, devolve par novo e revoga as famílias antigas; `idToken` de uso único (`jti:used`) |
| `POST /auth/google`, `/auth/apple`        | não    | STUB `501` (Fase 3): `{ idToken }` -> par de tokens                                                                                                                                                                                             |
| `GET /me`                                 | Bearer | `200 { id, nickname, provider, avatar, createdAt }`                                                                                                                                                                                             |
| `PUT /me`                                 | Bearer | `{ nickname }` (`validateNickname`) -> `200 { nickname }`; `400 INVALID_NICKNAME`; `409 NICKNAME_TAKEN`                                                                                                                                         |
| `PUT /me/avatar`                          | Bearer | `{ parts: { ... } }` (objeto plano, <= 32 chaves, valores escalares curtos) -> `200 { avatar }`; `400 INVALID_AVATAR`                                                                                                                           |
| `GET`/`PUT /me/partners/:partnerId/codes` | Bearer | `{ codes: { [signalId]: significado } }`; `403 NOT_PARTNERS` sem partida finalizada na mesma dupla; `400 INVALID_PARTNER`/`INVALID_CODES`                                                                                                       |
| `GET /health`                             | não    | `{ status, protocol }`                                                                                                                                                                                                                          |

**Rate limit REST** (em memória, por processo; `TRUST_PROXY` vale como no matchmaking; chave IPv6 = prefixo /64, IPv4 mapeado vira IPv4; teto de 50 mil chaves por limitador, descartando as mais antigas): `/auth/guest` por IP/hora e teto global/hora (criação em massa de convidados é abuso real; ambos configuráveis), `/auth/refresh` por IP/min, qualquer rota por IP/min, rotas autenticadas por `userId`/min e as ESCRITAS do perfil (`PUT`) com um sexto do limite de usuário. Excesso: `429 RATE_LIMITED` com `Retry-After`. Com várias instâncias o limite efetivo multiplica (mover para Redis, `rl:` em `docs/banco-de-dados.md`, no 2H).

**Logs.** Nunca token, hash, `Authorization`, cookie nem corpo de `/auth`. O logger (`src/logger.ts`) redige por nome de campo (`token`, `authorization`, `cookie`, `secret`, `hash`, `jwt`, `body`...) e por valor com cara de JWT/Bearer ou de refresh token (43 caracteres base64url), também dentro da mensagem (`msg`). Erros internos registram só nome e código.

**Sala e reconexão (para o cliente da Fase 3).**

- Entrada: `Authorization: Bearer <access>` no `POST /matchmake/*`. Com o SDK 0.18: `client.http.options.headers = { authorization: 'Bearer ...' }` (vale para o HTTP e, em Node/React Native, para o upgrade do WebSocket). Evite `client.auth.token = ...`: o SDK copia esse valor para a QUERY (`_authToken`) da URL do WebSocket (vaza em log de proxy); o servidor o ignora como credencial.
- Reconexão: o SDK reaproveita o token de reconexão, mas o JWT que vale é o do cabeçalho do momento. Se o access EXPIROU durante a queda (15 min), a reconexão volta `401`: o cliente chama `/auth/refresh`, atualiza o cabeçalho e chama `sdk.reconnect(reconnectionToken)` de novo. Navegador não consegue pôr `Authorization` no WebSocket: use o subprotocolo `trucaco.bearer, <jwt>` (`Sec-WebSocket-Protocol`); o servidor aceita os dois.
- Assento de bot: só o dono (mesmo `userId`) retoma; estranho é recusado ANTES de reservar (`_reserveSeat` da sala), sem gastar vaga.
- Stack de teste: salas com JWT em `src/rooms/authRoom.test.ts`; a suíte legada (`TrucoRoom.test.ts`) segue com `allowDevAuth: true`.

### Riscos conhecidos (aceitos por ora)

- Apelido: homóglifos Latin Extended passam na validação; aplicar skeleton/confusables antes do beta.
- Avatar: `parts` aceita texto livre de até 140 caracteres; validar contra o catálogo do rig na Fase 4.
- Janela de até 15 min do access após revogação (logout, reuso): aceita (access curto, sem checagem por requisição no WebSocket já aberto).
- Logout / "sair de todos os aparelhos" ainda sem rota (`revokeAllForUser` existe no store): Fase 3.
- Limitadores em memória por processo (REST e `JoinGuard` do lobby): com várias instâncias o limite efetivo multiplica; mover para Redis no deploy multi-instância (o 2H manteve em memória). Sob inundação de IPs distintos o teto de chaves descarta as mais antigas (um atacante pode "lavar" contadores alheios).
- Redis de produção precisa de `maxmemory-policy noeviction` e AOF; com evicção, famílias de refresh podem sumir e os usuários perdem a sessão.
- Usuário órfão: se o Redis falha em `createGuest` depois de criar o usuário, sobra um convidado sem sessão (o repositório não tem `delete`; limpeza periódica de convidados sem partida fica para o 2H/dalva-dba).
- `TRUST_PROXY` usa o último item de `X-Forwarded-For`; na Fly.io o certo é `Fly-Client-IP` (a tratar no deploy).

## Chaves Redis

Desenhadas em `docs/banco-de-dados.md` (seção 2): prefixo `trucaco:v1:`, refresh rotativo com detecção de reuso, `jti`, presença, filas de matchmaking por variante e rate limit compartilhado, cada uma com tipo, TTL, quem escreve e quem lê. O cliente `ioredis` existe para refresh/`jti` (bloco 2G, `RedisTokenStore`); presença, matchmaking e rate limit compartilhado entram no 2H.

## Banco de dados (Postgres via Prisma 7)

Modelo, índices, `onDelete` e retenção: `docs/banco-de-dados.md`. Schema em `prisma/schema.prisma`; a URL fica em `prisma.config.ts` (lê `DATABASE_URL`). O Prisma 7 exige driver adapter (`@prisma/adapter-pg`): `createPrisma(databaseUrl)` em `src/db/prisma.ts`. O client é gerado em `src/generated/prisma` (fora do git, do lint e do Prettier).

```bash
pnpm db:up                                  # Postgres 16 (5432) e Redis 7 (6380) em Docker
export DATABASE_URL=postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco   # ou copie de .env.example

pnpm --filter @trucaco/server db:generate   # gera o Prisma Client (o turbo faz isso antes de build/typecheck/test/lint)
pnpm --filter @trucaco/server db:migrate    # prisma migrate dev (local): cria e aplica migração. Use --create-only para editar o SQL
pnpm --filter @trucaco/server db:deploy     # prisma migrate deploy (CI/produção): só aplica
createdb -h localhost -U trucaco trucaco_test                # banco descartável do test:int
export TEST_DATABASE_URL=postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test
DATABASE_URL=$TEST_DATABASE_URL pnpm --filter @trucaco/server db:deploy   # migra o banco de teste do zero
pnpm --filter @trucaco/server test:int      # integração (*.int.test.ts); lê TEST_DATABASE_URL e/ou TEST_REDIS_URL, nunca DATABASE_URL/REDIS_URL
```

`pnpm test` NÃO exige banco: exclui `*.int.test.ts`. O `test:int` trunca as tabelas e por isso só aceita `TEST_DATABASE_URL`: host `localhost`/`127.0.0.1`/`::1` e nome de banco contendo `test` ou `verif` (`src/db/testDatabase.ts`); qualquer outra coisa falha na inicialização, antes de escrever. O cluster precisa ser UTF-8 com locale UTF-8 (não `C`/`POSIX`), senão `lower()` não dobra letras acentuadas e o apelido único falha (há teste para isso). Sem Docker, qualquer Postgres 16 serve (`createdb trucaco`). Rode `db:generate` uma vez após o `pnpm install` se for executar `tsc`/`vitest` direto no pacote, fora do turbo.

Ao criar uma migração nova com `db:migrate`, confira o SQL: o `CHECK` de apelido, o índice único em `lower(nickname)` e os demais `CHECK` da migração inicial são escritos à mão e o Prisma não os conhece. Migrações nunca rodam contra banco remoto a partir de máquina de desenvolvimento. A imagem de produção não traz o CLI `prisma` (devDependency): `db:deploy` roda em passo de release.

Erros do banco: os repositórios relançam SÓ erros de domínio (`InvalidInputError`, `NicknameTakenError`, `ProviderSubjectTakenError`, `NotPartnersError`, `PersistenceError`), com `code` e nome da constraint. O erro bruto do Prisma carrega a linha inteira (`meta.driverAdapterError.cause.detail`, "Failing row contains ..."), inclusive `deals` com as cartas de todos: **o chamador nunca loga nem repassa o erro bruto do Prisma**. O 2G mapeia `InvalidInputError` para 400, `NotPartnersError` para 403, `NicknameTakenError`/`ProviderSubjectTakenError` para 409 e `PersistenceError` para 500. Todo id recebido é validado como UUID e normalizado para minúsculas. Política do apelido: `validateNickname` (NFC, letras latinas, dígitos, `_`, `.`, `-`, 3 a 16), ver `docs/banco-de-dados.md`.

Acesso: `src/db/` tem as interfaces `UserRepository` e `MatchRepository` (`types.ts`), a implementação Prisma (`prismaRepositories.ts`) e a implementação em memória para testes de sala (`memoryRepositories.ts`, `createMemoryRepositories()`).

## Comandos

```bash
pnpm --filter @trucaco/server dev         # tsx watch src/main.ts
pnpm --filter @trucaco/server build       # tsup -> dist/main.js (bundle ESM, @trucaco/* embutidos)
pnpm --filter @trucaco/server start       # node dist/main.js (rode o build antes)
pnpm --filter @trucaco/server test        # Vitest
pnpm --filter @trucaco/server typecheck
```

`pnpm build` na raiz builda `protocol` e `rules` antes (Turborepo, `dependsOn: ^build`). O `dev` não builda os pacotes do workspace: rode `pnpm build` uma vez antes.

## Health

`GET /health` responde `{"status":"ok","protocol":<PROTOCOL_VERSION>}`. SIGTERM e SIGINT fazem desligamento limpo (matchmaker, WebSocket, HTTP).

## Docker

`infra/Dockerfile.server` (multi-stage, Node 22 alpine, usuário não-root, `HEALTHCHECK` em `/health`, porta 2567). Build a partir da raiz:

```bash
docker build -f infra/Dockerfile.server -t trucaco-server .
docker run --rm -p 2567:2567 trucaco-server
```
