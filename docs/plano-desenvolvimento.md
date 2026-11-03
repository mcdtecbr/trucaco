# Plano de desenvolvimento

Fases ordenadas; cada uma termina com critério de pronto verificável e revisão da `rita-revisora`. Estimativas em semanas de trabalho de uma pessoa orquestrando agentes. Cada fase vira um ou mais branches `feature/*` com PR para `develop`.

Documentos de apoio por tema: `docs/regras-truco.md` (regras e série), `docs/sinais.md`, `docs/audio.md` (vozes e efeitos), `docs/gamificacao.md` (conquistas, missões, ranking).

## Fase 0: fundação (1 semana)

| Etapa                                                                                   | Agente                                       | Pronto quando                                                                |
| --------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| Monorepo pnpm + Turborepo, TS estrito, ESLint/Prettier, Vitest                          | `diego-devops`                               | `pnpm lint && pnpm typecheck && pnpm test` passam na raiz com pacotes vazios |
| Esqueleto de `packages/protocol`, `rules`, `avatar`, `ui`, `apps/server`, `apps/mobile` | `artur-arquiteto` (desenho) → `diego-devops` | Cada pacote builda e tem um teste trivial                                    |
| Docker Compose local: Postgres + Redis                                                  | `diego-devops`                               | `docker compose up` sobe e `server` conecta                                  |
| GitHub Actions: lint, typecheck, test, build em PR                                      | `diego-devops`                               | Pipeline verde em PR de exemplo                                              |
| README e `apps/server/README.md` com setup em 5 minutos                                 | `teo-docs`                                   | Alguém novo roda local seguindo o doc                                        |

## Fase 1: motor de regras (2 semanas)

| Etapa                                                                                                             | Agente         | Pronto quando                                                  |
| ----------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| Tipos de carta, baralho, `Variant` Paulista e Mineiro em `protocol`/`rules`                                       | `tales-regras` | Hierarquia e manilhas testadas por variante                    |
| `HandState`, vazas, empates, vencedor da mão                                                                      | `tales-regras` | Todos os cenários de empate de `docs/regras-truco.md` cobertos |
| Escada de apostas: pedir, aceitar, correr, aumentar, quem pode aumentar                                           | `tales-regras` | Testes para ambas as escadas                                   |
| Mão de onze/dez e mão de ferro                                                                                    | `tales-regras` | Testes incluindo decisão de jogar/correr                       |
| `MatchState`, placar, rotação de pé, fim de jogo em 12                                                            | `tales-regras` | Partida completa simulada com RNG fixo                         |
| `SeriesState` e `SeriesConfig` (`single` e `bo3`): fim em 2 × 0 ou 2 × 1, reinício de placar e continuidade do pé | `tales-regras` | Série simulada nos dois formatos; `single` equivale a um jogo  |
| `GameEvent` emitido a cada transição (aposta, vaza, mão, jogo, série), com tipo em `protocol`                     | `tales-regras` | Teste: partida simulada produz a sequência de eventos esperada |
| `legalActions` e bot mínimo (carta mais fraca, corre a truco)                                                     | `tales-regras` | Bot termina 1000 partidas simuladas sem ação ilegal            |
| Revisão de cobertura e casos de borda                                                                             | `catia-qa`     | Cobertura ≥ 90% em `rules`                                     |

## Fase 2: servidor Colyseus (2–3 semanas): concluída em 2026-11-01, com ressalvas

Divergências do plano original (sem `LobbyRoom`, JWT HS256, código de 8 caracteres, Rita-C na revisão) estão na nota no topo de `docs/specs/2026-11-01-fase-2-servidor-plano.md`. Contrato em `docs/protocolo-servidor.md`; operação em `apps/server/README.md`.

