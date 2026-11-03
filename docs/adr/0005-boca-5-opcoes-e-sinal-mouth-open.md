# 0005: boca com 5 opções e o sinal `mouth_open`

- Status: aceita (Fatia 2 de 5 da ampliação do catálogo)
- Data: 2026-11-04
- Relacionada: ADR 0003 (catálogo segue o `.riv`); ADR 0004 (cor separada da forma); `docs/sinais.md`; `docs/avatar-rig.md`; `docs/avatar-rive-estado.md`

## Contexto

A fatia 2 do plano de 5 (ADR 0004) traz a boca das pranchas de referência (geradas por IA, não versionadas) e as línguas dos sinais. Antes havia 4 bocas e o sinal `tongue` mostrava uma língua saindo da boca atual.

## Decisão

1. `mouth` passa de 4 para **5 opções** (`AVATAR_PART_COUNTS.mouth = 5`). É crescimento do intervalo: nenhum valor gravado fica inválido, então **não há migração** nem mudança de `PROTOCOL_VERSION` por este motivo.
2. Mapa das opções, preservando o tipo de boca: 0 sorriso discreto com brilho (padrão); 1 sorriso largo com dentes; 2 lábios cheios entreabertos, escuros por dentro; 3 lábios fechados com cantinhos; 4 lábios cheios com cantinhos (nova). O desenho de 0 a 3 mudou para o estilo das pranchas, então o índice guarda o **tipo** de boca, não o traço exato (mesmo critério da ADR 0003). As bocas 1 e 2 têm mais de 2 paths (`mouth_1_inside`, `mouth_1_teeth`, `mouth_2_inside`).
3. Novo sinal **`mouth_open`** ("Abrir a boca"), o 16º, no fim de `SIGNAL_IDS`: trigger `trig_mouth_open`, 1000 ms, significado "Livre: a dupla combina". Mostra a boca aberta com dentes em cima e embaixo e a língua **centrada**.
4. O sinal `tongue` mantém id e trigger (`trig_tongue`, "Tenho um 3", para não invalidar combinados gravados) e passa a mostrar a língua **de lado**.
5. No fallback (`art.ts`, `poses.ts`, `AvatarFallback.tsx`): peças ocultas em repouso `mouth_inside`, `mouth_open_teeth_upper`, `mouth_open_teeth_lower`, `mouth_open_lower`, `mouth_open_upper`, `tongue_center` e `tongue`. Os canais `mouthOpacity`, `mouthOpenOpacity`, `tongueCenterOpacity` e `tongueSideOpacity` substituem `tongueOpacity`. Total: 75 paths e 403 vértices (orçamento 420).
6. No `.riv` (25,8 KB, 11 Numbers e 16 triggers): Solo da boca com 5 grupos, estado `mouth_4` na layer `mouth`, grupo `boca2` com as 7 peças da boca aberta e as timelines `sig_mouth_open` e `sig_tongue` de 60 quadros. Detalhes e receitas em `docs/avatar-rive-estado.md`.

## Alternativas consideradas

- Manter 4 bocas e só acrescentar o sinal: não entregaria a boca das pranchas.
- Reaproveitar `tongue` com a língua centrada e dar outro id à língua de lado: renomearia o significado de um sinal já combinado por duplas. Descartada; o id antigo ganha a língua de lado e o sinal novo ganha o centro.

## Consequências

- `SIGNAL_IDS` passa de 15 para 16: o painel "Combinar sinais" mostra 16 campos e o combinado gravado continua válido (só cresce).
- Validado no runtime web (`@rive-app/canvas` 2.21.6): 16 triggers, 11 Numbers, as 5 bocas e os dois sinais com boca 0, 1 e 4. **Não validado:** aparelho iOS/Android.
- Avatares com `mouth` de 0 a 3 mudam de traço, mas mantêm o tipo.

## O que não foi feito (divergências)

- A transição de ida do estado `sig_tongue` (150 ms, Cubic) não foi criada no Rive: o ponto ficava escondido atrás de outros no grafo.
- No fallback, `tongue` também gira a cabeça (5°) e balança a língua; no Rive esses dois movimentos não foram feitos (só a troca de opacidades). Os renderizadores diferem nisso.
- Segue pendente da fatia 1: pescoço, sombra do queixo e nariz só no Rive (ADR 0004).

## O que fica para as próximas fatias

Fatia 3: rosto (`face_shape` 6, nariz, sobrancelhas, `eyes` 6). Fatia 4: cabelo, barba e chapéu. Fatia 5: sombreado opcional. Óculos continuam fora (ADR 0003).
