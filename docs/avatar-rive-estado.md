# Estado do rig Rive e diário de montagem (`assets/rive/avatar.riv`)

Registro da montagem do `avatar.riv` no editor Rive (03/11/2026, editor web 0.9.517) e do que ainda falta. A especificação do rig continua em `docs/avatar-rig.md`; este arquivo diz o que o `.riv` exportado realmente tem e **onde ele difere do contrato atual**.

## Alinhamento do `.riv` com o contrato (resolvido)

O catálogo de variantes, o contrato de sinais e o fallback vetorial agora descrevem e desenham o mesmo que o `.riv` (ver `docs/adr/0003-catalogo-do-avatar-segue-o-riv.md`):

| Tema           | Situação                                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accessory`    | 3 variantes (0 nenhum, 1 bigode, 2 brinco). Óculos removidos por decisão do usuário. Contrato reduzido de 5 para 3 (exceção à regra "só cresce"); migração `20261103150000_avatar_accessory_3` leva `accessory` 3/4 gravados para 0. |
| Piscar         | `wink` (olho esquerdo) usa `trig_wink_l`; `wink_r` usa `trig_wink_r`.                                                                                                                                                                |
| Sinais novos   | 15 sinais, com `mouth_l` e `mouth_r`.                                                                                                                                                                                                |
| Variantes      | `PART_VARIANT_NAMES`, `SKIN_COLORS`, `BG_COLORS` etc. seguem o `.riv`; o fallback renderiza os mesmos paths (`packages/avatar/src/art.ts`) com `react-native-svg`.                                                                   |
| Piscar do idle | Variável (3 estados em 1,5x, 1x e 0,65x com Randomize Exit); a prévia do editor alternou os estados.                                                                                                                                 |
| Splash         | **Resolvido (03/11/2026):** Cadet assinado; o `.riv` reexportado só tem o artboard `Avatar` (ver "Licença do Rive").                                                                                                                 |

Convenção de lado: `_l` e `_r` são o lado da tela de quem vê o avatar; só `wink` guarda o significado do zap.

## Import dos SVGs no editor Rive web (testado em 03/11/2026, editor 0.9.517)

- O botão de import abre um seletor nativo, inacessível a automação. Funciona **soltar o arquivo no palco**: um evento `drop` com `File` SVG sobre o canvas entra em Assets como `<nome>` (512×512).
- Arrastar o asset de Assets para o artboard cria um **grupo vetorial** (não bitmap) com o preenchimento original editável (`FCE4D6`, `2B1B12` conferidos).
- O grupo nasce com a origem no ponto onde foi solto. Soltar no canto superior esquerdo do artboard dá posição ≈ (1, 2): as formas assentam nas coordenadas do SVG. Para exatidão, zerar X e Y do grupo.
- Campos numéricos do inspetor: duplo clique, `Ctrl+A`, digitar e `Enter` em chamadas separadas. Digitar com `Tab`/`Enter` no mesmo texto não aplica. Renomear na hierarquia aplica com atraso.

## Import em bloco (03/11/2026)

`pnpm --filter @trucaco/avatar art:composite` gera `assets/rive/source/_composto.svg` com as 68 partes em ordem de sobreposição. Soltar esse único arquivo no palco (drop simulado) e arrastar o asset para o canto do artboard cria o grupo `avatar_partes` com **68 filhos que mantêm os nomes do rig**. Observações: a lista da Hierarchy mostra o mais da frente no topo; o servidor local para `fetch` não funcionou a partir da página do Rive (bloqueio de rede), então o conteúdo foi colado no script.

Solo: clique direito no objeto → Wrap in → Solo (cria o nó, com o campo "Active" no inspetor); arrastar outros objetos da Hierarchy para cima do Solo os torna filhos (a posição local é compensada). Multi-seleção por Ctrl/Shift+clique **não funcionou** via automação.

**Cuidado:** na Hierarchy, renomear com duplo clique/F2 + digitar **não é confiável** e é perigoso: se o campo não entrar em edição, as letras viram atalhos do editor e, com `Ctrl+A`, deslocaram o grupo inteiro (desfeito com `Ctrl+Z`). Nomes de Solo não são usados pelo código, então foram deixados como "Solo"; renomear à mão.

### Dimensão `face_shape` concluída (03/11/2026)

Solo com os 4 `face_*`; timelines `face_0..3` (chave em `Active` do Solo); layer própria com Entry → `face_0` e Any State → cada estado por `face_shape = n`. Na prévia, `face_shape` 1 deu queixo quadrado e 3 deu rosto redondo. Esse é o molde para as outras dimensões (uma layer por dimensão, uma timeline e um estado por opção, transições por Any State). Receita completa de cliques na memória do agente.

### Dimensão `bg_color` concluída (03/11/2026)

8 timelines `bg_0..7` com keyframe de cor no `BG` (cores do catálogo), layer própria e transições por Any State. Na prévia, `bg_color` 5 deu roxo e 7 deu turquesa. Faltam `skin`, `hair`, `eyes`, `mouth`, `outfit`, `accessory`.

### Dimensão `mouth` concluída (03/11/2026)

Solo com 4 Groups (lábios sup+inf), timelines `mouth_0..3`, layer própria e transições por Any State (`mouth = n`). Na prévia, 0..3 deram 4 bocas diferentes. Faltam `skin`, `hair`, `eyes`, `outfit`, `accessory`.

### Dimensão `eyes` montada (03/11/2026)

Solo com 4 Groups (olhos + espelhos), timelines `eyes_0..3`, layer própria e transições por Any State (`eyes = n`); troca de estado confirmada no preview (o visual será conferido após remover os óculos). **Decisão:** as opções de óculos serão removidas de `accessory` (sinais de truco dependem do piscar de olho).

### Dimensão `hair` concluída (03/11/2026)

Dois Solos (frente com 8 opções, trás com long_back, afro_back e um grupo vazio), timelines `hair_0..7` com 2 chaves cada, layer própria e transições por Any State (`hair = n`). Na prévia os 8 penteados saíram corretos. Peças de óculos já removidas do arquivo Rive.

### Dimensão `outfit` concluída (03/11/2026)

Solo com 6 opções (camiseta, V, polo, camisa, colete, regata; as de várias peças viram Groups), timelines `outfit_0..5`, layer própria e transições por Any State (`outfit = n`). Prévia 0..5 correta. Os olhos (`eyes`) foram corrigidos (pupilas na frente). Faltam `skin` e `accessory` (earring, mustache e opção vazia).

### Dimensão `accessory` concluída e óculos removidos (03/11/2026)

Por decisão do usuário (sinais de truco usam piscar de olho; óculos o escondem), `acc_glasses`, `acc_sun_lenses` e `acc_sun_glint` saíram da arte e do Rive; `accessory` passou de 5 para 3 opções (0 nenhum = grupo vazio, 1 bigode, 2 brinco), 65 paths, 322 vértices, 442.368 combinações. Solo + timelines `accessory_0..2` + layer + Any State (`accessory = n`); prévia 0..2 correta. **`test_matrix`:** os PNGs `01` e `05` antigos foram removidos e os casos 01, 02, 05, 06, 09 e 10 do `build-matrix.ts` foram ajustados; falta regenerar (`art:matrix`, exige `@resvg/resvg-js` instalado).

### Dimensão `skin` concluída (03/11/2026)

Seis timelines `skin_0..5` que gravam a cor das formas de pele de uma vez (selecionando `avatar_partes` e editando os 3 hex de pele em Selected Colors: base, sombra e sombra a 55%), layer própria e transições por Any State (`skin = n`). Prévia 0..5 correta. **As 8 dimensões de personalização estão prontas.** (Histórico desta data: idle, sinais, limpeza e exportação vieram nas seções seguintes; ossos ficaram adiados.)

### Idle, olhar e piscar (03/11/2026)

Sem ossos: as animações mexem em nós existentes (limitação do pivô). `idle_breathe` (2,4 s, `avatar_partes` Y), `idle_look` (4 s, Solo dos olhos X), `idle_blink` (4,5 s, Solo dos olhos escala Y compensada em Y). Layers `Base_Idle`, `Idle_Look` e `Blink_Random`, cada uma com Entry → estado em loop. **Piscar aleatório (03/11/2026, depois):** a layer `Blink_Random` ganhou 3 estados com a mesma timeline `idle_blink` em velocidades 1,5x, 1x e 0,65x, conectados dois a dois com Exit Time 4400 ms e **Randomize Exit** em cada um (opção do estado, no inspetor). Não é preciso código nem trigger. Não funcionou: Random não existe na transição (só no estado) e não há `Duplicate` de estado (criar por Add State). (A layer `Signal_Triggers` e as animações de sinal vieram na seção seguinte.)

### Sinais e layer `Signal_Triggers` (03/11/2026)

Doze timelines `sig_*` de 1 s na primeira versão (depois 15, ver "Piscadinha de um olho só e torção de boca") (sobrancelha, piscadinha, mordida de lábio, bochecha, língua, nariz, encolher de ombros, aceno, balançar a cabeça, queixo para cima, olhar para o lado, sorriso), todas aproximadas por transformações de nós existentes (sem ossos; na primeira versão a piscadinha fechava os dois olhos, corrigido depois). `tongue` e `mouth_inside` ficam ocultos (opacidade 0) em repouso e só aparecem no sinal de língua. A layer `Signal_Triggers` tem um estado vazio, 12 estados na primeira versão (15 depois) e, para cada sinal, Idle → sinal pelo trigger `trig_<id>` e volta ao Idle com Exit Time de 1000 ms. Prévia: `trig_eyebrow` e `trig_shrug` dispararam e voltaram. Os 15 sinais foram testados no preview e o `.riv` foi exportado e validado no runtime web (ver seções seguintes).

### Piscadinha de um olho só e torção de boca (03/11/2026)

Pedido do usuário: piscar um olho ou o outro, e torcer a boca para um lado ou para o outro. O `trig_wink` (que fechava os dois olhos) foi apagado; entram `trig_wink_l`/`trig_wink_r` (lado esquerdo/direito **da tela**) e `trig_mouth_l`/`trig_mouth_r`, totalizando 15 triggers.

- **Piscadinha:** `sig_wink` (esquerdo, nome mantido porque o editor não renomeia animações) e `sig_wink_r` (direito) animam a escala Y dos nós `eye_pupil_N` e `eye_white_N` (origem do nó = centro do olho, sem compensar posição): esquerdo 99→10→99 e direito −99→−10→−99 (os `_r` são espelhados, escala Y −100% e rotação −180°), chaves em 0, 12 e 36 quadros, interpolação Hold. Nas opções de olho 2 e 3 os `_r` estão aninhados dentro dos esquerdos (`eye_pupil_2_r` em `eye_pupil_2`, `eye_white_3_r` em `eye_white_3`): em `sig_wink` esses filhos recebem contraescala (−101,01 → −1000 → −101,01) para não fechar junto; o Hold evita o inchaço no meio da interpolação. Testado no preview nas 4 opções de olho.
- **Torção de boca:** `sig_mouth_l` (+10°) e `sig_mouth_r` (−10°) giram o Solo da boca (pivô na altura do nariz, então a boca também desloca ~11 px para o lado) e reduzem a escala X a 90%, chaves em 0, 30 e 60 quadros. Funciona com qualquer opção de boca, mas é rotação do conjunto, não deformação dos vértices.
- Estados `sig_wink`, `sig_wink_r`, `sig_mouth_l`, `sig_mouth_r` na layer `Signal_Triggers`, cada um com Idle → estado pelo trigger e volta com Exit Time de 1000 ms.

### Ossos: cabeça rígida feita (03/11/2026, depois)

Decisão do usuário: **cabeça rígida**, sem Weight (a torção de boca continua sendo a rotação do Solo, não deformação de vértices). Feito no editor e exportado (`avatar.riv` de 16,8 KB, validado no runtime web: 15 triggers, 8 Numbers, 60 FPS, só o artboard `Avatar`):

- `Root Bone 2` no nível do artboard (o Rive não deixa pôr osso dentro de grupo), com um **Translation Constraint** (Offset ligado, World/World) cujo alvo é `avatar_partes`: o osso soma o movimento do corpo (respiração, aceno etc.) ao seu próprio. O `Root Bone 2` fica em (0, 0) e a posição dele vira deslocamento aditivo; `Bone 1` é filho dele, com rotação 0.
- Penduradas no `Bone 1` por Set Parent (botão direito na linha da Hierarchy): nose, brow_r, brow_l, cabelo da frente, acessório, tongue, mouth_inside, Solo da boca, Solo dos olhos, Solo do rosto e ears. Ficam em `avatar_partes`: neck_shadow, outfit, neck, cabelo de trás e BG. As posições locais das peças não mudaram, então as chaves antigas continuam valendo.
- **Pivô no pescoço:** o osso gira em torno da própria origem, então cada chave de rotação vem com chaves de posição calculadas: posição = (I − R(θ))·d, com d = (256, 397). Para ±6° dá cerca de (42,9; −24,58) e (−40,1; 28,93).
- `sig_head_shake`: rotação do osso 0 → +6° → −6° → +3° → 0 (quadros 0, 15, 30, 45, 60), além do movimento do corpo que já existia. `sig_nod`: chaves de Y do osso 0, 6, 0, 6, 0 (a cabeça desce mais que o corpo). `sig_chin_up`: Y do osso 0, −8, 0 (quadros 0, 30, 60). Os outros sinais não mudaram.
- **Não feito:** `sig_shrug` (ombros) e a torção de boca por vértices. Backup antes de mexer: arquivo `avatar-backup-pre-ossos` na mesma pasta do Rive.

### Ossos: teste inicial, antes da migração (03/11/2026)

Teste no editor: um osso (ferramenta Bone, em Design) com uma peça pendurada por "Set Parent" (Alt+P) leva a peça junto quando gira; o teste foi desfeito. **Decisão: seguir sem ossos e fazer a migração depois** (pendência). O que a migração exige:

1. Pendurar no osso, em ordem frente→trás (Set Parent anexa no fim): cabelo da frente, acessório, `tongue`, `mouth_inside`, `nose`, boca, sobrancelhas, olhos, rosto, orelhas. `outfit`, `neck`, `neck_shadow`, cabelo de trás e `BG` ficam fora.
2. O osso deve ficar dentro de `avatar_partes` (para o `idle_breathe`) e no topo da ordem.
3. Pendurar muda a posição das peças para relativa ao osso: refazer `idle_look`, `idle_blink`, `sig_eyebrow`, `sig_look_away`, `sig_lip_bite`, `sig_smile`, `sig_cheek_puff`, `sig_mouth_l/_r`, `sig_wink*` conforme necessário.
4. Depois, refazer aceno, balançar, queixo e ombros como rotação do osso em torno do pescoço.

### Exportação e validação (03/11/2026)

`assets/rive/avatar.riv` exportado do editor (menu > Export > For Runtime), 26,7 KB, zero bitmaps. Antes da exportação: `Timeline 1` apagada e `tongue`/`mouth_inside` com opacidade 0 em repouso (a opacidade só estava marcada nas notas; no arquivo continuava 100%, o que mostrava a língua em repouso).

Validação no runtime web (`@rive-app/canvas` 2.21.6, Chrome desktop, página local): carrega artboard `Avatar` e state machine `Main`; 15 triggers (`trig_*`) e 8 Numbers lidos; os 15 triggers disparam sem erro; trocar os 8 Numbers muda o visual; **60 FPS com 1 e com 4 instâncias** (256×256). **Não validado:** runtime nativo (`rive-react-native`), dispositivo móvel, legibilidade a 64 px no `.riv`, licença comercial. O arquivo exportado tem os artboards extras `Watermark`, `NuRiveBrandmark01` e `NuRiveWordmark01` (plano gratuito do editor): conferir o termo de uso antes de publicar. O `.rev` não existe: o fonte do Rive fica na nuvem do editor (`editor.rive.app/file/untitled/2701970`, arquivo `avatar`).

### Licença do Rive: Cadet assinado e `.riv` sem splash (03/11/2026)

**Atualização:** o usuário assinou o Cadet (workspace Trucaco, 1 assento pago, US$ 17 por mês, próxima cobrança em 03/12/2026). O `.riv` reexportado (16.506 bytes, antes 26.853) tem só o artboard `Avatar`: `Watermark` e `NuRive*` saíram; 15 triggers, 8 Numbers e 60 FPS no runtime web. **Atenção:** a assinatura é mensal; o que acontece com `.riv` já exportado se ela for cancelada continua sem confirmação nas páginas oficiais. Com o Cadet, "Revision history" do editor ficou liberado (84 revisões no dia). Os Termos de Serviço (uso comercial) continuam sem leitura.

Texto original da conferência (antes da assinatura):

Conferido nas páginas oficiais (preços e exportação para runtime): o plano Free exporta `.riv`, mas o arquivo toca uma **tela de splash do Rive** ("Exports for runtime, with a Rive splash screen"); os artboards `Watermark` e `NuRive*` do nosso `.riv` provavelmente são essa splash (inferência, não está escrito). O plano **Cadet** (US$ 17/assento/mês ou US$ 108/assento/ano, até 3 assentos) exporta "without the splash screen". Os runtimes são código aberto, sem royalties (licença MIT segundo busca, não confirmada nas páginas). **Não consta** nas páginas se o plano gratuito permite uso comercial do `.riv` nem se arquivos exportados continuam valendo após o fim da assinatura.

Ações antes de publicar: (1) ler os Termos de Serviço em rive.app (frase sobre uso comercial); (2) assinar o Cadet e reexportar o `.riv`, confirmando que `Watermark`/`NuRive*` saíram; (3) revalidar no runtime web. Fontes: https://rive.app/docs/account-admin/pricing.md, https://rive.app/docs/editor/exporting/exporting-for-runtime.md, https://rive.app/blog/new-pricing.

### Integração web no componente `Avatar` (03/11/2026)

`Avatar.web.tsx` testado contra o `assets/rive/avatar.riv` real, empacotado com esbuild numa página local (React 19 + `@rive-app/react-canvas`, wasm local): carrega o `.riv`; aplica as 8 dimensões (troca de rosto, pele, cabelo, olhos, boca, roupa, acessório e fundo confirmada visualmente); valores inválidos (`hair: 99`, `skin: 'x'`) caem no avatar padrão; `fireSignal('wink_l')` altera o canvas por ~1 s e volta; quatro instâncias na mesma página (uma de 256 px e três de 64 px); a 64 px o rosto, o cabelo, o boné e a cor de pele são distinguíveis. **Splash do Rive:** no plano gratuito o runtime mostra uma tela preta com o logo do Rive por vários segundos antes do avatar (ver pendência de licença). Typecheck estrito de `Avatar.web.tsx` com os pacotes reais passa; o `pnpm typecheck` do `packages/ui` falha no repositório só porque `@rive-app/react-canvas`, `typescript` e os tipos não estão instalados no pacote (peerDependencies `*`). **Não testado:** `Avatar.native.tsx` (precisa de `rive-react-native` em dispositivo).

Próximos passos de estrutura: cada opção de um Solo precisa ser **um único filho** (agrupar as partes de uma opção, ex.: `eye_white_N` + `eye_pupil_N` + espelhos); opções sem peça (ex.: cabelo posterior inexistente) precisam de um nó vazio.

## Fatia 1: cores (04/11/2026)

Ampliação do catálogo, fatia 1 de 5 (ADR 0004). `.riv` de 22,6 KB, só o artboard `Avatar`, state machine `Main`, **11 Numbers e 15 triggers**, 60 FPS no runtime web.

- Timelines novas: `skin_6` e `skin_7`, `hair_color_0..7`, `eye_color_0..2` e `outfit_color_0..10`.
- Três layers novas (`hair_color`, `eye_color`, `outfit_color`), cada uma com Entry para `_0` e Any State para `_n` por `input = n`.
- Para evitar colisão de hex, o botão do polo passou a `#F8FAFC` e a coroa do boné a `#1E2836` (também em `art.ts`).
- Validado no runtime web (`@rive-app/canvas` 2.21.6): 8 peles, 8 cabelos, 3 olhos e 11 roupas (polo, colete e regata) corretos, mais 4 combinações misturadas. Aparelho iOS/Android não testado.
- **Divergência com o fallback:** pescoço (base alargada), sombra do queixo (Multiply 75% com Feather) e nariz (Multiply 70% com Feather 5) foram ajustados só no Rive; `art.ts` e o fallback vetorial ainda não têm esses ajustes.