| Etapa                                                                                                                 | Agente                              | Pronto quando                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Schema Prisma: `users`, `avatars`, `matches`, `match_players`, `partner_codes`, `reports`, `blocks`; migração inicial | `dalva-dba`                         | `prisma migrate dev` aplica em local limpo                          |
| `protocol`: mensagens cliente→servidor e servidor→cliente, schema Colyseus da mesa                                    | `artur-arquiteto` → `caio-colyseus` | Tipos compartilhados compilam nos dois lados                        |
| `TrucoRoom`: integra motor, filtro por assento, timer de turno                                                        | `caio-colyseus`                     | 4 clientes de teste jogam uma mão completa                          |
| Série: `TrucoRoom` executa `single` e `bo3`; `LobbyRoom` oferece o formato ao criar a mesa privada                    | `caio-colyseus`                     | Teste: série `bo3` até o fim com 4 clientes                         |
| Transmissão de `GameEvent` a todos e registro do log de eventos da partida em `matches`                               | `caio-colyseus` + `dalva-dba`       | Teste: cliente recebe os eventos de uma mão; log completo gravado   |
| Reconexão e bot de ausência                                                                                           | `caio-colyseus`                     | Teste: cliente cai, reconecta em 60 s e continua; expira e bot joga |
| `LobbyRoom`: criar/entrar por código, fila pública FIFO, parcerias                                                    | `caio-colyseus`                     | Testes de sala                                                      |
| Sinais: validação, rate limit, broadcast, log                                                                         | `caio-colyseus`                     | Teste: 2 sinais em 1 s → segundo rejeitado                          |
| Chat da dupla e da mesa: filtro, rate limit, frases rápidas                                                           | `caio-colyseus`                     | Teste: mensagem de parceiro não chega ao adversário                 |
| Auth: guest, JWT, `onAuth`, refresh em Redis                                                                          | `caio-colyseus`                     | Teste de integração de login e entrada em sala                      |
| Auditoria de auth, filtro de cartas, rate limit                                                                       | `vitor-seguranca`                   | Sem achado crítico ou alto em aberto                                |

### Fase 2: pendências e ressalvas (para depois)

- **Retenção e expurgo**: nenhum job roda. Vale para `deals`, `events`, partidas canceladas, `reports` e convidados inativos (`docs/banco-de-dados.md`, seção "Retenção").
- **Estado do lobby e limites em Redis** para multi-instância: fila, mesas, `JoinGuard`, rate limit REST e de matchmaking estão em memória do processo. Presença e `mm:*` do desenho ainda não existem.
- **Moderação**: silenciar, bloquear, denunciar (ponto de extensão `canReceiveChat`) e filtro de palavrões no chat. Hoje só há limpeza de texto e rate limit.
- **Ban persistente**: o `bannedUsers` da sala existe só em memória e se perde com a sala.
- **`partnerUserId` e filtro de bloqueados na fila**: o campo existe em `JoinOptions`, mas nada o usa.
- **Logout e "sair de todos os aparelhos"**: `revokeAllForUser` existe, sem rota.
- **Google, Apple e `POST /auth/link`**: respondem `501` (Fase 3).
- **Homóglifos no apelido**: letras latinas parecidas passam na validação (sem skeleton/confusables).
- **Avatar com texto livre**: resolvido na Fase 4 (63f861c): `parts` é validado por `parseAvatarParts` contra o catálogo (8 partes com contagens fixas); avatar antigo fora do catálogo volta como padrão.
- **Janela do access JWT**: até 15 min de acesso após revogação (logout, reuso), porque o WebSocket já aberto não consulta o Redis.
- **Usuário órfão** se o Redis falha em `createGuest` (sem `delete` no repositório).
- **Validação de Docker e CI no GitHub**: o workflow ainda não rodou no GitHub, e o container de desenvolvimento não tem Docker. A sequência do CI foi reproduzida localmente.
- **ZWJ rejeitado no chat**: emoji com ZWJ (comum no celular) é recusado com `CHAT_BLOCKED`. Decidir se libera.
- **Outros achados**: a rota `GET /matches` não existe (o repositório já tem `listForUser`); o `TRUST_PROXY` usa o último item de `X-Forwarded-For`, e na Fly.io o certo é `Fly-Client-IP` (tratar no deploy).

## Fase 3: cliente jogável (3 semanas): concluída em 2026-11-02, com ressalvas

