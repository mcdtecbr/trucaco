# Especificação do rig Rive do avatar (`assets/rive/avatar.riv`)

> O `assets/rive/avatar.riv` já foi montado e exportado; o que ele tem e onde difere deste contrato está em `docs/avatar-rive-estado.md`.

Documento para o ilustrador. É autocontido: com ele se produz o arquivo `.riv` sem ler o código. O avatar vetorial de `packages/avatar` (fallback com `react-native-svg`) é o avatar do produto e desenha as mesmas variantes do `.riv` (ADR 0003). **Nomes são contrato**: mudar um nome ou a ordem de uma variante exige atualizar `packages/avatar/src/riveContract.ts`, `parts.ts`, `signals.ts`, `docs/sinais.md` e este documento juntos. Ids de sinal e índices de variante nunca são renomeados nem reordenados; só se acrescenta ao fim.

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

| Input (Number) | Variantes | O que controla                         |
| -------------- | --------- | -------------------------------------- |
| `face_shape`   | 6         | Formato do rosto                       |
| `skin`         | 8         | Cor da pele                            |
| `hair`         | 19        | Formato do cabelo (cor = `hair_color`) |
| `eyes`         | 6         | Estilo dos olhos                       |
| `mouth`        | 5         | Estilo da boca                         |
| `outfit`       | 6         | Roupa (modelo e cor juntos)            |
| `accessory`    | 3         | Acessório (índice 0 = nenhum)          |
| `bg_color`     | 8         | Cor do círculo de fundo                |
| `hair_color`   | 8         | Cor do cabelo, sobrancelha e bigode    |
| `eye_color`    | 3         | Cor da pupila                          |
| `outfit_color` | 11        | Cor da roupa (0 = padrão do modelo)    |
| `brows`        | 4         | Sobrancelhas (cor = `hair_color`)      |
| `nose`         | 8         | Nariz (cor = sombra da pele)           |
| `beard`        | 5         | Barba (cor = `hair_color`)             |
| `hat`          | 11        | Chapéu ou boné (cor própria)           |

São **15 Numbers** (ADR 0004, 0006 e 0007; `face_shape` e `eyes` têm 6 opções, `hair` 19). Cor é dimensão própria, separada da forma: `hair_color` vale para cabelo, sobrancelha, bigode e barba (o chapéu tem cor própria e não existe `hat_color`); `eye_color` recolore a pupila; `outfit_color` 0 usa a cor principal de cada modelo de roupa e 1 a 10 aplicam a paleta (`OUTFIT_COLORS`). As chaves novas ficam ao fim de `AVATAR_PART_KEYS`.

Os nomes são exatamente estes (minúsculas, sublinhado). O catálogo e as contagens vivem em `@trucaco/protocol` (`AVATAR_PART_KEYS`, `AVATAR_PART_COUNTS`).

### 2.2 Sinais (inputs **Trigger**)

Um trigger por sinal, nome `trig_<id>`, exceto `wink`, que usa `trig_wink_l`. Todos disparam uma animação de **cerca de 1 s** que **volta ao estado ocioso sozinha** (a state machine não deve ficar presa; ao terminar, retorna ao ocioso). Duração máxima de qualquer sinal: **1,2 s**.

