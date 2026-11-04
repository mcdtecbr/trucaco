# Monetização: como manter o Trucaço gratuito e no ar

Fonte para as decisões de receita do jogo. Escrito em 2026-11-04 como proposta; as decisões marcadas **a confirmar** ficam com o usuário. Os valores de preço e de custo são estimativas de partida, para calibrar no beta (Fase 7).

## 1. Princípios

1. **Jogar é de graça e completo.** Paulista, Mineiro, mesa privada, série `bo3`, fila pública, ranking, chat da dupla, sinais e conquistas: tudo aberto a quem não paga. Nada de "energia", "vidas", limite de partidas por dia ou espera para jogar de novo.
2. **Nada que se compra muda o jogo.** Nenhum item altera cartas, sorteio, informação sobre a mão alheia, tempo de jogada ou pareamento. Sinal continua público na mesa. Quem paga só aparece diferente, nunca joga com vantagem. Isso protege o ranking (Fase 9) e a confiança no servidor como fonte única de verdade.
3. **O servidor decide o que o jogador tem.** Toda posse (item, assinatura, anúncio assistido) nasce de um recibo validado no servidor, nunca de mensagem do cliente. Vale a mesma regra das conquistas em `docs/gamificacao.md`.
4. **Sem dinheiro real na mesa.** Não há aposta, ficha trocável por dinheiro, torneio pago com prêmio em dinheiro nem "moeda" que saia do jogo. Isso tira o produto da área de jogos de azar e das regras de apostas, e evita problema com as lojas.
5. **Sem caixa de recompensa aleatória** (loot box, pacote surpresa, roleta paga). O jogador vê o que compra. Simplifica o que as lojas e a legislação brasileira de jogos eletrônicos e de consumo cobram, e evita a discussão com menores de idade.
6. **Anúncio nunca aparece na mesa nem interrompe uma mão.** Se houver anúncio, ele aparece entre partidas, por escolha do jogador (recompensado) ou como banner discreto nas telas fora da mesa. Jamais durante a vaza, a aposta ou a decisão de onze/dez.
7. **Pagar deve ser gesto de apoio, não alívio de incômodo.** O jogo livre precisa ser bom o bastante para a pessoa querer ficar; o que se vende é identidade, expressão e conveniência.

## 2. O que o jogo gasta

Estimativa da operação mínima, antes de escala (um processo do servidor, bancos gerenciados pequenos). Conferir os preços reais no deploy da Fase 7.

| Item                                          | Custo estimado   | Observação                                                     |
| --------------------------------------------- | ---------------- | -------------------------------------------------------------- |
| Fly.io, servidor Colyseus (1 máquina)         | US$ 5 a 15/mês   | Uma sala vive num processo; mais de uma máquina exige Redis    |
| Postgres gerenciado (pequeno)                 | US$ 0 a 20/mês   | Depende de plano gratuito ou não                               |
| Redis gerenciado (pequeno)                    | US$ 0 a 10/mês   | Precisa `noeviction` + AOF (ver handoff da Fase 5)             |
| Rive Cadet (editor do avatar)                 | US$ 17/mês       | Assinado em 2026-11-03; pode cair para anual (US$ 108)         |
| Apple Developer Program                       | US$ 99/ano       | Obrigatório para iOS                                           |
| Google Play Console                           | US$ 25 uma vez   |                                                                |
| Expo EAS                                      | US$ 0 a 19/mês   | Plano gratuito tem cota de builds; o pago se a cota não bastar |
| Domínio, e-mail transacional, observabilidade | US$ 5 a 20/mês   |                                                                |
| Vozes gravadas (Fase 7) e efeitos licenciados | Pontual, a orçar | Ver `docs/audio.md`, seção 5                                   |

Ordem de grandeza: **US$ 40 a 100 por mês** (R$ 250 a 600) com poucos jogadores. Dobra ou triplica com algumas centenas de jogadores simultâneos (mais máquinas, banco maior). A meta de receita do primeiro ano é só cobrir isso; lucro é objetivo de longo prazo, se vier.

## 3. Fontes de receita, avaliadas

