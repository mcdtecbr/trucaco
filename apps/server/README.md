# @trucaco/server

Servidor de jogo em tempo real do Trucaco (Colyseus). **Estado atual (Fase 2, blocos 2D e 2E):** runtime executável (Colyseus + `WebSocketTransport` + express) com `GET /health` e a sala `truco` (`src/rooms/TrucoRoom.ts`). Sinais/sfx/chat (2F), auth e REST (2G), lobby e persistência (2H) entram nos próximos blocos. `src/index.ts` tem os exports puros (`buildHealth`, `createServer`); `src/main.ts` é a entrada que sobe o processo.

## Variáveis de ambiente

Definidas em `.env.example` na raiz do repositório. Copie para `.env` (nunca versionado).

| Variável                                                                | Uso                                                                    | Exemplo (dev)                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Postgres do `infra/docker-compose.yml`                                 | `trucaco` / `trucaco_dev_only` / `trucaco` / `5432`                 |
| `DATABASE_URL`                                                          | Conexão Prisma (Fase 2)                                                | `postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco`      |
| `TEST_DATABASE_URL`                                                     | Banco descartável do `test:int` (host local, nome com `test`/`verif`)  | `postgresql://trucaco:trucaco_dev_only@localhost:5432/trucaco_test` |
| `REDIS_PORT`                                                            | Porta do Redis no host                                                 | `6380` (a 6379 pode estar ocupada por outro Redis local)            |
| `REDIS_URL`                                                             | Conexão Redis (Fase 2)                                                 | `redis://localhost:6380`                                            |
| `PORT`                                                                  | Porta HTTP/WebSocket do servidor (padrão `2567`)                       | `2567`                                                              |
| `MATCHMAKE_RATE_LIMIT_PER_MIN`                                          | Limite de `POST /matchmake/*` por IP/min (padrão `20`)                 | `20`                                                                |
| `TRUST_PROXY`                                                           | `true` só atrás de proxy que define `X-Forwarded-For` (padrão `false`) | `false`                                                             |
| `JWT_SECRET`                                                            | Segredo do JWT próprio (Fase 2). Só por ambiente                       | valor longo e aleatório                                             |

## Sala `truco`

Mesa de 4 jogadores, registrada em `createServer` com `server.define('truco', ...)` (`defineTrucoRoom`).

**Opções de criação** (validadas por `validateRoomOptions` de `@trucaco/protocol`; campo extra ou inválido rejeita a criação): `variant` (`paulista`|`mineiro`), `format` (`single`|`bo3`; `bo3` só com `visibility: 'private'`), `ironHand` (boolean), `visibility` (`public`|`private`). Semente do RNG, prazos e placar inicial NÃO são opções do cliente: vêm de `TrucoRoomConfig`, injetada só por código do servidor/teste (`defineTrucoRoom(server, config)`); a semente padrão sai de `crypto.randomInt` e fica em `room.seed`.

**Entrada** (`static onAuth` TEMPORÁRIO, `TODO(2G)`): a autenticação é o `static onAuth(token, options, context)` da sala, que o matchmaker roda ANTES de criar a sala ou reservar assento (`create`, `join`, `joinById`, `joinOrCreate`); o `onAuth` de instância do core 0.18 só roda depois do `onCreate` e por isso não é usado. O retorno vira `client.auth` e chega ao `onJoin(client, options, auth)`. Sem credencial válida nenhuma sala é criada. Aceita `{ userId, nickname }` das opções de join, SÓ quando `NODE_ENV` é `development` ou `test` EXPLÍCITOS (o `pnpm dev` passa `--dev`, que define `development`). Qualquer outro valor, inclusive `NODE_ENV` ausente e `production` (o que o Dockerfile define), rejeita toda entrada. O bloco 2G troca por JWT. Assento por ordem de chegada (0..3), guardado no servidor (`sessionId -> assento`); o 4º jogador tranca a sala e inicia a série (pé no assento 0). O `userId` fica só em memória do servidor (mapa por assento) e NUNCA vai ao estado compartilhado; a identidade pública na mesa é `seat` + `nickname`. Se alguém sai antes do início, o assento é liberado (sem herdar strikes ou rate limit), a sala destranca e a série só começa com 4 jogadores sentados. Mensagens inválidas (`INVALID_PAYLOAD`, `INVALID_SIGNAL`, `INVALID_SFX`) contam para a expulsão (5 em 10 s); o log é limitado a 1 `warn` por assento a cada 5 s, com o total suprimido. Cada cliente tem `client.view` própria: só recebe o bloco `privates[seuAssento]`.

