# 0003: o catálogo de variantes do avatar segue o `avatar.riv`; fallback passa a desenhar o mesmo SVG

- Status: aceita
- Data: 2026-11-03
- Autor: `artur-arquiteto` (plano), decisões do usuário; registrado pelo orquestrador
- Relacionada: ADR 0002 (avatar vetorial como produção); `docs/avatar-rig.md`; `docs/avatar-rive-estado.md`

## Contexto

O `assets/rive/avatar.riv` foi montado no editor Rive (26,7 KB, 65 paths) e validado no runtime web a 60 FPS. As variantes dele (cabelos, roupas, rostos, tons de pele, cores de fundo, acessórios) não coincidiam com o catálogo do `develop` (`packages/avatar/src/parts.ts`) nem com o desenho do fallback vetorial: o mesmo índice mostrava aparências diferentes no Rive e no fallback. O `.riv` não é barato de mudar (montado à mão). Os óculos foram removidos do rig por decisão do usuário: escondem o piscar de olho, base dos sinais de truco.

## Decisão

1. O `avatar.riv` é a **referência visual**. Nomes, ordem e cores de `PART_VARIANT_NAMES` e das tabelas de cores passam a descrever o que o `.riv` desenha.
2. `AVATAR_PART_COUNTS.accessory` cai de **5 para 3** (0 nenhum, 1 bigode, 2 brinco). É uma **exceção à regra "só cresce"** do contrato, aceita porque o produto ainda não foi lançado e porque os óculos saíram por decisão de produto. A migração `20261103150000_avatar_accessory_3` leva `accessory` 3 e 4 gravados para 0, preservando as outras partes. Dali em diante a regra "só cresce" volta a valer.
3. O fallback vetorial passa a **renderizar os mesmos paths do rig** (`packages/avatar/src/art.ts`, 512×512) com `react-native-svg`, em vez de switches de `View`. Isso substitui a frase "sem dependência nova" do ADR 0002; o resto do ADR 0002 (vetorial como produção, Rive como extensão) continua valendo.

## Alternativas consideradas

- **Redesenhar as variantes à mão com `View`/`Animated`**: sem dependência nova, mas só aproxima (béziers do afro, do topete, do chapéu e do colete não se reproduzem) e exige reescrever quase todo o arquivo. Descartada.
- **Refazer o rig conforme o catálogo antigo**: custo alto no editor Rive. Descartada.
- **Manter `accessory` em 5**: deixa 3 e 4 sem desenho no `.riv` e o editor oferece opções fantasmas. Descartada.

## Consequências

- O mesmo índice mostra a mesma aparência no Rive e no fallback; uma tabela (`art.ts`) a manter.
- Dependência nova: `react-native-svg` (parte do SDK Expo).
- Dados de desenvolvimento com `accessory` 3/4 são ajustados pela migração; o cliente que tinha esses valores em cache volta ao padrão.
- Semântica dos índices mudou (ex.: `hair` 6 era "black power", agora é "chapéu"): testes e e2e que citam nomes por índice precisam de releitura.
- Desempenho medido em 03/11/2026 (`apps/mobile/e2e/perf/avatarPerf.perf.ts`, Chromium, 4 avatares, web): sem limite de CPU, 60,0 FPS ocioso e 60,0 FPS com 4 rajadas de sinais; com CPU 4x de throttle, 59,7 FPS ocioso e 52,5 FPS com sinais (4,3% dos quadros acima de 33 ms). A medição de 02/11/2026 do fallback antigo (ADR 0002) deu 36 a 40 FPS ocioso e 14,6 a 21,7 FPS com sinais no mesmo throttle, então o fallback novo não piorou o web (os números vêm de execuções em momentos diferentes, na mesma máquina de desenvolvimento). **Continua sem medição em aparelho** iOS/Android.
