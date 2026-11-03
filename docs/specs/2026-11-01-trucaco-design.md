# Trucaco: especificação de design

Data: 2026-11-01. Status: aprovada no brainstorming inicial.

## 1. Objetivo

Produto público de truco online (Paulista e Mineiro) para web, iOS e Android. Mesa de 4 jogadores em dispositivos separados, cada um com avatar animado que executa **sinais de truco** visíveis a toda a mesa; chat privado da dupla no início da partida para combinar os sinais; balões de conversa na mesa durante o jogo. Mesa de 6 na fase 8.

Também fazem parte do produto: **gritos de truco com a voz de cada avatar** (masculina ou feminina, por tipo de aposta) e **efeitos sonoros engraçados** (`docs/audio.md`); **série melhor de 3 jogos** como opção da mesa (`docs/regras-truco.md`); **conquistas e missões diárias** (Fase 6) e **ranking competitivo com ligas e temporadas** (Fase 9, depois do beta) (`docs/gamificacao.md`).

Fora do escopo do MVP: mesa de 6, ranking competitivo (Fase 9), loja/monetização, chat de voz entre jogadores, variantes regionais além de Paulista e Mineiro.

## 2. Decisões de stack

| Decisão  | Escolha                                                       | Alternativas descartadas e motivo                                                                                                     |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Cliente  | React Native + Expo (web/iOS/Android), TypeScript             | PWA só (sem loja de apps); Flutter (stack fora do ecossistema JS/.NET do time); Unity (WebGL pesado, avatares 3D além da necessidade) |
| Servidor | Node + TypeScript + Colyseus                                  | Socket.IO puro (reescreveria salas, sync e reconexão); .NET SignalR (regras não compartilhariam código com o cliente)                 |
| Avatar   | Rive, rig único com partes trocáveis e state machine          | Lottie (sem state machine, customização difícil); 3D (pesado); spritesheets (muita arte manual)                                       |
| Dados    | PostgreSQL via Prisma; Redis                                  | —                                                                                                                                     |
| Auth     | Google, Apple e convidado; JWT próprio                        | E-mail/senha (atrito e responsabilidade); só convidado (sem persistência entre dispositivos)                                          |
| Infra    | GitHub (`mcdtecbr/trucaco`), GitHub Actions, Fly.io, Expo EAS | Azure DevOps + Container Apps (custo e complexidade iniciais)                                                                         |
| MVP      | Paulista e Mineiro, mesa de 4                                 | —                                                                                                                                     |

## 3. Arquitetura

Monorepo pnpm + Turborepo:

```
apps/mobile      Expo: UI, mesa, avatar Rive, chat, cliente Colyseus
apps/server      Colyseus: LobbyRoom, TrucoRoom, auth, REST, persistência
packages/rules   Motor de regras puro (sem I/O): applyAction(state, action) → state
packages/protocol Tipos, schemas e constantes compartilhados
packages/avatar  Catálogo de partes do avatar, de sinais (→ gatilhos Rive), de vozes e de efeitos sonoros
packages/ui      Componentes visuais compartilhados (cartas, mesa, placar, balões)
assets/rive      avatar.riv
assets/audio     Vozes dos avatares e efeitos (m4a) + LICENSES.md
infra            Dockerfile, fly.toml, docker-compose local
```

Dependências permitidas: `rules` e `protocol` não dependem de nada interno. `avatar` e `ui` dependem de `protocol`. `server` depende de `rules` e `protocol`. `mobile` depende de `protocol`, `avatar`, `ui` (e nunca de `rules`: o cliente não decide regra).

**Princípio**: o servidor é a única fonte de verdade. O cliente envia intenções, recebe estado filtrado e renderiza.

## 4. Motor de regras (`packages/rules`)

- Estado imutável `HandState` (mão em curso), `MatchState` (placar do jogo, pé, variante, mão especial) e `SeriesState` (jogos ganhos por dupla, formato `single` ou `bo3`, jogo corrente). Em `single`, a série tem um único jogo.
- `applyAction(state, action): Result<state, RuleError>`. Ações: `PLAY_CARD`, `PLAY_COVERED`, `CALL_BET`, `ACCEPT_BET`, `RAISE_BET`, `FOLD`, `SPECIAL_HAND_PLAY`, `SPECIAL_HAND_FOLD`.
- `Variant` parametriza o que difere entre Paulista e Mineiro (ver `docs/regras-truco.md`, seção "Parametrização"). Nada mais usa `if (variant)`.
- `seats` parametrizado (4 agora, 6 na fase 8).
- Determinismo: embaralhar recebe um RNG injetado para testes reproduzíveis.
- `legalActions(state, seat)` para o servidor validar e para o bot de desconexão escolher jogada.

