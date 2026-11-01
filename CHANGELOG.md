# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), agrupado por fase do plano (`docs/plano-desenvolvimento.md`). Nenhuma versão foi publicada ainda; tudo está em "Não lançado". Entradas tiradas do histórico do git (hash curto entre parênteses).

## [Não lançado]

### Fase 2: servidor Colyseus (2026-11-01)

#### Adicionado

- Contrato cliente↔servidor em `packages/protocol`: mensagens, `ErrorCode`, opções de sala, catálogos de sinais, efeitos e frases (43d025e, 8a24d82).
- Runtime do servidor: Colyseus 0.18 com `GET /health`, build com `tsup` e Dockerfile de produção (5a5557f).
- Schema da mesa com visão por assento (`StateView`) e motor integrado à sala `truco`, com timer de turno de 20 s (6404393, afac910).
- Schema Prisma e migração inicial: `users`, `avatars`, `matches`, `match_players`, `partner_codes`, `reports`, `blocks`, com política de apelido e tetos de JSON (3713517).
- Reconexão de 60 s, bot de ausência e voto de cancelamento (05b9652).
- Sinais, efeitos sonoros e chat da dupla e da mesa, com cooldown por assento (8fb6238).
- Autenticação: convidado, JWT HS256 de 15 min, refresh rotativo em Redis com detecção de reuso, `/me` e códigos de dupla (ad09e87).
- Lobby por REST: mesas privadas por código, fila pública FIFO e reserva de assento; gravação da partida em `matches` (9d37537).
- CI com Postgres 16 e Redis 7.4 para os testes de integração (b1b0031).
- Documentação do contrato em `docs/protocolo-servidor.md`.

#### Alterado

- Código de sala com 8 caracteres e alfabeto de 31 símbolos, em vez de 6 (8a24d82). Decisão do usuário após a auditoria.
- Eventos públicos em camelCase, iguais aos do motor (43d025e).
- Lobby por REST e `matchMaker`, sem `LobbyRoom`. Criar ou entrar em mesa direto pelo matchmaker responde `403 USE_LOBBY` (9d37537).
- `userId` fora do estado compartilhado da mesa (6404393).

#### Corrigido

- Revisões de segurança e de estado do servidor: auth antes do `onCreate`, corrida no início da mesa e limite por IP (475dbcb); paridade de ids, erros sem dados, apelido e limites (d013abc); reconexão (c856d68); chat recusado não expulsa e destinatário por time (3ad8405); auth e REST (925c153); lobby e fila (9f45670).

### Fase 1: motor de regras (2026-11-01)

#### Adicionado

- Cartas, baralho e `Variant` de Paulista e Mineiro, com hierarquia e manilhas (e4378ac).
- Vazas, empates, escada de apostas, mão de onze/dez e mão de ferro (e4378ac).
- Partida, placar, rotação do pé, fim de jogo em 12 e série `single` e `bo3` (f79d861).
- `GameEvent` emitido a cada transição, `legalActions` e bot mínimo (f79d861).
- Mão de ferro opcional (`ironHand`, padrão ligada) e carta às cegas visível a toda a mesa quando jogada (1fb88e3). Decisão do usuário.

#### Alterado

- Mão de dez no Mineiro: o limiar é exatamente 10 pontos. Com 11 não há mão especial (10bbac8). Decisão do usuário.
- Bot não pede nem aumenta aposta; a decisão de pedir é sempre humana (10bbac8). Decisão do usuário.

#### Corrigido

- Aumentar a aposta equivale a aceitar o pedido anterior (59a4792).

#### Testes

- Casos de borda e cobertura de 99% das linhas do motor (95847d7).

### Fase 0: fundação (2026-11-01)

#### Adicionado

- Monorepo pnpm com Turborepo, TypeScript estrito, ESLint, Prettier e Vitest (e16fa23).
- Esqueleto dos pacotes `protocol`, `rules`, `avatar`, `ui`, `apps/server` e `apps/mobile` (e16fa23).
- Docker Compose local com Postgres e Redis (e16fa23).
- GitHub Actions com lint, typecheck, test e build (e16fa23).
- Documentação inicial: spec, plano, regras, sinais, áudio, gamificação e agentes (61d9203, 658271e).
- Mescladas na `develop` pelos PRs #1 e #2 (488805a, 4b70ca5).

### Decisões a confirmar

Assumidas por padrão nas fases acima. Cada uma precisa de confirmação do usuário antes do beta.

- **Voto de cancelamento unânime** entre humanos conectados, zerado a cada mão (Fase 2).
- **Ban por sala em memória** (`bannedUsers`): quem é expulso por abuso não volta àquela mesa, mas o ban se perde quando a sala fecha (Fase 2).
- **ZWJ rejeitado no chat**: emoji com ZWJ é recusado com `CHAT_BLOCKED` (Fase 2).
- **Cooldown de reentrada na fila de 60 s** para quem casa e não senta ou desiste (Fase 2).
- **Janela de graça do refresh de 20 s** (`REFRESH_REUSE_GRACE_SECONDS`), usada uma vez por token (Fase 2).
- **Subprotocolo `trucaco.bearer`** para o JWT no WebSocket do navegador (Fase 2).
- **Rodízio do pé entre os jogos da série** (Fase 1): o pé do jogo seguinte é o assento seguinte ao que deu a última mão do anterior. Não confirmado.
