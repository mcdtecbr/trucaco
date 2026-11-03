---
name: avatar-rive-estado
description: Estado do avatar Rive em 2026-11-03 (avatar.riv no develop, catálogo alinhado, 15 sinais) e o que falta
metadata:
  type: project
---

**O `assets/rive/avatar.riv` existe e está no `develop`** (26,7 KB, artboard `Avatar`, state machine `Main`, 8 Numbers + 15 triggers). Montado no editor Rive (sem gerar o binário por código: o usuário recusou isso). Diário de montagem e divergências em `docs/avatar-rive-estado.md`; contrato do rig em `docs/avatar-rig.md`; decisão do catálogo em `docs/adr/0003-catalogo-do-avatar-segue-o-riv.md`. Receitas do editor em [[rive-editor-receitas]].

**Decisões do usuário (2026-11-03)**

- **Óculos removidos** do catálogo (escondem o piscar de olho, base dos sinais): `accessory` = 3 (nenhum, bigode, brinco). Migração `20261103150000_avatar_accessory_3`.
- **O `.riv` é a referência visual**: catálogo (`parts.ts`) e fallback vetorial seguem o `.riv`; o fallback renderiza o mesmo SVG (`packages/avatar/src/art.ts`) com `react-native-svg` (dependência aprovada).
- **Sinais**: 15 (`wink_r`, `mouth_l`, `mouth_r` acrescentados ao fim de `SIGNAL_IDS`; `wink` continua e dispara `trig_wink_l`). `_l`/`_r` = lado **da tela**. Só `wink` guarda o zap; os outros três são livres para a dupla.
- **Sem ossos por ora** (teste feito e revertido: osso rígido por "Set Parent" funciona). Migração para ossos é **pendência futura**; custos em `docs/avatar-rive-estado.md`.
- Piscar do idle variável: layer `Blink_Random` com 3 estados (`idle_blink` a 1,5x, 1x e 0,65x), Exit Time 4400 ms e **Randomize Exit** ligado em cada um (inspetor do estado). Torção de boca = rotação do Solo da boca, não deformação de vértices.

**Validação feita:** runtime web (`@rive-app/canvas` 2.21.6) carrega o `.riv`, lê os 15 triggers e 8 Numbers, 60 FPS com 4 instâncias; `Avatar.web` testado com o `.riv` real; FPS do fallback novo no web: 60 (CPU 1x), 59,7 ocioso e 52,5 com sinais (CPU 4x). `rivFile.test.ts` confere os nomes dos inputs dentro do `.riv`.

**Pendências**

1. **Licença do Rive:** o plano gratuito exporta `.riv`, mas o runtime mostra uma splash do Rive por vários segundos (os artboards `Watermark` e `NuRive*` do arquivo). O Cadet (US$ 17/assento/mês, US$ 108/ano) exporta sem splash. Uso comercial no plano gratuito não consta nas páginas oficiais: ler os Termos de Serviço e reexportar depois de assinar.
2. **Aparelho iOS/Android:** `Avatar.native` e os `transform` em string do `react-native-svg` nativo nunca rodaram; FPS em aparelho não medido.
3. O Rive em si (4G web, 4H nativo) ainda não é o renderizador de produção: continua o fallback vetorial (ADR 0002 e 0003).
4. Não existe `.rev`: o fonte do Rive fica na nuvem (`editor.rive.app/file/untitled/2701970`, arquivo `avatar`). Se a conta se perder, o rig precisa ser refeito.
