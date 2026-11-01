---
name: feedback_git_convencao
description: Git do Trucaco — Git Flow, stage por caminho, commit e push só quando o usuário pedir, PR para develop
metadata:
  type: feedback
---

Segue a skill `convencao-git` do usuário: `feature/*` sai da `develop` e volta por PR; `develop` → `master` por PR apenas quando o usuário pedir; nunca push direto em `develop` ou `master` (a única exceção foi o commit de bootstrap).

- Stage por caminho explícito, nunca `git add -A` nem `git add .`. Procurar segredos no diff antes do commit.
- Commit em pt-BR, `tipo(escopo): descrição`, com a linha `Co-Authored-By` indicada pelo ambiente.
- Rodar `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` antes de commitar.

**Why:** o usuário quer decidir o que é publicado. Em 2026-11-01 ele aprovou commit local, depois "só push" (sem PR), e só depois pediu o PR. O repositório é público até o fim do levantamento.

**How to apply:** commitar, dar push e abrir PR só quando pedido, um passo por vez. Ao terminar um trabalho, perguntar se faz push e PR. Detalhes de como abrir PR sem `gh` em [[trucaco-ambiente-dev]].
