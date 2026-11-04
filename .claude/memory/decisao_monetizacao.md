---
name: decisao_monetizacao
description: Decisões do usuário sobre monetização (2026-11-04) - jogo gratuito, Trucaço Plus a R$ 9,90/mês, sem doação, anúncio nunca na mesa; IMPLANTAR SÓ NO FINAL DO PROJETO
metadata:
  type: project
---

**Monetização, decidida em 2026-11-04** (detalhes em `docs/monetizacao.md`): o jogo é gratuito e completo; a receita vem de cosméticos (avatar, vozes, soundboard, mesa) e da assinatura **Trucaço Plus a R$ 9,90 por mês** (aprovada; anual proposto R$ 79,90, a confirmar). **Sem doação** (retirada por ordem do usuário). **Anúncio nunca na mesa**; banner permitido só fora da mesa e sempre discreto; anúncio recompensado com verificação no servidor; intersticial entre partidas só se a receita faltar. Nada vendido dá vantagem de jogo; sem aposta com dinheiro real nem caixa aleatória. Loja vira Fase 10, depois do ranking; Fase 6 ganha modelo de posse (`entitlements`) e Fase 7 ganha telemetria e termos. Pendentes: itens trancados, moeda do jogo (proposta: sem), preços dos cosméticos, provedor web (Mercado Pago ou Stripe), onde o banner aparece.

**Quando implantar (ordem do usuário em 2026-11-04): só no final do projeto**, depois das fases planejadas (ranking, Fase 9). Até lá, nenhuma fase cria loja, assinatura, anúncio ou SDK de pagamento. O que pode entrar antes, por ser base e não monetização: o modelo de posse (`entitlements`) na Fase 6 e a telemetria e os termos na Fase 7, mesmo assim só se o usuário confirmar na hora.

**Why:** o usuário quer o jogo gratuito, mas precisa cobrir os custos de operação (estimados em US$ 40 a 100/mês).

**How to apply:** não puxar monetização para fases anteriores; ao chegar ao fim do plano, abrir a Fase 10 (loja) com o `artur-arquiteto` seguindo `docs/monetizacao.md`; nunca propor doação, banner na mesa ou item com vantagem. Ver [[projeto-trucaco]] e [[handoff-fase-5]].