Blocos 3A a 3J. Plano em `docs/specs/2026-11-02-fase-3-cliente-plano.md`; relatório da fase em `docs/specs/2026-11-02-fase-3-relatorio.md`; contrato em `docs/protocolo-servidor.md`; app em `apps/mobile/README.md`.

| Etapa                                                                                                           | Agente           | Pronto quando                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------- |
| Expo Router, telas de entrada (convidado), início, criar/entrar mesa (com escolha de formato `single` ou `bo3`) | `fabio-frontend` | Fluxo roda no web e no Expo Go                        |
| Cliente Colyseus, store de UI, reconexão no cliente                                                             | `fabio-frontend` | Partida de teste com 4 abas/dispositivos              |
| Componentes em `packages/ui`: carta, mão, pilha da vaza, vira                                                   | `fabio-frontend` | Testes de componente                                  |
| Placar numérico em camadas (série, jogo, mão com valor animado, vazas) e histórico das mãos ao tocar            | `fabio-frontend` | Testes de componente; leitor de tela anuncia aumentos |
| Mesa: jogar carta, carta coberta, botões de truco contextuais, mão de onze/dez, mão de ferro                    | `fabio-frontend` | Partida completa jogável por humanos no web           |
| Avatar placeholder (círculo com apelido) nas 4 posições                                                         | `fabio-frontend` | —                                                     |
| E2E web: convidado → sala → partida até o fim                                                                   | `catia-qa`       | Playwright verde no CI                                |

Critério verificado: CI do GitHub verde em `dd8ab6e` (jobs `verify`, `integration` e `e2e-web`, run 41499226931). `pnpm --filter @trucaco/mobile test:e2e` passa local com 5 cenários. Contagens e comandos no relatório da fase.

### Fase 3: pendências e ressalvas (para depois)

**Não validado (só o usuário ou um aparelho consegue):**

- **iOS e Android**: nada nativo foi testado. Sem simulador nem EAS na nuvem. Validar no Expo Go: transporte do JWT no RN (`Sec-WebSocket-Protocol`), SecureStore, deep link, teclado e layout em aparelho.
- **Leitor de tela** (VoiceOver, TalkBack, leitor do navegador): os textos de acessibilidade e os anúncios não foram ouvidos. Os textos não tiveram revisão de UX.
- **Safari e outros navegadores**: o E2E roda só em Chromium. O subprotocolo `trucaco.bearer` foi provado em Node (`ws`, undici) e no Chromium.
- **Proxies de produção**: se a Fly.io repassa `Sec-WebSocket-Protocol` e o `Host` como esperado. Verificar no deploy.
- **Revisão por Codex nunca feita.** As Fases 1 a 3 foram revisadas só pela Rita-C (agente Claude, `opus`). O Codex CLI instalado no Windows falha com erro 1332 do sandbox, então a revisão por Codex segue pendente.

**Pendências de produto (decidir antes do beta):**

- **Reload da página da mesa** (decidido em 2026-11-02: retomar): o token de reconexão agora é guardado (`sessionStorage` no web, SecureStore no nativo) e a splash volta ao assento; ver `apps/mobile/README.md`. Pendente de servidor: a mesa da fila pública não pode ser retomada depois dos 60 s (o bot assumiu), porque `POST /tables/join` só serve mesa privada.
- **Botões de aposta do parceiro**: em aposta pendente e em decisão de onze/dez, os dois da dupla veem os botões (o motor dá ação legal aos dois). O servidor aceita a primeira ação. Decidir se a UI esconde os botões do parceiro.
- **`voteRematch` e o limite de 150 ms** (`ACTION_MIN_INTERVAL_MS`): o voto de revanche também é barrado por esse limite. **Decidido pelo usuário em 2026-11-02: manter como está** (um humano dificilmente vota em menos de 150 ms depois da última jogada).

**Decisões assumidas por padrão, a confirmar com o usuário:** a lista completa está em "Decisões a confirmar" no `CHANGELOG.md` e em `docs/protocolo-servidor.md`. Inclui voto de cancelar unânime, ban por sala em memória, ZWJ recusado no chat, cooldown de 60 s para reentrar na fila, janela de graça de 20 s no refresh, `ROOM_NOT_FOUND` e `TOKEN_EXPIRED` reservados ao cliente, `typedRoutes` desligado, carta jogada como "selecionar e confirmar", cores "Nós" e "Eles" fixas e o estilo provisório do baralho.

