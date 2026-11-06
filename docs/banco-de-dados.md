# Banco de dados: Postgres e Redis

Autor: `dalva-dba` (bloco 2C da Fase 2). Fonte do schema: `apps/server/prisma/schema.prisma` e as migrações `apps/server/prisma/migrations/20261101173134_init` (modelo) e `20261101190000_nickname_policy_json_limits` (política de apelido e tetos de tamanho, escrita à mão). Contrato de acesso: `apps/server/src/db/` (interfaces `UserRepository` e `MatchRepository`, implementação Prisma e em memória). Conquistas, missões e estatísticas (Fase 6, bloco 6C, migração `20261105140000_fase6_progressao`, ADR 0009) estão modelados abaixo; o ranking (Fase 9) ainda não (tabelas novas apontarão para `users.id` e `matches.id`). `ProgressionRepository` fica em `src/db/` (Prisma e memória).

## 1. Postgres

### Princípios

- **Ids**: UUID aleatório (`@default(uuid())`, gerado pelo Prisma, v4). Nada sequencial: evita enumeração e IDOR. O tipo é `uuid` nativo.
- **Minimização de dados (LGPD)**: `users` não guarda e-mail, nome real, avatar do provedor nem senha. Só `provider`, `provider_subject` (o `sub` do Google/Apple ou um id aleatório para convidado), apelido e datas.
- **Nomes**: tabelas e colunas em `snake_case` (`@@map`/`@map`); enums nativos do Postgres também em `snake_case`.
- **Regras que o Prisma não expressa** estão no SQL da migração, em bloco "EDITADO À MÃO". Ao gerar uma migração nova (`db:migrate`) confira o diff: o `migrate diff` não detecta `CHECK` nem o índice em `lower(nickname)`, então eles não são descartados, mas uma recriação de tabela os perderia.

### Tabelas

| Tabela                | Chave                                  | Pontos de decisão                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `id`                                   | `UNIQUE(provider, provider_subject)`; `UNIQUE (lower(nickname))`; `CHECK` apelido 3..16 caracteres, NFC e só caracteres permitidos (seção Política de apelido)                                                                                                      |
| `avatars`             | `user_id` (PK e FK)                    | Um por usuário por construção. `parts` é o `AvatarParts` (JSON, objeto) validado no servidor; o banco garante `jsonb_typeof = 'object'` e `pg_column_size < 16 KB`                                                                                                  |
| `matches`             | `id`                                   | Só partidas terminadas ou canceladas (nada em andamento). `seed` é `BIGINT` porque a semente é uint32. `events` em visão pública; `deals` só auditoria                                                                                                              |
| `match_players`       | `(match_id, seat)`                     | A PK composta é o `UNIQUE(match, seat)`. `user_id` NULL = bot ou usuário removido; `bot_from` = `seq` em que o bot assumiu. `CHECK` assento 0..3 e `team = seat % 2`                                                                                                |
| `partner_codes`       | `id`, `UNIQUE(user_a_id, user_b_id)`   | Par ordenado: `CHECK (user_a_id < user_b_id)`. O repositório ordena (`orderPair`) por string UUID minúscula, que coincide com a ordem de bytes do tipo `uuid`. `codes` é objeto JSON, `pg_column_size < 16 KB`; só grava quem já jogou junto (`havePlayedTogether`) |
| `reports`             | `id`                                   | `reporter_id`, `reported_id`, `match_id` anuláveis (viram NULL se a origem for apagada: a denúncia sobrevive). `text` ≤ 500. `CHECK` reporter ≠ reported                                                                                                            |
| `blocks`              | `id`, `UNIQUE(blocker_id, blocked_id)` | `CHECK (blocker_id <> blocked_id)`                                                                                                                                                                                                                                  |
| `user_achievements`   | `(user_id, achievement_id)`            | Fase 6. `level` 0 a N (0 = em andamento), `progress` >= 0, `unlocked_at` do nível 1 (CHECK: `level = 0` <=> `unlocked_at` nulo). `achievement_id` é texto do catálogo em código, validado pelo repositório                                                          |
| `user_missions`       | `(user_id, mission_id, period_key)`    | Fase 6. `period_key` `2026-11-04` ou `2026-W45` (America/Sao_Paulo; CHECK de formato e 8 a 10 caracteres); `target` > 0; CHECK `0 <= progress <= target`; `completed_at` nulo até concluir                                                                          |
| `user_stats`          | `(user_id, variant)`                   | Fase 6. `played`, `won` (CHECK `played >= won >= 0`); só partidas gravadas depois da migração                                                                                                                                                                       |
| `progression_applied` | `match_id` (PK e FK, cascata)          | Fase 6. Uma linha por partida já avaliada: idempotência de `applyMatchProgress` (ADR 0009)                                                                                                                                                                          |

