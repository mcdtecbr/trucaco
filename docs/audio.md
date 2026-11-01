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

| Evento         | Quando toca                                    | Exemplos de fala           |
| -------------- | ---------------------------------------------- | -------------------------- |
| `truco`        | Primeiro aumento (3 no Paulista, 4 no Mineiro) | "Truco!", "Truco, ladrão!" |
| `seis`         | Aumento para 6                                 | "Seis!", "Seeeis!"         |
| `oito`         | Aumento para 8 (só Mineiro)                    | "Oito!"                    |
| `nove`         | Aumento para 9 (só Paulista)                   | "Nove!"                    |
| `dez`          | Aumento para 10 (só Mineiro)                   | "Dez!"                     |
| `doze`         | Aumento para 12                                | "Doze!", "Vale doze!"      |
| `quero`        | Aceitou o aumento                              | "Quero!", "Vem!"           |
| `corro`        | Correu do aumento                              | "Corro.", "Tô fora."       |
| `mao_especial` | Mão de onze ou de dez, ao decidir jogar        | "Vamos nessa!"             |
| `mao_de_ferro` | Início da mão de ferro                         | "Mão de ferro!"            |
| `vaza`         | Ganhou uma vaza (opcional, menos frequente)    | "Boa!"                     |
| `venceu_jogo`  | Dupla venceu o jogo                            | "É nossa!"                 |
| `venceu_serie` | Dupla venceu a série melhor de 3               | "Campeões!"                |

- O nome falado segue o valor da aposta e não a variante: o evento `seis` toca nas duas.
- **2 a 3 variações (takes)** por evento, para não repetir sempre a mesma gravação. Arquivo: `assets/audio/voices/<voiceId>/<evento>_<n>.m4a`.
- Quem toca o grito é o aparelho de **cada jogador**, a partir do evento de jogo vindo do servidor. Nenhum áudio trafega pela rede.
- Junto do grito, o avatar executa a animação Rive `trig_shout` (boca aberta) e aparece um balão grande com o texto da fala. O texto é obrigatório: serve de legenda para quem joga sem som.

## 2. Efeitos engraçados (soundboard)

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

- Reprodução com `expo-audio` (web, iOS e Android). Confirmar na Fase 5b que a API cobre pré-carregar, tocar sobreposto e ajustar volume nas três plataformas.
- **Pré-carregamento** ao entrar na mesa: só as vozes dos 4 avatares presentes, mais o soundboard.
- **Formato**: mono, curto (cerca de 1 s por fala), AAC `.m4a`. Verificar suporte em iOS, Android e nos navegadores-alvo antes de gravar tudo; se faltar, gerar também `.ogg`/`.mp3`.
- **Orçamento**: meta de até 1 MB por voz completa e 1 MB para o soundboard. Medir na Fase 5b e ajustar.
- **Web**: navegadores só liberam áudio após um gesto do usuário. A tela de entrada ou o botão "entrar na mesa" precisa desbloquear o áudio.
- **Latência**: o grito toca ao chegar o evento do servidor, junto da animação; conferir que não atrasa em relação ao estado da mesa.

## 5. Fonte dos áudios e licenças

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

`value` é o valor da aposta; o cliente converte em evento de voz (`truco`, `seis`, `oito`, `nove`, `dez`, `doze`) pela escada da variante.

Efeito (cliente → servidor → todos): `sfx { sfxId }` e `sfx { seat, sfxId, at }`.
