# 0009: progressão com catálogo em código e idempotência por partida

- Status: aceita (Fase 6, bloco 6C)
- Data: 2026-11-04
- Relacionada: `docs/gamificacao.md`, `docs/specs/2026-11-04-fase-6-plano.md` (decisão 3 e seção 4)

## Contexto

A Fase 6 grava conquistas, missões e estatísticas do jogador. O esboço de `docs/gamificacao.md` (seção 4) previa quatro tabelas: `achievements` e `missions` (catálogo) e `user_achievements` e `user_missions` (estado). A avaliação roda no servidor depois de `saveMatch` (bloco 6D), no mesmo processo, e pode ser reexecutada para a mesma partida (nova tentativa, falha parcial, backfill futuro). Reprocessar não pode dobrar o progresso.

## Decisão

1. **O catálogo fica em código**, não em tabelas. `ACHIEVEMENT_IDS`, `ACHIEVEMENT_TARGETS`, `MISSION_IDS` e `MISSION_DEFINITIONS` em `packages/protocol/src/gamification.ts` são a fonte; o banco guarda só o estado do jogador (`user_achievements`, `user_missions`, `user_stats`). Ids são estáveis (nunca renomear nem remover). Diverge do esboço de `docs/gamificacao.md` §4 (corrigido lá). Motivos: a condição de cada conquista é código de qualquer jeito (o esboço já dizia "condição codificada no servidor"); metas e ids precisam chegar ao cliente por `protocol`, e uma segunda cópia no banco poderia divergir; mudar uma meta vira commit revisado e testado, não `UPDATE` em produção; sem FK para catálogo, ids novos entram sem migração.
2. **O nível é derivado do progresso.** A coluna `level` é gravada junto com o progresso, calculada por `achievementLevelFor` (`protocol`) no momento da escrita, e nunca diminui (se uma meta futura subir, quem já tem o nível o mantém). `unlocked_at` é o instante do nível 1; o CHECK `(level = 0) = (unlocked_at IS NULL)` garante a coerência.
3. **Chave de período em `America/Sao_Paulo`**: `period_key` é texto curto (`2026-11-04` diária, `2026-W45` semanal ISO), calculado pelo servidor (6D). Sem job: as linhas do período nascem na primeira leitura (`ensureMissions`, determinístico) e "expiram" porque a chave muda. CHECK de formato no banco (8 a 10 caracteres). Missões de períodos antigos ficam até um expurgo (pendência de retenção).
4. **Idempotência por partida com a tabela `progression_applied (match_id PK, FK matches ON DELETE CASCADE, applied_at)`.** `applyMatchProgress` abre uma transação e insere o `match_id` com `ON CONFLICT DO NOTHING`; se não inseriu, a partida já foi aplicada e a chamada devolve `applied: false` sem escrever. Duas transações simultâneas para a mesma partida disputam o índice único: a segunda espera a primeira confirmar e então não insere (uma aplicação só, sem lock explícito). A marca e as escritas ficam na mesma transação, então uma falha desfaz as duas e a nova tentativa aplica.
5. **Soma no banco, não ler-modificar-gravar.** Estatísticas, conquistas e missões usam `INSERT ... ON CONFLICT DO UPDATE SET progress = progress + delta` (missão limitada à meta com `LEAST`; CHECK `progress <= target`). Partidas diferentes do mesmo usuário em paralelo se serializam no bloqueio da linha e não perdem incremento. Usuários e itens são escritos em ordem fixa (id) para evitar deadlock entre partidas simultâneas.
6. **Estatísticas só de partidas novas.** `user_stats` (`played`, `won` por variante, `CHECK played >= won >= 0`) começa a contar na migração. Backfill a partir das `matches` já gravadas é opcional e fica fora do escopo (script único, a decidir depois; seria idempotente pela mesma `progression_applied`).
7. **`users.linked_at`** (anulável) entra aqui só para o 6F (vínculo do convidado a Google ou Apple); sem uso até lá.
8. **Cascata**: as três tabelas de estado apontam para `users` com `ON DELETE CASCADE` (apagar conta, `DELETE /me`, leva a progressão: LGPD). `progression_applied` aponta para `matches` com cascata, então o expurgo de partidas (12 meses) leva a marca junto; reprocessar uma partida já expurgada nem existe.

## Por que não uma coluna em `matches`

Uma coluna `progression_applied_at` em `matches` seria equivalente, mas (a) altera uma tabela grande e de leitura quente (`GET /matches`, auditoria) para um dado que só o 6D usa, (b) atualiza a linha da partida (e seu `events` e `deals` TOAST) a cada aplicação, e (c) mistura auditoria com progressão. A tabela de marca é uma linha de 24 bytes, sem tocar em `matches`, e some por cascata.

## Alternativas

- **Tabelas `achievements` e `missions`:** rejeitadas (ponto 1).
- **Idempotência por chave no Redis:** rejeitada; o dado já está no Postgres e a marca precisa ser atômica com as escritas.
- **Calcular o estado inteiro das `matches` a cada leitura (sem tabelas de estado):** rejeitada; ficaria cara (varredura de `events`) e não cobre missões com contadores da sala (`signalsBySeat`).

## Consequências

- Migração `20261105140000_fase6_progressao`: aditiva (3 tabelas de estado, 1 de marca, 1 coluna anulável), reversível por `DROP TABLE` e `DROP COLUMN` (perde só a progressão gravada depois). Não altera dados existentes.
- Metas e ids novos entram por código, sem migração. Renomear ou remover id exigiria migração de dados: proibido por regra.
- Queda do processo entre `saveMatch` e a avaliação perde a progressão daquela partida (risco já aceito no plano); a marca só impede duplicar, não recupera.
- Linhas de conquista com id que saiu do catálogo (não deve ocorrer) são ignoradas pelas leituras.
- Convidados nunca expiram, então suas linhas de progressão também não (mesma pendência de retenção da Fase 2).
