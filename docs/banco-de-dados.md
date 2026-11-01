# Banco de dados: Postgres e Redis

Autor: `dalva-dba` (bloco 2C da Fase 2). Fonte do schema: `apps/server/prisma/schema.prisma` e a migração `apps/server/prisma/migrations/20261101173134_init/migration.sql`. Contrato de acesso: `apps/server/src/db/` (interfaces `UserRepository` e `MatchRepository`, implementação Prisma e em memória). Conquistas, missões e ranking (Fases 6 e 9, `docs/gamificacao.md`) NÃO estão modelados ainda: nada aqui os bloqueia (tabelas novas apontam para `users.id` e `matches.id`).

## 1. Postgres

### Princípios

- **Ids**: UUID aleatório (`@default(uuid())`, gerado pelo Prisma, v4). Nada sequencial: evita enumeração e IDOR. O tipo é `uuid` nativo.
- **Minimização de dados (LGPD)**: `users` não guarda e-mail, nome real, avatar do provedor nem senha. Só `provider`, `provider_subject` (o `sub` do Google/Apple ou um id aleatório para convidado), apelido e datas.
- **Nomes**: tabelas e colunas em `snake_case` (`@@map`/`@map`); enums nativos do Postgres também em `snake_case`.
- **Regras que o Prisma não expressa** estão no SQL da migração, em bloco "EDITADO À MÃO". Ao gerar uma migração nova (`db:migrate`) confira o diff: o `migrate diff` não detecta `CHECK` nem o índice em `lower(nickname)`, então eles não são descartados, mas uma recriação de tabela os perderia.

### Tabelas

