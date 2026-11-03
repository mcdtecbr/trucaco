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
| Piscar do idle | Variável (3 estados em 1,5x, 1x e 0,65x com Randomize Exit); a prévia do editor alternou os estados.                                                                                                                                                   |
| Splash         | **Ainda pendente:** no plano gratuito do Rive o runtime mostra uma splash do Rive por vários segundos (ver "Licença do Rive").                                                                                                       |

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

### Ossos: teste feito, migração adiada (03/11/2026)

Teste no editor: um osso (ferramenta Bone, em Design) com uma peça pendurada por "Set Parent" (Alt+P) leva a peça junto quando gira; o teste foi desfeito. **Decisão: seguir sem ossos e fazer a migração depois** (pendência). O que a migração exige:

1. Pendurar no osso, em ordem frente→trás (Set Parent anexa no fim): cabelo da frente, acessório, `tongue`, `mouth_inside`, `nose`, boca, sobrancelhas, olhos, rosto, orelhas. `outfit`, `neck`, `neck_shadow`, cabelo de trás e `BG` ficam fora.
2. O osso deve ficar dentro de `avatar_partes` (para o `idle_breathe`) e no topo da ordem.
3. Pendurar muda a posição das peças para relativa ao osso: refazer `idle_look`, `idle_blink`, `sig_eyebrow`, `sig_look_away`, `sig_lip_bite`, `sig_smile`, `sig_cheek_puff`, `sig_mouth_l/_r`, `sig_wink*` conforme necessário.
4. Depois, refazer aceno, balançar, queixo e ombros como rotação do osso em torno do pescoço.

### Exportação e validação (03/11/2026)

`assets/rive/avatar.riv` exportado do editor (menu > Export > For Runtime), 26,7 KB, zero bitmaps. Antes da exportação: `Timeline 1` apagada e `tongue`/`mouth_inside` com opacidade 0 em repouso (a opacidade só estava marcada nas notas; no arquivo continuava 100%, o que mostrava a língua em repouso).

Validação no runtime web (`@rive-app/canvas` 2.21.6, Chrome desktop, página local): carrega artboard `Avatar` e state machine `Main`; 15 triggers (`trig_*`) e 8 Numbers lidos; os 15 triggers disparam sem erro; trocar os 8 Numbers muda o visual; **60 FPS com 1 e com 4 instâncias** (256×256). **Não validado:** runtime nativo (`rive-react-native`), dispositivo móvel, legibilidade a 64 px no `.riv`, licença comercial. O arquivo exportado tem os artboards extras `Watermark`, `NuRiveBrandmark01` e `NuRiveWordmark01` (plano gratuito do editor): conferir o termo de uso antes de publicar. O `.rev` não existe: o fonte do Rive fica na nuvem do editor (`editor.rive.app/file/untitled/2701970`, arquivo `avatar`).

### Licença do Rive: pendência (03/11/2026)

Conferido nas páginas oficiais (preços e exportação para runtime): o plano Free exporta `.riv`, mas o arquivo toca uma **tela de splash do Rive** ("Exports for runtime, with a Rive splash screen"); os artboards `Watermark` e `NuRive*` do nosso `.riv` provavelmente são essa splash (inferência, não está escrito). O plano **Cadet** (US$ 17/assento/mês ou US$ 108/assento/ano, até 3 assentos) exporta "without the splash screen". Os runtimes são código aberto, sem royalties (licença MIT segundo busca, não confirmada nas páginas). **Não consta** nas páginas se o plano gratuito permite uso comercial do `.riv` nem se arquivos exportados continuam valendo após o fim da assinatura.

Ações antes de publicar: (1) ler os Termos de Serviço em rive.app (frase sobre uso comercial); (2) assinar o Cadet e reexportar o `.riv`, confirmando que `Watermark`/`NuRive*` saíram; (3) revalidar no runtime web. Fontes: https://rive.app/docs/account-admin/pricing.md, https://rive.app/docs/editor/exporting/exporting-for-runtime.md, https://rive.app/blog/new-pricing.

### Integração web no componente `Avatar` (03/11/2026)

`Avatar.web.tsx` testado contra o `assets/rive/avatar.riv` real, empacotado com esbuild numa página local (React 19 + `@rive-app/react-canvas`, wasm local): carrega o `.riv`; aplica as 8 dimensões (troca de rosto, pele, cabelo, olhos, boca, roupa, acessório e fundo confirmada visualmente); valores inválidos (`hair: 99`, `skin: 'x'`) caem no avatar padrão; `fireSignal('wink_l')` altera o canvas por ~1 s e volta; quatro instâncias na mesma página (uma de 256 px e três de 64 px); a 64 px o rosto, o cabelo, o boné e a cor de pele são distinguíveis. **Splash do Rive:** no plano gratuito o runtime mostra uma tela preta com o logo do Rive por vários segundos antes do avatar (ver pendência de licença). Typecheck estrito de `Avatar.web.tsx` com os pacotes reais passa; o `pnpm typecheck` do `packages/ui` falha no repositório só porque `@rive-app/react-canvas`, `typescript` e os tipos não estão instalados no pacote (peerDependencies `*`). **Não testado:** `Avatar.native.tsx` (precisa de `rive-react-native` em dispositivo).

Próximos passos de estrutura: cada opção de um Solo precisa ser **um único filho** (agrupar as partes de uma opção, ex.: `eye_white_N` + `eye_pupil_N` + espelhos); opções sem peça (ex.: cabelo posterior inexistente) precisam de um nó vazio.

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
