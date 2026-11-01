# AGENTS.md

Instruções para o Codex CLI neste repositório. O Claude Code usa o `CLAUDE.md`; o agente `rita-revisora` chama `codex review`, que lê este arquivo.

## Contexto do projeto

Trucaco: truco online (Paulista e Mineiro) em monorepo TypeScript. `packages/rules` é o motor de regras puro; `apps/server` é o servidor Colyseus (fonte de verdade da partida); `apps/mobile` é o cliente Expo (web, iOS, Android); `packages/avatar` cuida dos avatares Rive e dos sinais. Regras do jogo em `docs/regras-truco.md`.

## Revisão de código

Responda em português do Brasil. Revise o diff, lendo o código ao redor para entender o contexto. Confirme cada achado antes de reportar; sem certeza, marque como "possível" e descreva o cenário.

O que procurar, em ordem de prioridade:

1. **Correção**: lógica errada, off-by-one, null não tratado, condição de corrida, erro engolido, contrato público quebrado (mensagem do protocolo, schema Colyseus, rota REST, assinatura exportada).
2. **Regras do jogo**: divergência do que está em `docs/regras-truco.md` (hierarquia de cartas, manilhas, empates, mão de onze/dez, mão de ferro, valores de truco). Regra de jogo fora de `packages/rules` é achado.
3. **Segurança e anti-trapaça**: cliente recebendo carta de outro jogador, validação de ação só no cliente, entrada de chat/sinal sem validação ou rate limit, segredo exposto, autorização faltando.
4. **Testes**: lógica não trivial sem teste cobrindo a mudança.
5. **Simplicidade**: código removível, abstração sem segundo uso, duplicação do que já existe no monorepo.
6. **Padrões**: nomenclatura, organização e estilo divergentes do restante do código; TypeScript com `any` ou `as` desnecessário.
7. **Manutenção**: acoplamento excessivo entre pacotes, dependência nova sem necessidade, comentário desatualizado.

Formato: lista ordenada por gravidade, cada achado com arquivo e linha, problema em uma frase, cenário concreto de falha e correção sugerida. Termine com veredito: aprovado, aprovado com ressalvas, ou precisa de correção. Sem achados, diga isso em vez de inventar problemas.