**Cobertura automatizada:** a cola de efeito dos hooks `useAnnouncer` e `useLayoutMode` não tem teste automatizado. Mão de ferro, onze/dez, `bo3` e aposta pendente têm teste de projeção e de render estático, não de partida completa por humanos.

### Dockerfile do servidor (resultado de 2026-11-02)

`infra/Dockerfile.server` foi construído pela primeira vez com Docker Desktop 29.9.2. A primeira tentativa falhou no `corepack prepare pnpm@9.15.9` (o corepack do `node:22.12.0` não reconhece as chaves de assinatura atuais do npm). Corrigido com `npm install -g pnpm@9.15.9`. Depois da correção: imagem de cerca de 616 MB, `NODE_ENV=production` com o usuário `node`, `GET /health` 200 com `{"status":"ok","protocol":2}`, healthcheck do Docker `healthy`, e `POST /auth/guest` ok contra Postgres 16 e Redis reais depois de `db:deploy`. Sem migração, o erro é `P2021`, esperado: as migrações rodam no release, não no runtime. **Não testado:** Fly.io real e WebSocket de sala dentro do contêiner.

## Fase 4: avatar e sinais (3 semanas): concluída em 2026-11-02, com ressalvas

Blocos 4A a 4J. Plano de execução em `docs/specs/2026-11-02-fase-4-avatar-plano.md`; relatório em `docs/specs/2026-11-02-fase-4-relatorio.md`; decisões em `docs/adr/0001-avatar-em-packages-avatar.md` e `docs/adr/0002-avatar-vetorial-como-producao-e-rive-como-extensao.md`; contrato do rig em `docs/avatar-rig.md`.

O avatar de produção é o **vetorial** (`View` e `Animated`). Rive ficou pendente: o `.riv` não existe e os blocos 4G (web) e 4H (nativo) esperam o arquivo e um dev build. Status por etapa:

| Etapa                                                                                 | Agente                             | Pronto quando                                                      | Status (2026-11-02)                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rig `avatar.riv`: partes trocáveis, state machine `Main`, idle                        | `rai-avatar`                       | Arquivo abre no editor e no runtime web                            | **Pendente (4G/4H)**: sem `.riv`. Contrato pronto em `docs/avatar-rig.md`; a arte fica com o usuário ou ilustrador.                                                                                                                                                                             |
| 12 gatilhos de sinais conforme `docs/sinais.md`                                       | `rai-avatar`                       | Cada trigger anima e volta ao idle                                 | **Parcial**: os 12 sinais animam no vetorial (`packages/avatar/src/poses.ts`, `runSignal.test.ts`), voltam ao ocioso em até 1,2 s. Os triggers Rive (`trig_<id>`) seguem pendentes.                                                                                                             |
| `packages/avatar`: catálogo de partes, catálogo de sinais, mapeamento de triggers     | `rai-avatar`                       | Testes de catálogo                                                 | **Feito** (ef53540): `signals.ts`, `parts.ts`, `riveContract.ts`, testes em `catalog.test.ts`.                                                                                                                                                                                                  |
| Componente `<Avatar>` `.native.tsx` e `.web.tsx`                                      | `rai-avatar`                       | Renderiza igual em web, iOS, Android                               | **Parcial**: um único `Avatar.tsx` (vetorial), sem divisão `.native`/`.web` (vem com o Rive, 4G/4H). Testado no Chromium; iOS e Android **não testados**. Fica em `packages/avatar`, não em `ui` (ADR 0001).                                                                                    |
| Criador de avatar (tela) e `PUT /me/avatar`                                           | `fabio-frontend` + `caio-colyseus` | Avatar salvo reaparece após login                                  | **Feito** (63f861c, d24a5bd). Coberto por E2E com **reload** (`avatar.spec.ts`). Não há teste de logout seguido de login.                                                                                                                                                                       |
| Painel de sinais na mesa (segurar para enviar) e animação sincronizada nos 4 avatares | `fabio-frontend`                   | Sinal de um jogador aparece nos outros 3 em < 500 ms em rede local | **Feito**, com ressalva: `test:int` mede menos de 500 ms com servidor real (`table.int.test.ts`); E2E confere o marcador `avatar-<assento>-signal-<id>` nos 4 navegadores. Latência em rede real não medida.                                                                                    |
| Revisão de desempenho em mobile (FPS com 4 avatares)                                  | `duda-debugger`                    | ≥ 50 FPS em aparelho intermediário                                 | **Parcial**: medido só no Chromium, com o script `apps/mobile/e2e/perf` (fora da suíte). Sem CPU limitada, 59,6 a 60 FPS; com CPU 4x e 4 sinais simultâneos, 14,6 a 21,7 FPS. **Pendente: aparelho intermediário.** Causa provável: `Animated` sem driver nativo na web. Ver relatório da fase. |