Receitas do editor aprendidas:

- Criar timeline pelo "+" de Animations, **esperando 1 s antes de digitar o nome**. Renomear depois não funciona: errou o nome, apague e crie de novo.
- Editar cor por hex em Selected Colors, com **duplo clique** no valor; no modo Animate vira keyframe sozinho.
- Transições: clique direito no estado e "Connect to...". A condição (`input = n`) se edita na seta da transição.
- **Cuidado com hex repetido entre peças:** Selected Colors agrupa por valor, então editar um hex muda todas as peças que o compartilham, inclusive as que não deveriam mudar (foi o caso do botão do polo e da coroa do boné). Dê um hex único à peça que não deve acompanhar a cor antes de editar.

## Fatia 2: bocas, línguas e sinal `mouth_open` (04/11/2026)

Ampliação do catálogo, fatia 2 de 5 (ADR 0005). `avatar.riv` de 25,8 KB, só o artboard `Avatar`, state machine `Main`, **11 Numbers e 16 triggers**.

- Solo da boca com 5 grupos (todos chamados "Group"; renomear no editor não funciona, identificar pela ordem). Timelines `mouth_0..mouth_4` refeitas; a layer `mouth` ganhou o estado `mouth_4` (`mouth = 4`).
- Grupo `boca2` com as 7 peças da boca aberta, filho do `Bone 1`, na frente, opacidade base 0 (`tongue` e `tongue_center` também com 0).
- Timelines `sig_mouth_open` e `sig_tongue` (novas/refeitas), 60 quadros, chaves em 0, 10, 50 e 60: Solo da boca 100→0→0→100, `boca2` 0→100→100→0, língua 0→100→100→0.
- Input `trig_mouth_open` e estado `sig_mouth_open` na layer `Signal_Triggers`: ida de 150 ms com interpolação Cubic e condição `trig_mouth_open`; volta por Exit Time de 1000 ms.
- Validado no runtime web (`@rive-app/canvas` 2.21.6): 16 triggers, 11 Numbers, `Main`, só `Avatar`, as 5 bocas certas e os dois sinais (capturados 350 ms após o gatilho) com boca 0, 1 e 4. `rivFile.test.ts` confere os 16 triggers e as animações `mouth_4`, `sig_mouth_open` e `sig_tongue` (o `.riv` exportado guarda nomes de animações e inputs, não de objetos). Aparelho iOS/Android não testado.
- **Pendências e divergências:** (1) a transição de ida de `sig_tongue` (150 ms, Cubic) não foi feita, porque o ponto ficava escondido atrás de outros no grafo; (2) no fallback o sinal `tongue` também gira a cabeça (5°) e balança a língua, e no Rive esses dois movimentos não foram feitos (só a troca de opacidades); (3) os ajustes de pescoço, sombra do queixo e nariz da fatia 1 seguem só no Rive.