| Trigger            | Duração | Animação                                                                                                                                              |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trig_wink_l`      | 900 ms  | Olho esquerdo (do espectador) fecha por completo e reabre; cabeça inclina levemente (id `wink`)                                                       |
| `trig_wink_r`      | 900 ms  | Olho direito (do espectador) fecha por completo e reabre (id `wink_r`)                                                                                |
| `trig_eyebrow`     | 900 ms  | As duas sobrancelhas sobem bem alto, seguram e descem                                                                                                 |
| `trig_lip_bite`    | 1000 ms | Dentes superiores aparecem mordendo o lábio inferior; segura e solta                                                                                  |
| `trig_cheek_puff`  | 1000 ms | As duas bochechas incham para os lados (bolinhas de pele que passam do contorno), pulsam                                                              |
| `trig_tongue`      | 1000 ms | Boca aberta com a língua rosa **de lado**, segura e recolhe (no fallback, a cabeça inclina 5° e a língua balança; no `.riv` só a troca de opacidades) |
| `trig_mouth_open`  | 1000 ms | Boca aberta com dentes em cima e embaixo e língua **centrada**, segura e fecha (id `mouth_open`)                                                      |
| `trig_nose_twitch` | 900 ms  | Nariz treme: três movimentos curtos laterais com leve aumento                                                                                         |
| `trig_shrug`       | 1000 ms | Ombros sobem até quase a altura do queixo, seguram e descem; cabeça afunda um pouco                                                                   |
| `trig_nod`         | 1000 ms | Cabeça acena para baixo duas ou três vezes                                                                                                            |
| `trig_head_shake`  | 1000 ms | Cabeça balança de um lado a outro duas ou três vezes                                                                                                  |
| `trig_chin_up`     | 1000 ms | Cabeça inclina para trás, queixo sobe, segura e volta                                                                                                 |
| `trig_look_away`   | 1000 ms | Olhos (pupilas) e cabeça viram para o lado direito do espectador, seguram e voltam                                                                    |
| `trig_smile`       | 1000 ms | Sorriso contido aparece sobre a boca atual (qualquer variante de boca), segura e some                                                                 |
| `trig_mouth_l`     | 1000 ms | Boca inteira inclina e desloca para a esquerda do espectador, segura e volta (id `mouth_l`)                                                           |
| `trig_mouth_r`     | 1000 ms | Igual, para a direita do espectador (id `mouth_r`)                                                                                                    |

Cada sinal precisa ser **legível a 64 px** e distinguível dos outros num relance. Disparar o mesmo trigger duas vezes seguidas (com a primeira já terminada) anima duas vezes. Disparar outro trigger durante um sinal pode interromper o anterior e começar o novo (o cliente já controla a fila).

### 2.3 Estados ociosos (sem input; não são sinais)

- `idle_breathe`: contínuo e sutil (ombros e peito sobem e descem cerca de 1,5% em ciclo de ~3,6 s).
- `idle_blink`: piscada rápida com intervalo **variável**: três estados da layer `Blink_Random` usam a mesma timeline em velocidades 1,5x, 1x e 0,65x, ligados entre si por transições com Exit Time de 4400 ms e **Randomize Exit** ligado, então cada ciclo sorteia o próximo estado (intervalo esperado entre cerca de 3 e 7 s; não medido com precisão).
- `idle_look`: olhar para a carta jogada (reserva de uso futuro; pode ficar como pose neutra por enquanto).

Os estados ociosos ficam em camadas (layers) independentes da camada dos sinais, para não competirem. Eles são locais, não passam pelo servidor.

## 3. Variantes por parte (a ORDEM é contrato)

O índice é a posição na lista, começando em 0. **Não reordenar.** A mesma lista está em `PART_VARIANT_NAMES` (`packages/avatar/src/parts.ts`).

- **`face_shape` (6)**, 1ª linha da prancha: 0 oval alto; 1 redondo; 2 quadrado; 3 coração; 4 queixo em V; 5 longo.
- **`skin` (8)**, cor base / sombra: 0 clara (#FCE4D6 / #E8B89B); 1 dourada (#E0AC69 / #C68943); 2 morena (#B87B42 / #945927); 3 marrom (#8D5524 / #673B15); 4 marrom escura (#523219 / #361F0E); 5 terrosa (#C67D5A / #A15538); 6 oliva (#C9A56B / #A07E45); 7 rosada (#F1C2AE / #D49A84).
- **`hair` (19)**, só o formato (a cor vem de `hair_color`), na ordem das pranchas (esquerda para a direita, cima para baixo, sem as repetições que só mudam de cor). Nós: `hair_<n>_back` (camada 2, atrás da cabeça, do pescoço e da roupa) e `hair_<n>_front` (camada 7). 0 careca (`hair_bald_shade`); 1 espetado (front); 2 longo ondulado (back, front); 3 cacheado (back, front); 4 coque alto (front, com o coque no mesmo path); 5 longo com franja (back, front); 6 ondulado médio (back, front); 7 topete lateral (front); 8 afro (back, front); 9 pixie (front); 10 repicado (front); 11 bob de lado (back, front); 12 longo de lado (front); 13 ondulado curto (back, front); 14 longo liso (back, front); 15 bob repicado (back, front); 16 coque (`hair_16_cap` e `hair_16_bun`); 17 bob com franja (back, front); 18 raspado (front, opacidade 0.72). Boné e chapéu saíram de `hair`.
- **`beard` (5)**, cor = `hair_color`, camada 4 (logo depois do rosto; boca, nariz e bigode ficam por cima): 0 sem barba; 1 barba cheia com bigode e furo da boca (`beard_1`); 2 sombra de barba, opacidade 0.35 (`beard_2`); 3 cavanhaque com bigode (`beard_3`); 4 cavanhaque (`beard_4`).
- **`hat` (11)**, camada 7, cada um com as cores da prancha (nós `hat_<n>_<papel>`): 0 sem chapéu; 1 boné azul (crown, brim, button); 2 boné vermelho (idem); 3 boné preto (idem); 4 chapéu de palha (brim, crown, band); 5 boné vermelho de lado (crown, panel, brim, button); 6 gorro azul com pompom (dome, cuff, pompom); 7 gorro vermelho canelado (dome, cuff, ribs); 8 fedora (brim, crown, band); 9 chapéu de pescador (brim, crown, eyelets); 10 boné preto e vermelho (crown, panel, brim, button). Com `hat` de 1 a 10 o cabelo da frente e do topo some (grupo-embrulho `hair_front`, opacidade chaveada pelas timelines `hat_*` na layer `hat`: `hat_0` = 100%, `hat_1` a `hat_10` = 0%; entram nele `hair_<n>_front`, `hair_16_cap`, `hair_16_bun`, `hair_bald_shade`, `hair_3_back` e `hair_8_back`) e ficam só os `hair_<n>_back` dos longos. Os cabelos 2 e 14 não aceitam chapéu: a regra vive no servidor (`parseAvatarParts`) e no editor, e o `.riv` não precisa tratar essa combinação (ADR 0007). A copa de palha (4), fedora (8) e pescador (9) cobre a cabeça inteira; a aba é moderada.
- **`eyes` (6)**: 0 amendoado com delineador; 1 aberto com pálpebra marcada; 2 redondo liso; 3 arregalado com cílios; 4 grande com brilho; 5 cílios longos.
- **`mouth` (5)**: 0 sorriso discreto com brilho (padrão); 1 sorriso largo com dentes; 2 lábios cheios entreabertos, escuros por dentro; 3 lábios fechados com cantinhos; 4 lábios cheios com cantinhos. O índice guarda o tipo de boca, não o traço exato (o desenho de 0 a 3 mudou na ADR 0005). No Rive, o Solo da boca tem 5 grupos, todos chamados "Group": identifique pela ordem.
- **Boca aberta dos sinais** (fora do catálogo; oculta em repouso): grupo `boca2`, filho do `Bone 1` e na frente, com 7 peças: `mouth_inside`, `mouth_open_teeth_upper`, `mouth_open_teeth_lower`, `mouth_open_lower`, `mouth_open_upper`, `tongue_center` (sinal `mouth_open`) e `tongue` (sinal `tongue`, de lado). Opacidade base 0.
- **`outfit` (6)**, modelo (cores abaixo são o padrão, `outfit_color` 0): 0 camiseta cinza (#E5E7EB), gola redonda; 1 camiseta rosa (#F2A0A0) gola V, mostra pele; 2 polo azul (#0EA5E9) com gola e botões; 3 camisa marrom (#7C2D12) de botões; 4 colete escuro (#1F2937) sobre camisa branca; 5 regata branca (#F9FAFB), mostra pele.
- **`hair_color` (8)**: 0 castanho escuro (#2B1B12); 1 preto (#14110F); 2 castanho (#5A3A22); 3 loiro (#E3C16F); 4 ruivo (#B7461B); 5 grisalho (#A9ADB3); 6 azul (#2B6CB0); 7 rosa (#D64C8F).
- **`eye_color` (3)**: 0 escuro (#1B1B1F); 1 castanho (#6B3F1F); 2 azul (#2B72C9).
- **`outfit_color` (11)**: 0 padrão do modelo; 1 a 10 = índices 1 a 10 de `OUTFIT_COLORS` em `packages/avatar/src/parts.ts` (rosa, azul claro, marrom, grafite, branco, preto, azul, vermelho, verde, amarelo).
- **`accessory` (3)**: 0 nenhum; 1 bigode (cor do cabelo); 2 brinco dourado (#F5B301). Óculos e boné de acessório **não existem**: os óculos escondem o piscar de olho, base dos sinais (ADR 0003).
- **`bg_color` (8)**: 0 verde (#1E5631); 1 azul (#1D4ED8); 2 vermelho (#991B1B); 3 laranja (#D97706); 4 cinza (#4B5563); 5 roxo (#581C87); 6 laranja escuro (#C2410C); 7 turquesa (#0F766E). Cor chapada, sem degradê.

A fonte vetorial de todas as variantes é `packages/avatar/src/art.ts` (183 paths e 1256 vértices, orçamento de 1300; 512×512); o fallback vetorial e o `.riv` desenham o mesmo conjunto (ADR 0003). Referência visual: `assets/rive/test_matrix/`.

Regras de composição: as variantes de `hair`, `accessory` e `eyes` se combinam livremente (com chapéu o cabelo da frente some; o cabelo longo e o afro ficam atrás do rosto). Camadas, de trás para a frente: fundo, cabelo de trás, pescoço e ombros/roupa, rosto, barba, sobrancelhas, olhos, nariz, bochechas de sinal, boca, sinais de boca (dentes, língua, sorriso), acessório, cabelo da frente, chapéu.

### 3.1 Estrutura montada no Rive (fatia 4, 05/11/2026)

O `.riv` exportado tem as peças de cabelo, barba e chapéu: 58.135 bytes, 15 Numbers e 16 triggers. Os nomes `hair_<n>_back`, `hair_<n>_front` e `hat_<n>_<papel>` acima são o contrato do código. No `.riv` os objetos têm nomes do editor ("Group", "Solo" e nomes herdados), porque renomear não funcionou; as animações guardam os nomes do contrato (`hair_0` a `hair_18`, `beard_0` a `beard_4`, `hat_0` a `hat_10`). Localize os objetos pela ordem e pela estrutura abaixo.

- **Cabelo de trás:** Solo `hair_back` (nome no editor `cabelo4a 2`), em `avatar_partes`, atrás do pescoço. Filhos `hb_2`, `hb_3`, `hb_5`, `hb_6`, `hb_8`, `hb_11`, `hb_13`, `hb_14`, `hb_15` e `hb_17`, mais um filho vazio (formatos sem cabelo de trás).
- **Cabelo da frente:** wrapper `hair_front` ("Group") dentro de `Bone 1`, com um Solo "cabelo4a" (`hf_0` a `hf_18`). É o grupo-embrulho que o chapéu esconde.
- **Barba:** Solo `beard` (nome no editor "Group") em `Bone 1`, entre `boca2` e `hair_front`. Filho 0 vazio (sem barba) e `bd_1` a `bd_4`.
- **Chapéu:** Solo `fatia4b` no topo de `Bone 1`. Filho 0 vazio e `ht_1` a `ht_10`.
- **Timelines:** `hair_0` a `hair_18`, `beard_0` a `beard_4` e `hat_0` a `hat_10`. As `hat_*` também chaveiam a opacidade do wrapper `hair_front` (`hat_0` 100%, demais 0%).
- **Layers:** `hair`, `beard` (nome no editor "Layer 18") e `hat`.
- **Cor:** `hair_color_0` a `hair_color_7` recolorem o cabelo da frente, o de trás, as sobrancelhas e as barbas.

Validado no runtime web (`@rive-app/canvas` 2.21.6, 05/11/2026): `hair` 0 a 18 com `hair_color` 0 a 7; `beard` 0 a 4 com a cor do cabelo; `hat` 0 a 10 com o cabelo da frente sumindo e o de trás permanecendo. Aparelho iOS/Android não testado. Diário e lições em `docs/avatar-rive-estado.md`.

### 3.2 Sombreado (fatia 5, sem input novo)

Sete formas translúcidas por cima da arte, sem input, sem migração e sem mudar o protocolo. Nós novos (nomes são contrato; fonte em `art.ts`, SVGs em `assets/rive/source/shade_*.svg`). Cores derivadas da pele escolhida (`skin`): `shade` é a cor de sombra da pele (já existe em `SKIN_COLORS`); `deep` = `shade` misturado 40% com `#2A1208`; `blush` = `shade` misturado 50% com `#D2475A`. Mistura linear em RGB. Cada nó recebe a cor da pele como o `neck_shadow` já recebe.