Blocos e commits:

| Bloco   | Commits                   | Entrega                                                                                                               |
| ------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 4A      | 63f861c                   | Contrato `AvatarParts` em `packages/protocol` (`parseAvatarParts`, `DEFAULT_AVATAR_PARTS`)                            |
| 4B      | 63f861c                   | Servidor valida `PUT /me/avatar` pelo catálogo (`INVALID_AVATAR`); bot de vaga pode sinalizar (sem vagas de bot hoje) |
| 4C      | ef53540                   | Catálogos, `SIGNALS`, contrato do rig (`riveContract.ts`) e `docs/avatar-rig.md`                                      |
| 4D      | ef53540                   | `<Avatar>` vetorial com os 12 sinais e `reduceMotion` (destaque de 1 s)                                               |
| 4E      | d24a5bd                   | Sinais na mesa: painel (segurar 400 ms), fila de 1 por assento, anúncio para leitor de tela, avatares nos assentos    |
| 4F      | d24a5bd                   | Criador de avatar (`/avatar`, link em Início e Configurações)                                                         |
| 4G      | pendente                  | Rive web (`@rive-app/react-canvas`): depende de `assets/rive/avatar.riv`                                              |
| 4H      | pendente                  | Rive nativo (`rive-react-native`): depende de dev build e do `.riv`                                                   |
| 4I      | e3eea18 (script), 08a7705 | Script de medição de FPS com 4 avatares, fora da suíte; teste do bot de ausência corrigido                            |
| Revisão | 948f3d5                   | Correções da revisão: bot de ausência não sinaliza; avatares saem da árvore de acessibilidade                         |
| 4J      | (este commit de docs)     | ADRs 0001 e 0002, spec §7, plano, CHANGELOG, `apps/mobile/README.md`, relatório e handoff                             |

### Fase 4: pendências e ressalvas (para depois)

- **Arte do `.riv`**: quem faz é o usuário ou um ilustrador, a partir de `docs/avatar-rig.md`. Sem o arquivo, 4G e 4H não começam. Nenhum agente produz nem valida o `.riv`.
- **Decisão do usuário (2026-11-02)**: nesta fase, só o fallback vetorial; Rive web fica para depois (4G). Rive nativo (4H) não tem decisão formal; a recomendação do plano é na Fase 7, junto do EAS.
- **Desempenho**: decidir se a respiração e o olhar ociosos saem no web, ou se o caminho é Rive web (4G). Medido: com `prefers-reduced-motion`, 57,9 FPS com CPU 4x ocioso. Medir em aparelho intermediário antes do beta.
- **Bot que sinaliza**: o código existe, mas o servidor não cria vagas de bot. O bot de ausência não sinaliza, e nenhum caminho cria bot de vaga. Na prática, nenhum bot sinaliza. Decidir se e quando o servidor passa a criar vagas de bot.
- **Voz**: `AvatarParts.voice` existe no contrato, mas não é usada na Fase 4. Vem com a Fase 5b.
- **Acessibilidade**: textos de acessibilidade e anúncios dos sinais não foram ouvidos em leitor de tela, e os textos não tiveram revisão de UX.
- **Revisão por Codex**: segue pendente (ver Fase 3). A Fase 4 foi revisada pela Rita-C (agente Claude, `opus`); o `vitor-seguranca` ficou de fora por decisão do usuário.

