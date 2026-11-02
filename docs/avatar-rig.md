# Especificação do rig Rive do avatar (`assets/rive/avatar.riv`)

Documento para o ilustrador. É autocontido: com ele se produz o arquivo `.riv` sem ler o código. Enquanto o `.riv` não existe, o avatar vetorial de `packages/avatar` (Views e Animated) é o avatar do produto e segue exatamente este contrato. **Nomes são contrato**: mudar um nome ou a ordem de uma variante exige atualizar `packages/avatar/src/riveContract.ts`, `parts.ts`, `signals.ts`, `docs/sinais.md` e este documento juntos. Ids de sinal e índices de variante nunca são renomeados nem reordenados; só se acrescenta ao fim.

## 1. Entrega

- Arquivo `assets/rive/avatar.riv`, **menor que 500 KB** (alvo: 150 KB). Informar o tamanho a cada versão.
- **Um único artboard** chamado `Avatar`, **quadrado** (sugestão 512 x 512), com o desenho centrado em um **círculo** de recorte (o fundo `bg_color` preenche o círculo; nada fora dele aparece).
- **Uma única state machine** chamada `Main`, definida como a padrão do artboard.
- Sem texto embutido (nenhuma letra, número ou fonte), sem marcas, logotipos ou personagens de terceiros, sem imagens raster pesadas: só vetor. Se usar imagem, justificar o tamanho.
- Legível a **64 px** de lado: formas simples, traços grossos, contraste entre as partes (cabelo/rosto/fundo). Nenhum detalhe essencial menor que 2 px a 64 px.
- Desempenho: **4 instâncias simultâneas** na mesa a pelo menos 50 FPS em aparelho intermediário. Poucos nós, poucos pontos por forma, sem malhas (mesh) deformáveis pesadas, sem partículas, sem blur nem sombras difusas.
- Carregado uma vez e reutilizado pelas 4 instâncias (cada uma com suas partes e seu estado).

## 2. Inputs da state machine `Main`

### 2.1 Partes (inputs **Number**)

Cada input recebe o **índice** da variante (0 até n-1). O valor padrão de todos é 0. Qualquer combinação de índices deve montar um avatar sem sobreposição quebrada. Valor fora do intervalo não será enviado (o cliente valida), mas a state machine deve tratá-lo como 0.

| Input (Number) | Variantes | O que controla                |
| -------------- | --------- | ----------------------------- |
| `face_shape`   | 4         | Formato do rosto              |
| `skin`         | 6         | Cor da pele                   |
| `hair`         | 8         | Cabelo (estilo e cor juntos)  |
| `eyes`         | 4         | Estilo dos olhos              |
| `mouth`        | 4         | Estilo da boca                |
| `outfit`       | 6         | Roupa (modelo e cor juntos)   |
| `accessory`    | 5         | Acessório (índice 0 = nenhum) |
| `bg_color`     | 8         | Cor do círculo de fundo       |

Os nomes são exatamente estes (minúsculas, sublinhado). O catálogo e as contagens vivem em `@trucaco/protocol` (`AVATAR_PART_KEYS`, `AVATAR_PART_COUNTS`).

### 2.2 Sinais (inputs **Trigger**)

Um trigger por sinal, nome `trig_<id>`. Todos disparam uma animação de **cerca de 1 s** que **volta ao estado ocioso sozinha** (a state machine não deve ficar presa; ao terminar, retorna ao ocioso). Duração máxima de qualquer sinal: **1,2 s**.

| Trigger            | Duração | Animação                                                                                 |
| ------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `trig_wink`        | 900 ms  | Olho esquerdo (do espectador) fecha por completo e reabre; cabeça inclina levemente      |
| `trig_eyebrow`     | 900 ms  | As duas sobrancelhas sobem bem alto, seguram e descem                                    |
| `trig_lip_bite`    | 1000 ms | Dentes superiores aparecem mordendo o lábio inferior; segura e solta                     |
| `trig_cheek_puff`  | 1000 ms | As duas bochechas incham para os lados (bolinhas de pele que passam do contorno), pulsam |
| `trig_tongue`      | 1000 ms | Língua rosa sai pela boca, balança de leve e recolhe; cabeça inclina um pouco            |
| `trig_nose_twitch` | 900 ms  | Nariz treme: três movimentos curtos laterais com leve aumento                            |
| `trig_shrug`       | 1000 ms | Ombros sobem até quase a altura do queixo, seguram e descem; cabeça afunda um pouco      |
| `trig_nod`         | 1000 ms | Cabeça acena para baixo duas ou três vezes                                               |
| `trig_head_shake`  | 1000 ms | Cabeça balança de um lado a outro duas ou três vezes                                     |
| `trig_chin_up`     | 1000 ms | Cabeça inclina para trás, queixo sobe, segura e volta                                    |
| `trig_look_away`   | 1000 ms | Olhos (pupilas) e cabeça viram para o lado direito do espectador, seguram e voltam       |
| `trig_smile`       | 1000 ms | Sorriso contido aparece sobre a boca atual (qualquer variante de boca), segura e some    |

Cada sinal precisa ser **legível a 64 px** e distinguível dos outros num relance. Disparar o mesmo trigger duas vezes seguidas (com a primeira já terminada) anima duas vezes. Disparar outro trigger durante um sinal pode interromper o anterior e começar o novo (o cliente já controla a fila).

