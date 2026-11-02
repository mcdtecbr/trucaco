# Regras do Truco implementadas pelo motor

Referência normativa para `packages/rules`. Quando o código e este documento divergirem, um dos dois está errado: corrija e registre em ADR. Termos em português são os nomes canônicos usados no código (`manilha`, `vira`, `zap`, `maoDeOnze`).

## Comum às duas variantes

- **Baralho**: 40 cartas (sem 8, 9, 10 e sem coringa). Naipes: paus ♣, copas ♥, espadas ♠, ouros ♦.
- **Mesa de 4**: duas duplas, parceiros em assentos opostos (0–2 e 1–3). Sentido anti-horário.
- **Jogo**: vence a dupla que chega a **12 pontos**. A mesa pode ser criada como jogo único ou como **série melhor de 3** (seção "Série" abaixo).
- **Mão**: cada jogador recebe 3 cartas. Uma mão tem até 3 **vazas** (rodadas de uma carta por jogador). Vence a mão quem faz 2 vazas, com as regras de empate abaixo.
- **Pé e mão**: o **pé** é quem embaralha e distribui (gira a cada mão, anti-horário). O **mão** é quem está à direita do pé e começa a primeira vaza. Nas vazas seguintes, começa quem venceu a vaza anterior. Se a vaza anterior empatou, começa de novo quem a iniciou.
- **Carta coberta (encoberta)**: a partir da 2ª vaza, o jogador pode jogar uma carta virada para baixo, que perde de qualquer carta. Permitido nas duas variantes. Na mão de ferro não existe carta coberta: as cartas são jogadas às cegas, mas abertas (ver abaixo).
- **Empates em vaza ("cangou"/"empachou")**:
  - Empate na 1ª vaza: a mão vai para quem vencer a 2ª vaza. Se a 2ª também empatar, vai para quem vencer a 3ª. Se as três empatarem, ninguém pontua.
  - 1ª vaza vencida e 2ª empatada: quem venceu a 1ª leva a mão.
  - 1ª e 2ª vencidas por duplas diferentes e 3ª empatada: quem venceu a 1ª leva a mão.
- **Pedir truco (aumentar a aposta)**: qualquer jogador da dupla pode pedir no seu turno de jogar, antes de jogar a carta. A resposta é de **um único jogador**, nunca da dupla: `aceitar`, `correr` (a dupla que pediu ganha o valor vigente antes do pedido: a base da mão se for o primeiro pedido) ou `aumentar` (pede o próximo valor). **Quem responde**: no truco (primeiro pedido), o adversário que joga logo depois de quem pediu (o assento seguinte na ordem da mesa); em qualquer aumento (retruco, seis, oito, nove, dez, doze), quem fez o **pedido anterior**, de modo que a responsabilidade alterna entre os dois jogadores. O mesmo vale para um aumento pedido depois de uma aposta aceita: responde quem fez o último pedido. O parceiro de quem responde só assiste: não tem `aceitar`, `correr` nem `aumentar`, e o motor rejeita essas ações de qualquer outro assento (`NOT_YOUR_TURN`). **Aumentar equivale a aceitar o pedido anterior**: se A pede truco (3), B pede seis e A corre, B ganha 3, o valor que aceitou ao aumentar. Uma dupla só pode pedir o próximo aumento se não foi ela a última a aumentar.
- **Mão especial de "onze"/"dez"** (nome e limiar variam por variante): quando uma dupla está a um aumento de ganhar e a outra não, a dupla na frente vê as cartas uma da outra e decide **jogar** (a mão vale o valor do primeiro truco, sem novos aumentos) ou **correr** (a adversária ganha o valor base da mão). Se ambas estão no limiar, é **mão de ferro**: ninguém vê as próprias cartas, cada um joga uma carta às cegas (escolhida por posição), sem truco, vale o valor base. A carta é **aberta e visível a toda a mesa assim que é jogada** e vale pela força real.
- **Decisão da dupla na mão de onze/dez** (uma só dupla no limiar): os jogadores da dupla (dois na mesa de 4; na mesa de 6, ainda por validar na Fase 8, o motor exige que todos os três aceitem) veem as cartas um do outro e **os dois decidem**, em qualquer ordem. Para jogar, **os dois aceitam** (`playSpecial` de cada um); se **um correr** (`runSpecial`), a dupla corre na hora e a adversária ganha o valor base. Aceitar é definitivo: quem já aceitou não tem mais ações (nem pode correr depois) e espera o parceiro. O estado registra os assentos que já aceitaram em `specialAccepted`. A mão de ferro não muda.
- **Mão de ferro é opcional**: quem abre a sala escolhe se ela vale (`ironHand`, padrão ligada). Com a opção desligada e as duas duplas no limiar, a mão é **normal**: cartas abertas, valor base e apostas liberadas. A mão de onze/dez com apenas uma dupla no limiar vale sempre, independente da opção.
- **Bot**: nunca pede nem aumenta aposta; essa decisão é sempre de jogador humano. Ele corre de aposta pendente, decide a mão de onze/dez e joga a carta mais fraca. O bot pode emitir **sinais** (servidor e avatar, Fases 2 e 4); isso não é função do motor.
- **Timer de turno**: 20 s por ação (configurável). Ao estourar: carta mais fraca é jogada automaticamente; se havia truco pendente, a resposta automática é `correr`. Na decisão de onze/dez, cada aceite reinicia o prazo (o segundo decisor ganha mais 20 s); ao estourar, jogam por quem ainda não decidiu.
- **Desconexão**: 60 s para reconectar. Depois disso (ou na saída consentida, que já libera o bot na hora) a cadeira é assumida por bot e **fica com o bot até o dono voltar por um novo join**, com o mesmo usuário. A vaga continua reservada ao dono, e a mesa destranca para ele entrar de novo. Há teto de 20 reconexões por assento; acima disso, a queda já vai direto para o bot.
- **Cancelar a mesa por voto** (`voteCancel`): vale a **unanimidade dos humanos conectados** (bot não vota; quem está na janela de reconexão não conta). O voto vale só dentro da mão em curso e zera a cada mão nova. Se nenhum humano fica conectado por 60 s, ou não resta nenhum humano na mesa, a série é cancelada sem vencedor e sem estatística de vitória.