Receitas do editor aprendidas:

- **Mover um nó de pai:** clicar no canvas vazio para limpar a seleção, selecionar a linha, `Alt+P`, esperar 1 s e clicar na linha do novo pai.
- **Agrupar:** `Ctrl+G`.
- **Ordem de desenho:** botão direito > Move (passar o mouse, sem clicar) > Bring to front.
- Multisseleção na Hierarchy é instável. "Draw Order +" do inspetor cria Draw Rule: evitar.
- O campo numérico só aceita `Ctrl+A` depois de aparecer a borda azul (senão vira atalho).
- Criar timeline pelo "+" esperando 1 s, com o foco fora do campo de busca.
- Chaves: clique na régua (10 quadros ≈ 98,6 px) e o losango do campo.
- "Connect to and from..." num estado Animation State cria ida e volta de uma vez.

## Cor de pele por Number: CONFIRMADA no editor (03/11/2026)

Teste no arquivo do Rive (editor 0.9.517, prévia da state machine): timelines `skin_0` (chave de cor FCE4D6 em `face_oval`) e `skin_1` (E0AC69), dois estados na layer, transições `skin = 1` e `skin = 0`, Entry ligado a `skin_0`. Na prévia, `skin` 0→1 trocou o rosto para E0AC69 e 1→0 voltou. **Sem data binding e sem duplicar paths**: o plano A vale e o orçamento de 68 paths se mantém. Falta testar no runtime (web/nativo) e escalar para 6 tons e as 11 formas.

