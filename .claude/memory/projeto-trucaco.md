---
name: projeto-trucaco
description: Trucaco — truco online Paulista e Mineiro; decisões do brainstorming, estado das fases e próximos passos
metadata:
  type: project
---

**Trucaco**: truco online Paulista e Mineiro para web, iOS e Android. Pasta `E:\Sources\trucaco`, remoto `https://github.com/mcdtecbr/trucaco.git` (público no início; o usuário vai fechar após o levantamento). O nome tem "c": **trucaco**.

**Decisões (brainstorming 2026-11-01)**, detalhadas em `docs/specs/2026-11-01-trucaco-design.md`: produto público; cliente React Native + Expo (web/iOS/Android); servidor Node/TS + Colyseus com Postgres (Prisma) e Redis; avatar Rive (partes trocáveis + um trigger por sinal); MVP = Paulista e Mineiro com mesa de 4, mesa de 6 na fase 8; login Google/Apple + convidado; GitHub Actions + Fly.io + Expo EAS. Sinais de truco são públicos na mesa (todos veem); chat da dupla é privado; balões de chat na mesa.

**Estado em 2026-11-01**: Fase 0 (fundação) concluída e mesclada na `develop` (PR #1, CI verde no GitHub), e o plano ampliado também mesclado (PR #2). `develop` sincronizada com o GitHub. **Próxima: Fase 1, motor de regras (`tales-regras`), trabalhando direto na `develop`** (ver [[feedback_git_convencao]]: sem PR até o usuário avisar). Antes dela o usuário deve revisar `docs/regras-truco.md` (normativo). A `master` está no commit inicial e só recebe da `develop` por PR quando o usuário pedir. A branch padrão do GitHub ainda é `master`.

**Acréscimos de 2026-11-01 (PR #2)**, nos docs: série **melhor de 3 jogos** opcional na criação da mesa (`bo3` só em mesa privada; fila pública é `single`); placar da mesa **numérico em camadas** (série, jogo, mão, vazas); **áudio** com voz masculina/feminina por avatar, gritos por aposta (`truco`, `seis`, `oito`, `nove`, `dez`, `doze`), `quero`/`corro` e soundboard engraçado (protótipo sintético, vozes finais gravadas na Fase 7; `docs/audio.md`, nova **Fase 5b**); **gamificação** (`docs/gamificacao.md`): conquistas e missões diárias na Fase 6, ranking competitivo Elo com ligas e temporadas na **Fase 9** (depois do beta). XP e nível **não** foram escolhidos. Em aberto: recompensa das conquistas (proposta: itens cosméticos) e confirmar a regra de rodízio do pé entre jogos da série.

**Time**: 12 agentes persona-função em `.claude/agents/` (artur, tales, caio, fabio, rai, dalva, catia, duda, rita, vitor, diego, teo), no padrão dos projetos de `E:\Sources` (Fiori, wapis). O trabalho continua no VS Code, abrindo a pasta do projeto.

**Why:** as decisões e o plano nasceram numa sessão de brainstorming; só existem nos docs do repo e nesta memória.

**How to apply:** ler `CLAUDE.md` e `docs/plano-desenvolvimento.md` antes de agir. Ferramentas e armadilhas em [[trucaco-ambiente-dev]]; regras de Git em [[feedback_git_convencao]].

**Fase 1 (2026-11-01, direto na `develop`)**: blocos A (cartas, mão, apostas, onze/dez, ferro) e B (partida, série, `GameEvent`, `legalActions`, bot) commitados em `packages/rules`. **Decisões do usuário**: (1) mão de ferro é **opção** na abertura da sala (`ironHand`, padrão ligada; desligada = mão normal); (2) Mineiro tem mão de **10** (11 pontos não é mão especial); (3) **bot nunca pede nem aumenta aposta**, decisão sempre humana, mas o bot **pode dar sinais** (servidor/avatar, Fases 2 e 4). `GameEvent` fica em `rules` (rules não importa `@trucaco/*`); `Card/Rank/Suit` duplicados em `protocol` e `rules`. Mão de ferro: carta escolhida às cegas, mas aberta e visível a toda a mesa ao ser jogada (decisão do usuário; `publicEvent` ajustado). Em aberto: rodízio do pé entre jogos da série; faltam catia-qa (cobertura ≥ 90%), rita-revisora e teo-docs.

**Revisão sem Codex (2026-11-01)**: o container da nuvem não tem o Codex CLI. Se a `rita-revisora` devolver `CODEX_AUSENTE`, o orquestrador aciona a `rita-revisora-claude` (modelo `opus`, somente leitura) com o mesmo escopo de diff. Fase 1 foi revisada assim (agente Claude); recomendado repetir com a Rita/Codex na máquina Windows sobre `acf118a..HEAD`.
