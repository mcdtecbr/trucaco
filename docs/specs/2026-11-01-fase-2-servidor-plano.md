# Fase 2: plano do servidor Colyseus

**Estado: concluído em 2026-11-01; divergências do plano:**

- **Sem `LobbyRoom`**: o lobby é REST (`/tables`, `/tables/join`, `/queue`) + `matchMaker`, que devolve reserva de assento. Motivo em `apps/server/README.md` ("Desenho e por que"). A `LobbyRoom` do core publicava a lista de mesas e não tinha fila.
- **JWT HS256** (`jose`), não assimétrico: só este servidor emite e verifica. ES256 fica para quando houver verificador externo.
- **Código de sala com 8 caracteres** (decisão do usuário após a auditoria), não 6.
- **Revisão pela Rita-C** (`rita-revisora-claude`, `opus`), no lugar do Codex: o container não tem o Codex CLI.
- **Build gera `dist/main.js`** (não `dist/index.js`); o `index.ts` só exporta funções puras.
- **`userId` não está em `players[]`** do schema (ver a linha de `TableState` abaixo).
- **`error` leva só `code`**: não há campo `message` (o tipo do protocolo não o tem).

Pendências e ressalvas: `docs/plano-desenvolvimento.md`, Fase 2.

Autor: `artur-arquiteto` (somente leitura), 2026-11-01. Complementa a §5 do design (`2026-11-01-trucaco-design.md`). Onde houver divergência com a §5, vale este plano e a §5 deve ser atualizada pelo `teo-docs` (`@filter` virou `StateView`; eventos em camelCase).

Versões conferidas no registro do npm em 2026-11-01. **A API de cada pacote ainda precisa ser confirmada nos `.d.ts` instalados** (a documentação web do Colyseus estava bloqueada no ambiente de planejamento).

## Estado de partida

- `apps/server/src/index.ts` só tem `buildHealth()`. Sem Colyseus, Prisma nem bundler.
- Motor (`packages/rules`) completo: `startSeries`, `applySeriesAction`, `cancelSeries`, `legalActions`, `pendingSeat`, `viewFor`, `publicEvent`, `botAction`. `GameEvent` em camelCase (`betCalled`, `betRaised`, `handDecided`…).
- `Card/Rank/Suit` existem em `protocol` e em `rules` (lint proíbe `rules` importar pacotes internos).

## Blocos (S = exige `vitor-seguranca`)

| Bloco                         | Agente                        | Depende de    | Pronto quando                                                                        |
| ----------------------------- | ----------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| 2A protocolo (**S**)          | `caio-colyseus`               | —             | Compila; `index.test.ts` cobre constantes                                            |
| 2B runtime do servidor        | `diego-devops`                | —             | `pnpm build` gera `dist/index.js` executável; `/health` responde                     |
| 2C schema Prisma              | `dalva-dba`                   | 2B            | `prisma migrate dev` em banco limpo; `prisma generate` no CI; doc das chaves Redis   |
| 2D `TrucoRoom` núcleo         | `caio-colyseus`               | 2A, 2B        | 4 clientes jogam uma mão e uma `bo3` inteira (incluindo onze e ferro, `rng` semeado) |
| 2E reconexão e bot            | `caio-colyseus`               | 2D            | Testes: cai/reconecta, expira e o bot joga                                           |
| 2F sinais, sfx, chat (**S**)  | `caio-colyseus`               | 2D            | Testes de rate limit e de não vazamento entre canais                                 |
| 2G auth e REST (**S**)        | `caio-colyseus`               | 2C            | guest → JWT → entra na sala (teste de integração)                                    |
| 2H `LobbyRoom` + persistência | `caio-colyseus` + `dalva-dba` | 2D, 2G        | Testes de sala; log completo gravado em `matches`                                    |
| 2I CI e testes                | `catia-qa` + `diego-devops`   | 2C (paralelo) | Postgres e Redis no workflow; `@colyseus/testing`                                    |

Depois de cada bloco: revisão (`rita-revisora`, ou `rita-revisora-claude` se o Codex faltar). `vitor-seguranca` ao final de 2A, 2F, 2G e 2H. `teo-docs` atualiza a §5 e o README do servidor.

