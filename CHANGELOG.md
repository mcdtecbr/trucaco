# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), agrupado por fase do plano (`docs/plano-desenvolvimento.md`). Nenhuma versão foi publicada ainda; tudo está em "Não lançado". Entradas tiradas do histórico do git (hash curto entre parênteses).

## [Não lançado]

### Avatar: ampliação do catálogo, fatia 3 (rosto) (2026-11-05), sem commit

Decisão em `docs/adr/0006-rosto-segue-as-pranchas-e-avatares-recomecam.md`. `.riv` reexportado (38,5 KB, 13 Numbers, 16 triggers), validado no runtime web; não validado em aparelho iOS/Android.

#### Alterado

- `face_shape` 6 e `eyes` 6, redesenhados pela prancha de referência (índices na ordem da prancha, sem compatibilidade com o desenho anterior); `brows` (4) e `nose` (8) são dimensões novas ao fim de `AVATAR_PART_KEYS` (13 Numbers). `PROTOCOL_VERSION` 4.
- Migração `20261105120000_avatar_rosto`: **apaga todos os avatares** (`DELETE FROM "avatars"`); o cliente usa o padrão até o jogador recriar.
- Orçamento de vértices do `art.ts` de 420 para 760 (122 paths, 725 vértices). Removido `HAIR_COLOR` (legado).

### Avatar: ampliação do catálogo, fatia 2 (bocas e línguas) (2026-11-04), sem commit final

Decisão em `docs/adr/0005-boca-5-opcoes-e-sinal-mouth-open.md`. Não validado em aparelho iOS/Android.

#### Adicionado

- `mouth` ganha a 5ª opção (lábios cheios com cantinhos); sem migração, pois o intervalo só cresce.
- Sinal `mouth_open` ("Abrir a boca", 16º de `SIGNAL_IDS`, trigger `trig_mouth_open`, 1000 ms): boca aberta com língua centrada.
- Fallback vetorial: peças da boca aberta e das línguas (75 paths, 403 vértices) e canais `mouthOpacity`, `mouthOpenOpacity`, `tongueCenterOpacity` e `tongueSideOpacity`.
- `avatar.riv` (25,8 KB) com 11 Numbers e 16 triggers: Solo da boca com 5 grupos, grupo `boca2` e timelines `sig_mouth_open` e `sig_tongue`.

#### Alterado

- Desenho das bocas 0 a 3 no estilo das pranchas de referência (o índice mantém o tipo de boca).
- Sinal `tongue` (mesmo id e trigger) passa a mostrar a língua de lado.

#### Divergências conhecidas

- No Rive faltam a transição de ida de `sig_tongue` e os movimentos de cabeça (5°) e balanço da língua que o fallback faz.

### Avatar: ampliação do catálogo, fatia 1 (cores) (2026-11-04), ainda sem commit

Decisão em `docs/adr/0004-catalogo-do-avatar-cor-separada-de-forma.md`. Não validado em aparelho iOS/Android.

#### Adicionado

- `AvatarParts` ganha `hair_color` (8), `eye_color` (3) e `outfit_color` (11, 0 = padrão do modelo), ao fim de `AVATAR_PART_KEYS`; paletas `HAIR_COLORS`, `EYE_COLORS` e `OUTFIT_COLORS` ampliada em `packages/avatar/src/parts.ts`.
- Migração de dados `20261104120000_avatar_cores` (idempotente).
- Editor de avatar com as três cores, cada uma logo depois da sua forma.
- `avatar.riv` (22,6 KB) com 11 Numbers, timelines e layers das cores.

#### Alterado

- `skin` passa de 6 para 8 opções (oliva e rosado).
- `PROTOCOL_VERSION` de 2 para 3; `parseAvatarParts` segue estrito (falta de chave recusa o avatar).
- Botão do polo `#F8FAFC` e coroa do boné `#1E2836`, para não colidir com outras cores no editor Rive.

#### Divergências conhecidas