### Partidas: `options`, `room_code` e encerramento (2H)

- `matches.options` (JSON) guarda as opções da mesa (`variant`, `format`, `ironHand`, `visibility`) e, ao fim, `endReason`: `finished` (série com vencedor), `cancelled` (cancelada por voto) ou `abandoned` (ninguém ficou conectado pela janela de 60 s, ou a sala fechou com a série em andamento). O enum `status` do banco só tem `finished` e `cancelled`; `endReason` distingue os dois casos cancelados.
- Se o log de eventos estourar o teto do `MatchRecorder` (6000 eventos ou 1 MB de texto JSON), `options` recebe `logTruncated: true` e `eventsDropped` com a quantidade de eventos que ficou de fora.
- `matches.room_code` (`VARCHAR(8)`) é dado de auditoria e NÃO pode sair por rota. `listForUser` não o seleciona; uma rota nova só o expõe com decisão explícita.
- `seed`, `events` e `deals` também não saem por REST (`listForUser` não os traz).

### Política de apelido (migração `20261101190000_nickname_policy_json_limits`)

- **Normalização**: NFC obrigatória. O servidor chama `validateNickname` (`src/db/validation.ts`), que normaliza (NFC) ANTES de validar e devolve o texto a gravar; `João` digitado com `a` + til combinante vira `João` e colide com o apelido NFC. Direto no SQL, o banco recusa o que não está em NFC (`users_nickname_nfc_check`, `normalize(nickname, NFC) = nickname`, Postgres 13+).
- **Caracteres permitidos** (`users_nickname_charset_check`, mesma expressão de `NICKNAME_PATTERN`): `0-9`, `A-Z`, `a-z`, `_`, `.`, `-` e as letras latinas de Latin-1 e Latin Extended-A/B (U+00C0 a U+024F, exceto `×` U+00D7 e `÷` U+00F7). Ficam de fora espaço (qualquer), tab, controles, zero-width, marcas bidi, combinantes soltos, emoji e outros alfabetos (cirílico, grego etc.). Comprimento 3 a 16 code points (`users_nickname_length_check`).
- **Unicidade**: `UNIQUE (lower(nickname))`. Exige banco com encoding UTF8 e locale UTF-8 (no locale `C`, `lower('Á')` não vira `á`); o `test:int` verifica.
- **Esqueleto contra imitação (7A, migração `20261106120000_nickname_skeleton`)**: `nicknameSkeleton` (`src/db/validation.ts`) dobra Latin Extended-A/B e letras com barra (`ı`, `ł`, `đ`, `ø`, `ǀ`, `ŀ`, `ƚ`, `ȷ`, `ɉ`, `ſ`, `ĸ`, `Ɩ`...) para a letra ASCII parecida, `I` para `l`, `0` para `o`, e põe em minúsculas (falso positivo aceito: `Ivo` x `lvo`). Acentos do português (Latin-1) continuam distintos (`João` x `Joao`). A unicidade é do **índice único de expressão `users_nickname_skeleton_key`** `lower(translate(nickname, de, para))` (atômico; a violação vira `NICKNAME_TAKEN` como a do `users_nickname_lower_key`); um teste confere que a migração traz as mesmas tabelas do TypeScript. A migração não apaga ninguém: nas colisões que já existiam, o mais antigo mantém o apelido e os demais viram `Jogador` + 8 hex do id (o jogador troca em `PUT /me`). **Política de apelido NOVO** (`NICKNAME_PATTERN`): ASCII, Latin-1 e, de Latin Extended, só letras que decompõem por NFD em ASCII + marca (`ā`, `ğ`...) e `ı ł đ ħ ŧ`; o resto de U+0100 a U+024F é recusado. O CHECK do banco continua mais largo, então apelidos antigos seguem carregando. Risco residual: confusáveis fora do latino ou entre ASCII além de `I`/`l`/`0`/`o` (ex.: `1`) seguem só por denúncia `offensive_nickname`.
- A migração falha, e reverte inteira, se já houver apelido fora da política; nenhum dado é apagado. Rollback: `DROP CONSTRAINT` das duas constraints novas.

### Tetos de tamanho dos jsonb

