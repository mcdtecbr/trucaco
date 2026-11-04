# Gamificação: conquistas, missões e ranking

Fonte para as tabelas e regras de progressão do jogador. Valores numéricos são **propostas iniciais**, calibradas no beta fechado (Fase 7) antes do ranking (Fase 9).

Decidido em 2026-11-01: entram **conquistas e missões diárias** (Fase 6) e **ranking competitivo com ligas e temporadas** (Fase 9, depois do beta). **XP e nível não entram** por enquanto; se entrarem depois, são um sistema à parte.

Princípios:

- **O servidor calcula tudo.** O cliente só exibe. Conquistas, missões e rating partem do log de eventos da partida (`GameEvent` em `docs/audio.md`, seção 6), nunca de dados enviados pelo cliente.
- **Convidado** acumula conquistas e missões no próprio perfil e elas migram quando ele vincula uma conta social. **Convidado não entra no ranking.**
- **Partida só conta se terminou.** Mesa cancelada por voto não gera conquista, missão nem rating.

## 1. Conquistas (Fase 6)

Catálogo com ids estáveis (nunca renomear). Cada conquista tem uma condição verificada pelo servidor ao fim da partida e, quando faz sentido, níveis (bronze, prata, ouro) por quantidade.

| id                 | Nome              | Condição                                                                                           | Níveis (bronze/prata/ouro) |
| ------------------ | ----------------- | -------------------------------------------------------------------------------------------------- | -------------------------- |
| `primeira_vitoria` | Estreia vitoriosa | Vencer a primeira partida                                                                          | única                      |
| `zap_na_mao`       | Zap na mão        | Vencer uma vaza jogando o zap                                                                      | 1 / 25 / 100               |
| `doze_na_mesa`     | Vale doze         | Vencer uma mão valendo 12                                                                          | 1 / 10 / 30                |
| `virada`           | Virada histórica  | Vencer um jogo estando 9 ou mais pontos atrás                                                      | 1 / 5 / 15                 |
| `mao_de_ferro`     | De ferro          | Vencer uma mão de ferro                                                                            | 1 / 5 / 15                 |
| `serie_perfeita`   | 2 a 0             | Vencer uma série melhor de 3 sem perder jogo                                                       | 1 / 10 / 30                |
| `corredor_esperto` | Correr a tempo    | Correr de um aumento e a dupla adversária perder a mão ao fim (não se aplica se o jogo acabou ali) | 5 / 25 / 100               |
| `dupla_afinada`    | Dupla afinada     | Vencer N partidas com o mesmo parceiro                                                             | 5 / 25 / 100               |
| `sinaleiro`        | Sinaleiro         | Usar sinais em N partidas                                                                          | 10 / 50 / 200              |
| `maratona`         | Maratona          | Jogar N partidas                                                                                   | 10 / 100 / 500             |

Notas:

- `corredor_esperto` depende de o motor expor, no fim da mão, o que a dupla que correu teria decidido; se isso complicar o log, a conquista sai do catálogo inicial (decisão do `tales-regras` na Fase 1).
- Conquista nunca pode depender de o jogador "provar" algo ao servidor por mensagem própria; só de eventos da partida.
- Notificação: ao fim da partida, a tela de Resultado mostra as conquistas desbloqueadas. O Perfil lista todas, com progresso.

## 2. Missões (Fase 6)

- **3 missões diárias** sorteadas de um catálogo, renovadas à meia-noite (America/Sao_Paulo). **1 missão semanal**, renovada na segunda-feira.
- Exemplos do catálogo: jogar 3 partidas; vencer 1 partida; pedir truco 3 vezes; aceitar 2 aumentos; usar 5 sinais; vencer uma mão valendo 6 ou mais; jogar uma partida com o mesmo parceiro da véspera.
- Missão com requisito de parceiro ou de variante só é sorteada se o jogador já cumpriu o pré-requisito (ex.: já tem dupla frequente).
- Contagem das apostas (implementação do 6D): "pedir truco" conta cada `betCalled` do jogador **e** cada `betRaised` (aumentar é pedir a aposta maior); "aceitar aumento" conta cada `betAccepted` **e** cada `betRaised` (no motor, aumentar aceita o pedido anterior). Logo um aumento vale 1 em cada missão.
- Partida em que o jogador foi substituído por bot por ausência não conta para as missões dele.
- Sem acúmulo: missão não concluída no dia expira.