**Mensagens do cliente** (todas passam por `parseClientMessage`; falha -> `error { code }`, estado intacto; o assento nunca vem da mensagem): `play`, `playBlind`, `bet` (o servidor escolhe `callBet`/`raiseBet`), `accept`, `run`, `special`, `voteCancel` (unanimidade dos humanos conectados cancela a série). `ready`, `signal`, `sfx` e `chat` são aceitos e IGNORADOS (log debug) até os blocos 2F. Rate limit de ações: `ACTION_MIN_INTERVAL_MS` por assento (`RATE_LIMITED`); 5 `INVALID_PAYLOAD` em 10 s expulsam o cliente (código 1008); tamanho máximo por mensagem `MAX_MESSAGE_BYTES` (limite do transporte, a conexão cai acima disso); 30 mensagens/s por conexão.

**Servidor -> cliente:** `event { seq, at, event }` (um por cliente, `publicEvent` por assento; carta coberta alheia sem identidade), `turnTimer { seat, deadlineAt }`, `presence { seat, status: 'online'|'away'|'bot' }`, `error { code }`. O estado (`TableState`) segue por patch com visão por assento. O log de eventos em memória (`room.eventLog`, visão pública) é gravado pelo 2H.

**Timer de turno:** `TURN_TIMEOUT_MS` (20 s), reiniciado a cada ação aceita. Ao estourar, `botAction` do motor joga POR ele (nunca pede nem aumenta aposta); 2 expirações seguidas marcam o assento `away` (uma ação aceita volta a `connected`). Ao fim da série (`phase: 'finished'`, `winnerTeam`) o timer é cancelado e a sala fecha após `finishDelayMs` (15 s por padrão).

## Reconexão e bot de ausência (bloco 2E)

API real do `@colyseus/core` 0.18 (confirmada nos fontes): `onDrop(client, code)` roda na queda SEM consentimento e é onde se chama `allowReconnection(client, seconds)`; `onReconnect(newClient)` roda quando o token de reconexão volta; `onLeave(client, code)` roda só na saída DEFINITIVA (consentida, `code 4000`, janela expirada ou sem direito a janela). A `sessionId` é a MESMA na reconexão (só o objeto `Client` e o token mudam, o token gira); o core copia `auth`, `userData` e a `view` ANTIGA para o novo `Client`. O core NÃO roda `onAuth` ao reconectar.

**Fluxo.** Queda não consentida durante a partida: assento `away` (`presence { seat, status: 'away' }`, `players[seat].status = 'away'`), `allowReconnection(client, reconnectSeconds)` e, enquanto isso, o timer de turno normal (20 s) joga por ele com `botAction` (nunca pede nem aumenta aposta). Voltou na janela (`onReconnect` -> `resume`): `client.view` antiga é descartada (`dispose()`) e recriada (`createSeatView`), o core envia o estado completo filtrado, o servidor reenvia os eventos perdidos (`seq` maior que o último enviado àquele assento, em ordem, via `eventLog` em visão pública sem assento), `presence` dos demais assentos e o `turnTimer`; o assento volta a `connected`. A identidade da PRÓPRIA carta coberta NÃO vem do replay: vem do estado completo (`privates[seat].ownCovered`). Eventos enviados a um socket já morto antes de o servidor notar a queda contam como entregues; o cliente deve tratar salto de `seq` como pedido de resincronização pelo estado. Janela expirada: `onLeave` -> o assento vira bot (`isBot: true`, `status: 'bot'`, `presence 'bot'`), que age nos turnos dele após `botThinkMs` por `botAction` + `applySeriesAction` (a mesma porta das ações humanas; um timer de segurança de turno segue armado). Saída consentida (`room.leave()`) durante a partida: bot na hora, sem janela. O dono volta a qualquer momento por um novo join com o mesmo `userId` (a sala é destrancada quando o bot assume): substitui o bot, que tem a ação pendente cancelada (o `sync` rearma só o relógio do humano). Quem não é o dono recebe `ROOM_FULL`. Antes da partida (`waiting`) nada muda: sair libera o assento.