| Coluna                      | Teto no banco (`pg_column_size`, valor não comprimido) | Validação na aplicação                                                                                                                                             |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `partner_codes.codes`       | < 16 KB (`partner_codes_codes_size_check`)             | `signalId` só de `SIGNAL_IDS` (`@trucaco/protocol`), no máximo 12 chaves, valor string até `PARTNER_CODE_MAX_LENGTH` (60)                                          |
| `avatars.parts`             | < 16 KB (`avatars_parts_size_check`)                   | objeto plano validado por `parseAvatarParts` (`@trucaco/protocol`): exatamente as chaves de `AVATAR_PART_KEYS` com índices inteiros do catálogo e `voice` opcional |
| `matches.options` / `games` | < 16 KB / < 64 KB                                      | mesmos tetos em bytes de JSON (`JSON_LIMITS`)                                                                                                                      |
| `matches.deals` / `events`  | < 1 MB / < 2 MB                                        | idem; uma partida real fica na ordem de centenas de KB                                                                                                             |

Decisão do 2H: o `MatchRecorder` limita o próprio buffer de eventos (6000 eventos e 1 MB de texto JSON) e, ao estourar, descarta o excedente e marca `logTruncated`/`eventsDropped` em `options` (seção "Partidas"). Nada é descartado em silêncio. `saveMatch` ainda lança `InvalidInputError` se o banco recusar um teto real (CHECK).

### Erros de persistência e vínculo de dupla

- **Nunca logar o erro bruto do Prisma.** Numa violação de CHECK, `meta.driverAdapterError.cause.detail` traz a linha inteira ("Failing row contains ..."), inclusive `deals` com as cartas de todos. Os repositórios (`guarded` em `prismaErrors.ts`) relançam apenas erros de domínio sem `cause`, `meta`, `detail` nem valores: `InvalidInputError` (entrada recusada; `constraint` com o NOME da constraint), `NicknameTakenError`, `ProviderSubjectTakenError`, `NotPartnersError` e `PersistenceError` (`code` e `constraint`). O nome vem do campo estruturado `meta.driverAdapterError.cause.constraint` (string ou `{ index }`; o CHECK não o traz e cai para o texto `... constraint "nome"` do Postgres, só aceitando identificadores simples).
- **Ids**: todo id de entrada é validado como UUID e normalizado para minúsculas; o resto vira `InvalidInputError` (o 2G devolve 400), nunca chega cru ao banco.
- **`savePartnerCodes` exige vínculo**: `havePlayedTogether(a, b)` = existe partida `finished` em que os dois foram `match_players` da MESMA `team`. Sem vínculo, `NotPartnersError` (o 2G mapeia para 403). Impede que um usuário grave códigos para qualquer `partnerId`.
- **Paridade**: `memoryRepositories` valida o mesmo que o banco recusa (`assertFinishedMatch`, usuário inexistente, ids, apelido), para o teste de sala não ficar verde com gravação que falharia em produção. O conjunto de casos inválidos (`parityCases.ts`) roda contra os dois.

### Remoção de usuário (`onDelete`)

| Relação                                                                    | Regra     | Efeito                                                                                        |
| -------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `avatars.user_id`                                                          | `Cascade` | Dado pessoal do usuário: some com ele                                                         |
| `blocks.*`, `partner_codes.user_*_id`                                      | `Cascade` | Relações pessoais: somem. O outro lado perde o bloqueio ou os códigos da dupla                |
| `user_achievements.user_id`, `user_missions.user_id`, `user_stats.user_id` | `Cascade` | Progressão do jogador: some com a conta (LGPD). `DELETE /me` não precisa de código extra      |
| `progression_applied.match_id`                                             | `Cascade` | Expurgar a partida apaga a marca de idempotência                                              |
| `match_players.user_id`                                                    | `SetNull` | O histórico da mesa permanece, com o assento anonimizado (a listagem mostra `nickname: null`) |

Apagar conta (`DELETE /me`, Fase 6B) é um único `DELETE FROM users`: as linhas acima fazem o resto (sem código de limpeza no servidor). **O que `DELETE /me` apaga**: usuário, avatar, bloqueios (nos dois sentidos), combinados de dupla, conquistas, missões e estatísticas. **O que fica, anonimizado**: assentos em `match_players` (`user_id` nulo) e denúncias contra a conta. `progression_applied` é por partida, não por usuário: fica.
| `reports.reporter_id`, `reported_id` | `SetNull` | Evidência de moderação preservada sem identificar |
| `reports.match_id` | `SetNull` | Expurgar uma partida não apaga a denúncia |
| `match_players.match_id` | `Cascade` | Única cascata de match: apagar a partida leva seus jogadores |

### Índices e a consulta que cada um atende