### 2.3 Estados ociosos (sem input; não são sinais)

- `idle_breathe`: contínuo e sutil (ombros e peito sobem e descem cerca de 1,5% em ciclo de ~3,6 s).
- `idle_blink`: piscada rápida (cerca de 160 ms) em intervalos aleatórios de 3 a 7 s.
- `idle_look`: olhar para a carta jogada (reserva de uso futuro; pode ficar como pose neutra por enquanto).

Os estados ociosos ficam em camadas (layers) independentes da camada dos sinais, para não competirem. Eles são locais, não passam pelo servidor.

## 3. Variantes por parte (a ORDEM é contrato)

O índice é a posição na lista, começando em 0. **Não reordenar.** A mesma lista está em `PART_VARIANT_NAMES` (`packages/avatar/src/parts.ts`).

- **`face_shape` (4)**: 0 redondo; 1 oval comprido (mais alto que largo); 2 quadrado de cantos suaves; 3 largo e achatado.
- **`skin` (6)**, do mais claro ao mais escuro: 0 bege claro (#F6D5B8); 1 bege rosado (#EDB79A); 2 dourado (#D9A066); 3 moreno (#B97A4B); 4 marrom (#8A5533); 5 marrom escuro (#5A3724). Cores de referência; podem ser ajustadas mantendo a ordem de claro para escuro.
- **`hair` (8)**: 0 careca (sem cabelo; sobrancelhas escuras); 1 curto rente; 2 repartido de lado (franja varrida); 3 topete reto (volume reto no alto); 4 longo solto (cai dos dois lados do rosto); 5 coque no alto; 6 black power (volume redondo grande); 7 moicano (faixa central alta). Cor de cada estilo (referência): 1 castanho escuro, 2 castanho médio, 3 preto, 4 loiro, 5 ruivo escuro, 6 preto, 7 verde. A cor faz parte da variante.
- **`eyes` (4)**: 0 redondos pequenos (pontos escuros); 1 grandes com brilho (branco, íris escura e reflexo); 2 estreitos (traço horizontal); 3 felizes em arco (arco voltado para cima, estilo "^").
- **`mouth` (4)**: 0 sorriso aberto suave (arco para baixo, curvo); 1 reta (traço horizontal curto); 2 aberta (oval escura); 3 sorriso de canto (arco curto inclinado).
- **`outfit` (6)**, ombros e peito com decote visível: 0 camiseta lisa vermelha, gola redonda; 1 gola em V azul; 2 listras horizontais verdes (duas faixas claras); 3 moletom amarelo com capuz atrás do pescoço e dois cordões; 4 terno escuro com camisa branca em V e gravata vermelha; 5 camisa de time roxa com distintivo redondo branco e dourado no peito (sem escudo real nem texto).
- **`accessory` (5)**: 0 nenhum; 1 óculos redondos (aros finos pretos e ponte); 2 óculos escuros (lentes escuras **semitransparentes**, para o olho e a piscada continuarem visíveis); 3 boné azul com aba, por cima do cabelo; 4 bigode escuro sob o nariz, na cor do cabelo (preto se `hair` = 0).
- **`bg_color` (8)**: 0 verde-mesa (#1F6B4A); 1 azul (#2C5C9E); 2 vermelho-tijolo (#A8472F); 3 amarelo (#D4A72C); 4 roxo (#6A4A9C); 5 laranja (#D9772B); 6 turquesa (#2A9AA0); 7 cinza-azulado (#62717F). Cor chapada, sem degradê.

Regras de composição: as variantes de `hair`, `accessory` e `eyes` se combinam livremente (o boné cobre o cabelo curto sem vazar; o cabelo longo e o black power ficam atrás do rosto; os óculos ficam sobre os olhos). Camadas, de trás para a frente: fundo, cabelo de trás, pescoço e ombros/roupa, rosto, cabelo da frente, sobrancelhas, olhos, nariz, bochechas de sinal, boca, sinais de boca (dentes, língua, sorriso), acessório.

## 4. Teste de aceitação

1. Abrir o `.riv` no Rive e, no painel de inputs, varrer cada Number de 0 a n-1 com os outros em 0: cada variante muda só a sua parte.
2. Disparar cada um dos 12 triggers: anima em até 1,2 s e retorna ao ocioso sem intervenção.
3. Combinações aleatórias de partes não geram buracos, recortes errados nem partes escapando do círculo.
4. A 64 px, os 12 sinais são distinguíveis e as 8 partes têm variantes visualmente distintas.
5. Arquivo exportado abaixo de 500 KB; 4 instâncias simultâneas fluidas.

## 5. Integração (para quem integra)

O componente `<Avatar>` de `packages/avatar` mantém a mesma API (`parts`, `signal`, `onSignalEnd`, `size`, `reduceMotion`) quando o renderizador Rive entrar: define cada input Number a partir de `parts`, dispara `trig_<id>` do sinal e chama `onSignalEnd` após a duração do catálogo. Com `reduceMotion`, não dispara a animação: mostra só o destaque estático. Falha ao carregar o `.riv` -> renderiza o avatar vetorial, sem quebrar a mesa. Constantes do contrato: `RIVE_CONTRACT` em `packages/avatar/src/riveContract.ts`. Sinais e durações: `docs/sinais.md`.
