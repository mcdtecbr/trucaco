---
name: feedback_git_convencao
description: Git do Trucaco — MODO ATUAL: commit e push direto na develop, sem PR, até o usuário avisar; depois volta ao Git Flow
metadata:
  type: feedback
---

**Modo atual (ordem do usuário em 2026-11-01):** seguir todos os planos **direto na `develop`**, com commit e push na própria `develop`, **sem branch de feature e sem PR**, até o usuário avisar para gerar PR. Isso é autorização permanente para esse modo: pode commitar e dar push na `develop` sem perguntar a cada vez. Continua valendo: nunca mexer na `master`, stage por caminho, procurar segredos no diff, rodar a verificação antes de commitar. Quando o usuário mandar abrir PR, voltar ao fluxo abaixo (e perguntar se quer um PR único com tudo desde o último PR mesclado, #2).

**Atualização 2026-11-03:** o usuário passou a pedir PR para `develop` (PRs #3 a #6, avatar Rive) e a mergear ele mesmo. No trabalho do avatar o fluxo é branch, PR e o usuário mergeia, com o `gh` (ver [[feedback_pr_e_revisao]]). Não é certo que o modo "direto na develop" tenha acabado para as outras frentes: na dúvida, perguntar.

**Fluxo padrão (a retomar)** da skill `convencao-git` do usuário: `feature/*` sai da `develop` e volta por PR; `develop` → `master` por PR apenas quando o usuário pedir; nunca push direto em `develop` ou `master`.

- Stage por caminho explícito, nunca `git add -A` nem `git add .`. Procurar segredos no diff antes do commit.
- Commit em pt-BR, `tipo(escopo): descrição`, com a linha `Co-Authored-By` indicada pelo ambiente.
- Rodar `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` antes de commitar.

**Why:** o usuário quer decidir quando abrir PR (PRs #1 e #2 mesclados em 2026-11-01). Até então prefere o ritmo direto na `develop`. O repositório é público até o fim do levantamento: não versionar segredos nem material sem direito de redistribuição.

**How to apply:** no modo atual, commitar e dar push na `develop` ao fim de cada bloco de trabalho. **Abrir PR, mexer na `master` ou criar branch de feature só quando o usuário pedir.** Detalhes de como abrir PR sem `gh` em [[trucaco-ambiente-dev]].

**Ordem do usuário (2026-11-01, Fase 2)**: commit e push a CADA etapa concluída (bloco de implementação, rodada de correção de revisão, testes, docs), antes de iniciar a seguinte. Uma etapa só conta como concluída com a verificação completa verde (`format:check`, `lint`, `typecheck`, `test`, `build`) conferida pelo orquestrador. Etapa em andamento (agente ainda trabalhando) não é commitada parcialmente.
