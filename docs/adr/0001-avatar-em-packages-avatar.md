# 0001: `<Avatar>` fica em `packages/avatar`, não em `packages/ui`

- Status: aceita
- Data: 2026-11-02
- Autor: `artur-arquiteto` (plano da Fase 4), registrado por `teo-docs`
- Relacionada: ADR 0002 (renderizador vetorial e ponto de extensão Rive); spec §7 (divergência registrada lá)

## Contexto

A spec (`docs/specs/2026-11-01-trucaco-design.md`, §7) põe o componente `<Avatar parts signalQueue />` em `packages/ui`, com implementação `.native.tsx` e `.web.tsx`. Pela regra de dependências da spec (§3), `ui` depende só de `protocol`; `avatar` também depende só de `protocol`; `mobile` depende de `protocol`, `avatar` e `ui`.

Se o `<Avatar>` ficasse em `ui`, `ui` precisaria importar `@trucaco/avatar` (catálogo de partes, sinais, animação), o que quebra a regra de dependências.

## Decisão

- O `<Avatar>` (e o catálogo que ele usa: `parts`, `signals`, `riveContract`, `useSignalAnimation`) fica em `packages/avatar`. Peers `react` e `react-native`, como `packages/ui`.
- `packages/ui` não importa `@trucaco/avatar`. O slot do avatar é uma prop `avatar?: ReactNode` no `AvatarPlaceholder`; quem monta o desenho é o app.
- A composição com o estado da mesa fica em `apps/mobile/src/screens/SeatAvatar.tsx`, que envolve o `<Avatar>` e marca o desenho como fora da árvore de acessibilidade (o assento já tem nome no `AvatarPlaceholder`).

## Alternativas consideradas

- **Componente em `packages/ui` com dependência `ui -> avatar`**: contraria a regra da spec §3. Descartada.
- **Catálogo em `ui`, componente em `avatar`**: separaria o que muda junto (partes, sinais e o rig). Descartada.
- **Slot `ReactNode` em `ui` (adotada)**: `ui` continua sem conhecer o avatar; o app escolhe o desenho.

## Consequências

- A spec §7 diz "em `packages/ui`": a divergência está registrada no próprio §7 (nota de divergência, esta fase).
- `ui` pode ser testado sem `avatar`; o teste do `<Avatar>` fica em `packages/avatar` (`Avatar.test.tsx`).
- Quem for usar o `<Avatar>` fora do app precisa depender de `@trucaco/avatar`, não de `@trucaco/ui`.
- Nada automatizado impede `ui` de importar `avatar`: o ESLint (`eslint.config.mjs`) restringe `rules` e `server` no cliente, mas não `avatar`. Hoje a regra é de revisão. Sugestão: incluir `@trucaco/avatar` na lista de `no-restricted-imports` de `packages/ui` (não feito nesta fase).
