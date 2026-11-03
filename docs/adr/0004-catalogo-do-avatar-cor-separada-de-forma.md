# 0004: no catálogo do avatar, a cor é uma dimensão própria, separada da forma

- Status: aceita (Fatia 1 de 5 da ampliação do catálogo)
- Data: 2026-11-04
- Relacionada: ADR 0003 (catálogo segue o `.riv`); `docs/avatar-rig.md`; `docs/avatar-rive-estado.md`

## Contexto

Até a ADR 0003, cor e forma andavam juntas em várias partes: `hair` era estilo e cor (uma cor só, `#2B1B12`), `outfit` era modelo e cor, e a pupila tinha cor fixa. Ampliar o catálogo (mais cabelos, roupas, rostos) multiplicaria as variantes se cada cor exigisse uma forma nova. Plano em 5 fatias, decidido com o usuário (respostas "padrões"): 1 Cores; 2 Boca e línguas; 3 Rosto; 4 Cabelo, barba e chapéu; 5 sombreado opcional. Esta ADR cobre só a fatia 1.

## Decisão

1. `AvatarParts` passa de 8 para **11 chaves obrigatórias**. `skin` cresce de 6 para 8 opções (oliva e rosado). Entram, **ao fim** de `AVATAR_PART_KEYS`, nesta ordem: `hair_color` (8), `eye_color` (3) e `outfit_color` (11). Contagens em `AVATAR_PART_COUNTS` (`packages/protocol/src/avatar.ts`).
2. `PROTOCOL_VERSION` vai de 2 para **3**. `parseAvatarParts` continua estrito: chave faltando recusa o avatar inteiro.
3. Paletas em `packages/avatar/src/parts.ts` (`SKIN_COLORS`, `HAIR_COLORS`, `EYE_COLORS`, `OUTFIT_COLORS`), na ordem dos Numbers do rig:
   - `hair_color` vale para cabelo, sobrancelha e bigode/barba. Boné e chapéu não mudam. Índice 0 é a cor atual (`#2B1B12`).
   - `eye_color` recolore a pupila (não há íris separada). Índice 0 é `#1B1B1F`.
   - `outfit_color` 0 = **padrão do modelo** (cada roupa usa a sua cor principal, `OUTFIT_COLORS[outfit]`); 1 a 10 aplicam a paleta (`resolveFill` em `art.ts`).
4. O rig `.riv` ganha os mesmos Numbers e as mesmas cores; o fallback vetorial e o `.riv` seguem iguais (ADR 0003). Para evitar colisão de hex entre peças no editor, o botão do polo passou a `#F8FAFC` e a coroa do boné a `#1E2836` (também no `art.ts`).
5. O editor de avatar (`AvatarEditorView.tsx`) mostra cada cor logo depois da sua forma (`EDITOR_PART_ORDER`); a ordem do contrato é outra.

## Migração

`apps/server/prisma/migrations/20261104120000_avatar_cores/migration.sql`, só de dados, sem mudar `schema.prisma`. Perfis gravados ficariam recusados por `parseAvatarParts`, então a migração preenche o que falta: `hair_color` 0, `eye_color` 0 e `outfit_color` copiando `outfit` (de 0 a 5; senão 0), porque as 6 primeiras cores de roupa são as cores principais atuais. Idempotente: só toca a chave ausente. Testada em Postgres 16 descartável: 3 linhas na primeira execução, 0 na segunda.

## Alternativas consideradas

- **Uma forma por cor** (mais variantes de `hair` e `outfit`): explode a contagem de paths e de combinações a cada fatia. Descartada.
- **Cor opcional no contrato** (chave ausente = padrão): afrouxaria `parseAvatarParts`, que hoje recusa o avatar inteiro. Descartada; a migração cobre os dados.
- **Data binding de cor do Rive**: não usado; o rig continua com timelines por Number (ver `docs/avatar-rive-estado.md`).

## Consequências

- Cliente com `PROTOCOL_VERSION` 2 não conversa com servidor 3 (mudança incompatível do avatar).
- O catálogo volta a só crescer (a exceção de `accessory` da ADR 0003 não se repete).
- Validado no runtime web (`@rive-app/canvas` 2.21.6): 8 peles, 8 cabelos, 3 olhos e 11 roupas (polo, colete e regata) renderizam certo, mais 4 combinações misturadas; `.riv` de 22,6 KB, 11 Numbers e 15 triggers, 60 FPS. **Não validado:** aparelho iOS/Android.
- **Divergência conhecida:** os ajustes de pescoço (base alargada), de sombra do queixo (Multiply 75% com Feather) e de nariz (Multiply 70% com Feather 5) foram feitos só no Rive e **ainda não estão** em `art.ts` nem no fallback vetorial. Os dois renderizadores diferem nesses três detalhes até alguém levá-los ao `art.ts`.

## O que fica para as próximas fatias

Fatia 2: boca (5 opções) e línguas/`mouth_open`. Fatia 3: rosto (`face_shape` 6, nariz, sobrancelhas, `eyes` 6). Fatia 4: cabelo (20), barba e chapéu (boné e chapéu saem de `hair`). Fatia 5: sombreado opcional. Óculos continuam fora (ADR 0003). As imagens de referência dessas fatias são geradas por IA e não são versionadas. Cada fatia que mude o contrato exige nova migração de dados e nova versão do protocolo.