| Nó                 | Camada (posição)                           | Forma                                                                                                          | Recorte                              | Cor       | Opacidade | Visível quando                            |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------- | --------- | ----------------------------------------- |
| `shade_jaw_soft`   | 4, logo depois de `neck_shadow`            | retângulo (100,226 a 412,420) menos a meia-elipse INFERIOR, centro (256,226), raios 124 x 112 (contorno único) | rosto escolhido (`face_*`)           | `shade`   | 0,12      | sempre                                    |
| `shade_jaw`        | 4, depois do anterior                      | retângulo (100,226 a 412,420) menos a meia-elipse INFERIOR, centro (256,226), raios 124 x 124 (contorno único) | rosto escolhido                      | `shade`   | 0,16      | sempre                                    |
| `shade_cheek_l`    | 4                                          | elipse centro (194,292) raios 24 x 14                                                                          | nenhum                               | `blush`   | 0,28      | sempre                                    |
| `shade_cheek_r`    | 4                                          | elipse centro (318,292) raios 24 x 14                                                                          | nenhum                               | `blush`   | 0,28      | sempre                                    |
| `shade_beard_neck` | 4, antes das barbas (a barba cobre o alto) | `M222,386L290,386L289,414Q256,434 223,414Z`                                                                    | nenhum                               | `deep`    | 0,35      | `beard` 1, 3 ou 4                         |
| `shade_bald_gloss` | 7, depois de tudo                          | `M214,134Q246,118 282,128Q250,128 220,148Q208,146 214,134Z`                                                    | rosto escolhido                      | `#FFFFFF` | 0,28      | `hair` = 0 e `hat` = 0                    |
| `shade_hair_gloss` | 7, depois de tudo                          | `M188,142Q204,108 252,96Q282,92 306,100Q262,104 232,122Q210,134 200,160Q184,160 188,142Z`                      | `hair_<n>_front` do cabelo escolhido | `#FFFFFF` | 0,20      | `hair` fora de 0 e 16 (coque) e `hat` = 0 |

Mandíbula em dois degraus (soft 0,12 e core 0,16, soma 0,28 no fundo): o retângulo começa no centro da elipse (y = 226), não em y = 300, para não deixar borda reta horizontal fora do rosto. As elipses são largas o bastante (rx 124) para nenhum dos 6 rostos passar delas nessa altura.

Montado no Rive (fatia 5, 04/11/2026; `avatar.riv` de 60.606 bytes, 15 Numbers, 16 triggers, validado no runtime web):

