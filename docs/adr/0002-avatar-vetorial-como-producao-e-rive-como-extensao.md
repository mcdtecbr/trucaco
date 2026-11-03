# 0002: avatar vetorial é o renderizador de produção da Fase 4; Rive entra atrás de `renderer`

- Status: aceita
- Data: 2026-11-02
- Autor: `artur-arquiteto` (plano da Fase 4), registrado por `teo-docs`
- Relacionada: ADR 0001 (localização do `<Avatar>`); `docs/avatar-rig.md`; `docs/sinais.md`

## Contexto

O avatar do produto é desenhado no Rive (spec §2 e §7): um `assets/rive/avatar.riv` com state machine e triggers. Hoje o arquivo não existe. Ele é um binário feito no editor Rive, por pessoa (usuário ou ilustrador); nenhum agente do time o produz nem o valida visualmente.

Além disso:

- Rive nativo (`rive-react-native` 9.x) exige development build (EAS ou `expo run:*`). O Expo Go só carrega módulos nativos do próprio SDK, então com Rive nativo não há validação em Expo Go, que é o caminho previsto para iOS e Android nesta etapa.
- A biblioteca nova (`@rive-app/react-native` 0.5, sobre Nitro Modules) é pré-1.0. Não foi escolhida.
- A Fase 4 não pode esperar a arte: o plano previa o risco de o avatar "ficar para sempre" sem arte.

## Decisão

1. O renderizador de produção da Fase 4 é o **vetorial**: `View` e `Animated` do React Native, sem dependência nova. Formato de rosto, pele, cabelo, olhos, boca, roupa, acessório e fundo vêm de `AvatarParts`; os 12 sinais são animações curtas de transform e opacidade (`packages/avatar/src/AvatarFallback.tsx`, `poses.ts`, `useSignalAnimation.ts`).
2. O contrato do rig vira documento (`docs/avatar-rig.md`) e constantes (`packages/avatar/src/riveContract.ts`). É a especificação que o ilustrador recebe.
3. Rive entra como **ponto de extensão**: `AvatarRendererId` (hoje só `'fallback'`) e `pickRenderer` em `packages/avatar/src/Avatar.tsx`. Quando houver um renderizador Rive, ele entra ali (blocos 4G web e 4H nativo do plano) e o `<Avatar>` mantém a mesma API (`parts`, `signal`, `onSignalEnd`, `size`, `reduceMotion`). Hoje `pickRenderer` ignora o pedido e devolve `'fallback'`.

## Alternativas consideradas

- **Esperar o `.riv` para fechar a Fase 4**: bloqueia o código por algo que não é do time. Descartada.
- **Rive nativo já na Fase 4**: exige dev build, o que impede validar no Expo Go, e a compatibilidade de `rive-react-native` 9.x com `newArchEnabled: true` não foi verificada (`docs/specs/2026-11-02-fase-4-avatar-plano.md`, §5). Adiada para o 4H, condicionada a dev build.
- **Rive com `@rive-app/react-native` 0.5 (nova biblioteca)**: pré-1.0 e dependente de Nitro Modules. Não recomendada no plano para esta fase.

## Consequências

- O produto usa o vetorial até o `.riv` existir. Isso vale também para o beta, se for preciso.
- **Desempenho no web**: `useNativeDriver` é `false` na web (`Platform.OS !== 'web'`), então o `Animated` roda na thread JavaScript. Medição de 2026-11-02 no Chromium com 4 avatares: 59,6 a 60 FPS sem CPU limitada; com CPU 4x de throttle, 36 a 40 FPS ocioso e 14,6 a 21,7 FPS com 4 sinais simultâneos. A causa mais provável é esse driver, mas não foi perfilada. Detalhes no relatório da fase (`docs/specs/2026-11-02-fase-4-relatorio.md`). Meta do plano (50 FPS em aparelho intermediário) não foi medida em aparelho.
- A troca de renderizador não muda tela nenhuma (ponto de extensão), mas exige que o Rive respeite a mesma lista de inputs e triggers (`RIVE_CONTRACT`).
- Os nomes de inputs, triggers e as contagens de variantes viram contrato com o ilustrador: mudar exige atualizar `riveContract.ts`, `parts.ts`, `signals.ts`, `docs/sinais.md` e `docs/avatar-rig.md` juntos.