Mecânica que funcionou: Animations "+" → Timeline (esperar 1 s e digitar o nome); no modo Animate, selecionar a forma e editar o hex em Selected Colors (vira keyframe sozinho); arrastar a timeline para o grafo; clique direito no estado → Connect to and from; clicar na seta da transição → "+" em Conditions → input, operador e valor (campo de valor: duplo clique, Ctrl+A, digitar, Enter). A transição criada por Connect to and from já vem com "= 0".

(Texto original da hipótese, mantido como histórico:)

Em vez de data binding de cor ou paths duplicados por tom, usar a layer `Customization_Setup` com um estado por valor de `skin`, cada um tocando uma animação de 1 frame que define `fill` das 11 formas de pele/sombra. Mantém 68 paths. A confirmar no editor: se a state machine permite escolher o estado por condição de Number (`skin == n`) e se o custo de 6 animações é aceitável.

## Estado do arquivo no Rive e dicas de operação (03/11/2026)

Arquivo "Untitled" (editor.rive.app/file/untitled/2701970): artboard `Avatar` 512×512, `face_oval` e `hair_short` importados, state machine padrão (ainda "State Machine 1") com os **20 inputs criados**: 8 Numbers (`face_shape`, `skin`, `hair`, `eyes`, `mouth`, `outfit`, `accessory`, `bg_color`, default 0) e 12 Triggers (`trig_*`).