## 5. Servidor (`apps/server`)

**Estado (Fase 2, concluída em 2026-11-01).** Divergências em relação ao texto original: o lobby é REST + `matchMaker` (sem `LobbyRoom`), a visão por assento usa `StateView` (sem `@filter`) e os eventos são camelCase. Detalhes em `docs/specs/2026-11-01-fase-2-servidor-plano.md` (nota no topo), contrato em `docs/protocolo-servidor.md` e operação em `apps/server/README.md`.

- **Lobby por REST (sem `LobbyRoom`)**: `POST /tables` (mesa privada, criador é o 1º assento), `POST /tables/join` (entrar por código), `POST /queue`, `GET /queue`, `POST /queue/leave` (fila pública FIFO por variante e `ironHand`; os 4 assentos são sorteados). Código de mesa com 8 caracteres do alfabeto de 31 símbolos (`ROOM_CODE_ALPHABET`). As rotas autenticam e devolvem uma **reserva de assento**, consumida pelo cliente no WebSocket. `bo3` só em mesa privada. Criar ou entrar direto por `matchmake/create|join|joinOrCreate` responde `403 USE_LOBBY`. `partnerUserId` existe em `JoinOptions`, mas nada o usa (escolha de dupla fica para depois).
- **`TrucoRoom`** (4 assentos, sala `truco`): instancia o motor e mantém o `SeriesState` em memória da sala (nunca no schema). Projeta o estado no schema (`@colyseus/schema` 5, `schema()`/`t.*`) com **visão filtrada por assento**: o bloco `privates` é `t.map(...).view()` e cada cliente recebe só o do próprio assento, via `StateView` (`client.view`, recriada a cada (re)conexão). O bloco traz as cartas próprias e `legalActions` daquele assento, para o cliente habilitar botões sem conhecer regra. `userId` NÃO vai ao schema: fica só em memória do servidor (mapa por assento). Timer de turno 20 s, reconexão e bot na seção abaixo.
- **Reconexão, bot e abandono**: `onDrop` abre `allowReconnection` de 60 s e o assento fica `away`. Expirada a janela, ou na saída consentida, o bot assume (na saída consentida, na hora) e **fica no assento até o dono voltar por um novo join com o mesmo `userId`**. A retomada passa pelo `reconnectUpgradeGuard` (JWT no upgrade) e pela checagem de token de reconexão por sessão (`checkReconnectionToken`). `voteCancel` é unânime entre humanos conectados e zera a cada mão. Se nenhum humano fica conectado por 60 s, a série é cancelada sem vencedor.
- **Sinais**: mensagem `signal { signalId }` → validação (catálogo, rate limit 1/3 s) → broadcast `signal { seat, signalId, at }` → log.
- **Eventos de jogo e efeitos**: o servidor transmite `event { seq, at, event }` com `PublicGameEvent` (nomes camelCase do motor: `gameStarted`, `handStarted`, `cardPlayed`, `trickDecided`, `betCalled`, `betAccepted`, `betRaised`, `betRun`, `specialDecided`, `handDecided`, `gameDecided`, `seriesDecided`, `seriesCancelled`), e o cliente toca a voz do avatar a partir deles (o grito sai de `betCry`). Efeitos engraçados: `sfx { sfxId }` → validação (catálogo, rate limit 1/5 s) → broadcast `sfx { seat, sfxId, at }`. Nenhum áudio trafega pela rede; só ids (`docs/audio.md`).
- **Chat**: `chat` com `scope: 'partner'` (só para a dupla) ou `scope: 'table'` (os 4). Texto até 140 caracteres, validado por `parseClientMessage` (`@trucaco/protocol`); cooldown de 2 s. Frases rápidas por id. Filtro de palavrões: NÃO implementado (moderação pendente, ver `docs/plano-desenvolvimento.md`).
- **Auth**: JWT de acesso HS256 (15 min) emitido pelo próprio servidor, validado no REST e no `onAuth` estático da sala. Refresh opaco e rotativo em Redis. Rotas reais: `POST /auth/guest`, `POST /auth/refresh`, `GET`/`PUT /me`, `PUT /me/avatar`, `GET`/`PUT /me/partners/:partnerId/codes`, `GET /health`. `POST /auth/google`, `POST /auth/apple` e `POST /auth/link` respondem `501` (stub até a Fase 3). `GET /matches` não existe como rota ainda (o repositório tem `listForUser`). Códigos e status em `docs/protocolo-servidor.md`.
- **Persistência**: Postgres via Prisma 7 com `@prisma/adapter-pg`: `users`, `avatars`, `matches`, `match_players`, `partner_codes`, `reports`, `blocks`; na Fase 6 `achievements`, `user_achievements`, `missions`, `user_missions`; na Fase 9 `seasons`, `ratings`, `rating_history` (`docs/gamificacao.md`). O `MatchRecorder` grava a partida uma vez, ao fim (terminada, cancelada ou abandonada), com `endReason` em `options`. Redis hoje: refresh tokens. Presença, fila e rate limit estão em memória por processo; o desenho com Redis (`docs/banco-de-dados.md`, seção 2) e `@colyseus/redis-driver` ficam para o deploy com mais de uma instância.

