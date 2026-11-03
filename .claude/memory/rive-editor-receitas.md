---
name: rive-editor-receitas
description: Como operar o editor web do Rive (editor.rive.app) por automação de navegador: receitas validadas, coordenadas, armadilhas e o que é perigoso
metadata:
  type: reference
---

Receitas do editor Rive (0.9.517, 03/11/2026) para quem for ajustar o `assets/rive/avatar.riv`. O estado do arquivo e as decisões estão em [[avatar-rive-estado]] e em `docs/avatar-rive-estado.md`. As coordenadas são do frame de screenshot 1288x936; conferir "coordinate frame" a cada captura.

O editor Rive é um canvas Flutter: a árvore de acessibilidade quase não expõe nada, tudo é por coordenadas. O frame de screenshot muda (ex.: 1120x1090, 1288x936); conferir "coordinate frame" a cada screenshot.

**Funciona**

- Importar SVG: seletor nativo de arquivo é inacessível; em vez disso, `javascript_tool` cria `new File([svg],'x.svg')`, monta um `DataTransfer` e despacha `dragenter/dragover/drop` (DragEvent, bubbles) num `elementFromPoint` do canvas. Entra em Assets; arrastar o asset (`left_click_drag`) para o canto sup. esq. do artboard cria grupo vetorial em ~(1,2) com nomes dos `id`. Um SVG composto com muitos `<path id>` vira um grupo com filhos nomeados.
- Colar SVG via clipboard (Ctrl+V) e `fetch` a localhost a partir da página NÃO funcionam; colar o conteúdo inline no script funciona.
- Inputs da state machine: painel de inputs (ícone na barra do painel da SM); "+" → Number/Boolean/Trigger. Depois de criar, **esperar ~1 s** antes de digitar o nome e `Enter`. Renomear input existente: clicar, esperar, `F2`, digitar.
- Campos numéricos do inspetor (Position etc.): duplo clique, `Ctrl+A`, `type`, `Enter`, cada um em chamada separada.
- Animations "+" → Timeline: espera 1 s, digita o nome, Enter; funciona. No modo Animate, editar o hex em Selected Colors cria keyframe de cor sozinho.
- Grafo da SM: arrastar timeline da lista para o grafo cria estado; clique direito no estado → "Connect to and from..." e clicar no alvo cria transições nos dois sentidos (condição vem "= 0"); "Done" no banner para terminar; clicar na seta da transição → "+" em Conditions (linha na borda inferior, ~y=920) → escolher input, editar valor. Estado inicial: clique direito em Entry → Connect to.
- Prévia: botão play no painel da SM; editar o valor do input na lista de inputs muda o estado ao vivo. Teste de pele 0→1→0 passou.
- Solo: clique direito → "Wrap in" (passar o mouse, não clicar) → Solo. Arrastar outros objetos da Hierarchy sobre a linha do Solo os reparenta. Solo tem campo "Active".
- `Ctrl+Z` desfaz bem; conferir screenshot a cada passo.

**Receita validada por dimensão (face_shape levou ~15 chamadas e passou no preview)**

1. Solo com N filhos (Wrap in → Solo + arrastar os outros para ele). 2. Para cada opção n: Animations "+" → Timeline, esperar 1 s, digitar `<dim>_n`, Enter; com o Solo selecionado, clicar no campo **Active** do inspetor, digitar o nome do filho (a lista filtra) e `Enter` (vira keyframe). 3. Nova Layer no painel de layers (ícone de layers na barra da SM, "+"). 4. Right-click no canvas do grafo → "Add State" (cria "Animation State"; no inspetor, Timeline: clicar, digitar nome, Enter, e o estado assume o nome) OU arrastar a timeline da lista para o grafo (só com o layout NÃO maximizado). 5. Entry: right-click → Connect to → clicar estado 0 → Done. 6. Any State: right-click → Connect to → clicar vários estados em sequência → Done (cria uma transição por clique). 7. Condição de cada transição: clicar no círculo da seta, "+" (1277,891), campo de input (47,920): digitar nome do input + Enter, e para valor != 0: duplo clique no campo de valor (250,920), Ctrl+A, digitar, Enter.

- Dimensão de cor (bg_color): selecionar o objeto (BG fica no fim da Hierarchy; rolar 30 ticks), criar timeline, na 1ª clicar no losango ao lado de Selected Colors (~(1193,496) para grupo com path) e nas demais clicar no hex (~(1125,496)), digitar o hex, Enter (vira keyframe). Nome da nova layer entra em edição ao criar: digitar e Enter funciona.
- Em lote, usar `wait` de 1 s entre cada passo; com isso os alvos múltiplos do Any State pegaram os 8 estados. Posições dos estados no grafo maximizado: círculo de cada transição fica no meio da linha Any State→estado.
- Cuidados: estados novos caem em cima de Entry/Any State e escondem transições (arrastar o nó para longe); clique "perdido" no lote pode deixar transição faltando ou duplicada (conferir; Delete funciona em transição). Estados e timelines novas não precisam de nome, mas o estado herda o da timeline. O painel de condições fica na borda inferior da tela (y≈891-920).
- Ícone de maximizar do grafo: (1069,697) normal / (1277,42) quando maximizado (o mesmo ícone restaura). Em layout normal (1277,42) cai em "Animate" e é inofensivo.

