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

**Fase 2 (2026-11-01)**: plano do `artur-arquiteto` em `docs/specs/2026-11-01-fase-2-servidor-plano.md` (blocos 2A–2I, contrato do `protocol`, decisões). Fase 1 fechada (138 testes, bug de "aumentar = aceitar o anterior" corrigido). Status das 5 perguntas ao usuário no fim do plano: ver o próprio doc/conversa.

**Bloco 2A (2026-11-01)**: contrato do `protocol` commitado (43d025e) e auditado pelo `vitor-seguranca` (sem achado crítico/alto). Respostas do usuário às 5 perguntas do plano da Fase 2: todos os padrões. **Código de sala com 8 caracteres** (não 6; alfabeto de 31 símbolos). **Rita-C reservada para o bloco 2D.** Para o bloco 2H: rate limit de entrada por código/IP/usuário e mesmo erro para sala inexistente e cheia (de quem não está na mesa). Para o cliente (Fase 3): renderizar chat só como `<Text>`, nunca HTML.

**Fase 2 concluída (2026-11-01)**: blocos 2A a 2I commitados na `develop` (último: b1b0031). Servidor com lobby por REST e `matchMaker` (sem `LobbyRoom`), `TrucoRoom` com `StateView`, reconexão de 60 s, bot de ausência, sinais, sfx, chat, auth JWT HS256 com refresh rotativo em Redis, persistência em `matches`. Documentado em `docs/protocolo-servidor.md`, `apps/server/README.md`, `docs/banco-de-dados.md`, `CHANGELOG.md`. Divergências do plano na nota do topo de `docs/specs/2026-11-01-fase-2-servidor-plano.md`. Pendências e ressalvas em `docs/plano-desenvolvimento.md` (Fase 2). **Revisora das Fases 1 e 2: Rita-C** (`rita-revisora-claude`, `opus`, por falta do Codex CLI no container). Próxima: **Fase 3** (cliente jogável, `fabio-frontend`), também direto na `develop`. Ainda sem Docker e sem CI verificado no GitHub.

**Fase 3 em andamento (2026-11-02)**: blocos 3A a 3H1b commitados na `develop` (último `7cbe481`): contrato HTTP e snapshot no `protocol`, `logout`, esqueleto Expo SDK 58, camada de rede com refresh em fila única e transporte `trucaco.bearer`, telas de auth e lobby, `packages/ui` (cartas, leque, placar, anúncios), servidor publicando `manilhaRank/manilhaCards/nextBetValue/pendingValue/actingSeat`, mesa jogável básica. **Pendente: 3H2** (ferro, onze/dez, coberta, histórico, fim de partida, voto, chat) junto com as correções já revisadas do 3H1; depois 3I (E2E e CI) e 3J (docs). Tudo detalhado em [[handoff-fase-3]]. Revisora das Fases 1 a 3: Rita-C (Claude opus), por falta do Codex na nuvem.