## 6. Cliente (`apps/mobile`)

- Expo Router. Telas: Entrada (login/convidado) → Início (criar/entrar/jogar) → Criador de avatar (partes e voz) → Preparação da partida (chat da dupla + catálogo de sinais) → Mesa → Resultado (placar final e conquistas desbloqueadas). Também: Perfil (estatísticas, conquistas, missões do dia) e Configurações de som.
- Estado: Zustand para UI local; estado da partida vem do `Room` do Colyseus (`room.state`), sem duplicar lógica.
- Mesa: 4 avatares em posições fixas (eu embaixo, parceiro em cima, adversários nos lados), cartas na mão, pilha da vaza, vira (Paulista), placar, botões de truco contextuais (só quando `legalActions` inclui).
- **Placar numérico em camadas**, que acompanha o desenrolar do jogo: (1) _série_, só em `bo3`, com os jogos ganhos por dupla (ex.: 1 × 0); (2) _jogo_, pontos por dupla em números grandes, de 0 a 12; (3) _mão_, o valor atual em destaque ("Vale 6"), que muda com animação a cada aumento; (4) _vazas_, 3 marcas por dupla (ganha, perde ou empata) da mão em curso. Tocar no placar abre o histórico das mãos do jogo (quem pediu truco, quem correu, pontos). O leitor de tela anuncia aumentos e fim de mão.
- Painel de efeitos (soundboard) e atalho de som na mesa; o jogador pode silenciar a voz de um adversário específico (`docs/audio.md`, seção 3).
- Painel de sinais: toque/clique e segure. Balão de chat sobre o avatar por 4 s.
- Web e mobile compartilham código; diferenças via `Platform` e componentes `.web.tsx` quando inevitável (Rive usa pacotes diferentes).

## 7. Avatar (`packages/avatar`, `assets/rive`)

- `avatar.riv` com artboard único, camadas trocáveis por input numérico/booleano: `face_shape`, `skin`, `hair`, `eyes`, `mouth`, `outfit`, `accessory`, `bg_color`. Perfil salva `AvatarParts` como JSON.
- State machine `Main`: layer `Idle` (respirar, piscar aleatório, olhar) e layer `Signals` com um trigger por sinal (`docs/sinais.md`). Sinal interrompe e volta ao idle.
- Componente `<Avatar parts signalQueue />` em `packages/ui` com implementação `.native.tsx` (`rive-react-native`) e `.web.tsx` (`@rive-app/react-canvas`).
  - **Divergência (Fase 4, 2026-11-02; ADR 0001 e 0002):** o `<Avatar>` fica em `packages/avatar`, não em `packages/ui`, porque `ui` não pode depender de `avatar` (§3). `ui` recebe o avatar como `ReactNode`. A fila de sinais fica no cliente da mesa (`tableController`), não no componente. O renderizador de produção da Fase 4 é o vetorial (`View` e `Animated`); Rive entra depois, atrás do ponto de extensão `renderer` (`.native.tsx` e `.web.tsx` ainda não existem: blocos 4G e 4H do plano, pendentes). Contrato do rig: `docs/avatar-rig.md`.
- `AvatarParts` inclui `voice` (`masc_1..3`, `fem_1..3`), que define a voz dos gritos. A voz não faz parte do rig Rive; o avatar só recebe `trig_shout` (boca aberta) quando fala.
- Arte inicial cartoon flat feita no editor Rive; evolução ou encomenda depois.

## 8. Autenticação e perfil