**Agrupar peças em uma opção (aprendido em `mouth`, 03/11/2026)**

- Group: clicar na linha e `Ctrl+G` (ou menu: Wrap in → Group). Arrastar outra linha sobre a linha do Group (x≈75, y do Group) a torna filha. Os Groups ficam no lugar da linha embrulhada.
- **Depois de `Ctrl+G` ou `Ctrl+Z` o Ctrl fica "preso" no editor**: cliques viram seleção múltipla e arrastos falham ou bagunçam a estrutura. Enviar a tecla `ctrl` sozinha NÃO libera de forma confiável. O que ajudou: `Escape` (que também **volta a Hierarquia ao topo**; rolar de novo `scroll down` 6 ticks para as bocas) e só então arrastar. Regra: após `Ctrl+G`, fazer `Escape`, re-rolar, tirar um zoom para conferir as linhas e SÓ ENTÃO arrastar. Nunca encadear ctrl+g e arrasto no mesmo lote.
- Se o resultado for estranho, `Ctrl+Z` desfaz bem (um passo por ação); conferir com zoom a cada passo.
- Menu de contexto da Hierarquia: o item "Wrap in" vem **desabilitado para Groups** (só funciona em path/shape isolado). Para um Group o menu mostra "Ungroup", "Convert to Solo", "Convert to N-Slice". Para obter um Solo contendo Groups: embrulhar em Solo um item avulso (ex.: um path/shape), e arrastar os Groups para ele; ou testar o "+" da Hierarquia (não verificado) para criar Solo vazio. Posição do item "Wrap in": Copy_y = min(click_y+9, 410); Wrap in = Copy_y+224; submenu Group (x≈254) / Solo (y+21).
- Solo com Groups (feito em mouth): "Wrap in → Solo" num path avulso (ex.: `nose`), arrastar os Groups sobre a linha do Solo (um por vez, conferir com zoom; o Solo sobe uma linha a cada arrasto), depois arrastar o path de volta para a borda entre duas linhas acima do Solo.
- **Atalho para Active:** com o Solo expandido e uma timeline aberta no modo Animate, clicar na bolinha (rádio, x≈54) ao lado de cada filho do Solo cria o keyframe de Active. Não precisa digitar nome (resolve filhos todos chamados "Group").
- Painéis da esquerda (ícones em y=925): Hierarchy x=11, Data 27, Assets 44, Animations 62. Animations "+"(157,74)→Timeline(122,129). A timeline recém-criada abre sozinha em modo Animate.
- Layer nova: ícone Layers (982,699), "+"(1068,725), digitar nome, Enter. Arrastar timelines da lista Animations (x≈38) para o grafo funciona (4 de uma vez, y=745, x=270/450/630/810). Entry/Any State: clique direito → "Connect to..." (1º item, ~+33px,+14px do clique), clicar alvos, "Done" (896,722).
- **Condições:** só funcionam com o grafo MAXIMIZADO (ícone 1069,699; restaura em 1277,42): círculo da transição → "+"(1277,893) → campo (47,920) abre lista → `mouth` em (35,700) etc. (clicar no item, NÃO digitar: digitar fora do campo dispara atalhos de ferramenta) → valor: duplo clique (250,920), Ctrl+A, número, Enter. Com 4 estados, círculos Any State em x≈275(0),363(1),450(2),540(3) a y=122.
- Rename de Group: clicar na linha já selecionada entra em edição visível (zoom mostra campo); aí digitar+Enter funcionou.
- **Menu de contexto da Hierarquia: a posição de "Wrap in" depende da linha clicada**: Copy_y = min(y+9, 410) e Wrap in = Copy_y+224 (submenu Group/Solo no mesmo y, +21). Errar cai em "Move" (reordenou camada; desfeito com Ctrl+Z). Sempre hover e screenshot antes de clicar no submenu.
- **Arrastar linhas depois de a lista rolar**: ao remover linhas, a lista pode deslocar e o arrasto cai na linha errada (aninhou paths dentro de paths). Fazer 1 arrasto, zoom, e só então o próximo; Ctrl+Z desfaz.
- Hierarchy: abrir busca (174,74) expande TUDO; Escape limpa. Clicar na seta (x≈48/77) expande/recolhe. Trocar de painel (Animations↔Hierarchy) reseta a rolagem para o topo; refazer `scroll down 10`.
- Teste de preview sem ver o visual: o grafo destaca o estado ativo (zoom em 204,725→914,860).
- Layer nova: o painel de Layers alterna com o ícone (982,699); conferir que abriu antes de clicar "+" e digitar (digitar sem campo em edição dispara atalhos de ferramenta; Escape + clicar no ponteiro (51,46) resolve).
- Preview: play (214,699); inputs na lista Animations (rolar 5 ticks), campo numérico duplo clique, Ctrl+A, número, Enter.

