# Catálogo de sinais de truco

Fonte para `packages/avatar/src/signals.ts` e para a state machine do `assets/rive/avatar.riv`. Cada sinal tem id estável (nunca renomear, só adicionar), nome exibido, gatilho Rive, duração e o significado tradicional, que serve apenas como sugestão no chat da dupla: cada dupla combina o seu.

Os sinais são **públicos**: todo mundo na mesa vê a animação. Blefar e ler o adversário faz parte do jogo.

| id            | Nome                  | Gatilho Rive       | Duração | Significado tradicional               |
| ------------- | --------------------- | ------------------ | ------- | ------------------------------------- |
| `wink`        | Piscar um olho        | `trig_wink`        | 900 ms  | Tenho o zap (4♣ / manilha de paus)   |
| `eyebrow`     | Levantar sobrancelhas | `trig_eyebrow`     | 900 ms  | Tenho o sete copas / manilha de copas |
| `lip_bite`    | Morder o lábio        | `trig_lip_bite`    | 1000 ms | Tenho o espadão / manilha de espadas  |
| `cheek_puff`  | Inflar a bochecha     | `trig_cheek_puff`  | 1000 ms | Tenho o sete ouros / manilha de ouros |
| `tongue`      | Mostrar a língua      | `trig_tongue`      | 1000 ms | Tenho um 3                            |
| `nose_twitch` | Mexer o nariz         | `trig_nose_twitch` | 900 ms  | Tenho um 2                            |
| `shrug`       | Encolher os ombros    | `trig_shrug`       | 1000 ms | Não tenho nada                        |
| `nod`         | Acenar com a cabeça   | `trig_nod`         | 1000 ms | Pede truco / aceita                   |
| `head_shake`  | Balançar a cabeça     | `trig_head_shake`  | 1000 ms | Não peça / corre                      |
| `chin_up`     | Levantar o queixo     | `trig_chin_up`     | 1000 ms | Pode aumentar                         |
| `look_away`   | Olhar para o lado     | `trig_look_away`   | 1000 ms | Joga a carta mais fraca               |
| `smile`       | Sorriso contido       | `trig_smile`       | 1000 ms | Blefe / livre                         |

## Regras de uso na mesa

- Um sinal por jogador a cada **3 segundos** (rate limit no servidor).
- Animação dura ~1 s (900 a 1000 ms, coluna Duração; teto de 1200 ms em `MAX_SIGNAL_DURATION_MS`) e volta ao estado ocioso. Sinais recebidos durante uma animação entram em fila de 1 posição; o resto é descartado.
- O servidor transmite `{ seat, signalId, at }` para todos os assentos da mesa e registra no log da partida.
- O painel de sinais no cliente usa **toque e segure** (mobile) ou **clique e segure** (web) para disparar, evitando toque acidental.
- O catálogo exibido no chat da dupla permite anotar o significado combinado; o combinado é salvo em `partner_codes` por par de jogadores.

## Implementação

- Catálogo em código: `SIGNALS` em `packages/avatar/src/signals.ts` (id, nome, gatilho, duração, significado). Um teste garante uma entrada por `SignalId` com gatilho `trig_<id>`.
- O avatar vetorial (`packages/avatar`) é o avatar de produção até existir o `.riv`; ele e o rig Rive seguem os mesmos ids e durações. Especificação do rig: `docs/avatar-rig.md`.
- Com "reduzir movimento" ativo, o sinal vira um destaque estático (anel branco) de 1 s, sem animação.
- O `<Avatar>` não impõe a fila de 1 posição: ela fica no cliente da mesa. Sinal novo (nova `key`) durante outro substitui o em curso.

## Estados ociosos do avatar (não são sinais)

`idle_breathe` (contínuo), `idle_blink` (aleatório a cada 3–7 s), `idle_look` (olhar para a carta jogada). Eles não passam pelo servidor.
