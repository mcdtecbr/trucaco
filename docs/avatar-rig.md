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
- **`hair` (19)**, só o formato (a cor vem de `hair_color`), na ordem das pranchas (esquerda para a direita, cima para baixo, sem as repetições que só mudam de cor). Nós: `hair_<n>_back` (camada 2, atrás da cabeça, do pescoço e da roupa) e `hair_<n>_front` (camada 7). 0 careca (`hair_bald_shade`); 1 espetado (front); 2 longo ondulado (back, front); 3 cacheado (back, front); 4 coque alto (front, com o coque no mesmo path); 5 longo com franja (back, front); 6 ondulado médio (back, front); 7 topete lateral (front); 8 afro (back, front); 9 pixie (front); 10 repicado (front); 11 bob de lado (back, front); 12 longo de lado (front); 13 ondulado curto (back, front); 14 longo liso (back, front); 15 bob repicado (back, front); 16 coque (`hair_16_cap` e `hair_16_bun`); 17 bob com franja (back, front); 18 raspado (front, opacidade 0.5). Boné e chapéu saíram de `hair`.
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

A fonte vetorial de todas as variantes é `packages/avatar/src/art.ts` (175 paths e 1210 vértices, orçamento de 1300; 512×512); o fallback vetorial e o `.riv` desenham o mesmo conjunto (ADR 0003). Referência visual: `assets/rive/test_matrix/`.

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

## 4. Teste de aceitação

1. Abrir o `.riv` no Rive e, no painel de inputs, varrer cada Number de 0 a n-1 com os outros em 0: cada variante muda só a sua parte.
2. Disparar cada um dos 16 triggers: anima em até 1,2 s e retorna ao ocioso sem intervenção.
3. Combinações aleatórias de partes não geram buracos, recortes errados nem partes escapando do círculo.
4. A 64 px, os 16 sinais são distinguíveis e as 8 partes têm variantes visualmente distintas.
5. Arquivo exportado abaixo de 500 KB; 4 instâncias simultâneas fluidas.

## 5. Integração (para quem integra)

O componente `<Avatar>` de `packages/avatar` mantém a mesma API (`parts`, `signal`, `onSignalEnd`, `size`, `reduceMotion`) quando o renderizador Rive entrar: define cada input Number a partir de `parts`, dispara `trig_<id>` do sinal e chama `onSignalEnd` após a duração do catálogo. Com `reduceMotion`, não dispara a animação: mostra só o destaque estático. Falha ao carregar o `.riv` -> renderiza o avatar vetorial, sem quebrar a mesa. Constantes do contrato: `RIVE_CONTRACT` em `packages/avatar/src/riveContract.ts`. Sinais e durações: `docs/sinais.md`.