### Recompensas (a confirmar)

Sem XP e nível, a recompensa de conquistas e missões precisa ser outra coisa. **Proposta**: itens cosméticos, como partes de avatar, vozes e efeitos sonoros do soundboard, liberados por conquista ou por sequência de missões. Falta o usuário confirmar isso antes da Fase 6; até lá, o catálogo de partes do avatar tem todos os itens liberados.

## 3. Ranking competitivo (Fase 9, depois do beta)

- **Rating por variante**: Paulista e Mineiro têm rankings separados.
- **Modelo**: Elo adaptado para duplas. O rating de uma dupla é a média dos dois jogadores; o resultado da partida atualiza o rating de cada um. Proposta inicial: fator K alto nas 20 primeiras partidas (calibração) e menor depois. Valores a calibrar com dados do beta.
- **Só conta a fila pública**, formato `single`. Partidas em mesa privada, amistosa ou série `bo3` não alteram rating.
- **Ligas**: Bronze, Prata, Ouro, Platina, Diamante, Mestre, cada uma (até Diamante) com divisões III, II e I. Limiares de rating definidos na calibração.
- **Temporadas**: mensais. No fim, reset parcial do rating em direção à média, com recompensa cosmética por liga alcançada.
- **Leaderboard**: global por variante e da temporada. Aparece o apelido e o avatar, nunca e-mail.
- **Pareamento**: a fila pública passa a juntar jogadores de rating próximo (substitui o FIFO simples da Fase 8).
- **Anti-abuso**:
  - Só contas vinculadas pontuam.
  - Abandono (cair e não voltar em 60 s) conta como derrota para quem saiu; os outros três jogadores seguem com resultado normal.
  - Limite de partidas contadas contra os mesmos adversários na temporada (evita combinar resultado).
  - Jogadores bloqueados ou denunciados não pareiam entre si.
  - Revisão manual de saltos anormais de rating (alerta para o painel de moderação).

## 4. Dados (esboço para `dalva-dba`)

Atualizado no bloco 6C (ADR 0009): o catálogo de conquistas e missões fica **em código** (`packages/protocol/src/gamification.ts`), sem tabelas `achievements` e `missions`. No banco entram `user_achievements`, `user_missions`, `user_stats` (partidas e vitórias por variante) e `progression_applied` (idempotência por partida); ver `docs/banco-de-dados.md`.

| Tabela                | Conteúdo                                             | Fase |
| --------------------- | ---------------------------------------------------- | ---- |
| `user_achievements`   | Jogador, conquista, nível, progresso, data           | 6    |
| `user_missions`       | Jogador, missão, período, progresso, concluída       | 6    |
| `user_stats`          | Jogador, variante, partidas, vitórias                | 6    |
| `progression_applied` | Partida já avaliada (idempotência)                   | 6    |
| `seasons`             | Id, início, fim                                      | 9    |
| `ratings`             | Jogador, variante, temporada, rating, partidas, liga | 9    |
| `rating_history`      | Partida, jogador, rating antes e depois              | 9    |

## 5. Decisões em aberto

1. Recompensa de conquistas e missões (proposta cosmética acima).
2. Valores de K, limiares de liga e tamanho das temporadas: calibrar no beta.
3. Se o ranking de **duplas fixas** (opção não escolhida agora) entra numa fase futura. Os dados de `partner_codes` e o histórico por par já deixam isso possível.

> Nota (revanche): as Fases 6 e 9 não contam partida com `botFrom != null` em algum jogador e exigem 4 `userId` distintos. Revanches com bots não valem para conquistas, missões nem ranking.