- **Recorte pelo rosto:** `shade_jaw_soft`, `shade_jaw` e `shade_bald_gloss` recortam (as bochechas não têm recorte; os polígonos exatos das mandíbulas a reimportar no Rive são `assets/rive/source/shade_jaw_soft.svg` e `shade_jaw.svg`: só o anel abaixo de y=226, nada na testa) pelo Solo de rostos (`faces3`). Clipping Shape aceita Solo como fonte.
- **Recorte pelo cabelo:** `shade_hair_gloss` recorta pelo Solo `cabelo4a` (`hf_*`), dentro do wrapper `hair_front`. Com chapéu, o wrapper some pelas timelines `hat_*`, então a regra `hat` = 0 vale.
- **Posição:** `shade_bald_gloss` dentro de `hf_0`. Mandíbulas, bochechas e `shade_beard_neck` logo acima do Solo `faces3`, em `Bone 1`.
- **Cor por pele:** `shade`, `blush` e `deep` chaveadas nas timelines `skin_0` a `skin_7` (`skin_0` chaveado explicitamente).
- **Visibilidade:** `shade_beard_neck` pela opacidade do grupo nas timelines `beard_0` a `beard_4` (0% em 0 e 2, 100% nas outras). `shade_hair_gloss` nas timelines `hair_n` (0% em `hair_0` e `hair_16`, 100% nas outras 17).

**Não há divergência.** No Rive o recorte é o Solo `cabelo4a` inteiro, mas um Solo renderiza só o filho ativo (o cabelo escolhido). Por isso o recorte no Rive equivale ao `hair_<n>_front` do fallback. Verificado no runtime web (04/11/2026) com todos os formatos de `hair` (0 a 18), `hair_color` 5 e `skin` 1: o brilho não vazou para a pele. (A suspeita de que o Solo inteiro vazaria foi um falso alarme.)

No fallback, o `AvatarFallback` usa `ClipPath` do `react-native-svg` com os mesmos paths (`clipPaths` em `art.ts`); id do recorte único por instância (`useId`), emitido uma vez por Svg. Só testado no web; `ClipPath` nativo não foi visto em aparelho. Referência visual do estado final: `assets/rive/test_matrix/` (todos os 10 PNGs regenerados com o sombreado). Em `_composto.svg` o recorte aparece como atributo `data-clip` (não é renderizado por visualizadores comuns).

Pendências: a matriz de combinações não foi toda conferida no editor (hair 8, 12 e 16, entre outros, foram vistos só no runtime); iOS e Android não testados. Os assets de importação do painel Assets do Rive não são sobras: os nomes aparecem como nós em uso na hierarquia, então não há nada a apagar. Lições e receitas em `docs/avatar-rive-estado.md` (fatia 5).

### 3.3 Peças com geometria alterada (`fix/avatar-pendencias`, 04/11/2026)

Esta correção mudou o desenho (`d`) de 7 peças e a opacidade de `hair_18_front`. Nomes, camadas, hierarquia e inputs seguem iguais. O `.riv` reexportado em 04/11/2026 (60.502 bytes) já tem essa geometria. Para reproduzir no editor, reimportar o SVG de `assets/rive/source/` por cima do nó de mesmo nome (o `_composto.svg` traz todas):

- `hair_1_front.svg`, `hair_7_front.svg`, `hair_10_front.svg`, `hair_5_front.svg`, `hair_17_front.svg`: borda da franja subida (de 4 a 24 px, conforme o ponto) para as sobrancelhas ficarem visíveis. Nos cabelos 5 e 17, a mecha lateral também foi afastada 10 a 15 px do canto externo dos olhos.
- `hair_18_front.svg`: mesmo contorno; `fill-opacity` de 0,5 para 0,72, para ler como cabelo raspado e não como cinza claro. No Rive, o alpha é chaveado nas 8 timelines `hair_color_0` a `hair_color_7`.
- `hat_6_pompom.svg`: pompom menor e mais baixo (topo em y 56,5; antes 47,5). A copa e a faixa não mudaram.

No fallback (`art.ts`), o pompom é `ell(256, 64, 23, 21)` escalado por `HAT_SCALE` (`'6'`), e termina no mesmo topo (y 56,5) do SVG.

Margem do topo (artboard 512): o gorro inteiro cabe no Rive (cúpula em y 80,8; pompom em y 56,5). O SVG de origem do pompom nunca saiu do artboard (topo em 47,5 antes da correção); o excesso visto antes no editor foi leitura errada, não geometria.

### 3.4 Cabelos longos 2, 12 e 14: franja fora dos olhos (mesclada no PR #18, fbc552b)

Os cabelos 2 (longo ondulado), 12 (longo de lado) e 14 (longo liso) cobriam de 13% a 53% de olhos e sobrancelhas (medido com o cabelo dilatado 6 px). A abertura do rosto na peça da frente foi alargada (meia-largura de 78 para 110 px, topo da linha do cabelo de y 138/150 para y 128) e o contorno externo subiu de 4 a 14 px para a mecha não ficar fina. Resultado medido (rasterização, dilatação de 6 px, 4 sobrancelhas e 6 olhos): cobertura 0% em todas as combinações. Silhueta mantida: as peças `hair_<n>_back` não mudaram (o contorno externo da frente fica entre 4 e 16 px dentro do de trás). Ressalva do 12: ele não tem peça de trás, então a abertura larga deixava uma faixa de fundo entre a bochecha e o cabelo (até 20 px a y 300 no rosto oval, até 26 no coração). A borda interna do 12 volta para perto do contorno do rosto abaixo de y 240 (vértices 5, 6, 8 e 9 de novo; ver a tabela): faixa de no máximo 3 px nos 6 rostos entre y 240 e 300, e olhos e sobrancelhas seguem a 6 px de folga (até 0,08% dos pontos do estilo 5). Em contrapartida, o cabelo cobre parte das bochechas dos rostos redondo e quadrado (a borda interna passa por x 178 a 334 em y 300). Mesmo número de vértices (10 por peça) e mesmo orçamento (182 paths, 1252 vértices).

Peças com `d` alterado (reimportar o SVG de `assets/rive/source/` por cima do nó de mesmo nome, ou editar os vértices abaixo no Edit Vertices; `_composto.svg` traz as três): `hair_2_front.svg`, `hair_12_front.svg`, `hair_14_front.svg`. Nenhum nome, camada, hierarquia ou input mudou.

Tabela vértice a vértice (ordem do path, começando no `M`). Coordenadas absolutas do artboard 512; cada handle e posição aparece como antigo -> novo.

#### hair_2_front (10 vértices, mesma ordem e mesmos tipos de segmento)