- Expo AuthSession (Google) e `expo-apple-authentication`. Backend valida token do provedor, cria/encontra `user`, emite JWT (15 min) + refresh (30 dias, rotativo, em Redis).
- Convidado: `POST /auth/guest` cria `user` com `provider = guest` e apelido. `POST /auth/link` troca o owner para a conta social, preservando avatar, histórico e códigos de dupla.
- Perfil: apelido único (3–16 caracteres), `AvatarParts`, estatísticas (partidas, vitórias por variante), duplas frequentes e seus códigos, conquistas e missões (Fase 6) e liga e rating (Fase 9). Ao vincular, o convidado leva conquistas e missões; convidado não entra no ranking.

## 9. Erro, abuso e resiliência

- Ações inválidas rejeitadas pelo motor com `RuleError` tipado; o servidor responde `error { code }` e não altera estado.
- Desconexão: reconexão em 60 s; bot (carta mais fraca, nunca pede truco, corre a truco) depois disso.
- Anti-trapaça: filtro de schema por assento; validação exclusiva no servidor; log de partida para auditoria.
- Moderação: denúncia na mesa (`reports`), bloqueio (`blocks`, não sorteia na mesma mesa pública), filtro de texto, rate limit em chat e sinais, banimento manual.

## 10. Testes

- `rules`: Vitest, cobertura alta; casos por variante (hierarquia, manilha fixa × vira, todos os empates, mão de onze/dez, mão de ferro, escada de apostas, quem pode aumentar).
- `server`: `@colyseus/testing` com 4 clientes simulados: mão completa, truco aceito/corrido/aumentado, reconexão, bot, sinais com rate limit, chat de parceiro não vaza.
- `rules` (série): `bo3` termina em 2 × 0 e 2 × 1, reinicia placar e rodízio do pé entre jogos, `single` equivale a um jogo.
- Áudio: todo par voz × evento tem arquivo (teste de catálogo); rate limit de `sfx`; `GameEvent` correto para as duas escadas de aposta.
- Gamificação: conquistas e missões avaliadas a partir do log de uma partida simulada; partida com bot por ausência não conta missão do ausente; rating (Fase 9) só da fila pública e de contas vinculadas.
- `mobile`/`ui`: testes de componente (cartas, balão, painel de sinais, placar em camadas, avatar com mock do Rive, player de áudio com mock).
- E2E: Playwright (web) para fluxo login convidado → sala → partida; Maestro (mobile) nos builds EAS.
- CI (GitHub Actions): lint, typecheck, test, build do server, preview web em PR.

## 11. Riscos e mitigação

| Risco                                      | Mitigação                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Arte Rive leva mais tempo que o código     | Fase 4 começa com rig simples; avatar placeholder até lá; `packages/avatar` desacopla catálogo de arte |
| Regras regionais divergentes geram disputa | `docs/regras-truco.md` é normativo; mudanças por ADR                                                   |
| Rive em RN e web usa pacotes diferentes    | Componente com `.native.tsx`/`.web.tsx` e API única                                                    |
| Latência/reconexão em mobile               | Colyseus `allowReconnection`, estado completo re-enviado ao reconectar, bot                            |
| Toxicidade no chat                         | Filtro, rate limit, denúncia, bloqueio desde o MVP                                                     |
| Licença das vozes e efeitos                | Fonte e licença em `assets/audio/LICENSES.md`; nada sem licença comercial vai para produção (Fase 7)   |
| Áudio bloqueado no navegador               | Desbloquear no primeiro toque (entrada ou "entrar na mesa"); legenda em balão sempre visível           |
| Spam de efeitos sonoros                    | Rate limit 1/5 s, silenciar efeitos e silenciar um jogador, denúncia                                   |
| Ranking manipulado (combinar resultado)    | Só fila pública e contas vinculadas, limite contra os mesmos adversários, revisão de saltos (Fase 9)   |

## 12. Áudio

Vozes dos avatares (masculinas e femininas), gritos por tipo de aposta (`truco`, `seis`, `oito`, `nove`, `dez`, `doze`), `quero`, `corro` e efeitos engraçados. O servidor só transmite ids de eventos; cada aparelho toca o próprio arquivo. Protótipo com voz sintetizada de licença comercial, versão final com vozes gravadas. Detalhes, catálogos e licenças em `docs/audio.md`.

## 13. Gamificação

Conquistas e missões diárias na Fase 6; ranking competitivo (Elo por variante, ligas, temporadas) na Fase 9, depois do beta. Calculado no servidor a partir dos eventos da partida. XP e nível não entram agora. Detalhes em `docs/gamificacao.md`.

## 14. Fases

Ver `docs/plano-desenvolvimento.md`.