## Truco Paulista

- **Hierarquia das cartas comuns** (da mais forte para a mais fraca): 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4.
- **Vira e manilhas**: após distribuir, o pé vira uma carta (a **vira**). A manilha é a carta de valor imediatamente superior à vira (4→5, …, 3→4, circular: 3 → 4). As 4 manilhas são ordenadas por naipe: **paus (zap) > copas > espadas > ouros**. Nenhuma outra carta empata com manilha; manilhas nunca empatam entre si.
- **Valores**: mão vale **1**; truco → **3**; seis → **6**; nove → **9**; doze → **12**.
- **Mão de onze**: dupla com 11 pontos. Decide jogar (vale 3) ou correr (adversária ganha 1).
- **Mão de ferro**: 11 × 11. Cartas jogadas às cegas e abertas na mesa, vale 1, sem truco.

## Truco Mineiro

- **Hierarquia**: manilhas fixas, nesta ordem: **4♣ (zap) > 7♥ (sete copas) > A♠ (espadão) > 7♦ (sete ouros)**. Depois as cartas comuns: 3 > 2 > A (♣♥♦) > K > J > Q > 7 (♣♠) > 6 > 5 > 4 (♥♠♦).
- **Sem vira.**
- **Valores**: mão vale **2**; truco → **4**; seis → **6**; oito → **8**; dez → **10**; doze → **12**.
- **Mão de dez**: dupla com 10 pontos. Decide jogar (vale 4) ou correr (adversária ganha 2). O limiar é exatamente 10: com 11 pontos não há mão especial.
- **Mão de ferro**: 10 × 10. Cartas jogadas às cegas e abertas na mesa, vale 2, sem truco.

## Série (melhor de 3 jogos)

Opção definida por quem cria a mesa, nas duas variantes:

- **`single`** (padrão): um jogo de 12 pontos. É o formato da fila pública rápida.
- **`bo3`**: vence a série a dupla que ganhar **2 jogos**. O terceiro jogo só acontece se a série estiver 1 × 1. Disponível em mesas privadas e amistosas.
- **Entre jogos**: os pontos voltam a 0, as duplas e os assentos permanecem. O pé do jogo seguinte é o assento que vem depois do pé que deu a última mão do jogo anterior (o rodízio continua). Confirmado pelo usuário em 2026-11-02. O mesmo rodízio vale na revanche (`docs/protocolo-servidor.md`, seção "Revanche").
- **Mão de onze/dez e mão de ferro** valem por jogo: reiniciam junto com o placar de pontos.
- **Mesa encerrada por voto durante a série**: a série é cancelada, sem vencedor e sem estatística de vitória.
- Não confundir com o "melhor de 3" da **mão**, que já é a regra das vazas: vence a mão quem faz 2 das 3 vazas.

## Fora do escopo do MVP (decidido para fase 8)

- **Mesa de 6** (3 × 3): ordem de assentos, distribuição de 18 cartas e regras de empate serão especificadas em ADR próprio na fase 8, antes de implementar. O motor deve ser escrito com `seats` parametrizado para não bloquear isso.
- Variações regionais (truco gaúcho, truco com envido/flor) não entram no produto.

## Parametrização no motor

Uma única implementação, com objeto `Variant`:

```ts
interface Variant {
  id: 'paulista' | 'mineiro';
  baseHandValue: number; // 1 | 2
  betLadder: number[]; // [3,6,9,12] | [4,6,8,10,12]
  fixedManilhas: Card[] | null; // null (usa vira) | [4♣,7♥,A♠,7♦]
  specialHandThreshold: number; // 11 | 10
  commonRank: Rank[]; // 3,2,A,K,J,Q,7,6,5,4
}
```

Tudo o que não está nesta tabela é comportamento comum e não deve virar `if (variant === ...)` espalhado pelo código.

O formato da série é independente da variante:

```ts
interface SeriesConfig {
  format: 'single' | 'bo3'; // single = um jogo de 12 pontos
}
```