| Vértice (ordem do path, começando em M) | posição antiga -> nova | handle de entrada (in) antigo -> novo | handle de saída (out) antigo -> novo |
| --------------------------------------- | ---------------------- | ------------------------------------- | ------------------------------------ |
| 0                                       | 256,84 (igual)         | 182,84 -> 180,84                      | 330,84 -> 332,84                     |
| 1                                       | 378,230 -> 384,230     | 378,128 -> 384,128                    | 383.33,255.33 -> 390.67,255.33       |
| 2                                       | 372,300 -> 382,300     | 381.33,278.67 -> 390,278.67           | 364,321.33 -> 374,321.33             |
| 3                                       | 380,372 -> 388,372     | 366.67,345.33 -> 376,345.33           | 350,372 -> 362,372                   |
| 4                                       | 334,266 -> 366,266     | 334,322 -> 366,326                    | 332,198 -> 366,190                   |
| 5                                       | 256,138 -> 256,128     | 304,150 -> 330,132                    | 208,150 -> 182,132                   |
| 6                                       | 178,266 -> 146,266     | 180,198 -> 146,190                    | 178,322 -> 146,326                   |
| 7                                       | 132,372 -> 124,372     | 162,372 -> 150,372                    | 145.33,345.33 -> 136,345.33          |
| 8                                       | 140,300 -> 130,300     | 148,321.33 -> 138,321.33              | 130.67,278.67 -> 122,278.67          |
| 9                                       | 134,230 -> 128,230     | 128.67,255.33 -> 121.33,255.33        | 134,128 -> 128,128                   |

Vértices alterados: 10 de 10. Handles em coordenadas absolutas do artboard 512; segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle). Os segmentos com handle = vértice são retos.

#### hair_12_front (10 vértices, mesma ordem e mesmos tipos de segmento)

| Vértice (ordem do path, começando em M) | posição antiga -> nova | handle de entrada (in) antigo -> novo | handle de saída (out) antigo -> novo |
| --------------------------------------- | ---------------------- | ------------------------------------- | ------------------------------------ |
| 0                                       | 144,236 -> 130,236     | 142,270 -> 126,270                    | 134,140 -> 122,140                   |
| 1                                       | 250,82 (igual)         | 170,84 -> 166,84                      | 336,80 (igual)                       |
| 2                                       | 384,236 -> 390,236     | 384,130 -> 390,130                    | 386,300 -> 392,300                   |
| 3                                       | 382,396 -> 386,396     | 372,350 -> 376,350                    | 396,436 -> 400,436                   |
| 4                                       | 400,500 -> 402,500     | 412,470 -> 414,470                    | 380,470 -> 382,470                   |
| 5                                       | 346,380 -> 350,380     | 350,440 -> 354,440                    | 346,320 -> 320,336                   |
| 6                                       | 340,246 -> 362,240     | 350,280 -> 340,270                    | 332,206 -> 374,190                   |
| 7                                       | 262,150 -> 262,128     | 310,170 -> 322,130                    | 214,160 -> 200,130                   |
| 8                                       | 160,250 -> 150,240     | 174,190 -> 138,190                    | 152,300 -> 172,268                   |
| 9                                       | 144,336 -> 146,340     | 160,330 -> 196,308                    | 130,300 -> 118,300                   |

Vértices alterados: 10 de 10. Handles em coordenadas absolutas do artboard 512; segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle). Os segmentos com handle = vértice são retos.

#### hair_14_front (10 vértices, mesma ordem e mesmos tipos de segmento)

| Vértice (ordem do path, começando em M) | posição antiga -> nova | handle de entrada (in) antigo -> novo | handle de saída (out) antigo -> novo |
| --------------------------------------- | ---------------------- | ------------------------------------- | ------------------------------------ |
| 0                                       | 256,88 (igual)         | 184,88 -> 180,88                      | 328,88 -> 332,88                     |
| 1                                       | 372,230 -> 382,230     | 372,130 -> 380,130                    | 372,230 -> 382,230                   |
| 2                                       | 380,402 -> 388,402     | 380,402 -> 388,402                    | 380,402 -> 388,402                   |
| 3                                       | 352,404 -> 360,404     | 352,404 -> 360,404                    | 340,330 -> 366,330                   |
| 4                                       | 336,250 -> 366,262     | 340,290 -> 366,290                    | 330,196 -> 366,190                   |
| 5                                       | 256,140 -> 256,128     | 300,150 -> 330,132                    | 212,150 -> 182,132                   |
| 6                                       | 176,250 -> 146,262     | 182,196 -> 146,190                    | 172,290 -> 146,290                   |
| 7                                       | 160,404 -> 152,404     | 172,330 -> 146,330                    | 160,404 -> 152,404                   |
| 8                                       | 132,402 -> 124,402     | 132,402 -> 124,402                    | 132,402 -> 124,402                   |
| 9                                       | 140,230 -> 130,230     | 140,230 -> 130,230                    | 140,130 -> 132,130                   |

Vértices alterados: 10 de 10. Handles em coordenadas absolutas do artboard 512; segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle). Os segmentos com handle = vértice são retos.

**Estado em `avatar (22).riv` (04/11/2026, antes da seção 3.5):** `assets/rive/avatar.riv` com 60.502 bytes, 15 Numbers e 16 triggers. Só os vértices de `hair_2_front`, `hair_12_front` e `hair_14_front` mudaram, em relação a `avatar (20).riv` (do mesmo tamanho); o `(22)` difere do `(21)` apenas no cabelo 12 (comparação pixel a pixel). Nomes, camadas, hierarquia e inputs seguem iguais. O fallback (`packages/avatar/src/art.ts`) tem a mesma geometria, inclusive o `hair_12_front` com a borda interna da tabela acima (vértices 5, 6, 8 e 9 reajustados, sem faixa de fundo; os mesmos valores foram digitados no Rive no `(22)`). Validação: comparação pixel a pixel no runtime web de 85 combinações (`hair` 0 a 18 com `hair_color` 0 e 3, `skin` 0 a 7, `mouth` 0 a 4, `face_shape` 0 a 5, `beard` 0 a 4, `hat` 0 a 10, `eyes`, `brows`, `nose`, `outfit`, `accessory`, `eye_color`) contra a versão anterior: só os cabelos 2, 12 e 14 mudaram. O ruído do piscar (90 a 330 px) é o mesmo quando a versão anterior é comparada com ela mesma.