| Índice                                                   | Consulta                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users_provider_provider_subject_key` (UNIQUE)           | `findByProvider` no login (guest, Google, Apple) e `POST /auth/link`                                                                                                      |
| `users_nickname_lower_key` (UNIQUE em `lower(nickname)`) | Apelido único sem diferenciar caixa; busca por apelido sem diferença de caixa (`lower(...) = ?`)                                                                          |
| `match_players_user_id_match_id_idx`                     | `GET /matches`: partidas de um usuário (junta com `matches` por `match_id`)                                                                                               |
| `matches_ended_at_id_idx` (`ended_at DESC, id DESC`)     | Ordenação e cursor `(ended_at, id)` de `GET /matches`; expurgo por `ended_at`                                                                                             |
| `blocks_blocker_id_blocked_id_key` (UNIQUE)              | "Quem eu bloqueei" (prefixo `blocker_id`) e `addBlock` idempotente                                                                                                        |
| `blocks_blocked_id_idx`                                  | "Quem me bloqueou": o sorteio de mesa pública checa os dois sentidos                                                                                                      |
| `partner_codes_user_a_id_user_b_id_key` (UNIQUE)         | `GET/PUT /me/partners/:id/codes` e duplas frequentes do lado A                                                                                                            |
| `partner_codes_user_b_id_idx`                            | Duplas frequentes do lado B                                                                                                                                               |
| `reports_status_created_at_idx`                          | Fila de moderação: reports abertos, mais antigos primeiro                                                                                                                 |
| `reports_reported_id_created_at_idx`                     | Histórico de denúncias contra um jogador (decidir banimento)                                                                                                              |
| `reports_reporter_id_created_at_idx`                     | Limitar denúncias por autor (abuso do recurso)                                                                                                                            |
| `reports_match_id_idx`                                   | Denúncias de uma partida e o `SetNull` do expurgo sem varredura                                                                                                           |
| `reports_reporter_id_reported_id_match_id_key` (UNIQUE)  | Uma denúncia por (denunciante, denunciado, partida): `POST /reports` repetido não grava de novo (migração `20261106100000_reports_unique`, auditoria 6I). NULL não colide |
| `user_achievements_pkey` `(user_id, achievement_id)`     | `GET /me/achievements`, perfil público (prefixo `user_id`) e a soma atômica `ON CONFLICT`                                                                                 |
| `user_missions_pkey` `(user_id, mission_id, period_key)` | Soma atômica de progresso e `ensureMissions` idempotente (`ON CONFLICT DO NOTHING`)                                                                                       |
| `user_missions_user_id_period_key_idx`                   | `GET /me/missions`: missões do usuário no dia e na semana (`period_key IN (...)`)                                                                                         |
| `user_stats_pkey` `(user_id, variant)`                   | `GET /me` e perfil público: estatísticas por variante; soma atômica                                                                                                       |
| `progression_applied_pkey` `(match_id)`                  | Decide, por partida, quem aplica a progressão (inserção única; transação concorrente espera)                                                                              |

`GET /matches` pagina por cursor (`endedAt`, `id`) em vez de `OFFSET`: o custo não cresce com a página e o empate de `ended_at` é resolvido pelo id. O cursor é opaco (base64url) e o servidor devolve `InvalidInputError` se vier adulterado. Tamanho de página padrão 20, máximo 50. O resumo devolvido não contém `events`, `deals` nem `seed`.

### Retenção (política proposta; job diário implementado no 7A, atrás de `RETENTION_ENABLED`)

| Dado                                  | Retenção                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matches.deals` (cartas de todos)     | 30 dias; depois `UPDATE matches SET deals = NULL WHERE ended_at < now() - interval '30 days'`. Nunca sai por REST                                                                                                                                                                            |
| `matches.events` e a linha da partida | 12 meses (auditoria anti-trapaça e disputas); depois `DELETE FROM matches WHERE ended_at < now() - interval '12 months'`                                                                                                                                                                     |
| Partidas `cancelled`                  | 30 dias (não contam para missão, conquista nem rating)                                                                                                                                                                                                                                       |
| `partner_codes`                       | Enquanto os dois usuários existirem (somem por `Cascade` com o usuário). Proposta: apagar pares sem `updated_at` há 12 meses. **O job de expurgo NÃO existe ainda: pendência antes do beta** (vale também para `deals`, `events`, `cancelled`, `reports` e convidados inativos desta tabela) |
| `reports`                             | Fechadas (`reviewed`/`dismissed`): 12 meses após `reviewed_at`; abertas: até serem tratadas                                                                                                                                                                                                  |
| `user_missions` de períodos antigos   | Proposta: apagar linhas com `period_key` de mais de 90 dias (pendência do job de expurgo; mudar o prazo não exige migração)                                                                                                                                                                  |
| Convidados inativos                   | Sem partida e `last_seen_at` com mais de 90 dias: apagar o usuário (as partidas ficam anonimizadas pelo `SetNull`)                                                                                                                                                                           |