| Fonte                                       | Encaixe no Trucaço                                                      | Receita esperada | Esforço | Risco à experiência | Recomendação                            |
| ------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | ------- | ------------------- | --------------------------------------- |
| Cosméticos do avatar, vozes e soundboard    | Alto: catálogo Rive e vozes já existem; conquistas já propõem cosmético | Média            | Médio   | Nenhum              | **Base do modelo**                      |
| Cosméticos da mesa (verso de carta, feltro) | Alto: visível aos 4 da mesa, o mais "mostrável"                         | Média            | Baixo   | Nenhum              | **Sim**, junto dos de avatar            |
| Assinatura "Trucaço Plus"                   | Bom: receita previsível, remove anúncios, item do mês                   | Média            | Médio   | Baixo               | **Sim**, depois da loja                 |
| Anúncio recompensado (opt-in)               | Bom: o jogador escolhe assistir para ganhar item ou moeda do jogo       | Baixa a média    | Médio   | Baixo               | **Sim**, com validação no servidor      |
| Anúncio intersticial entre partidas         | Comum nos trucos do mercado, mas irrita e derruba retenção              | Média            | Baixo   | Médio               | **Só se a receita faltar**, a confirmar |
| Banner discreto fora da mesa                | Lobby, perfil, loja; nunca na mesa; some para quem tem Plus             | Baixa            | Baixo   | Baixo               | **Sim**, discreto e fora da mesa        |
| Passe de temporada (cosmético)              | Bom com as temporadas mensais do ranking (Fase 9)                       | Média            | Alto    | Baixo               | **Sim**, na Fase 9                      |
| Torneios pagos com prêmio                   | Vira aposta; regulação e lojas                                          | ?                | Alto    | Alto                | **Não**                                 |
| Vender vantagem (dica, ver carta, tempo)    | Quebra o princípio 2 e o ranking                                        | Alta no curto    | Baixo   | Fatal               | **Nunca**                               |
| Venda de dados dos jogadores                | Incompatível com LGPD e com a confiança                                 | ?                | ?       | Fatal               | **Nunca**                               |

### 3.1 Cosméticos (produto principal)

O que o jogo já tem ou já planeja, só falta "trancar" parte e vender ou dar:

- **Avatar**: partes do catálogo (`packages/avatar/src/parts.ts`). Hoje tudo está liberado. Proposta: a maior parte continua livre; entram **conjuntos temáticos novos** (chapéus e roupas de festa junina, de carnaval, de torcida; itens de temporada) como pagos ou como recompensa.
- **Vozes** (`AvatarParts.voice`, Fase 5b): 2 vozes de cada gênero livres, as outras compradas ou ganhas. Vozes "de personagem" (caipira, narrador, robô) só na loja.
- **Soundboard**: pacotes de efeitos engraçados (`docs/audio.md`, seção 3). O jogador compra o pacote e toda a mesa ouve.
- **Mesa**: verso de carta, cor do feltro, moldura do avatar, animação de vitória. Novos no catálogo: entram em `packages/protocol` como `TableCosmetics` com validação igual à de `AvatarParts`.
- **Sinais**: não vender sinais (são mecânica). Vender, no máximo, **variações estéticas** da mesma animação, e só se o `.riv` comportar sem explodir a state machine.

Preços de partida (a confirmar): item avulso R$ 3,90 a 9,90; pacote temático R$ 14,90 a 24,90. Preço em real na Play Store e App Store com os patamares que as lojas permitem.

### 3.2 Trucaço Plus (assinatura)

**Decidido pelo usuário em 2026-11-04: o Trucaço Plus entra, a R$ 9,90 por mês.** O preço anual (proposta: R$ 79,90) e o que exatamente entra no pacote seguem a confirmar. Inclui:

- Sem anúncios de nenhum tipo.
- Um item cosmético novo por mês (fica para sempre, mesmo cancelando).
- Estatísticas completas no Perfil (por parceiro, por variante, histórico ilimitado) e histórico de partidas sem limite de tempo. **Isso não é vantagem de jogo**: é leitura do passado.
- Mesa privada com opções extras de personalização (nome da mesa, feltro).
- Selo de apoiador no perfil e na mesa (discreto, pode esconder).

Não inclui: fila prioritária, pareamento diferente, qualquer coisa que afete partida ou ranking.

### 3.3 Anúncios

Ordem de preferência:

1. **Recompensado, por escolha do jogador**: "assista a um vídeo e ganhe X" (um item temporário, progresso numa missão, uma moeda do jogo). Fica fora da mesa, numa tela de loja ou de resultado. Precisa de **verificação no servidor** (server-side verification da rede de anúncios); o cliente nunca avisa "assisti" por conta própria.
2. **Intersticial entre partidas**, no máximo 1 a cada N partidas e nunca para quem tem Plus. **A confirmar**: ligar desde o início ou só se a receita de cosméticos não cobrir o custo.
3. **Banner fora da mesa**, sempre discreto: tamanho padrão pequeno, na borda da tela do lobby, do perfil ou da loja, sem cobrir botão nem conteúdo, sem animação chamativa, e nunca em tela cheia. Some para quem tem Plus.
4. **Na mesa, nada**: nem banner, nem intersticial, nem recompensado. Decisão do usuário em 2026-11-04.