Os cabelos 4, 6, 11, 13 e 15 e a ressalva do 12 foram tratados na seção 3.5. A tabela do `hair_12_front` acima é a da versão anterior à 3.5: a frente do 12 foi reeditada de novo e o `hair_12_back` foi criado. O teste de regressão (`packages/avatar/src/art.test.ts`, "franja de todos os cabelos 1..18 deixa sobrancelhas e olhos livres...") cobre os 18 cabelos em três grupos: ZERO (3, 4, 6, 8, 11, 12, 13, 15: folga de 6 px, nenhum ponto de olho ou sobrancelha coberto), LONGOS (2 e 14: folga de 6 px, teto de 0,5% dos pontos de cada um dos 6 estilos de olho; o cílio do estilo 3 encosta) e JUSTOS (1, 5, 7, 9, 10, 16, 17, 18: sem folga, só não podem sobrepor; nenhuma sobrancelha e teto de 2% por estilo de olho; o cílio do estilo 5 encosta na mecha lateral de 5 e 17). O mesmo teste confere que o 12 não abre faixa de fundo (0 px, com cabelo achado em toda linha) entre o rosto e o cabelo em y 240 a 300, nos 6 rostos.

### 3.5 Cabelos 4, 6, 11, 12, 13 e 15: rosto livre e `hair_12_back` (branch `fix/avatar-cabelos-rosto`, ainda não mesclada)

Os cabelos 4 (coque alto), 6 (ondulado médio), 11 (bob de lado), 13 (ondulado curto) e 15 (bob repicado) cobriam parte de olhos e sobrancelhas (até 26%, 35%, 13%, 42% e 57% de um estilo de olho, com folga de 6 px; 4 a 31% das sobrancelhas). Em todos, a franja subiu para y 176 ou menos e a borda interna da mecha lateral saiu da zona dos olhos (x de 142 a 148 à esquerda e de 366 a 372 à direita); o contorno externo foi alargado de 4 a 12 px para a mecha lateral não ficar fina (sempre dentro do contorno da peça de trás, que não mudou). Silhueta e caráter mantidos: coque e testa limpa no 4, ondas e pontas no 6 e no 13, franja de lado no 11, pontas repicadas no 15.

O cabelo 12 (longo de lado) não tinha peça de trás, então a borda interna da frente precisava voltar ao contorno do rosto abaixo de y 240 e cobria bochechas dos rostos redondo e quadrado. Agora o 12 tem a peça `hair_12_back` (camada 2, sem `hideWithHat`, como as de 2 e 14: fica sob o chapéu) que cobre a faixa de fundo atrás do rosto, e a frente voltou à abertura larga (borda interna em x 144 e 366 em y 250 a 340; a mecha longa do lado direito e a mecha curta do esquerdo mantidas). O brilho (`shade_hair_gloss`) segue recortado só pela frente (`hair_12_front`).

Resultado medido (rasterização por amostragem do contorno, 4 sobrancelhas e 6 estilos de olho, os dois lados): com folga de 6 px, 0% de cobertura em olhos (por estilo) e sobrancelhas nos cabelos 3, 4, 6, 8, 11, 12, 13 e 15; 2 e 14 até 0,2% (um ponto do cílio do estilo 3); 1, 5, 7, 9, 10, 16, 17 e 18 já eram aceitos sem folga (0 sobrancelhas, até 1,8% do estilo 5). Faixa de fundo no 12: 0 px nos 6 rostos entre y 240 e 300 (frente mais `hair_12_back`); pontos de bochecha (194,292) e (318,292) fora da frente do 12 nos 6 rostos. Orçamento: 183 paths e 1256 vértices pela contagem do `countVertices` (teto 1300; eram 182 paths e 1248 vértices: `hair_12_back` soma 8 e as seis frentes mantêm o mesmo número de vértices cada).

Peças alteradas ou novas (reimportar o SVG de `assets/rive/source/` por cima do nó de mesmo nome, ou editar os vértices abaixo no Edit Vertices; `_composto.svg` e `_indice.csv` já trazem tudo): `hair_4_front.svg`, `hair_6_front.svg`, `hair_11_front.svg`, `hair_12_front.svg`, `hair_13_front.svg`, `hair_15_front.svg` e o nó novo `hair_12_back.svg` (importar o SVG, mesmo grupo e as mesmas timelines `hair_color_*` dos outros `hair_<n>_back`). Nenhum nome existente, camada, hierarquia ou input mudou; só o nó `hair_12_back` é novo.

Tabelas em valores LOCAIS do Rive: local = absoluto do artboard 512 menos o centro do bbox do path antigo (indicado no título de cada peça). Cada célula mostra antigo -> novo; "igual" quando não muda. O hair_4_front tem um segundo subpath (a elipse do coque) que não muda.

Validação: `packages/avatar/src/art.test.ts` ("franja de todos os cabelos 1..18...") cobre todas as frentes por estilo de olho e sobrancelha, a ausência de bochecha coberta e de faixa de fundo no 12 e o recorte do brilho; sem exceções anotadas.

#### hair_4_front (6 vértices do corpo; o coque, subpath da elipse, não muda; centro do path antigo = 256,159; local = absoluto - centro)

| Vértice | posição local antiga -> nova | in local antigo -> novo | out local antigo -> novo |
| ------- | ---------------------------- | ----------------------- | ------------------------ |
| 0       | -106,67 -> -106,17           | - (igual)               | -116,-9 -> -114,-29      |
| 1       | 0,-67 (igual)                | -76,-67 -> -68,-67      | 76,-67 -> 68,-67         |
| 2       | 106,67 -> 106,17             | 116,-9 -> 114,-29       | 106,67 -> 106,17         |
| 3       | 82,67 -> 82,17               | 82,67 -> 82,17          | 80,11 -> 78,-19          |
| 4       | 0,-41 (igual)                | 54,-37 -> 50,-37        | -54,-37 -> -50,-37       |
| 5       | -82,67 -> -82,17             | -80,11 -> -78,-19       | - (igual)                |

Vértices alterados: 6 de 6. Segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle); handle igual ao vértice = segmento reto. O Rive mantém hoje a geometria antiga. Para o nó não se deslocar, mantenha a origem do nó onde está e digite os valores locais (absoluto = local + centro do path antigo, indicado acima).

#### hair_6_front (9 vértices; centro do path antigo = 257.65,213; local = absoluto - centro)