- Pescoço, sombra do queixo e nariz foram ajustados só no Rive; `art.ts` e o fallback vetorial ainda não os têm.

### Fase 5: chat da dupla e combinado de sinais (2026-11-03), concluída com ressalvas

Ressalvas: iOS, Android, leitor de tela, Safari e Firefox não foram testados; a silenciagem nativa (`expo-secure-store`) não foi validada em aparelho; o combinado de convidado some ao sair da conta e não tem expurgo; o estado da sala continua em memória por processo. Pendências (P3 da revisão, rota de retomada da fila pública): `docs/specs/2026-11-03-fase-5-relatorio.md`. Balões de chat na mesa (4 s) já existiam desde a Fase 3 (3H3).

#### Adicionado

- `packages/protocol`: mensagens `setCode { signalId, meaning }` (cliente) e `codes { codes, by, at }` (servidor, só aos 2 assentos da dupla); `PARTNER_CODE_MAX_LENGTH` (60), `CODES_COOLDOWN_MS` (1 s), `cleanPartnerCode`; `CODE_NOT_SAVED` em `ERROR_CODES` (edd6f93).
- Servidor: `setCode` por assento com cooldown; carga de `partner_codes` quando o par humano se forma; reenvio do combinado na retomada e no `ready`; gravação do par que já jogou junto a cada edição; gravação do par novo ao fim da 1ª partida `finished` (edd6f93).
- Chat da dupla na sala de espera (a sala de espera é a "preparação"; não há fase nova nem timer) (edd6f93, c0db943).
- Cliente: painel "Combinar sinais" na espera e na mesa, com os 12 sinais, campo de até 60 caracteres e o significado tradicional só como texto de apoio; o combinado aparece sob o sinal no painel de sinais; aviso de convidado sobre o combinado (c0db943). Hoje o aviso aparece para todos os jogadores: a flag `guest` vem fixa em `true` em `TableRoomScreen.tsx`.
- Cliente: aviso na mesa quando o parceiro sinaliza e há combinado para o sinal, por 5 s (c0db943).
- Silenciar um jogador só neste aparelho (preferência local, `trucaco.muted.v1`, até 50 apelidos; bots não entram na lista) (c0db943, 278afb6).
- Testes: sala com combinado e chat da dupla (`TrucoRoom.test.ts`), `codes.int.test.ts` contra o servidor real, `codes.spec.ts` (E2E) e `mutedStore.test.ts` (edd6f93, c0db943, 296741d).

#### Alterado

- `PARTNER_CODE_MAX` do banco e da REST passou de 140 para 60 caracteres, com a mesma limpeza do chat (edd6f93, debe97b). Sem migração: não há dado em produção.
- `ready` deixou de ser ignorado: não inicia a partida, mas reenvia `codes` ao assento (edd6f93).
- Chat da dupla passou a valer na sala de espera; `signal` e `sfx` continuam só em `playing` (edd6f93).

#### Corrigido

- `ready` não consome mais o limite de 150 ms das ações; tem limite próprio de 500 ms (738b363).
- O combinado não é apagado quando a leitura do banco falha; a sala não grava nesse par e avisa com `CODE_NOT_SAVED` (278afb6, debe97b).
- Salvar o combinado não envia duas vezes o mesmo texto; bots não aparecem na lista de silenciados (278afb6).
- A limpeza do combinado também vale na REST, a gravação em voo é coalescida (no máximo uma por par) e o aviso `CODE_NOT_SAVED` aparece no cliente (debe97b).

### Fase 4: avatar e sinais (2026-11-02), concluída com ressalvas

Ressalvas: o `.riv` não existe, então Rive web (4G) e nativo (4H) estão pendentes e o avatar de produção é o vetorial; iOS, Android e aparelho intermediário não foram testados. Relatório em `docs/specs/2026-11-02-fase-4-relatorio.md`; decisões em `docs/adr/0001-avatar-em-packages-avatar.md` e `docs/adr/0002-avatar-vetorial-como-producao-e-rive-como-extensao.md`.