## Fase 5: chat da dupla e balões (1–2 semanas)

| Etapa                                                                              | Agente                        | Pronto quando                                    |
| ---------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ |
| Tela de preparação: chat da dupla + catálogo de sinais com anotação de significado | `fabio-frontend`              | Dupla combina e o combinado fica visível na mesa |
| `partner_codes`: salvar/recuperar combinado por par                                | `caio-colyseus` + `dalva-dba` | Reaparece quando a mesma dupla joga de novo      |
| Balões de chat da mesa sobre o avatar (4 s), frases rápidas                        | `fabio-frontend`              | —                                                |
| Auditoria de chat: filtro, rate limit, vazamento entre canais                      | `vitor-seguranca`             | Sem achado alto                                  |

## Fase 5b: áudio, vozes dos avatares e efeitos (1–2 semanas)

Detalhes em `docs/audio.md`. Protótipo com voz sintetizada de licença comercial; vozes finais na Fase 7.

| Etapa                                                                                                                 | Agente                                          | Pronto quando                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Catálogos `voices.ts` e `sfx.ts` em `packages/avatar`; `AvatarParts.voice` salvo em `PUT /me/avatar`                  | `rai-avatar` + `caio-colyseus`                  | Testes de catálogo: todo par voz × evento tem arquivo                         |
| Áudio de protótipo: `masc_1` e `fem_1` com todos os eventos (2 takes) e 8 efeitos; `assets/audio/LICENSES.md`         | `rai-avatar` (usuário aprova serviço e licença) | Arquivos dentro do orçamento de tamanho; fonte e licença registradas          |
| Player com `expo-audio`: pré-carregar vozes da mesa, tocar sobreposto, volumes separados, desbloqueio de áudio no web | `fabio-frontend`                                | Toca igual em web, iOS e Android; sem atraso perceptível                      |
| `GameEvent` → evento de voz pela escada da variante; animação `trig_shout` e balão grande com a fala (legenda)        | `rai-avatar` + `fabio-frontend`                 | "Truco", "seis", "oito", "nove", "dez", "doze" tocam certo nas duas variantes |
| Soundboard: `sfx` no servidor (validação e rate limit 1/5 s) e painel na mesa                                         | `caio-colyseus` + `fabio-frontend`              | Teste: 2 efeitos em 1 s → segundo rejeitado; todos ouvem o primeiro           |
| Escolha de voz no criador de avatar; Configurações de som (vozes, efeitos, silenciar efeitos, silenciar um jogador)   | `fabio-frontend`                                | Preferências persistem no aparelho                                            |
| Auditoria: spam de efeitos, silêncio por jogador, licenças                                                            | `vitor-seguranca`                               | Sem achado alto                                                               |

## Fase 6: contas, perfil, conquistas e missões (3 semanas)

Detalhes em `docs/gamificacao.md`. Recompensas de conquistas e missões dependem de decisão do usuário (proposta: itens cosméticos).

| Etapa                                                                                              | Agente                             | Pronto quando                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Login Google e Apple (Expo AuthSession), `POST /auth/google` e `/auth/apple`, vínculo de convidado | `fabio-frontend` + `caio-colyseus` | Convidado vincula e mantém avatar/histórico                 |
| Perfil, estatísticas, histórico de partidas                                                        | `fabio-frontend` + `caio-colyseus` | —                                                           |
| Tabelas de conquistas e missões (`achievements`, `user_achievements`, `missions`, `user_missions`) | `dalva-dba`                        | Migração aplica em local limpo                              |
| Avaliação de conquistas e progresso de missões no servidor, a partir do log da partida             | `caio-colyseus`                    | Teste: partida simulada desbloqueia as conquistas esperadas |
| Missões diárias (3) e semanal (1): sorteio, renovação à meia-noite (America/Sao_Paulo), expiração  | `caio-colyseus`                    | Teste com relógio falso                                     |
| Telas: Resultado mostra conquistas desbloqueadas; Perfil lista medalhas e missões do dia           | `fabio-frontend`                   | —                                                           |
| Denúncia, bloqueio, filtro na fila pública                                                         | `caio-colyseus`                    | Bloqueado não cai na mesma mesa pública                     |
| Auditoria completa de auth, autorização e anti-abuso de conquistas/missões                         | `vitor-seguranca`                  | Sem achado crítico ou alto                                  |

