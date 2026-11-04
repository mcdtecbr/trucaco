# Áudio: gritos de truco, vozes dos avatares e efeitos

Fonte para `packages/avatar/src/voices.ts`, `packages/avatar/src/sfx.ts` e para a pasta `assets/audio/`. Ids são estáveis (nunca renomear, só adicionar), como nos sinais.

Escopo: **sons gravados tocados no aparelho**. Não existe chat de voz entre jogadores (continua fora do produto).

## 1. Voz do avatar

Cada avatar tem uma **voz**, escolhida no criador de avatar e salva em `AvatarParts.voice`. O jogador ouve a voz do avatar de cada pessoa da mesa.

| Grupo     | Ids                          | Meta de lançamento | Protótipo (Fase 5b) |
| --------- | ---------------------------- | ------------------ | ------------------- |
| Masculina | `masc_1`, `masc_2`, `masc_3` | 3 vozes            | `masc_1`            |
| Feminina  | `fem_1`, `fem_2`, `fem_3`    | 3 vozes            | `fem_1`             |

Cada voz tem os mesmos eventos, para qualquer avatar poder usar qualquer voz.

### Eventos de voz

| Evento         | Quando toca                                          | Takes (id: fala)                                                                                                                                                     |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `truco`        | Primeiro aumento (3 no Paulista, 4 no Mineiro)       | `truco_1`: "Truco, ladrão!"; `truco_2`: "Truco, marreco!"; `truco_3`: "Truco na orelha!"; `truco_4`: "Aqui tem coragem!"; `truco_5`: "Vem que tem!"                  |
| `seis`         | Aumento para 6                                       | `seis_1`: "Meia dúzia!"; `seis_2`: "Meio pau!"; `seis_3`: "Seis!"; `seis_4`: "Foge não, que agora é tarde!"                                                          |
| `oito`         | Aumento para 8 (só Mineiro)                          | `oito_1`: "Oito!"; `oito_2`: "Subiu pra oito!"; `oito_3`: "Oito, e agora?"                                                                                           |
| `nove`         | Aumento para 9 (só Paulista)                         | `nove_1`: "Nove!"; `nove_2`: "Nooove!"; `nove_3`: "Foge não, que agora é tarde!"                                                                                     |
| `dez`          | Aumento para 10 (só Mineiro)                         | `dez_1`: "Dez!"; `dez_2`: "Subiu pra dez!"; `dez_3`: "Dez, e aí?"                                                                                                    |
| `doze`         | Aumento para 12                                      | `doze_1`: "Dooze!"; `doze_2`: "Queda!"; `doze_3`: "Cai o teto!"; `doze_4`: "Foge não, que agora é tarde!"                                                            |
| `quero`        | Aceitou o aumento                                    | `quero_1`: "Quero!"; `quero_2`: "Vem pra cá!"; `quero_3`: "Tá pago!"                                                                                                 |
| `corro`        | Correu do aumento ou da mão de onze/dez              | `corro_1`: "Corro!"; `corro_2`: "Tô fora!"; `corro_3`: "Dessa vez não!"; `corro_4`: "Pra mim chega!"; `corro_5`: "Pode ficar com essa!"; `corro_6`: "Não vou nessa!" |
| `mao_especial` | Mão de onze ou de dez, ao decidir jogar              | `mao_especial_1`: "Vamos nessa!"; `mao_especial_2`: "Bora jogar!"; `mao_especial_3`: "Tô dentro!"                                                                    |
| `mao_de_ferro` | Início da mão de ferro (fala o pé)                   | `mao_de_ferro_1`: "Mão de ferro!"; `mao_de_ferro_2`: "É no escuro!"; `mao_de_ferro_3`: "Fechei os olhos!"                                                            |
| `vaza`         | Ganhou uma vaza (opcional, sorteio com chance baixa) | `vaza_1`: "Manda o Zap pra cá!"; `vaza_2`: "Boa!"; `vaza_3`: "Essa é minha!"                                                                                         |
| `venceu_jogo`  | Dupla venceu o jogo                                  | `venceu_jogo_1`: "É nossa!"; `venceu_jogo_2`: "Tá no papo!"; `venceu_jogo_3`: "Ganhou, ganhou!"                                                                      |
| `venceu_serie` | Dupla venceu a série melhor de 3                     | `venceu_serie_1`: "Campeões!"; `venceu_serie_2`: "Levamos tudo!"; `venceu_serie_3`: "Mesa limpa!"                                                                    |

- O nome falado segue o valor da aposta e não a variante: o evento `seis` toca nas duas.
- **Takes** por evento (3 a 6, conforme a tabela), para não repetir sempre a mesma gravação; o sorteio nunca repete o take anterior (`pickTake`). O texto do take é a **legenda do balão e o roteiro da gravação**, igual para qualquer voz. A fonte da tabela é `packages/avatar/src/audioCatalog.json`. Ids de take são estáveis (`<evento>_<n>`; só se acrescentam). Arquivo: `assets/audio/voices/<voiceId>/<evento>_<n>.m4a`.
- Quem toca o grito é o aparelho de **cada jogador**, a partir do evento de jogo vindo do servidor. Nenhum áudio trafega pela rede.
- Junto do grito, aparece um balão grande com o texto da fala. O texto é obrigatório: serve de legenda para quem joga sem som. A animação Rive `trig_shout` (boca aberta) está prevista, mas o `avatar.riv` atual não tem esse trigger e nada o dispara ainda; o ponto de extensão é `store.speech[seat].event` (pendente com `rai-avatar`).

## 2. Efeitos engraçados (soundboard)

