---
name: feedback_pr_e_revisao
description: Como abrir e revisar PRs neste projeto desde 2026-11-03 (gh instalado, abrir o link, Codex com o diff no prompt, worktree curto)
metadata:
  type: feedback
---

**PR:** o `gh` está instalado (`C:\Program Files\GitHub CLI\gh.exe`, versão 2.103) e logado como `mcdtecbr`. No trabalho do avatar (PRs #3 a #6) o fluxo foi: branch `feature/*` ou `docs/*` a partir de `origin/develop`, `gh pr create --base develop`, **abrir o link do PR no navegador do usuário** (`Start-Process <url>`, além de citar a URL) e o usuário revisa e mergeia (não mergear sem ele dizer). Corpo do PR em arquivo (`--body-file`) para evitar problemas de aspas no PowerShell. Ver [[feedback_git_convencao]] sobre o modo "direto na develop" anterior.

**Revisão antes de concluir:** rodar a `rita-revisora` (Codex CLI 0.166, logado com ChatGPT). **Bug do ambiente:** o shell do Codex falha com `CreateProcessAsUserW failed: 740` (elevação), então `codex review` e qualquer `git diff` dentro dele não funcionam e ele "aprova" sem ler nada. **Contorno que funciona:** gerar o diff em arquivo (`git diff origin/develop...HEAD -- . ':!pnpm-lock.yaml'`) e rodar `codex exec --sandbox read-only --skip-git-repo-check - < prompt.txt`, com as instruções e o diff dentro do prompt. Ele revê o diff, mas não lê outros arquivos. Desconfiar de qualquer parecer que não cite o conteúdo do diff. Se o Codex falhar de vez (login, cota), cair no `/code-review` do Claude e avisar. Na revisão do PR #5 o Codex achou 2 problemas reais de ordem de desenho que os testes não pegavam; vale rodar sempre.

**Worktrees:** para trabalhar numa branch de `develop` sem mexer no diretório principal (que pode estar noutra branch e tem `apps/` sem rastreio do usuário), usar `git worktree add ../tc-xxx -b <branch> origin/develop` com nome CURTO (`node_modules` estoura o limite de caminho do Windows; remover com `cmd /c rmdir /s /q "\\?\D:\Sources\tc-xxx"` e `git worktree prune`). Depois do merge, limpar worktree e branches locais.

**Download de ferramentas** (ex.: `playwright install chromium`, 118 MB): pedir autorização explícita antes. Foi autorizado em 2026-11-03 para a medição de FPS.

**Why:** o usuário passou a pedir PR para `develop` e quer ver o PR direto; a revisão independente achou bugs que os testes não pegavam.