- Painel de inputs: ícone da barra do painel da state machine; "+" abre Number/Boolean/Trigger/Folder. Ao criar, o nome entra em edição, mas é preciso **esperar ~1 s** antes de digitar, senão o texto não aplica.
- Renomear input existente: clicar, esperar, `F2`, digitar, `Enter`. Renomear a state machine **não funcionou** (duplo clique, F2, menu de contexto sem "Rename"); renomear manualmente para `Main` ou ajustar `AVATAR_STATE_MACHINE` em `packages/avatar/src/signals.ts`.
- A lista de inputs marca "Deprecated" na seção de inputs da state machine: o Rive está migrando para data binding de ViewModel. Os runtimes ainda leem inputs; conferir se o seu plano e versão mantêm isso.
- Vários recursos mostram "Upgrade" (Share, Tags): conferir se o plano permite exportar `.riv` e o uso comercial.

## Fatia 3: rosto, olhos, sobrancelhas e nariz (05/11/2026)

Ampliação do catálogo, fatia 3 de 5 (ADR 0006). `avatar.riv` de 38,5 KB (é o export `avatar (11).riv`), só o artboard `Avatar`, state machine `Main`, **13 Numbers e 16 triggers**. Orçamento de vértices do rig: 760 (122 paths, 725 vértices).

