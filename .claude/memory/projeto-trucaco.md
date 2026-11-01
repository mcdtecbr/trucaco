---
name: projeto-trucaco
description: Trucaco — truco online Paulista e Mineiro; decisões do brainstorming, estado das fases e próximos passos
metadata:
  type: project
---

**Trucaco**: truco online Paulista e Mineiro para web, iOS e Android. Pasta `E:\Sources\trucaco`, remoto `https://github.com/mcdtecbr/trucaco.git` (público no início; o usuário vai fechar após o levantamento). O nome tem "c": **trucaco**.

**Decisões (brainstorming 2026-11-01)**, detalhadas em `docs/specs/2026-11-01-trucaco-design.md`: produto público; cliente React Native + Expo (web/iOS/Android); servidor Node/TS + Colyseus com Postgres (Prisma) e Redis; avatar Rive (partes trocáveis + um trigger por sinal); MVP = Paulista e Mineiro com mesa de 4, mesa de 6 na fase 8; login Google/Apple + convidado; GitHub Actions + Fly.io + Expo EAS. Sinais de truco são públicos na mesa (todos veem); chat da dupla é privado; balões de chat na mesa.

**Estado em 2026-11-01**: Fase 0 (fundação) feita, PR aberto: https://github.com/mcdtecbr/trucaco/pull/1 (`feature/fase-0-fundacao` → `develop`); o CI ainda não foi visto rodando no GitHub. Próxima: Fase 1, motor de regras (`tales-regras`), em branch nova a partir da `develop` depois que o PR #1 for mesclado. Antes dela o usuário deve revisar `docs/regras-truco.md` (normativo). `master` e `develop` existem; o primeiro commit foi direto na master só para bootstrap. A branch padrão do GitHub ainda é `master`.

**Time**: 12 agentes persona-função em `.claude/agents/` (artur, tales, caio, fabio, rai, dalva, catia, duda, rita, vitor, diego, teo), no padrão dos projetos de `E:\Sources` (Fiori, wapis). O trabalho continua no VS Code, abrindo a pasta do projeto.

**Why:** as decisões e o plano nasceram numa sessão de brainstorming; só existem nos docs do repo e nesta memória.

**How to apply:** ler `CLAUDE.md` e `docs/plano-desenvolvimento.md` antes de agir. Ferramentas e armadilhas em [[trucaco-ambiente-dev]]; regras de Git em [[feedback_git_convencao]].