Prazos são propostas para o usuário confirmar (privacidade/jurídico); mudar um prazo não exige migração.

**Job de retenção (7A, `apps/server/src/db/retention.ts`).** Com `RETENTION_ENABLED=true` roda em processo (1ª vez 5 min depois do boot, depois a cada 24 h), em lotes de 500 linhas por instrução SQL (teto de 200 lotes por passo; o resto fica para o dia seguinte), idempotente e sem sobreposição, logando só contagens. Passos: `deals` -> NULL após 30 dias; partidas `cancelled` apagadas após 30 dias; partidas apagadas após 12 meses (cascata em `match_players`; `reports.match_id` vira NULL); partidas citadas por denúncia **aberta** (`reports.status = 'open'`) não são tocadas (nem `deals`) até a moderação tratar; convidados com `last_seen_at` de mais de 90 dias, nunca vinculados, **sem** assento em partida, estatística, conquista com progresso nem denúncia aberta contra eles (as cascatas limpam avatar, bloqueios e combinados; a denúncia fechada fica anonimizada); `user_missions` de períodos com mais de 90 dias (pela chave do período). `last_seen_at` passou a ser atualizado a cada `/auth/refresh` (melhor esforço). **Ainda sem job**: `reports` fechadas (12 meses após `reviewed_at`) e `partner_codes` sem uso (12 meses). Uma instância só (estado em memória do processo).

Antes do 7A nenhum job rodava. Convidados nunca expiravam: a tabela `users` cresce a cada `POST /auth/guest` (limitado por `AUTH_GUEST_PER_IP_PER_HOUR` e `AUTH_GUEST_GLOBAL_PER_HOUR`). Se o Redis falha depois de `createGuest` gravar o usuário, sobra um convidado sem sessão, porque o repositório não tem `delete`. Expiração de convidados é decisão pendente (produto e `dalva-dba`).

### Telemetria de produto por SQL (7F)

Sem rastreamento novo no cliente: tudo sai de `users.last_seen_at` (atualizado a cada `/auth/refresh`, melhor esforço, então é "última renovação de sessão", não "último toque") e de `matches`/`match_players`. Rodar em réplica ou fora do horário de pico, só leitura, e nunca exportar `user_id` ou `nickname` para ferramenta externa: agregar sempre. Partidas apagadas pela retenção (12 meses, canceladas 30 dias) saem das contagens.

```sql
-- DAU: usuários ativos por dia (último refresh; subestima quem não renovou no dia, pois só guarda o ÚLTIMO)
SELECT date_trunc('day', last_seen_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*) AS usuarios
FROM users
WHERE last_seen_at >= now() - interval '30 days'
GROUP BY 1 ORDER BY 1;

-- DAU pelo que de fato aconteceu (mais fiel): usuários distintos que terminaram partida no dia
SELECT date_trunc('day', m.ended_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       count(DISTINCT mp.user_id) AS jogadores
FROM matches m JOIN match_players mp ON mp.match_id = m.id
WHERE m.status = 'finished' AND mp.user_id IS NOT NULL AND m.ended_at >= now() - interval '30 days'
GROUP BY 1 ORDER BY 1;

-- Partidas por jogador (histograma: quantos jogadores jogaram 1, 2, 3... partidas terminadas nos últimos 30 dias)
SELECT partidas, count(*) AS jogadores FROM (
  SELECT mp.user_id, count(*) AS partidas
  FROM matches m JOIN match_players mp ON mp.match_id = m.id
  WHERE m.status = 'finished' AND mp.user_id IS NOT NULL AND m.ended_at >= now() - interval '30 days'
  GROUP BY mp.user_id
) t GROUP BY partidas ORDER BY partidas;

-- Duplas repetidas: pares de parceiros (assentos 0/2 e 1/3) com 2+ partidas juntos (conta pares, não identifica ninguém no resultado)
SELECT partidas_juntos, count(*) AS duplas FROM (
  SELECT least(a.user_id, b.user_id) AS u1, greatest(a.user_id, b.user_id) AS u2, count(*) AS partidas_juntos
  FROM match_players a
  JOIN match_players b ON b.match_id = a.match_id AND b.seat = (a.seat + 2) % 4 AND a.seat < b.seat
  JOIN matches m ON m.id = a.match_id AND m.status = 'finished'
  WHERE a.user_id IS NOT NULL AND b.user_id IS NOT NULL
  GROUP BY 1, 2
) t GROUP BY partidas_juntos ORDER BY partidas_juntos;

-- Retenção D1 e D7 por coorte de cadastro (dia 0 = created_at). Atividade = ter terminado partida no dia
-- D+N (fuso de São Paulo). Só coortes com idade suficiente entram no denominador.
WITH coorte AS (
  SELECT id, (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia0
  FROM users  -- para só contas vinculadas: WHERE provider <> 'guest'
),
atividade AS (
  SELECT DISTINCT mp.user_id AS id, (m.ended_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
  FROM matches m JOIN match_players mp ON mp.match_id = m.id
  WHERE m.status = 'finished' AND mp.user_id IS NOT NULL
)
SELECT c.dia0,
       count(*) AS cadastros,
       round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM atividade a WHERE a.id = c.id AND a.dia = c.dia0 + 1)) / count(*), 1) AS d1_pct,
       round(100.0 * count(*) FILTER (WHERE EXISTS (SELECT 1 FROM atividade a WHERE a.id = c.id AND a.dia = c.dia0 + 7)) / count(*), 1) AS d7_pct
FROM coorte c
WHERE c.dia0 <= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7
GROUP BY c.dia0 ORDER BY c.dia0 DESC LIMIT 30;
```