## Fase 7: publicação beta (2 semanas)

| Etapa                                                                                               | Agente                 | Pronto quando                                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| Vozes finais (3 masculinas, 3 femininas) e efeitos definitivos; substituir os arquivos de protótipo | usuário + `rai-avatar` | `assets/audio/LICENSES.md` completo; nenhum áudio sem licença comercial |
| Dockerfile do server, `fly.toml`, Postgres e Redis gerenciados, secrets                             | `diego-devops`         | Servidor acessível com health check                                     |
| Deploy web (Expo export estático)                                                                   | `diego-devops`         | URL pública abre o jogo                                                 |
| EAS Build iOS/Android, TestFlight e teste interno Play                                              | `diego-devops`         | Build instalável nos dois                                               |
| Maestro E2E nos builds                                                                              | `catia-qa`             | Fluxo básico verde                                                      |
| Observabilidade: logs estruturados, métricas de salas, alertas                                      | `diego-devops`         | Dashboard mínimo                                                        |
| Beta fechado com 8–12 jogadores, ciclo de correções, dados para calibrar o ranking                  | `duda-debugger`        | Zero bug bloqueante aberto                                              |

## Fase 8: mesa de 6 e matchmaking público (3 semanas)

| Etapa                                                         | Agente                             | Pronto quando           |
| ------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| ADR com regras da mesa de 6 (assentos, distribuição, empates) | `artur-arquiteto` + usuário        | ADR aprovado            |
| Motor com `seats = 6`                                         | `tales-regras`                     | Testes da variante de 6 |
| `TrucoRoom` para 6, layout da mesa para 6                     | `caio-colyseus` + `fabio-frontend` | Partida de 6 jogável    |
| Matchmaking público (FIFO) com bloqueios                      | `caio-colyseus`                    | —                       |
| Painel de moderação mínimo                                    | `fabio-frontend` + `caio-colyseus` | —                       |

## Fase 9: ranking competitivo (3 semanas, depois do beta)

Detalhes em `docs/gamificacao.md`, seção 3. Valores calibrados com os dados do beta.

| Etapa                                                                                                   | Agente                              | Pronto quando                                                        |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| Tabelas `seasons`, `ratings`, `rating_history`                                                          | `dalva-dba`                         | Migração aplica em local limpo                                       |
| Cálculo de rating (Elo por variante, dupla pela média), só fila pública `single` e contas vinculadas    | `caio-colyseus`                     | Testes: vitória, derrota, calibração inicial, mesa privada não conta |
| Ligas e divisões; temporada mensal com reset parcial                                                    | `caio-colyseus`                     | Teste com relógio falso: virada de temporada                         |
| Pareamento por rating próximo na fila pública                                                           | `caio-colyseus`                     | Teste: ratings distantes não pareiam                                 |
| Anti-abuso: abandono conta como derrota, limite contra os mesmos adversários, alerta de salto de rating | `caio-colyseus` + `vitor-seguranca` | Auditoria sem achado alto                                            |
| Telas: liga e rating no Perfil, leaderboard global por variante e da temporada                          | `fabio-frontend`                    | —                                                                    |

## Convenções do plano

- Toda etapa que cria tipos compartilhados passa primeiro por `packages/protocol`.
- Ao fim de cada fase: `catia-qa` roda a suíte completa, `rita-revisora` revisa, `teo-docs` atualiza README/changelog, PR `feature/*` → `develop`.
- `develop` → `master` por PR apenas quando o usuário pedir (marcos: fim da fase 3, fim da fase 7).
- Numeração: a fase de áudio é a **5b** para não renumerar as demais, que já são citadas em outros documentos.
