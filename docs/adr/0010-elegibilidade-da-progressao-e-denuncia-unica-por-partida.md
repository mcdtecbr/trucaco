# 0010: elegibilidade da progressão anti-conluio e denúncia única por partida

- Status: aceita (Fase 6, auditoria 6I). Valores de elegibilidade são padrões a recalibrar no beta.
- Data: 2026-11-05
- Relacionada: ADR 0009 (progressão, idempotência), `docs/gamificacao.md` (nota de 6I), `docs/specs/2026-11-04-fase-6-plano.md` (seção 4, riscos de conluio)

## Contexto

A Fase 6 dá conquistas e missões a partir do log de partidas terminadas. A auditoria 6I (`vitor-seguranca`) apontou que, sem mais regras, quatro contas podiam combinar partidas curtas (fechar em uma ou duas mãos) ou jogar mesas privadas só entre convidados para farmar `maratona`, `dupla_afinada` e as demais. Na denúncia, a checagem de duplicidade na aplicação não era atômica: duas tentativas simultâneas podiam gravar a mesma denúncia duas vezes.

O ranking competitivo (Fase 9) vai reusar as mesmas partidas, então a regra precisa ser uma só.

## Decisão

1. **Elegibilidade da progressão** (`apps/server/src/progression/achievements.ts`, `service.ts`). Uma partida pontua só se, além das regras já existentes (`finished` com vencedor, 4 `userId` distintos, `botFrom === null` nos quatro):
   - tiver no mínimo `MIN_HANDS_FOR_PROGRESSION` = 4 mãos decididas (ignorado se o log foi truncado, para não punir o limite de tamanho);
   - durar no mínimo `MIN_MATCH_DURATION_MS` = 3 min;
   - não for mesa **privada** com os 4 jogadores convidados (`blockAllGuestPrivate`);
   - cada par dos 4 jogadores tiver menos de `PAIR_DAILY_PROGRESSION_LIMIT` = 5 partidas que já pontuaram nas 24 h anteriores ao fim da partida (`PAIR_LIMIT_WINDOW_MS`). A 6ª do mesmo grupo não pontua.

   Partida inelegível é gravada normalmente (histórico, combinado de sinais). Só não gera progresso. Os valores são constantes nomeadas e injetáveis (`ProgressionPolicy`), fáceis de recalibrar.

2. **Denúncia única por (denunciante, denunciado, partida)** (migração `20261106100000_reports_unique`). Índice único no banco, que torna a idempotência atômica. Denúncia sem partida não tem índice (NULL não colide) e fica com janela de 24 h na aplicação. Denúncia sem `matchId` só vale se os dois dividiram partida terminada nos últimos 7 dias. Teto de 10 denúncias gravadas por hora contra o mesmo denunciado.

3. **Sem oráculo nas duas escritas.** Denúncia repetida e denúncia acima do teto respondem `201` sem gravar. Quem não existe ou não compartilhou partida recebe o mesmo `INVALID_REPORT` que quem não é relevante. Não há resposta que revele a existência ou o histórico de outra conta.

## Alternativas

- **Só rate limit por usuário**: rejeitada. Não impede quatro contas farmando entre si; o limite por usuário é contornado com contas novas.
- **Excluir partida de convidados sempre**: rejeitada. Convidados são o caminho de entrada do produto; a regra cobre só a mesa privada com os quatro convidados, que é o caso de conluio.
- **Deduplicar denúncia só na aplicação**: rejeitada, pelo problema de corrida já descrito.
- **Pontuar por assento, e não por partida**: adiada. Hoje partida com bot ou conta repetida não pontua para ninguém (griefing por conta apagada ou bot no meio da partida fica registrado em `apps/server/README.md`).
- **Banir por fingerprint ou por IP**: fora desta fase (Fase 8, painel de moderação).

## Consequências

- Progresso lento para quem joga pouco por partida; o ritmo do beta vai calibrar os números. Mudança de valor é commit revisado, sem migração.
- A regra vale também para o ranking da Fase 9 (mesmos critérios de partida elegível).
- A janela de 24 h e o teto por par consultam `progression_applied` com `ended_at` dentro da janela: custo de leitura por partida (medir, pendência da Fase 6).
- Denúncia repetida nunca é revelada ao denunciante; isso protege o denunciado, mas o denunciante não sabe se a denúncia entrou.
- A migração da denúncia apaga antes as duplicatas exatas que já existam (mantém a mais antiga); sem isso o índice não seria criado.
- Multi-instância: o teto de denúncias por hora e a lista evitada em memória dependem de Redis (pendência registrada).