Rede: no iOS e Android, AdMob (ou mediador como AppLovin) via SDK nativo com Expo (exige dev build, não roda no Expo Go: mais um motivo para o dev build da Fase 7). No web, AdSense ou outra rede, com rendimento menor. Exige banner de consentimento (CMP compatível com LGPD) e, no iOS, o pedido de rastreamento (ATT). Sem consentimento, anúncio não personalizado.

### 3.4 Moeda do jogo (opcional, a confirmar)

Uma moeda interna ("fichas de truco") ganha por missões, conquistas e anúncio recompensado, e também comprável, serviria para comprar cosméticos. Vantagens: um só catálogo de preços, o jogador grátis chega a tudo com tempo. Desvantagens: precisa de contabilidade no servidor, pacotes de moeda, regras de reembolso, e o Brasil e as lojas exigem clareza no preço real do item. Proposta: **começar sem moeda**, com item comprado em dinheiro ou ganho por conquista. Reavaliar na Fase 9 com o passe de temporada.

## 4. Como entra no plano de desenvolvimento

**Decisão do usuário (2026-11-04): a monetização é implantada no final do projeto**, depois das fases já planejadas. Nada disso entra antes de o jogo estar publicado e com gente jogando. A ordem proposta:

| Quando                                      | Entrega                                                                                                                                                                                                       | Agentes                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Fase 6 (contas)                             | Modelo de **posse** no banco (`entitlements`: usuário, item, origem, validade) e catálogo com `locked`/`source`. Conquistas e missões passam a liberar itens. `PUT /me/avatar` valida posse além do catálogo. | `dalva-dba`, `caio-colyseus`, `fabio-frontend`                                                                             |
| Fase 7 (beta)                               | Telemetria de retenção e partidas por jogador; termos de uso e política de privacidade com a seção de compras e anúncios.                                                                                     | `fabio-frontend`, `teo-docs`, usuário                                                                                      |
| **Fase 10: loja** (nova, depois do ranking) | Compra na loja: iOS e Android por compra interna (IAP), web por Pix e cartão (Mercado Pago ou Stripe). Validação do recibo no servidor; webhook de assinatura. Trucaço Plus. Cosméticos da mesa.              | `artur-arquiteto` (plano), `caio-colyseus`, `fabio-frontend`, `rai-avatar`, `dalva-dba`, `vitor-seguranca`, `diego-devops` |
| Fase 10b (se preciso)                       | Anúncio recompensado com verificação no servidor; intersticial entre partidas se a receita não cobrir o custo.                                                                                                | `fabio-frontend`, `caio-colyseus`, `vitor-seguranca`                                                                       |
| Fase 9 ou 11                                | Passe de temporada cosmético (trilha grátis e trilha paga), ligado às temporadas do ranking.                                                                                                                  | `caio-colyseus`, `fabio-frontend`                                                                                          |

Por que a loja vem depois do ranking: cosmético vende quando há quem veja (fila pública cheia, Fase 8) e motivo para voltar (temporada, Fase 9). Vender antes disso gasta esforço sem público.

### 4.1 Impacto na arquitetura

- **`packages/protocol`**: tipos `Entitlement`, `StoreItem`, `TableCosmetics`; `PROTOCOL_VERSION` sobe. Erros novos: `ITEM_NOT_OWNED`, `RECEIPT_INVALID`, `SUBSCRIPTION_EXPIRED`.
- **Servidor**: rotas `GET /store`, `POST /store/receipt` (iOS/Android), webhook do provedor web, `GET /me/entitlements`. Recibos validados contra a Apple, o Google e o provedor web no servidor; nunca confiar no cliente. Posse cacheada na sala ao sentar (mesma projeção por assento). Alternativa para reduzir código: um serviço de assinaturas multiplataforma (RevenueCat ou similar) que unifica os recibos; tem plano gratuito até certo faturamento. Decidir no plano da Fase 10.
- **Banco**: `entitlements`, `purchases` (id do recibo, loja, valor, moeda, estado, reembolso), `subscriptions`. Reembolso ou chargeback revoga a posse.
- **Cliente**: tela Loja; compra interna via `expo-in-app-purchases` ou `react-native-iap` (exige dev build); web via checkout do provedor em nova aba. Nunca HTML de terceiros dentro da mesa.
- **Avatar e áudio**: catálogo ganha `source: 'free' | 'achievement' | 'store' | 'plus' | 'season'`. O `.riv` não muda por item pago: item pago é combinação ou peça nova do mesmo rig.
- **Segurança (`vitor-seguranca`)**: validação de recibo, replay de recibo, posse na projeção da mesa (um jogador não pode exibir item que não tem), rate limit das rotas de loja, segredos dos provedores, LGPD no consentimento de anúncio.