Observações: convidados nunca expiram e cada logout cria um novo (ver acima), então a retenção de convidados é pessimista; filtre `provider <> 'guest'` para ver só contas vinculadas. A retenção D1/D7 por partida terminada ignora quem só abriu o app. As cinco consultas foram executadas sem erro num Postgres 16 de teste (banco quase vazio): a sintaxe está validada, os números não; conferir no staging com dados reais antes de confiar neles. O `/metrics` (README do servidor) cobre o operacional (salas, fila, erros) em tempo real; estas consultas cobrem o produto, em retrospecto.

### Observações e limites conhecidos

- O `CHECK` de assento é 0..3. A mesa de 6 (Fase 8) troca `match_players_seat_check` e `match_players_team_check` (`team = seat % 2` continua válido).
- O tamanho de 60 caracteres por código de `partner_codes`, o catálogo de `signalId` e a forma de `AvatarParts` são validados no repositório/servidor; o banco só impõe tipo e teto de bytes (o Postgres não permite subconsulta em `CHECK`).
- `lower()` depende do locale do cluster para letras não ASCII: o conjunto de caracteres do apelido já é restrito (política acima), mas o banco precisa ser UTF-8 com locale UTF-8.
- `gen_random_uuid()` não é usado como default: o Prisma gera o UUID no cliente. Inserções SQL diretas precisam informar `id`.

### Produção: conexão e papéis (pendência de infra, `diego-devops`)

- **TLS**: fora da rede privada, `DATABASE_URL` com `sslmode=verify-full` (certificado do servidor verificado, não só criptografia).
- **Dois papéis**: um de MIGRAÇÃO (dono do schema, DDL; usado só pelo passo de release com `db:deploy`) e um de RUNTIME (somente DML: `SELECT/INSERT/UPDATE/DELETE` nas tabelas, sem DDL nem `TRUNCATE`). O servidor da aplicação nunca recebe a credencial de migração.
- **Banco de teste separado**: o `test:int` só roda contra `TEST_DATABASE_URL` local (ver `apps/server/README.md`).

## 2. Redis

Uso: sessão, presença e coordenação entre instâncias. **Nada que só o Redis guarda é insubstituível**: perder o Redis desloga todos (refresh tokens) e zera filas e presença, nunca perde partida ou perfil. Em produção, `appendonly yes` (`everysec`) preserva as famílias de refresh em um restart.

### Convenções

- Prefixo e versão: `trucaco:v1:`. Mudou o formato de um valor: sobe para `v2` e deixa o TTL expirar a `v1`.
- **Sem dados pessoais em claro**: nunca o token, o e-mail, o apelido nem o IP. Tokens entram como `sha256` em hex; IP como `HMAC-SHA256` (chave derivada do `JWT_SECRET`, sem variável nova) truncado em 16 hex. `userId` (UUID pseudonimizado) pode aparecer.
- **Todo valor tem TTL** (nenhuma chave eterna). Um erro de limpeza não vira vazamento de memória.
- Escritas que precisam ser atômicas usam Lua ou `SET NX`/`HSETNX`; o cliente (`ioredis`) é do bloco 2G/2H, não existe ainda.
- O driver e a presença do Colyseus (`@colyseus/redis-driver`/`-presence`, só com mais de uma instância) gravam chaves próprias fora do prefixo `trucaco:v1:`. Em produção, use um Redis (ou DB lógico) dedicado a elas, para um `FLUSH`/`SCAN` nosso nunca tocar nelas.