**Segurança da retomada.** Duas camadas. (1) O core valida o token de reconexão POR SESSÃO (`hasReservedSeat`/`checkReconnectionToken`): token de um assento não abre outro. (2) `reconnectUpgradeGuard` (`src/rooms/reconnectGuard.ts`, `beforeUpgrade` do `WebSocketTransport`) exige identidade no upgrade da reconexão (`_authToken` na URL ou `Authorization: Bearer`) e recusa com 403 se o `userId` apresentado não é o do assento da sessão (`TrucoRoom.authorizeReconnect`). TEMPORÁRIO (`TODO(2G)`): em `development`/`test` a identidade é o token `dev:<userId>`; em qualquer outro `NODE_ENV` (inclusive ausente) toda reconexão é recusada. O 2G troca por JWT. Rate limit, strikes (`INVALID_PAYLOAD`) e contadores vivem por assento e sobrevivem à reconexão e à retomada. Teto de `maxReconnects` (20) reconexões/retomadas por assento: acima disso a queda vai direto para o bot e o dono não retoma.

**Abandono.** Sem nenhum humano conectado por `abandonMs` (padrão: a janela de reconexão), ou quando todos os humanos saíram de vez, a série é cancelada (`seriesCancelled`, `phase: 'finished'`, sem vencedor) e a sala fecha após `finishDelayMs`.

**`voteCancel`.** Vale a unanimidade dos humanos CONECTADOS (bot não vota; ausente não conta). O voto zera a cada `handStarted` e é descartado quando o votante cai ou vira bot; se a queda deixa só votantes entre os conectados, a série cancela.

**Config só do servidor** (`TrucoRoomConfig`, nada vem do cliente): `reconnectSeconds` (padrão `RECONNECT_SECONDS` = 60; aceita fração em teste), `botThinkMs` (600), `abandonMs` (= janela), `maxReconnects` (20). Sem variável de ambiente nova.

## Limite por IP no matchmaking

`POST /matchmake/*` (criar/entrar em sala) tem janela deslizante em memória por IP: padrão 20 req/min, configurável só pelo servidor (`MATCHMAKE_RATE_LIMIT_PER_MIN`); excesso responde `429` com `Retry-After`. O IP vem do socket. Atrás de proxy reverso o socket é o do proxy: defina `TRUST_PROXY=true` para usar o último item de `X-Forwarded-For` (só se todo o tráfego passa pelo proxy; DESLIGADO por padrão). É por processo: com várias instâncias o limite efetivo é multiplicado (Redis fica para depois). O `ctx.ip` do Colyseus confia em cabeçalhos forjáveis e não é usado.

## Chaves Redis

Desenhadas em `docs/banco-de-dados.md` (seção 2): prefixo `trucaco:v1:`, refresh rotativo com detecção de reuso, `jti`, presença, filas de matchmaking por variante e rate limit compartilhado, cada uma com tipo, TTL, quem escreve e quem lê. O cliente Redis ainda não existe (blocos 2G/2H).

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
pnpm --filter @trucaco/server test:int      # integração (*.int.test.ts); lê TEST_DATABASE_URL, nunca DATABASE_URL
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