#### Adicionado

- `AvatarParts` em `packages/protocol` (`avatar.ts`): 8 partes com contagens fixas (4, 6, 8, 4, 4, 6, 5, 8), `voice` reservado para a 5b, `parseAvatarParts` e `DEFAULT_AVATAR_PARTS` (63f861c).
- Servidor valida `PUT /me/avatar` pelo catálogo: texto livre ou chave extra vira `400 INVALID_AVATAR` (63f861c).
- `packages/avatar`: catálogo de sinais (`SIGNALS`, `SIGNAL_TRIGGERS`), nomes das variantes, contrato do rig (`RIVE_CONTRACT`) e `docs/avatar-rig.md` (ef53540).
- `<Avatar>` vetorial (`View` e `Animated`) com os 12 sinais, respiração e piscada; `reduceMotion` troca a animação por um destaque de 1 s (ef53540).
- Sinais na mesa: painel com 12 botões (segurar 400 ms), fila de 1 por assento, anúncio para leitor de tela, avatares nos quatro assentos e na sala de espera (d24a5bd).
- Criador de avatar em `/avatar`, com link em Início e Configurações; o avatar salvo volta depois do reload (d24a5bd).
- Script de medição de FPS com 4 avatares, fora da suíte (e3eea18).

#### Alterado

- `PUT /me/avatar` deixa de aceitar texto livre (até 140 caracteres) e passa a exigir o catálogo. `GET /me` devolve `null` para avatar gravado fora do catálogo. Sem migração: não há produção (63f861c).
- Bots que sinalizam: o código está no servidor, mas nenhum caminho cria vaga de bot hoje (63f861c, corrigido em 948f3d5).

#### Corrigido

- Bot de ausência não sinaliza; só bot de vaga pode (948f3d5).
- Avatares saem da árvore de acessibilidade, para o leitor de tela não repetir "Avatar" quatro vezes (948f3d5).
- Teste do bot de ausência (onze/dez) espera por condição (`until`) o patch de `specialAccepted` no cliente antes de conferir, em vez de checar logo após o evento (08a7705).

### Regras de aposta e onze/dez (2026-11-02)

#### Alterado

- Aposta pendente é respondida por um só jogador: no truco, o adversário que joga logo depois de quem pediu; nos aumentos, quem fez o pedido anterior. O parceiro e o pedinte ficam sem ação (3968e85).
- Mão de onze/dez sem mão de ferro: os dois da dupla veem as cartas um do outro e decidem; para jogar os dois aceitam, se um corre a dupla corre (3968e85).
- Servidor e protocolo (aditivo, `PROTOCOL_VERSION` segue 2): `pending.responderSeat`, `hand.specialAccepted`, `actingSeat = -1` na decisão de onze/dez; timeout e bot de ausência atuam pelos decisores pendentes (e7b3d39, 3570a35).
- Cliente: botões só para quem decide e textos "Seu parceiro responde", "Aguardando resposta de …", "Você e seu parceiro decidem", "Aguardando o parceiro" (222d633).

### Infraestrutura (2026-11-02)

#### Corrigido

- `infra/Dockerfile.server` instala o pnpm com `npm install -g pnpm@9.15.9`, em vez de `corepack prepare`, que falhava no `node:22.12.0` por causa das chaves de assinatura do npm. Build testado com Docker Desktop 29.9.2: imagem de cerca de 616 MB, `GET /health` 200 e healthcheck `healthy`. Hash do commit a registrar.

### Fase 3: cliente jogável (2026-11-02), concluída com ressalvas

Ressalvas e o que não foi validado: `docs/plano-desenvolvimento.md` (Fase 3) e `docs/specs/2026-11-02-fase-3-relatorio.md`.

#### Adicionado