Escopo de 2G: `POST /auth/guest`, `/auth/refresh` (rotativo em Redis), `/auth/link` (só o contrato, stub), `GET/PUT /me`, `/me/avatar`; `onAuth` estático com `jose`; `JWT_SECRET` obrigatório e sem valor padrão. Google e Apple ficam para a Fase 3 (stub 501).

## Contrato em `packages/protocol` (`messages.ts`, `room.ts`, `errors.ts`)

**Opções de sala:** `RoomOptions { variant; format: 'single'|'bo3'; ironHand: boolean; visibility: 'public'|'private' }`, `JoinOptions { code?; partnerUserId? }`, `ROOM_CODE_LENGTH = 8` (decisão do usuário após a auditoria: 6 era adivinhável por força bruta) e alfabeto de 31 símbolos sem caracteres ambíguos (sem `0`, `O`, `1`, `I`, `L`). `bo3` só em mesa privada.

**Cliente → servidor** (nunca levam `seat`; o servidor deriva do `client`): `play {card, covered?}`, `playBlind {index}`, `bet` (o servidor escolhe `callBet` ou `raiseBet` pelo estado), `accept`, `run`, `special {decision: 'play'|'run'}`, `signal {signalId}`, `sfx {sfxId}`, `chat {scope: 'partner'|'table', text}` ou `{scope, phraseId}`, `voteCancel`, `ready`.

**Servidor → cliente:** `event {seq, at, event: PublicGameEvent}`, `signal {seat, signalId, at}`, `sfx {seat, sfxId, at}`, `chat {scope, seat, text|phraseId, at}`, `error {code, message?}`, `presence {seat, status: 'online'|'away'|'bot'}`, `turnTimer {seat, deadlineAt}`.

**Constantes:** `TURN_TIMEOUT_MS = 20000`, `RECONNECT_SECONDS = 60`, `SFX_COOLDOWN_MS = 5000`, `SFX_IDS` (vem de `docs/audio.md`; `packages/avatar` passa a reexportar de `protocol`), `QUICK_PHRASES`.

**Erros (`ErrorCode`):** os `RuleErrorCode` do motor copiados literalmente, mais `NOT_SEATED`, `ROOM_FULL`, `ROOM_NOT_FOUND`, `INVALID_CODE`, `INVALID_PAYLOAD`, `RATE_LIMITED`, `INVALID_SIGNAL`, `INVALID_SFX`, `CHAT_BLOCKED`, `UNAUTHORIZED`, `TOKEN_EXPIRED`. Um teste no servidor, que importa os dois pacotes, garante que o conjunto cobre `RuleErrorCode`.

**Eventos públicos:** vale o nome camelCase do motor (sem tabela de tradução). `protocol` declara `PublicGameEvent` estruturalmente igual ao do motor, com comentário de sincronia; o servidor atribui `const e: protocol.PublicGameEvent = publicEvent(ev, seat)` e o `tsc` acusa divergência. O grito do avatar vem de `BET_CRY_BY_VALUE` (3 e 4 → truco; 6; 8; 9 → nove; 10; 12). O cliente infere o `betAccepted` implícito em `betRaised` (documentar no tipo).

**Schema da mesa (`TableState`):** `roomCode`, `options`, `phase` (`waiting|playing|finished`), `players[4] {seat, nickname, avatar, status, handSize, isBot}`, `series`, `game {scores, handNumber, pe}`, `hand {vira, special, specialTeam, phase, turn, value, level, pending?, tricks, current}`, `turnDeadlineAt`, `cancelVotes`. **`userId` foi removido do schema compartilhado** (decisão tomada na implementação, 2026-11-01): o estado vai a todos os clientes, então o `userId` ficaria exposto a quem está na mesa. Ele fica só em memória do servidor (mapa por assento, usado para reserva, retomada do dono e vínculo do lobby); a identidade pública é `seat` + `nickname`. Por assento, só para o dono: cartas na mão (na mão de ferro, só `handSize`), `legalActions` (ids: `play:<rank><suit>`, `playCovered:…`, `playBlind:<i>`, `bet`, `accept`, `run`, `specialPlay`, `specialRun`) e `partnerCards` na decisão de onze/dez. Carta coberta alheia aparece como `{covered: true}`, sem rank.