### Chaves

| Chave                                                | Tipo / valor                                                                                                                       | TTL                                                                                                         | Escreve                                                     | Lê                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `trucaco:v1:rt:{sha256(refreshToken)}`               | HASH: `userId`, `familyId`, `issuedAt`, `usedAt` (ausente até a rotação), `graceUsed` (`1` depois que a janela de graça foi usada) | 30 dias (vida do refresh)                                                                                   | `/auth/guest`, `/auth/refresh`                              | `/auth/refresh`                                |
| `trucaco:v1:rtfam:{familyId}`                        | HASH: `userId`, `createdAt`, `lastJti`, `revokedAt` (ausente enquanto válida)                                                      | 30 dias, renovado a cada rotação, sem passar de `createdAt` + `REFRESH_FAMILY_MAX_SECONDS`                  | `/auth/refresh`, logout, detecção de reuso                  | `/auth/refresh`, `onAuth` opcional             |
| `trucaco:v1:userfam:{userId}`                        | SET de `familyId` do usuário                                                                                                       | 30 dias, renovado a cada rotação (poda das famílias expiradas)                                              | `/auth/guest`, `/auth/refresh`                              | "sair de todos", banimento, remoção de conta   |
| `trucaco:v1:jti:revoked:{jti}`                       | STRING `1`                                                                                                                         | Tempo que falta para o access JWT expirar (máx. 15 min)                                                     | logout, banimento                                           | `onAuth` e middleware REST                     |
| `trucaco:v1:idtoken:used:{sha256(provedor:idToken)}` | STRING `1` criada com `SET NX EX` (6F, implementado)                                                                               | Tempo que falta para o token expirar                                                                        | Quem consome token de uso único (ex.: vínculo `/auth/link`) | o mesmo `SET NX` (falha = reuso)               |
| `trucaco:v1:presence:{userId}`                       | STRING `{instanceId}:{roomId}` (ou `lobby`) (desenhado; não implementado)                                                          | 90 s, renovado a cada 30 s                                                                                  | `LobbyRoom`/`TrucoRoom` (heartbeat)                         | Lobby (sessão dupla, "dupla online")           |
| `trucaco:v1:mm:q:{variant}`                          | ZSET, membro `userId`, score = `enqueuedAt` (ms). FIFO por score. `variant` = `paulista`\|`mineiro`                                | 15 min renovado a cada entrada; membros com mais de 120 s são removidos pelo sorteador (`ZREMRANGEBYSCORE`) | `LobbyRoom` (entrar/sair da fila)                           | Sorteador (monta mesas de 4)                   |
| `trucaco:v1:mm:ticket:{userId}`                      | STRING `{variant}`: garante uma fila por jogador                                                                                   | 120 s                                                                                                       | `LobbyRoom`                                                 | `LobbyRoom`                                    |
| `trucaco:v1:mm:lock:{variant}`                       | STRING `{instanceId}` com `SET NX PX`                                                                                              | 2 s                                                                                                         | Sorteador                                                   | Sorteador (um por variante)                    |
| `trucaco:v1:rl:{scope}:{subjectHash}`                | ZSET de timestamps (janela deslizante) ou STRING contador (`INCR` + `EXPIRE` na primeira)                                          | Tamanho da janela + 1 s                                                                                     | Middleware de limite                                        | O mesmo (Lua: checar e registrar numa chamada) |

**Implementadas no 2G/2H e 6F:** `rt:`, `rtfam:`, `userfam:`, `jti:revoked:` e `idtoken:used:` (uso único do idToken social, `TokenStore.claimIdToken`). As demais chaves (`presence`, `mm:*`, `rl:*`) são o desenho para multi-instância: hoje presença, fila, rate limit e o estado do lobby ficam em memória do processo.

Detalhes:

- **Refresh rotativo com detecção de reuso.** Cada refresh pertence a uma família (`familyId`), criada no login. Em `/auth/refresh`: busca `rt:{hash}`; se a família estiver revogada, recusa. `HSETNX rt:{hash} usedAt <agora>` devolve 1 só para o primeiro uso: esse emite o novo par e grava o novo `rt:` na mesma família. Devolveu 0 (token já usado) é **reuso**: grava `revokedAt` na família (e revoga o `jti` do access vigente), recusa e registra log de segurança. Um token roubado e o legítimo não coexistem: o segundo a apresentar um refresh antigo derruba a família. Hash inexistente = token desconhecido ou expirado (401, sem efeito colateral). O `rt:` usado permanece até o TTL justamente para que o reuso seja detectável.
- **Rotação atômica (um único script Lua).** A checagem da família, o `HSETNX usedAt` e a gravação do novo `rt:` acontecem no MESMO `EVAL`; passos separados deixam uma janela em que um logout/reuso concorrente revoga a família e o novo token ainda é emitido. O script: (1) recusa se `rtfam:{familyId}` NÃO existir (família expirada ou apagada: 401, sem criar nada) ou tiver `revokedAt`; (2) `HSETNX rt:{hash} usedAt`; se 0, é reuso: grava `revokedAt` e devolve o `lastJti` para o chamador revogar o access vigente; (3) se 1, grava o novo `rt:{novoHash}`, atualiza `lastJti` e renova os TTLs de `rtfam` e `userfam`. `lastJti` (o `jti` do último access emitido da família) fica em `rtfam` justamente para a detecção de reuso e o logout revogarem o access vigente sem precisar dele na requisição.
- **Configuração do Redis em produção**: `maxmemory-policy noeviction` (despejar `rt:`/`rtfam:` sob pressão de memória deslogaria usuários ou, pior, apagaria `revokedAt` e reabilitaria uma família; com `noeviction` o Redis recusa escritas e o login falha de forma visível); `appendonly yes`; autenticação (`requirepass`/ACL) e TLS (`rediss://` em `REDIS_URL`) sempre que o Redis não estiver em rede privada isolada.
- **Janela de graça** (`REFRESH_REUSE_GRACE_SECONDS`, padrão 20 s, 0 desliga). Quem reapresenta o token que acabou de rotacionar (resposta perdida, duas abas) dentro da janela ganha um sucessor irmão, UMA vez por token (`graceUsed`); o primeiro ramo segue válido. Não dá para reemitir o mesmo sucessor, porque só o hash fica no Redis. Fora da janela, ou na segunda reapresentação, é reuso: a família cai e o `lastJti` é revogado. Trade-off aceito: quem roubou o token antigo nos primeiros segundos ganha um ramo.
- **Teto absoluto da família** (`REFRESH_FAMILY_MAX_SECONDS`, padrão 90 dias, 1 h a 365 dias). A rotação nunca estende a família além de `createdAt` + o teto: o TTL de `rt:`/`rtfam:` é cortado no que resta. Depois disso o refresh responde `INVALID_REFRESH_TOKEN`.
- **Poda**: a cada criação e revogação, `userfam:<id>` perde as famílias cujo `rtfam` já expirou.
- **`jti`**: o access JWT (15 min) não consulta o Redis por padrão; só `jti:revoked` é checado quando há revogação explícita (logout, banimento). `idtoken:used` serve ao uso único do idToken social (vínculo e login), por `SET NX EX`.
- **Presença**: uma chave por usuário, não um SET global, para o TTL expirar sozinho quando a instância cai. `status` na mesa (`online`/`away`/`bot`) continua no estado da sala; esta chave é só para o lobby.
- **Matchmaking**: só mesas públicas `single`. ZSET dá FIFO, deduplicação e remoção O(log n) ao cancelar; LIST não remove do meio. Bloqueios (`blocks`) são consultados no Postgres ao montar a mesa, não no Redis. O sorteador faz `ZRANGE` dos mais antigos sob `mm:lock`, valida bloqueios entre os candidatos e remove os escolhidos com `ZREM` na mesma seção crítica.
- **Rate limit** (desenho; nesta fase os limites são em memória por processo, ver `apps/server/README.md`; valores iniciais a confirmar): `mm-ip` 20/min por IP (`MATCHMAKE_RATE_LIMIT_PER_MIN`, hoje em memória e passa a Redis com mais de uma instância), `auth-guest-ip` 10 por hora por IP, `auth-refresh-user` 30/min por usuário. Limites de chat, sinal e sfx continuam em memória da sala: a sala vive em um processo só e o limite é por `userId` (decisão do plano da Fase 2), sem custo de rede por mensagem.

### O que não vai ao Redis

Estado da partida (vive na memória da sala), cartas, mensagens de chat, tokens em claro, e-mail, IP em claro, qualquer dado que precise sobreviver a um restart (vai para o Postgres).