**Não funciona / perigoso**

- Renomear State Machine e nós na Hierarchy: duplo clique/F2 + digitar nem sempre entra em edição; as letras viram atalhos de ferramenta e, com `Ctrl+A` antes, deslocaram o grupo todo. Nunca digitar sem ver o campo em edição (zoom antes). Renomear a SM aplicou com muito atraso (virou "Main" depois).
- Multi-seleção com Ctrl/Shift+clique não chega ao editor; right-click também reseleciona um só item.
- Redimensionar painéis arrastando a borda não funcionou; maximizar painel pelo ícone de expandir funciona (e restaura pelo mesmo ícone).
- Um clique de `Ctrl+A`/Enter fora de campo pode abrir o menu hambúrguer; Escape fecha.
- Agent do Rive (Build) NÃO cria SM/inputs/animações; só orienta. Build gasta cota da conta.

**Plano:** "Upgrade" aparece em Share/Tags/Backup; Export > For Runtime (.riv) está liberado (sem selo). A seção de inputs da SM é marcada "Deprecated" (migração para ViewModels); runtimes ainda leem inputs. Não usar "Convert Inputs to ViewModels".

**Aprendido depois (03/11/2026): piscadinha, boca, ossos, exportação**

- **Digitar valor em Animate cria a chave sozinho**; para criar uma chave sem mudar o visual, digitar 99 no lugar de 100 (ou o clique no losango ao lado do campo). Campos do inspetor de nós: Position y≈149, Scale y≈172 (nó) / y≈150 (Group e Solo), Rotation y≈173; losangos em x≈1192 (esquerda) e x≈1254 (Y).
- **Esperar 0,7 s depois de clicar numa linha da Hierarchy** antes de editar um campo do inspetor; sem a espera a edição vai para o nó anterior.
- **Tempo da timeline:** popover do relógio (≈235,722) → Current (323,758) / Duration (323,779), duplo clique, Ctrl+A, `mm:ss:ff` a 60 fps (1 s = `00:01:00`), Enter. Escape fecha o popover (e mantém a seleção).
- **Interpolação:** selecionar todas as chaves (botão direito numa chave → "Select All Keys") mostra "Keyframe Interpolation" no inspetor; ícone Hold em ≈(1192,616). Hold é necessário quando um filho aninhado leva contraescala do pai (ver wink no `docs/avatar-rive-estado.md`).
- **Escala de nós espelhados** (`*_r`): Y = -100% e rotação -180°; ao animar fechar o olho, usar -10, não +10. A origem do nó de olho já é o centro do olho (não precisa compensar posição).
- **Renomear NÃO funciona** para input, animação e State Machine (F2, duplo clique e menu sem "Rename"): apagar e recriar. Novo input/timeline entra em edição de nome sozinho ao criar (esperar 1,5 s e digitar).
- **Ao restaurar o layout (1277,42) a lista Animations pode rolar sozinha**; rolar ao topo antes de arrastar uma timeline para o grafo (arrastei `bg_6` por engano; Ctrl+Z desfez).
- **Ossos:** ferramenta Bone fica em Design mode no dropdown (264,46) → Bone (268,86); arrastar no canvas cria o osso (o 2º arrasto não criou filho). Reparentar: botão direito no nó → "Set Parent" (Alt+P) → clicar no osso na Hierarchy, sem arrastar; mantém a transformação mundial. Girar o osso no inspetor gira os filhos em torno da origem dele. Custos da migração em `docs/avatar-rive-estado.md`.
- **Exportar:** menu hambúrguer (20,46) → o campo Filename entra em edição ao abrir (renomear para `avatar`) → Export → "For Runtime" → modal "Run Rive anywhere" → botão "Export your .riv file". O download cai na pasta de Downloads do navegador (aqui `D:\Downloads`), sem aviso na tela.
- **Preview:** os gatilhos disparam clicando no círculo ao lado do trigger na lista de inputs; a captura de tela chega atrasada (~0,4 s), então para ver o pico da animação disparar e capturar logo em seguida, ou comparar pixels do canvas.
- **Hierarchy "Collapse All"** (botão direito) recolhe até o artboard; reexpandir pela seta. Pior caso: Escape pode resetar a rolagem; rolar de novo (1 tick ≈ 75 px).