Além do painel, há **efeitos de jogo locais** (`card_play`, `card_shuffle`, `table_slam` para o soco na mesa quando alguém pede truco ou aumenta, e `ambience_bar` opcional). Eles não passam pelo servidor, não entram em `SFX_IDS` e não sofrem o limite de 5 s. Arquivos em `assets/audio/sfx/<id>.m4a`.

Painel de efeitos que o jogador dispara durante a partida. Todos na mesa ouvem, como os sinais são vistos por todos.

| id             | Efeito                          |
| -------------- | ------------------------------- |
| `horn`         | Buzina                          |
| `sad_trombone` | Trombone triste (wah-wah-wah)   |
| `laugh`        | Risada                          |
| `crowd_ooh`    | Torcida "uuuh"                  |
| `rooster`      | Galo cantando                   |
| `rimshot`      | Bateria "ba-dum-tss"            |
| `clap`         | Palmas                          |
| `crickets`     | Grilos (silêncio constrangedor) |

Regras:

- Mensagem do cliente `sfx { sfxId }`; o servidor valida o id, aplica o limite de **1 efeito a cada 5 s por jogador** e retransmite `sfx { seat, sfxId, at }`.
- Efeito do próprio jogador também sai pelo servidor, para tocar sincronizado em todos.
- Lista inicial é curta de propósito. Novos efeitos entram por PR, com licença registrada.

## 3. Controles do jogador

Salvos no aparelho (não vão ao servidor), em Configurações e num atalho na mesa:

- Volume das **vozes** e volume dos **efeitos** separados.
- Interruptor "silenciar efeitos engraçados" (some só os efeitos e mantém os gritos).
- Interruptor "sem som" geral. A legenda em balão continua aparecendo.
- Silenciar a voz de **um jogador específico** (ligado ao bloqueio e à denúncia da moderação).

## 4. Aspectos técnicos

- Reprodução com `expo-audio` (web, iOS e Android). A API cobre pré-carregar, tocar sobreposto e ajustar volume; o export web e o Android empacotam os `.m4a` (conferido no build), mas o comportamento real em iOS, Android e Safari ainda não foi validado em aparelho.
- **Pré-carregamento** ao entrar na mesa: cada player do `expo-audio` é um player nativo (um ExoPlayer no Android), então não se carrega tudo. Ficam fixos **1 take por evento** (o primeiro) das vozes presentes (13 × até 2 vozes) e os 3 efeitos de jogo (`card_shuffle`, `card_play`, `table_slam`): cerca de 29 players. O diretor de fala prefere o take já carregado, e ao falar um evento pede em segundo plano os outros takes dele (variação nas próximas vezes). Esses e o soundboard (carregado no primeiro uso, então o 1º som de um efeito engraçado pode sair mudo) entram num LRU de 12 players. Latência do primeiro grito e memória no Android: só medíveis em aparelho (não medido).
- **Formato**: mono, curto (cerca de 1 s por fala), AAC `.m4a`. Verificar suporte em iOS, Android e nos navegadores-alvo antes de gravar tudo; se faltar, gerar também `.ogg`/`.mp3`.
- **Orçamento**: meta de até 1 MB por voz completa e 1 MB para o soundboard. Medir na Fase 5b e ajustar.
- **Web**: navegadores só liberam áudio após um gesto do usuário. A tela de entrada ou o botão "entrar na mesa" precisa desbloquear o áudio.
- **Latência**: o grito toca ao chegar o evento do servidor, junto da animação; conferir que não atrasa em relação ao estado da mesa.

## 5. Fonte dos áudios e licenças

- **Estado atual (Fase 5b, etapa 1)**: todos os arquivos são **placeholders silenciosos** (tom curto gerado por script, sem direitos de terceiros). Serviço de voz e fonte dos efeitos ainda não decididos; ver `assets/audio/README.md` e `LICENSES.md`.
- **Protótipo (Fase 5b)**: vozes sintetizadas por serviço com **licença comercial**, só para validar o sistema (eventos, takes, volume, pré-carregamento). Os arquivos são trocáveis sem mudar código.
- **Versão final**: vozes gravadas (contratadas ou do próprio time) e efeitos de biblioteca licenciada ou gravados. O usuário decide e fornece.
- **Antes de publicar** (Fase 7): toda voz e todo efeito tem fonte e licença registrados em `assets/audio/LICENSES.md`. Áudio sem licença comercial confirmada não vai para produção. O repositório é público até o fim do levantamento: não versionar material sem direito de redistribuição.
- Lista de falas a gravar: a tabela de eventos acima, com 2 a 3 takes cada, em ambiente silencioso, volume normalizado.

## 6. Mensagens e eventos (contrato em `packages/protocol`)

Evento de jogo (servidor → todos), usado para tocar a voz certa e animar o avatar:

```ts
type GameEvent =
  | { type: 'bet_called'; seat: number; value: number }
  | { type: 'bet_accepted'; seat: number }
  | { type: 'bet_folded'; seat: number }
  | { type: 'special_hand'; seat: number; kind: 'onze' | 'dez' | 'ferro' }
  | { type: 'trick_won'; seat: number }
  | { type: 'game_won'; team: 0 | 1 }
  | { type: 'series_won'; team: 0 | 1 };
```

Esse formato é ilustrativo. O tipo real é `PublicGameEvent` (`betCalled`, `betRaised`, `betAccepted`, `betRun`, `specialDecided`, `handStarted`, `trickDecided`, `gameDecided`, `seriesDecided`), e `voiceEventForGameEvent` em `packages/avatar/src/speech.ts` faz a conversão para evento de voz; `voiceEventForBet(value, variant)` aplica a escada da variante (Paulista 3/6/9/12, Mineiro 4/6/8/10/12).

Efeito (cliente → servidor → todos): `sfx { sfxId }` e `sfx { seat, sfxId, at }`.