| Vértice         | posição local antiga -> nova | in local antigo -> novo    | out local antigo -> novo  |
| --------------- | ---------------------------- | -------------------------- | ------------------------- |
| 0               | 104.35,23 -> 124.35,23       | 118.35,57 -> 134.35,57     | 132.35,-63 -> 146.35,-63  |
| 1 (sem mudança) | -1.65,-129 (igual)           | 88.35,-129 (igual)         | -89.65,-129 (igual)       |
| 2               | -117.65,23 -> -125.65,23     | -133.65,-67 -> -139.65,-67 | -115.65,71 -> -123.65,71  |
| 3               | -119.65,129 -> -125.65,129   | -131.65,97 -> -137.65,97   | -99.65,115 -> -113.65,115 |
| 4               | -91.65,39 -> -115.65,39      | -95.65,79 -> -115.65,79    | -87.65,-7 -> -115.65,-5   |
| 5               | -21.65,-65 (igual)           | -61.65,-45 -> -97.65,-49   | 4.35,-63 (igual)          |
| 6               | 60.35,-79 (igual)            | 34.35,-63 (igual)          | 82.35,-53 -> 92.35,-47    |
| 7               | 92.35,37 -> 108.35,37        | 88.35,-13 -> 108.35,-7     | 96.35,79 -> 110.35,79     |
| 8               | 118.35,129 -> 134.35,129     | 94.35,107 -> 114.35,107    | 132.35,93 -> 146.35,93    |

Vértices alterados: 8 de 9. Segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle); handle igual ao vértice = segmento reto. O Rive mantém hoje a geometria antiga. Para o nó não se deslocar, mantenha a origem do nó onde está e digite os valores locais (absoluto = local + centro do path antigo, indicado acima).

#### hair_11_front (6 vértices; centro do path antigo = 259.99,170.56; local = absoluto - centro)

| Vértice         | posição local antiga -> nova   | in local antigo -> novo        | out local antigo -> novo         |
| --------------- | ------------------------------ | ------------------------------ | -------------------------------- |
| 0               | -117.99,87.44 -> -127.99,87.44 | -113.99,65.44 -> -117.99,65.44 | -129.99,-20.56 -> -139.99,-20.56 |
| 1 (sem mudança) | -19.99,-86.56 (igual)          | -101.99,-72.56 (igual)         | 60.01,-94.56 (igual)             |
| 2               | 120.01,87.44 -> 126.01,87.44   | 128.01,-48.56 -> 132.01,-48.56 | 116.01,59.44 -> 124.01,59.44     |
| 3               | 98.01,17.44 -> 112.01,1.44     | 110.01,37.44 -> 120.01,29.44   | 66.01,5.44 -> 76.01,-0.56        |
| 4               | 10.01,-52.56 (igual)           | 36.01,-18.56 -> 36.01,-20.56   | -1.99,-20.56 (igual)             |
| 5               | -93.99,29.44 -> -109.99,5.44   | -45.99,7.44 -> -45.99,-2.56    | -107.99,45.44 -> -113.99,35.44   |

Vértices alterados: 5 de 6. Segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle); handle igual ao vértice = segmento reto. O Rive mantém hoje a geometria antiga. Para o nó não se deslocar, mantenha a origem do nó onde está e digite os valores locais (absoluto = local + centro do path antigo, indicado acima).

#### hair_12_front (10 vértices; centro do path antigo = 266.17,290.97; local = absoluto - centro)

| Vértice         | posição local antiga -> nova     | in local antigo -> novo            | out local antigo -> novo         |
| --------------- | -------------------------------- | ---------------------------------- | -------------------------------- |
| 0 (sem mudança) | -136.17,-54.97 (igual)           | -140.17,-20.97 (igual)             | -144.17,-150.97 (igual)          |
| 1 (sem mudança) | -16.17,-208.97 (igual)           | -100.17,-206.97 (igual)            | 69.83,-210.97 (igual)            |
| 2 (sem mudança) | 123.83,-54.97 (igual)            | 123.83,-160.97 (igual)             | 125.83,9.03 (igual)              |
| 3 (sem mudança) | 119.83,105.03 (igual)            | 109.83,59.03 (igual)               | 133.83,145.03 (igual)            |
| 4 (sem mudança) | 135.83,209.03 (igual)            | 147.83,179.03 (igual)              | 115.83,179.03 (igual)            |
| 5               | 83.83,89.03 (igual)              | 87.83,149.03 (igual)               | 53.83,45.03 -> 85.83,49.03       |
| 6               | 95.83,-50.97 -> 99.83,-40.97     | 73.83,-20.97 -> 99.83,-0.97        | 107.83,-100.97 -> 99.83,-100.97  |
| 7               | -4.17,-162.97 (igual)            | 55.83,-160.97 -> 63.83,-158.97     | -66.17,-160.97 -> -84.17,-158.97 |
| 8               | -116.17,-50.97 -> -122.17,-28.97 | -128.17,-100.97 -> -126.17,-100.97 | -94.17,-22.97 -> -122.17,-0.97   |
| 9               | -120.17,49.03 (igual)            | -70.17,17.03 -> -122.17,19.03      | -148.17,9.03 (igual)             |

Vértices alterados: 5 de 10. Segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle); handle igual ao vértice = segmento reto. O Rive mantém hoje a geometria antiga. Para o nó não se deslocar, mantenha a origem do nó onde está e digite os valores locais (absoluto = local + centro do path antigo, indicado acima).

#### hair_13_front (9 vértices; centro do path antigo = 258.87,201; local = absoluto - centro)

| Vértice         | posição local antiga -> nova | in local antigo -> novo    | out local antigo -> novo |
| --------------- | ---------------------------- | -------------------------- | ------------------------ |
| 0               | 101.13,31 -> 123.13,31       | 111.13,57 -> 133.13,57     | 121.13,-51 -> 143.13,-51 |
| 1 (sem mudança) | -2.87,-107 (igual)           | 79.13,-105 (igual)         | -82.87,-107 (igual)      |
| 2               | -110.87,31 -> -130.87,31     | -124.87,-51 -> -134.87,-51 | -108.87,61 -> -128.87,61 |
| 3               | -108.87,107 -> -124.87,107   | -118.87,83 -> -136.87,83   | -92.87,91 -> -116.87,91  |
| 4               | -88.87,43 -> -118.87,49      | -90.87,61 -> -118.87,61    | -84.87,3 -> -118.87,7    |
| 5               | -32.87,-41 (igual)           | -58.87,-25 -> -94.87,-31   | -12.87,-17 (igual)       |
| 6               | 61.13,-55 (igual)            | 31.13,-31 (igual)          | 81.13,-29 -> 87.13,-29   |
| 7               | 87.13,45 -> 109.13,49        | 87.13,9 -> 109.13,9        | 89.13,65 -> 109.13,65    |
| 8               | 105.13,105 -> 125.13,105     | 93.13,85 -> 113.13,85      | 121.13,85 -> 137.13,85   |

Vértices alterados: 8 de 9. Segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle); handle igual ao vértice = segmento reto. O Rive mantém hoje a geometria antiga. Para o nó não se deslocar, mantenha a origem do nó onde está e digite os valores locais (absoluto = local + centro do path antigo, indicado acima).