| Tabela          | Chave                                  | Pontos de decisão                                                                                                                                                                    |
| --------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`         | `id`                                   | `UNIQUE(provider, provider_subject)`; `UNIQUE (lower(nickname))`; `CHECK` apelido 3..16 caracteres e sem espaço nas pontas                                                           |
| `avatars`       | `user_id` (PK e FK)                    | Um por usuário por construção. `parts` é o `AvatarParts` (JSON, objeto) validado no servidor; o banco só garante `jsonb_typeof = 'object'`                                           |
| `matches`       | `id`                                   | Só partidas terminadas ou canceladas (nada em andamento). `seed` é `BIGINT` porque a semente é uint32. `events` em visão pública; `deals` só auditoria                               |
| `match_players` | `(match_id, seat)`                     | A PK composta é o `UNIQUE(match, seat)`. `user_id` NULL = bot ou usuário removido; `bot_from` = `seq` em que o bot assumiu. `CHECK` assento 0..3 e `team = seat % 2`                 |
| `partner_codes` | `id`, `UNIQUE(user_a_id, user_b_id)`   | Par ordenado: `CHECK (user_a_id < user_b_id)`. O repositório ordena (`orderPair`) por string UUID minúscula, que coincide com a ordem de bytes do tipo `uuid`. `codes` é objeto JSON |
| `reports`       | `id`                                   | `reporter_id`, `reported_id`, `match_id` anuláveis (viram NULL se a origem for apagada: a denúncia sobrevive). `text` ≤ 500. `CHECK` reporter ≠ reported                             |
| `blocks`        | `id`, `UNIQUE(blocker_id, blocked_id)` | `CHECK (blocker_id <> blocked_id)`                                                                                                                                                   |

### Remoção de usuário (`onDelete`)

| Relação                               | Regra     | Efeito                                                                                        |
| ------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `avatars.user_id`                     | `Cascade` | Dado pessoal do usuário: some com ele                                                         |
| `blocks.*`, `partner_codes.user_*_id` | `Cascade` | Relações pessoais: somem. O outro lado perde o bloqueio ou os códigos da dupla                |
| `match_players.user_id`               | `SetNull` | O histórico da mesa permanece, com o assento anonimizado (a listagem mostra `nickname: null`) |
| `reports.reporter_id`, `reported_id`  | `SetNull` | Evidência de moderação preservada sem identificar                                             |
| `reports.match_id`                    | `SetNull` | Expurgar uma partida não apaga a denúncia                                                     |
| `match_players.match_id`              | `Cascade` | Única cascata de match: apagar a partida leva seus jogadores                                  |

### Índices e a consulta que cada um atende

| Índice                                                   | Consulta                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `users_provider_provider_subject_key` (UNIQUE)           | `findByProvider` no login (guest, Google, Apple) e `POST /auth/link`                             |
| `users_nickname_lower_key` (UNIQUE em `lower(nickname)`) | Apelido único sem diferenciar caixa; busca por apelido sem diferença de caixa (`lower(...) = ?`) |
| `match_players_user_id_match_id_idx`                     | `GET /matches`: partidas de um usuário (junta com `matches` por `match_id`)                      |
| `matches_ended_at_id_idx` (`ended_at DESC, id DESC`)     | Ordenação e cursor `(ended_at, id)` de `GET /matches`; expurgo por `ended_at`                    |
| `blocks_blocker_id_blocked_id_key` (UNIQUE)              | "Quem eu bloqueei" (prefixo `blocker_id`) e `addBlock` idempotente                               |
| `blocks_blocked_id_idx`                                  | "Quem me bloqueou": o sorteio de mesa pública checa os dois sentidos                             |
| `partner_codes_user_a_id_user_b_id_key` (UNIQUE)         | `GET/PUT /me/partners/:id/codes` e duplas frequentes do lado A                                   |
| `partner_codes_user_b_id_idx`                            | Duplas frequentes do lado B                                                                      |
| `reports_status_created_at_idx`                          | Fila de moderação: reports abertos, mais antigos primeiro                                        |
| `reports_reported_id_created_at_idx`                     | Histórico de denúncias contra um jogador (decidir banimento)                                     |
| `reports_reporter_id_created_at_idx`                     | Limitar denúncias por autor (abuso do recurso)                                                   |
| `reports_match_id_idx`                                   | Denúncias de uma partida e o `SetNull` do expurgo sem varredura                                  |

`GET /matches` pagina por cursor (`endedAt`, `id`) em vez de `OFFSET`: o custo não cresce com a página e o empate de `ended_at` é resolvido pelo id. O cursor é opaco (base64url) e o servidor devolve `InvalidInputError` se vier adulterado. Tamanho de página padrão 20, máximo 50. O resumo devolvido não contém `events`, `deals` nem `seed`.

### Retenção (política proposta; o expurgo é um job do bloco 2H/`diego-devops`, ainda NÃO implementado)

| Dado                                  | Retenção                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `matches.deals` (cartas de todos)     | 30 dias; depois `UPDATE matches SET deals = NULL WHERE ended_at < now() - interval '30 days'`. Nunca sai por REST        |
| `matches.events` e a linha da partida | 12 meses (auditoria anti-trapaça e disputas); depois `DELETE FROM matches WHERE ended_at < now() - interval '12 months'` |
| Partidas `cancelled`                  | 30 dias (não contam para missão, conquista nem rating)                                                                   |
| `reports`                             | Fechadas (`reviewed`/`dismissed`): 12 meses após `reviewed_at`; abertas: até serem tratadas                              |
| Convidados inativos                   | Sem partida e `last_seen_at` com mais de 90 dias: apagar o usuário (as partidas ficam anonimizadas pelo `SetNull`)       |

Prazos são propostas para o usuário confirmar (privacidade/jurídico); mudar um prazo não exige migração.

### Observações e limites conhecidos

- O `CHECK` de assento é 0..3. A mesa de 6 (Fase 8) troca `match_players_seat_check` e `match_players_team_check` (`team = seat % 2` continua válido).
- O tamanho de 140 caracteres por código de `partner_codes` e a forma de `AvatarParts` são validados no repositório/servidor, não no banco (o Postgres não permite subconsulta em `CHECK`).
- `lower()` depende do locale do cluster para letras não ASCII. Para o apelido ser unívoco entre caixas em qualquer locale, o bloco 2G deve restringir o conjunto de caracteres do apelido (por exemplo letras, números, `_`, `-`, `.`) ou normalizar antes de gravar.
- `gen_random_uuid()` não é usado como default: o Prisma gera o UUID no cliente. Inserções SQL diretas precisam informar `id`.

## 2. Redis

Uso: sessão, presença e coordenação entre instâncias. **Nada que só o Redis guarda é insubstituível**: perder o Redis desloga todos (refresh tokens) e zera filas e presença, nunca perde partida ou perfil. Em produção, `appendonly yes` (`everysec`) preserva as famílias de refresh em um restart.

### Convenções

- Prefixo e versão: `trucaco:v1:`. Mudou o formato de um valor: sobe para `v2` e deixa o TTL expirar a `v1`.
- **Sem dados pessoais em claro**: nunca o token, o e-mail, o apelido nem o IP. Tokens entram como `sha256` em hex; IP como `HMAC-SHA256` (chave derivada do `JWT_SECRET`, sem variável nova) truncado em 16 hex. `userId` (UUID pseudonimizado) pode aparecer.
- **Todo valor tem TTL** (nenhuma chave eterna). Um erro de limpeza não vira vazamento de memória.
- Escritas que precisam ser atômicas usam Lua ou `SET NX`/`HSETNX`; o cliente (`ioredis`) é do bloco 2G/2H, não existe ainda.
- O driver e a presença do Colyseus (`@colyseus/redis-driver`/`-presence`, só com mais de uma instância) gravam chaves próprias fora do prefixo `trucaco:v1:`. Em produção, use um Redis (ou DB lógico) dedicado a elas, para um `FLUSH`/`SCAN` nosso nunca tocar nelas.

### Chaves

| Chave                                  | Tipo / valor                                                                                        | TTL                                                                                                         | Escreve                                                     | Lê                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `trucaco:v1:rt:{sha256(refreshToken)}` | HASH: `userId`, `familyId`, `issuedAt`, `usedAt` (ausente até a rotação)                            | 30 dias (vida do refresh)                                                                                   | `/auth/guest`, `/auth/refresh`                              | `/auth/refresh`                                |
| `trucaco:v1:rtfam:{familyId}`          | HASH: `userId`, `createdAt`, `revokedAt` (ausente enquanto válida)                                  | 30 dias, renovado a cada rotação                                                                            | `/auth/refresh`, logout, detecção de reuso                  | `/auth/refresh`, `onAuth` opcional             |
| `trucaco:v1:userfam:{userId}`          | SET de `familyId` do usuário                                                                        | 30 dias, renovado a cada rotação                                                                            | `/auth/guest`, `/auth/refresh`                              | "sair de todos", banimento, remoção de conta   |
| `trucaco:v1:jti:revoked:{jti}`         | STRING `1`                                                                                          | Tempo que falta para o access JWT expirar (máx. 15 min)                                                     | logout, banimento                                           | `onAuth` e middleware REST                     |
| `trucaco:v1:jti:used:{jti}`            | STRING `1` criada com `SET NX EX`                                                                   | Tempo que falta para o token expirar                                                                        | Quem consome token de uso único (ex.: vínculo `/auth/link`) | o mesmo `SET NX` (falha = reuso)               |
| `trucaco:v1:presence:{userId}`         | STRING `{instanceId}:{roomId}` (ou `lobby`)                                                         | 90 s, renovado a cada 30 s                                                                                  | `LobbyRoom`/`TrucoRoom` (heartbeat)                         | Lobby (sessão dupla, "dupla online")           |
| `trucaco:v1:mm:q:{variant}`            | ZSET, membro `userId`, score = `enqueuedAt` (ms). FIFO por score. `variant` = `paulista`\|`mineiro` | 15 min renovado a cada entrada; membros com mais de 120 s são removidos pelo sorteador (`ZREMRANGEBYSCORE`) | `LobbyRoom` (entrar/sair da fila)                           | Sorteador (monta mesas de 4)                   |
| `trucaco:v1:mm:ticket:{userId}`        | STRING `{variant}`: garante uma fila por jogador                                                    | 120 s                                                                                                       | `LobbyRoom`                                                 | `LobbyRoom`                                    |
| `trucaco:v1:mm:lock:{variant}`         | STRING `{instanceId}` com `SET NX PX`                                                               | 2 s                                                                                                         | Sorteador                                                   | Sorteador (um por variante)                    |
| `trucaco:v1:rl:{scope}:{subjectHash}`  | ZSET de timestamps (janela deslizante) ou STRING contador (`INCR` + `EXPIRE` na primeira)           | Tamanho da janela + 1 s                                                                                     | Middleware de limite                                        | O mesmo (Lua: checar e registrar numa chamada) |

Detalhes:

- **Refresh rotativo com detecção de reuso.** Cada refresh pertence a uma família (`familyId`), criada no login. Em `/auth/refresh`: busca `rt:{hash}`; se a família estiver revogada, recusa. `HSETNX rt:{hash} usedAt <agora>` devolve 1 só para o primeiro uso: esse emite o novo par e grava o novo `rt:` na mesma família. Devolveu 0 (token já usado) é **reuso**: grava `revokedAt` na família (e revoga o `jti` do access vigente), recusa e registra log de segurança. Um token roubado e o legítimo não coexistem: o segundo a apresentar um refresh antigo derruba a família. Hash inexistente = token desconhecido ou expirado (401, sem efeito colateral). O `rt:` usado permanece até o TTL justamente para que o reuso seja detectável.
- **`jti`**: o access JWT (15 min) não consulta o Redis por padrão; só `jti:revoked` é checado quando há revogação explícita (logout, banimento). `jti:used` serve a tokens de uso único curtos (vínculo de conta, ticket de entrada), por `SET NX EX`.
- **Presença**: uma chave por usuário, não um SET global, para o TTL expirar sozinho quando a instância cai. `status` na mesa (`online`/`away`/`bot`) continua no estado da sala; esta chave é só para o lobby.
- **Matchmaking**: só mesas públicas `single`. ZSET dá FIFO, deduplicação e remoção O(log n) ao cancelar; LIST não remove do meio. Bloqueios (`blocks`) são consultados no Postgres ao montar a mesa, não no Redis. O sorteador faz `ZRANGE` dos mais antigos sob `mm:lock`, valida bloqueios entre os candidatos e remove os escolhidos com `ZREM` na mesma seção crítica.
- **Rate limit** (valores iniciais, a confirmar no 2G): `mm-ip` 20/min por IP (`MATCHMAKE_RATE_LIMIT_PER_MIN`, hoje em memória e passa a Redis com mais de uma instância), `auth-guest-ip` 10 por hora por IP, `auth-refresh-user` 30/min por usuário. Limites de chat, sinal e sfx continuam em memória da sala: a sala vive em um processo só e o limite é por `userId` (decisão do plano da Fase 2), sem custo de rede por mensagem.

### O que não vai ao Redis

Estado da partida (vive na memória da sala), cartas, mensagens de chat, tokens em claro, e-mail, IP em claro, qualquer dado que precise sobreviver a um restart (vai para o Postgres).
