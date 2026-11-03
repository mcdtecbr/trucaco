---
name: decisao-resposta-aposta-onze-dez
description: Regras decididas pelo usuário em 2026-11-02 para quem responde aposta (truco/retruco) e como a dupla decide a mão de onze/dez
metadata:
  type: project
---

Decisões do usuário em 2026-11-02 (mudam o motor `packages/rules`, o servidor e o cliente; IMPLEMENTADO em 2026-11-02: motor 3968e85, servidor e7b3d39, cliente 222d633, testes 3570a35; ver `docs/regras-truco.md`):

1. **Aposta pendente: responde UM só jogador, não a dupla.** No pedido de truco responde o adversário que joga logo depois de quem pediu (próximo na ordem da mesa). No retruco (seis, oito, dez, doze) responde quem fez o pedido anterior (quem pediu o truco responde ao retruco; a responsabilidade alterna entre os dois jogadores). O parceiro de quem responde só assiste: sem botões.
2. **Mão de onze/dez que não é mão de ferro:** os dois da dupla na frente veem as cartas um do outro e **os dois decidem** jogar ou correr. Se **um correr, a dupla corre** e perde a mão (adversária ganha o valor base, como já era). Para jogar, **os dois precisam aceitar**.
3. Mão de ferro não muda.

**Why:** hoje o servidor dá ação legal aos dois da dupla e vale o primeiro clique; o usuário quer decisão individual na aposta e decisão conjunta (unânime para jogar, qualquer um corre) no onze/dez.

**How to apply:** fluxo tales-regras (motor e testes) → caio-colyseus (estado público: quem responde, quem já aceitou no onze/dez; `actingSeat` passa a ser o respondedor) → fabio-frontend (botões só para quem decide). Ver [[decisao-rodizio-pe-revanche]] e [[handoff-fase-4]].