- Dimensões novas: `brows` (4) e `nose` (8), ao fim de `AVATAR_PART_KEYS`. `face_shape` e `eyes` passam a 6 opções.
- Estrutura no Rive: Solo `brows4` dentro do `Bone 1`, com 4 grupos `bset_0..3` (par l/r em cada); Solo `noses3` com 8 narizes; grupo `fatia3b` com os Solos `eyesL` e `eyesR` (6 filhos `eyeL_n`/`eyeR_n`); Solo `faces3` com 6 rostos.
- Timelines `face_0..5`, `eyes_0..5`, `brows_0..3` e `nose_0..7`; layers `eyes`, `brows` e `nose`. A layer dos rostos ficou com o nome "Layer 2" (renomear falhou).
- `idle_blink`, `idle_look` e `sig_look_away` chaveiam o grupo `fatia3b`; `sig_wink` e `sig_wink_r` chaveiam `eyesL` e `eyesR`; `sig_nose_twitch` foi refeita (balanço em X do `noses3`, 900 ms); `sig_eyebrow` sobe o Solo das sobrancelhas 14 px.
- Código e banco: `PROTOCOL_VERSION` 4. Migração `20261105120000_avatar_rosto` faz `DELETE FROM "avatars"` por decisão do usuário (sem compatibilidade); os avatares são recriados no criador.
- Validado no runtime web (`@rive-app/canvas` 2.21.6): 13 Numbers, 16 triggers, `Main`, só `Avatar`; 6 rostos, 6 estilos de olho, 4 sobrancelhas, 8 narizes, 3 cores de olho, 8 cores de sobrancelha (seguem `hair_color`) e 8 tons de pele nos rostos e narizes. `wink_l` e `wink_r` fecham o olho nos estilos 0, 1, 3, 4 e 5. `sig_eyebrow` foi validado só pelo número (14 px): o movimento é sutil e não ficou nítido nas capturas. Aparelho iOS/Android não testado.