#### hair_15_front (8 vértices; centro do path antigo = 266.73,185.37; local = absoluto - centro)

| Vértice         | posição local antiga -> nova   | in local antigo -> novo        | out local antigo -> novo         |
| --------------- | ------------------------------ | ------------------------------ | -------------------------------- |
| 0               | -120.73,90.63 -> -132.73,90.63 | -110.73,70.63 -> -128.73,64.63 | -136.73,-15.37 -> -148.73,-15.37 |
| 1 (sem mudança) | -36.73,-99.37 (igual)          | -110.73,-81.37 (igual)         | 33.27,-113.37 (igual)            |
| 2               | 109.27,10.63 -> 119.27,10.63   | 107.27,-83.37 -> 125.27,-83.37 | 109.27,44.63 -> 119.27,44.63     |
| 3               | 125.27,102.63 -> 129.27,102.63 | 115.27,68.63 -> 123.27,68.63   | 103.27,90.63 -> 109.27,90.63     |
| 4               | 87.27,60.63 -> 105.27,60.63    | 93.27,76.63 -> 105.27,76.63    | 85.27,26.63 -> 105.27,26.63      |
| 5               | 55.27,-9.37 -> 105.27,-13.37   | 77.27,4.63 -> 99.27,4.63       | 33.27,-1.37 -> 63.27,-9.37       |
| 6               | -20.73,-51.37 (igual)          | -0.73,-25.37 -> 13.27,-25.37   | -40.73,-9.37 -> -40.73,-15.37    |
| 7               | -98.73,36.63 -> -120.73,-11.37 | -76.73,14.63 -> -80.73,-13.37  | -106.73,52.63 -> -120.73,14.63   |

Vértices alterados: 7 de 8. Segmentos Q já elevados a cúbicos (handle = ponto + 2/3 do controle); handle igual ao vértice = segmento reto. O Rive mantém hoje a geometria antiga. Para o nó não se deslocar, mantenha a origem do nó onde está e digite os valores locais (absoluto = local + centro do path antigo, indicado acima).

#### hair_12_back (nó NOVO, 7 pontos distintos; `countVertices` conta 8, porque o último `C` repete o ponto inicial; camada 2, sem hideWithHat, sob o chapéu como as demais)

Importar `assets/rive/source/hair_12_back.svg` (artboard 512, mesma cor `hair_color` e as mesmas 8 timelines `hair_color_*` dos outros `hair_<n>_back`; visibilidade pelo mesmo mecanismo `hair = 12`). Valores absolutos do artboard 512 (local = absoluto - centro do bbox 257.97,266):

| Vértice | posição absoluta | in      | out     |
| ------- | ---------------- | ------- | ------- |
| 0       | 256,92           | 174,92  | 338,92  |
| 1       | 388,232          | 390,124 | 388,232 |
| 2       | 392,396          | 392,396 | 392,396 |
| 3       | 376,440          | 376,440 | 376,440 |
| 4       | 256,440          | 256,440 | 256,440 |
| 5       | 146,340          | 146,340 | 146,340 |
| 6       | 124,232          | 124,232 | 122,124 |

**O que o Rive tem agora (04/11/2026):** `assets/rive/avatar.riv` com 60.833 bytes (`avatar (23).riv`; o `(22)` tinha 60.502), 15 Numbers e 16 triggers. Em relação ao `(22)`: as frentes `hair_4_front`, `hair_6_front`, `hair_11_front`, `hair_12_front`, `hair_13_front` e `hair_15_front` tiveram os vértices reeditados (só `d`; nome, camada, hierarquia e inputs iguais). O nó `hair_12_back` é novo: grupo "hb_14 2", último filho do Solo de trás `cabelo4a 2`, depois de `hair_short 2`; vértices reeditados, 8 chaves de cor nas timelines `hair_color_0` a `hair_color_7`, e `Solo.Active` da timeline `hair_12` apontando para o novo filho. Nenhum input novo, nenhuma migração; `PROTOCOL_VERSION` continua 5. O fallback (`art.ts`) tem a mesma geometria, com a peça de trás do 12. Orçamento: 183 paths e 1256 vértices (teto 1300).

Validação: comparação pixel a pixel no runtime web (`@rive-app/canvas` 2.21.6) de 85 combinações, `(23)` contra `(22)`: só os cabelos 4, 6, 11, 12, 13 e 15 mudaram (de 500 a 1650 px; o ruído do piscar é de até ~330 px). Render dos seis cabelos em vários rostos e dos cabelos 4, 6, 11, 12, 13 e 15 com os chapéus 1, 4, 6, 8, 9 e 10: olhos e sobrancelhas livres; a traseira do 12 aparece sob o chapéu. O teste de franja de `art.test.ts` cobre os cabelos 1 a 18 sem exceções; as tolerâncias estão explicadas no código.

Divergência anotada pelo agente do Rive: nas peças 6 e 11, os valores das tabelas foram digitados sem somar a diferença de origem do Rive (cerca de 0,65 px em X no 6 e 1 px em X no 11). É sub-pixel, e a comparação visual não achou diferença.

Não validado: inputs do state machine no preview do editor (a validação foi por timeline, canvas e runtime web); aparelho iOS/Android. A silhueta da mecha traseira do 12 (diagonal à esquerda, da mandíbula ao pescoço) é escolha da rai-avatar; o usuário pode pedir outra.

## 4. Teste de aceitação

1. Abrir o `.riv` no Rive e, no painel de inputs, varrer cada Number de 0 a n-1 com os outros em 0: cada variante muda só a sua parte.
2. Disparar cada um dos 16 triggers: anima em até 1,2 s e retorna ao ocioso sem intervenção.
3. Combinações aleatórias de partes não geram buracos, recortes errados nem partes escapando do círculo.
4. A 64 px, os 16 sinais são distinguíveis e as 8 partes têm variantes visualmente distintas.
5. Arquivo exportado abaixo de 500 KB; 4 instâncias simultâneas fluidas.

## 5. Integração (para quem integra)

O componente `<Avatar>` de `packages/avatar` mantém a mesma API (`parts`, `signal`, `onSignalEnd`, `size`, `reduceMotion`) quando o renderizador Rive entrar: define cada input Number a partir de `parts`, dispara `trig_<id>` do sinal e chama `onSignalEnd` após a duração do catálogo. Com `reduceMotion`, não dispara a animação: mostra só o destaque estático. Falha ao carregar o `.riv` -> renderiza o avatar vetorial, sem quebrar a mesa. Constantes do contrato: `RIVE_CONTRACT` em `packages/avatar/src/riveContract.ts`. Sinais e durações: `docs/sinais.md`.
