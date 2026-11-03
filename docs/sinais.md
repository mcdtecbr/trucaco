# Catálogo de sinais de truco

Fonte para `packages/avatar/src/signals.ts` e para a state machine do `assets/rive/avatar.riv`. Cada sinal tem id estável (nunca renomear, só adicionar), nome exibido, gatilho Rive, duração e o significado tradicional, que serve apenas como sugestão (texto de apoio no painel "Combinar sinais"): cada dupla combina o seu.

Os sinais são **públicos**: todo mundo na mesa vê a animação. Blefar e ler o adversário faz parte do jogo.

| id            | Nome                      | Gatilho Rive       | Duração | Significado tradicional               |
| ------------- | ------------------------- | ------------------ | ------- | ------------------------------------- |
| `wink`        | Piscar um olho            | `trig_wink_l`      | 900 ms  | Tenho o zap (4♣ / manilha de paus)   |
| `eyebrow`     | Levantar sobrancelhas     | `trig_eyebrow`     | 900 ms  | Tenho o sete copas / manilha de copas |
| `lip_bite`    | Morder o lábio            | `trig_lip_bite`    | 1000 ms | Tenho o espadão / manilha de espadas  |
| `cheek_puff`  | Inflar a bochecha         | `trig_cheek_puff`  | 1000 ms | Tenho o sete ouros / manilha de ouros |
| `tongue`      | Mostrar a língua          | `trig_tongue`      | 1000 ms | Tenho um 3                            |
| `nose_twitch` | Mexer o nariz             | `trig_nose_twitch` | 900 ms  | Tenho um 2                            |
| `shrug`       | Encolher os ombros        | `trig_shrug`       | 1000 ms | Não tenho nada                        |
| `nod`         | Acenar com a cabeça       | `trig_nod`         | 1000 ms | Pede truco / aceita                   |
| `head_shake`  | Balançar a cabeça         | `trig_head_shake`  | 1000 ms | Não peça / corre                      |
| `chin_up`     | Levantar o queixo         | `trig_chin_up`     | 1000 ms | Pode aumentar                         |
| `look_away`   | Olhar para o lado         | `trig_look_away`   | 1000 ms | Joga a carta mais fraca               |
| `smile`       | Sorriso contido           | `trig_smile`       | 1000 ms | Blefe / livre                         |
| `wink_r`      | Piscar o olho direito     | `trig_wink_r`      | 900 ms  | Livre: a dupla combina                |
| `mouth_l`     | Torcer a boca p/ esquerda | `trig_mouth_l`     | 1000 ms | Livre: a dupla combina                |
| `mouth_r`     | Torcer a boca p/ direita  | `trig_mouth_r`     | 1000 ms | Livre: a dupla combina                |

**Lado dos sinais.** Os ids `wink`, `wink_r`, `mouth_l` e `mouth_r` falam do lado **da tela** de quem vê o avatar. `wink` é o olho esquerdo da tela e dispara o trigger `trig_wink_l` do rig (o id `wink` não muda, para não invalidar combinados já gravados); `wink_r` é o direito. Só `wink` guarda o significado tradicional do zap.

## Regras de uso na mesa

- Um sinal por jogador a cada **3 segundos** (rate limit no servidor).
- Animação dura ~1 s (900 a 1000 ms, coluna Duração; teto de 1200 ms em `MAX_SIGNAL_DURATION_MS`) e volta ao estado ocioso. Sinais recebidos durante uma animação entram em fila de 1 posição; o resto é descartado.
- O servidor transmite `{ seat, signalId, at }` para todos os assentos da mesa e registra `info` no log do servidor (sem o texto de nenhum combinado). Não entra no log de eventos da partida.
- O painel de sinais no cliente usa **toque e segure** (mobile) ou **clique e segure** (web) para disparar, evitando toque acidental.
- **Combinado da dupla** (Fase 5): o painel "Combinar sinais" (na sala de espera e na mesa, botão "Combinar sinais") mostra os 15 sinais, cada um com um campo para anotar o significado combinado com o parceiro, de até 60 caracteres (`PARTNER_CODE_MAX_LENGTH`). Vazio apaga. O significado tradicional da tabela acima aparece só como texto de apoio do campo, nunca como valor salvo.
- **Privacidade do combinado**: o servidor envia o combinado (`codes`) só aos dois assentos da dupla. Os adversários veem o sinal na mesa, mas não o significado. O painel de sinais da mesa mostra o combinado sob o nome do sinal, só para quem é da dupla.
- **Sinal do parceiro**: quando o parceiro sinaliza e há combinado para esse sinal, a mesa mostra um aviso na tela com o nome do sinal e o significado combinado, por 5 s (`PRESENCE_NOTE_MS`, `partnerSignalNote`). Sem combinado, só o anúncio para o leitor de tela.
- **Salvo em `partner_codes`** por par de jogadores (`userId`), não por mesa: a dupla que joga de novo reencontra o combinado. Par novo é gravado ao fim da primeira partida finalizada; a sala grava a cada edição quando o par já jogou junto. Convidado troca de `userId` ao sair da conta, então o combinado dele some (ver `apps/mobile/README.md`).
- Pendente: mostrar o significado tradicional em cinza no painel de sinais da mesa (hoje só aparece no campo do painel "Combinar sinais") e o aviso "combinado salvo para esta dupla" (ver `docs/specs/2026-11-03-fase-5-relatorio.md`).

## Implementação

- Catálogo em código: `SIGNALS` em `packages/avatar/src/signals.ts` (id, nome, gatilho, duração, significado). Um teste garante uma entrada por `SignalId` com gatilho `trig_<id>`.
- O avatar vetorial (`packages/avatar`) é o avatar de produção até existir o `.riv`; ele e o rig Rive seguem os mesmos ids e durações. Especificação do rig: `docs/avatar-rig.md`.
- Com "reduzir movimento" ativo, o sinal vira um destaque estático (anel branco) de 1 s, sem animação.
- O `<Avatar>` não impõe a fila de 1 posição: ela fica no cliente da mesa. Sinal novo (nova `key`) durante outro substitui o em curso.

## Estados ociosos do avatar (não são sinais)

`idle_breathe` (contínuo), `idle_blink` (intervalo variável, sorteado dentro do `.riv`), `idle_look` (olhar para a carta jogada). Eles não passam pelo servidor.
