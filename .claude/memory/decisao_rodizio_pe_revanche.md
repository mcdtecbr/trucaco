---
name: decisao-rodizio-pe-revanche
description: Usuário decidiu aplicar rodízio do pé na revanche (mensagem de revanche no protocolo)
metadata:
  type: project
---

Em 2026-11-02 o usuário decidiu duas coisas: (1) criar uma mensagem de **revanche** ("Jogar de novo") no protocolo; (2) **aplicar o rodízio do pé na revanche**.

**Why:** a regra de rodízio do pé entre jogos da série nunca tinha sido confirmada ([[handoff-fase-4]]). Em 2026-11-02 o usuário confirmou o rodízio **na revanche** e, ao confirmar os padrões, também **entre jogos da série `bo3`** (`series.ts:91`): o pé é o assento seguinte ao pé da última mão.

**How to apply:** já implementado (`packages/rules/src/series.ts` e `startRematch` no `TrucoRoom`). A revanche está no protocolo, no servidor (b6bd137) e no cliente (f09565e). `docs/regras-truco.md` e `docs/protocolo-servidor.md` estão atualizados. Janela de 30 s, mínimo de 2 humanos conectados e unanimidade: **confirmados pelo usuário** em 2026-11-02.