## 5. O que medir no beta antes de vender

Sem esses números, qualquer preço é chute:

| Métrica                             | Para quê                                                |
| ----------------------------------- | ------------------------------------------------------- |
| DAU, WAU, retenção D1/D7/D30        | Base do que qualquer fonte pode render                  |
| Partidas por jogador por dia        | Quantos intersticiais caberiam sem incomodar            |
| Uso do criador de avatar e do sinal | Se a pessoa se importa com aparência (prediz cosmético) |
| Partidas com os mesmos parceiros    | Duplas fixas são quem mais compra identidade            |
| Custo de infraestrutura por DAU     | O que a receita por jogador precisa cobrir              |

Metas de referência do mercado de jogos casuais, para comparação e não como promessa: conversão de 1 a 3% dos ativos em compra; ARPDAU (receita diária por ativo) de alguns centavos de real com anúncio; assinatura entre 0,5 e 2% dos ativos mensais. Com esses números, o custo de US$ 40 a 100 por mês se cobre com algumas centenas de jogadores ativos por dia.

## 6. Regras externas a cumprir

- **Lojas**: bem digital usado dentro do app passa pela compra interna da Apple e do Google (comissão de 30%, ou 15% nos programas para pequenos desenvolvedores, que valem a inscrição). No web não há comissão de loja; Pix e cartão custam a taxa do provedor. Não apontar, de dentro do app iOS, para a compra no web: as regras sobre isso mudam por país e não vale o risco de rejeição.
- **LGPD**: consentimento para anúncio personalizado; política de privacidade dizendo o que a rede de anúncios recebe; direito de apagar a conta com as compras registradas pelo prazo fiscal.
- **Consumidor (Brasil)**: preço total em real antes de confirmar, direito de arrependimento em 7 dias na compra feita pela internet (o web precisa de rota de reembolso; nas lojas, elas cuidam), assinatura com cancelamento tão fácil quanto a adesão.
- **Classificação indicativa**: truco com cosmético, sem dinheiro real, deve ficar em classificação livre ou 10 anos. Anúncio e compra dentro do app entram na ficha das lojas. Confirmar na Fase 7.
- **Menores**: sem anúncio personalizado nem compra sem o controle parental das lojas; nunca pedir idade só para liberar algo.
- **Nota fiscal**: venda no web pelo CNPJ (MCD Tec) exige emissão; os provedores de pagamento não emitem. Nas lojas, a Apple e o Google são o vendedor de registro.

## 7. Decisões

**Decididas em 2026-11-04**: sem doação; anúncio nunca na mesa e banner sempre discreto onde estiver; **Trucaço Plus a R$ 9,90 por mês**.

A confirmar:

1. **Modelo base**: cosméticos + Plus (decidido), com anúncio só recompensado e banner discreto (proposta). Ou incluir intersticial entre partidas desde o início.
2. **Itens trancados**: quais partes do catálogo atual do avatar ficam pagas, se alguma. Proposta: nenhuma das atuais; só conjuntos novos.
3. **Recompensas de conquistas e missões** são cosméticos (pendência de `docs/gamificacao.md`). Esta proposta assume que sim.
4. **Moeda do jogo**: começar sem (proposta) ou já com.
5. **Preços** dos cosméticos (seção 3.1) e do Plus anual (seção 3.2). O Plus mensal já está decidido: R$ 9,90.
6. **Provedor de pagamento no web**: Mercado Pago (Pix nativo, conhecido no Brasil) ou Stripe (melhor API, Pix via parceiro). E se usar um unificador de recibos (RevenueCat ou similar) para iOS e Android.
7. **Onde o banner discreto pode aparecer** (lobby, perfil, loja) e se entra desde o início ou só com o intersticial.
8. **Fase 10** entra no `docs/plano-desenvolvimento.md` depois da Fase 9, ou antes dela, se a fila pública da Fase 8 já trouxer público suficiente.
