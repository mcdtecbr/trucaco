# Catálogo de sinais de truco

Fonte para `packages/avatar/src/signals.ts` e para a state machine do `assets/rive/avatar.riv`. Cada sinal tem id estável (nunca renomear, só adicionar), nome exibido, gatilho Rive e o significado tradicional, que serve apenas como sugestão no chat da dupla: cada dupla combina o seu.

Os sinais são **públicos**: todo mundo na mesa vê a animação. Blefar e ler o adversário faz parte do jogo.

| id            | Nome                  | Gatilho Rive       | Significado tradicional               |
| ------------- | --------------------- | ------------------ | ------------------------------------- |
| `wink`        | Piscar um olho        | `trig_wink`        | Tenho o zap (4♣ / manilha de paus)   |
| `eyebrow`     | Levantar sobrancelhas | `trig_eyebrow`     | Tenho o sete copas / manilha de copas |
| `lip_bite`    | Morder o lábio        | `trig_lip_bite`    | Tenho o espadão / manilha de espadas  |
| `cheek_puff`  | Inflar a bochecha     | `trig_cheek_puff`  | Tenho o sete ouros / manilha de ouros |
| `tongue`      | Mostrar a língua      | `trig_tongue`      | Tenho um 3                            |
| `nose_twitch` | Mexer o nariz         | `trig_nose_twitch` | Tenho um 2                            |
| `shrug`       | Encolher os ombros    | `trig_shrug`       | Não tenho nada                        |
| `nod`         | Acenar com a cabeça   | `trig_nod`         | Pede truco / aceita                   |
| `head_shake`  | Balançar a cabeça     | `trig_head_shake`  | Não peça / corre                      |
| `chin_up`     | Levantar o queixo     | `trig_chin_up`     | Pode aumentar                         |
| `look_away`   | Olhar para o lado     | `trig_look_away`   | Joga a carta mais fraca               |
| `smile`       | Sorriso contido       | `trig_smile`       | Blefe / livre                         |

## Regras de uso na mesa

- Um sinal por jogador a cada **3 segundos** (rate limit no servidor).
- Animação dura ~1 s e volta ao estado ocioso. Sinais recebidos durante uma animação entram em fila de 1 posição; o resto é descartado.
- O servidor transmite `{ seat, signalId, at }` para todos os assentos da mesa e registra no log da partida.
- O painel de sinais no cliente usa **toque e segure** (mobile) ou **clique e segure** (web) para disparar, evitando toque acidental.
- O catálogo exibido no chat da dupla permite anotar o significado combinado; o combinado é salvo em `partner_codes` por par de jogadores.

## Estados ociosos do avatar (não são sinais)

`idle_breathe` (contínuo), `idle_blink` (aleatório a cada 3–7 s), `idle_look` (olhar para a carta jogada). Eles não passam pelo servidor.