Receitas do editor aprendidas:

- **Path importado aberto:** um caminho fechado cuja última curva termina no ponto inicial pode entrar ABERTO no Rive. O preenchimento fecha com uma reta e aparece uma diagonal no canto do rosto. Correção: selecionar o objeto, Edit Vertices, "Close Path". Feito em oval, round, triangle, long e heart; face_square já estava certo. Conferir qualquer path importado grande e arredondado.
- **Busca em Animations:** com o filtro de busca ativo, a timeline nova some e o nome digitado vira atalho. Limpar a busca antes de criar.
- **Campo de tempo da timeline:** não digitar nele. As teclas viram atalhos e alteram opacidade e vértices (desfeito com Ctrl+Z). Posicionar o playhead clicando na régua.
- **Chave com valor igual:** digitar o valor e clicar no diamante só cria chave se o valor mudar. Para chavear um valor igual ao atual, clicar no diamante com o valor já no ponto.
- **Edição em outro quadro:** o Rive cria uma chave em 0 com o valor original ao editar em outro quadro. Conferir antes de dar por certa a animação.
- **Validação no runtime:** capturar sinais com vários canvases na mesma página atrasa os timers e dá falso negativo. O "wink não fecha" inicial era artefato de captura. Validar com um canvas por vez.

Lacunas e pendências:

- Nariz sem o Multiply 70% e Feather 5 do desenho anterior (preenchimento sólido da sombra da pele).
- Ajustes de pescoço, sombra e nariz da fatia 1 seguem só no Rive, fora do `art.ts`.
- `sig_tongue` (fatia 2): transição de ida sem 150 ms e Cubic, e giro/balanço da língua só no fallback.
- `idle_blink` aleatório não validado por captura nos 6 estilos de olho.
- `sig_eyebrow` pouco nítido.
- Layer dos rostos chamada "Layer 2"; grupos e objetos do Rive com nomes genéricos ("Group").
- Nada testado em iOS/Android. O Rive não é o renderizador de produção (ADR 0002).