## Decisões

1. **Manter a duplicação** de `Card`, `Seat`, `Team`, `ErrorCode` e `PublicGameEvent`. A sincronia fica garantida por atribuição tipada no servidor (`apps/server/src/game/contract.test.ts`). Não relaxar o lint; reavaliar na Fase 8.
2. **A verdade é o `SeriesState` do motor, em memória na sala** (`this.series`), nunca no schema. A cada ação: `applySeriesAction` e depois `projectState(series, this.state)`, que recalcula o schema a partir de `viewFor` por assento. `hands` nunca vai ao schema. A projeção fica isolada em `apps/server/src/game/projection.ts`.
3. **Timer de 20 s** com `this.clock.setTimeout`, reiniciado a cada mudança de `pendingSeat`. Ao expirar, `botAction` joga aquela jogada. O jogador só fica "ausente" após 2 expirações seguidas.
4. **Reconexão:** `allowReconnection(client, 60)`. Expirados os 60 s, o assento vira bot (`isBot`), que age sem esperar 20 s; se o jogador volta, substitui o bot. `rng` da sala = `mulberry32(seed)` com seed de `crypto.randomInt`, gravada em `matches` para reprodução.
5. **Runtime:** `tsup` (ESM, `target node22`, empacota só `@trucaco/*`), `tsx watch` em desenvolvimento. `Server` + `WebSocketTransport` + `express` direto, sem `@colyseus/tools`. Versões a fixar (conferidas no npm): `colyseus 0.18.10`, `@colyseus/schema 5.0.43` (sem decoradores: `schema()`/`t.*`), `@colyseus/testing 0.18.6`, `@colyseus/redis-driver` e `-presence` 0.18.x (só em produção com mais de uma instância), `express 5.3.0`, `jose 6.2`, `ioredis 6.0`, `@prisma/client 7.10.1` + `@prisma/adapter-pg`. **Verificar:** `prisma.config.ts` e a geração do client no CI. Não usar `prisma@8` em RC.
6. **Testes:** salas com `@colyseus/testing` e 4 clientes. Postgres (`postgres:16.6-alpine`) e Redis (`redis:7.4-alpine`) como `services:` do job do servidor no `ci.yml`. Persistência atrás de interfaces (`MatchRepository`, `TokenStore`) com implementação em memória nos testes de sala; testes de integração em `*.int.test.ts`.
7. **Log em `matches`:** `events jsonb` (array `[{seq, at, event}]` em visão pública), `seed`, `options`, `winnerTeam`, `games`; `deals jsonb` só para auditoria e nunca exposto por REST. `match_players` guarda `seat`, `userId` e `botFrom?` para a Fase 6 não creditar missão a quem estava ausente.

## Riscos

- `.view()` mal aplicado vaza cartas: teste obrigatório que decodifica o patch de cada cliente e procura cartas alheias. Uma `StateView` por cliente, recriada na reconexão.
- `legalActions` no schema serve só para o cliente habilitar botões. O servidor revalida tudo pelo motor e nunca aceita `seat` do cliente.
- Rate limit por `userId` (não por `sessionId`), inclusive no lobby. Mensagens `INVALID_PAYLOAD` repetidas levam a expulsão.
- JWT sem valor padrão; refresh rotativo com detecção de reuso.
- Colyseus 0.18 e schema 5 são recentes: isolar a projeção para a API do schema não contaminar o resto.
- A §5 do design ainda cita `@filter` e eventos `snake_case`: atualizar para não induzir o cliente da Fase 3 ao erro.

## Decisões pendentes do usuário (com padrão)

1. Eventos públicos em camelCase do motor, com atualização da §5? **Padrão: sim.**
2. Google e Apple na Fase 3, com só guest e refresh agora? **Padrão: sim, stubs 501.**
3. Timer expirado joga automaticamente; "ausente" só após 60 s desconectado ou 2 expirações seguidas? **Padrão: sim.**
4. Sala sem humanos conectados por 60 s encerra com `cancelSeries`, registrada como cancelada? **Padrão: sim.**
5. Prisma 7 com `@prisma/adapter-pg`, ou Prisma 6.x LTS? **Padrão: Prisma 7.10; a `dalva-dba` verifica o guia oficial antes.**