- Contrato HTTP e snapshot de estado em `packages/protocol`: códigos HTTP, respostas REST, `TableStateSnapshot` e `parseLegalAction` (4eb871e).
- `POST /auth/logout` e teste do handshake com `trucaco.bearer`; `TRUCO_SEED` só em development e test (32dd67e).
- Esqueleto Expo SDK 58 com Expo Router, Metro no monorepo e export web estático (a533cd8, bc17f60).
- Camada de rede do app: REST com refresh em fila única e lock entre abas, `TokenStorage` (SecureStore no nativo, `localStorage` no web) e cliente Colyseus que envia o JWT em `Sec-WebSocket-Protocol` (63c15fb).
- Telas de entrada, início (criar mesa privada `single`/`bo3`, entrar por código, fila pública), sala de espera e configurações, com Zustand (613ccb6).
- `packages/ui`: tokens, carta, leque, vira, placar em camadas, botões de aposta, timer de turno, chat, avatar placeholder e anúncios para leitor de tela (9370620, 8bed41d).
- Servidor publica no estado `hand.manilhaRank`, `manilhaCards`, `nextBetValue` e `pendingValue` (8bed41d) e `hand.actingSeat` (7cbe481).
- Mesa jogável: projeção pura do estado, ação enviada só se estiver em `legalActions`, offset de relógio e reconexão visível (c7a3d3a, 7cbe481).
- Mesa completa: mão de ferro às cegas, mão de onze/dez com carta do parceiro, carta coberta, histórico das mãos, fim de partida e de série, voto de cancelar e chat de texto (d5f71c1).
- Balão de chat sobre o avatar (4 s), chat na sala de espera e testes de interação (9779e86).
- Revanche "Jogar de novo": `voteRematch`, `rematchVotes`, `rematchDeadlineAt`, `matchNumber` e erro `REMATCH_NOT_AVAILABLE` (b6bd137); botão e reset da partida no cliente (f09565e).
- E2E web com Playwright: 5 cenários, cada um com 4 contextos de navegador, contra o servidor compilado (dd8ab6e).
- Job `e2e-web` no CI, com o relatório e o build web como artefatos (dd8ab6e).

#### Alterado

- Rodízio do pé na revanche: o pé segue o assento seguinte ao pé da última mão. Confirmado pelo usuário em 2026-11-02 (b6bd137), assim como o rodízio entre jogos da série `bo3`, que o motor já fazia.
- Os códigos `ROOM_NOT_FOUND` e `TOKEN_EXPIRED` ficam no `ErrorCode` como reservados ao cliente, documentados em 4eb871e. O servidor não os emite pelo WebSocket.

#### Corrigido

- Logout revoga o `lastJti`, e o guard recusa `Sec-WebSocket-Protocol` cujo primeiro item não é `trucaco.bearer` (70c6bb9).
- Rodadas de correção da camada de rede (4025331), das telas de entrada e lobby (de11e9d), e dos componentes e anúncios (ab04426).
- Revisão do 3H1 aplicada no 3H2: a dupla que decide em aposta pendente e em decisão de onze/dez passa a usar `actingSeat` e legalActions (texto "Sua dupla decide"), e o diálogo de saída da mesa tem `accessibilityViewIsModal` (verificado no código; o comportamento com leitor de tela não foi testado).

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
- **Janela de revanche de 30 s, mínimo de 2 humanos conectados e unanimidade** (Fase 3): implementados no `packages/protocol` e no servidor e **confirmados pelo usuário** em 2026-11-02, junto com o rodízio do pé na revanche e entre jogos da série `bo3`.
- **Limite de 150 ms aplicado também a `voteRematch`** (Fase 3): pendência de produto, a decidir.
- **`ROOM_NOT_FOUND` e `TOKEN_EXPIRED` reservados ao cliente** (Fase 3).
- **Avatar vetorial como produção até existir o `.riv`; Rive web (4G) depois** (Fase 4): decisão do usuário em 2026-11-02. Rive nativo (4H) segue sem decisão formal.
- **Sinal de bot só para bot de vaga, que hoje não existe** (Fase 4): o bot de ausência não sinaliza (confirmado pelo usuário em 2026-11-02). Decidir se o servidor cria vagas de bot.
