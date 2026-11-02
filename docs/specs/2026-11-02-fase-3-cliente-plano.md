# Fase 3: plano do cliente jogável

Autor: `artur-arquiteto` (somente leitura), 2026-11-02. Gravado pelo orquestrador a partir do relatório dele. Complementa `docs/plano-desenvolvimento.md` (Fase 3) e `docs/protocolo-servidor.md`. Versões consultadas no registro do npm em 2026-11-02; o que não foi verificado está marcado **a confirmar**.

## 1. Escopo e fora de escopo

**Entra:** app Expo (web, iOS, Android) em `apps/mobile` com Expo Router; login convidado; início (criar mesa privada `single`/`bo3`, entrar por código, fila pública); sala de espera; mesa jogável (cartas, coberta, mão de ferro às cegas, mão de onze/dez com `partnerCards`, botões de aposta contextuais por `legalActions`, vira, placar em camadas com histórico, timer de turno, presença/bot, votar cancelar); fim de partida/série; configurações mínimas (apelido via `PUT /me`, sair); reconexão com refresh; chat da mesa e da dupla só em texto (opcional, tamanho P: o servidor já suporta); avatar placeholder (círculo + apelido) em `packages/ui`; componentes e tokens em `packages/ui`; testes de componente; Playwright web no CI; build web estático.

**Fica fora:** Rive e sinais (Fase 4; o painel `signal` nem aparece), áudio e `sfx` (5b), login Google/Apple e `/auth/link` (501 no servidor; Fase 6), perfil e histórico (`GET /matches` não existe), moderação, builds EAS assinados (só configuração, sem submissão: sem conta/credenciais no ambiente), Maestro (sem simulador na nuvem; fica só o esqueleto).

## 2. Contrato primeiro (`packages/protocol`, bloco 3A)

Hoje o `protocol` tem `ERROR_CODES` (25, canal WS), `ClientMessage`/`ServerMessage`, `PublicGameEvent`, `RoomOptions` e catálogos. Falta tudo do REST e do estado. Acrescentar sem mudar o que existe:

- `src/http.ts`: `HTTP_ERROR_CODES` (os 31 de `apps/server/src/errorCodes.contract.test.ts` mais `INVALID_REFRESH_TOKEN` e `BO3_REQUIRES_PRIVATE`), tipo `HttpErrorCode`, `ApiError = { error: { code } }` e tipos de resposta: `GuestAuthResponse`, `RefreshResponse`, `MeResponse` (`avatar` como `Record<string, unknown> | null`, `createdAt` ISO), `CreateTableResponse { code, reservation: SeatReservation }`, `JoinTableResponse`, `QueueStatusResponse` (`status: 'idle' | 'queued' | 'matched' | 'seated'`, `reservation?`), `HealthResponse`. `SeatReservation` como tipo estrutural próprio, para `ui` e `mobile` não dependerem do SDK no tipo. Constantes: `RESERVATION_TTL_SECONDS = 15` e `WS_BEARER_PROTOCOL = 'trucaco.bearer'` (mover de `apps/server/src/auth/authService.ts` para o protocol e reexportar no servidor).
- `src/state.ts`: interface plana `TableStateSnapshot` espelhando `apps/server/src/game/schema.ts` (`PlayerSnapshot`, `HandSnapshot`, `SeatPrivateSnapshot`, `LegalActionId` como template literal `play:${Rank}${Suit} | playCovered:... | playBlind:0|1|2 | bet | accept | run | specialPlay | specialRun`) e `parseLegalAction(id)`. Convenções do schema viram constantes (`''` = sem carta, `-1` = ausente). Teste de contrato no servidor (como `game/contract.test.ts`) atribuindo o snapshot de `projection.ts` ao tipo do protocol.
- `ROOM_NOT_FOUND` e `TOKEN_EXPIRED`: manter em `ERROR_CODES` e documentar como **reservados ao cliente** (o cliente os sintetiza: 401 na reconexão vira `TOKEN_EXPIRED`; `reconnect` com sala morta vira `ROOM_NOT_FOUND`). Sem mudança no servidor. `PROTOCOL_VERSION` fica 2.

**Servidor (caio, bloco 3B, tamanho P):**

- `CORS_ORIGINS` já cobre o web; `.env.example` ganha `http://localhost:8081` comentado.
- Não é preciso expor o schema: o SDK decodifica por reflexão no handshake (confirmado em `src/serializer/SchemaSerializer.ts` do SDK), sem duplicação.
- Rota `POST /auth/logout` (revoga a família ou chama `revokeAllForUser`; pendência já listada) para a tela de sair.
- Teste de sala confirmando que o upgrade de reconexão aceita o subprotocolo `trucaco.bearer, <jwt>` vindo do SDK (já existe em `authRoom.test.ts`; estender ao caminho do SDK).

## 3. Arquitetura do cliente

**Versões** (npm, 2026-11-02): `expo@58.0.22` (SDK 58) fixa `react-native@0.88.1`, `react@19.3.0`, `react-native-web@~0.21.4`, `expo-router@~58.0.29`, `expo-secure-store@~58.0.2`, `react-native-reanimated@4.7.1`, `react-native-screens@~4.30.1`, `react-native-safe-area-context@~5.10.1`, `jest-expo@~58.0.13`. `@colyseus/sdk@0.18.9` (peer `@colyseus/core 0.18.x`, dependência `@colyseus/schema ^5.0.8`, resolve para 5.0.43, igual ao servidor). `zustand@5.0.16`, `@testing-library/react-native@14.1.0`, `@playwright/test@1.64.1`. **A confirmar:** compatibilidade do SDK 58 com o Node 22 do `.nvmrc` e com pnpm sem `node-linker=hoisted` (o Expo documenta suporte a pnpm isolado desde o SDK 50, não testado aqui).

**Pastas** em `apps/mobile`: `app/` (rotas Expo Router), `src/net/` (`api.ts` REST com refresh em fila única, `colyseus.ts`, `tokenStorage.{native,web}.ts`), `src/store/` (Zustand: `sessionStore`, `lobbyStore`, `tableStore`), `src/table/` (projeção e seletores), `src/i18n/errors.ts` (código para texto pt-BR). Em `packages/ui`: componentes puros sem rede (`Card`, `HandFan`, `TrickPile`, `Vira`, `ScoreLayers`, `BetButtons`, `AvatarPlaceholder`, `TurnTimer`, `ChatText`) e `tokens.ts`.

**Estado:** `room.state` é a fonte. `getStateCallbacks(room)`/`onStateChange` projeta para um `TableStateSnapshot` imutável no `tableStore`. `legalActions` do bloco `privates[mySeat]` habilita os botões. `hand` vazia com `handSize > 0` e `special === 'maoDeFerro'` significa cartas às cegas (`playBlind:<i>`); `partnerCards` renderiza quando não vazio. Os eventos (`event { seq }`) alimentam histórico e animações. **Salto de `seq`:** marcar `desynced`, descartar o histórico derivado e reconstruir pelo estado (placar e mão vêm do schema, nunca do log).

**Tokens:** access em memória; refresh no `expo-secure-store` (nativo). **Web:** o servidor devolve o refresh no corpo e não emite cookie. Opções: (a) só memória, que perde a sessão ao recarregar; (b) `localStorage`, exposto a XSS, mitigado por CSP do host estático, sem HTML no chat, sem bibliotecas de UI de terceiros, access de 15 min e rotação com detecção de reuso já no servidor. **Recomendação: (b) na Fase 3**, com `TokenStorage` abstraído para trocar por cookie httpOnly na Fase 6 (exigiria `Allow-Credentials` e proteção CSRF no servidor). Decisão do usuário.

**Colyseus:** `new Client(SERVER_URL, { headers: { authorization: 'Bearer …' } })`; atualizar `client.http.options.headers` a cada refresh; nunca `client.auth.token`. Entrada: REST do lobby, depois `client.consumeSeatReservation(reservation)` em até 15 s. Reconexão: `room.reconnectionToken` guardado em memória (no nativo também no SecureStore, para sobreviver ao app morto); `onDrop` leva a refresh se faltar menos de 60 s para expirar, depois `client.reconnect(token)`; 401 leva a refresh e nova tentativa; 403/404 vira `ROOM_NOT_FOUND` e volta ao início.

**Risco crítico confirmado no código (bloco 3D):** o SDK só põe o JWT no upgrade quando `typeof document !== 'undefined'` é falso (ramo Node: `new WebSocket(url, { headers, protocols })`, `src/transport/WebSocketTransport.ts:50-63`), e o WebSocket do RN 0.88 descarta esse objeto (`Libraries/WebSocket/WebSocket.js:107-114`: `protocols` não-array vira `null` e `options` fica `undefined`). No navegador o SDK não expõe API pública para `transport.protocols`. Logo, **sem ajuste, a reconexão falha com 401 em todas as plataformas**; a entrada inicial não exige JWT no upgrade (`reconnectGuard.ts` só age com `reconnectionToken`). Solução no cliente: subclasse de `Client` que sobrescreve `createRoom` devolvendo um `Room` cujo `connect` injeta `connection.transport.protocols = ['trucaco.bearer', jwt]` (web), ou um shim de `WebSocket` nativo que traduz `{headers, protocols}` para `(url, protocols, {headers})` (RN). Alternativa no servidor: aceitar o JWT no upgrade via ticket de uso único (não recomendada: mais superfície). **A confirmar** com teste real contra o servidor; o Vitor audita.

## 4. Telas e componentes

Rotas: `/` (splash: restaura a sessão ou cria convidado com apelido editável), `/home` (criar mesa com variante/formato/ferro, entrar por código com `isValidRoomCode`, fila pública com variante/ferro), `/table/[code]` (espera: código grande para compartilhar e 4 assentos; mesa quando `phase === 'playing'`; resultado quando `finished`), `/settings` (apelido, sair, versão/protocolo).

Layout: celular em retrato (mão em leque embaixo, parceiro em cima, adversários nos lados por `screenPosition`); web a partir de 900 px com placar, histórico e chat na lateral. Tokens: cores do baralho e das duplas, tipografia, espaçamento 4/8, raio; sem biblioteca de UI.

Acessibilidade: `accessibilityRole`, `accessibilityLabel` por carta ("3 de paus, manilha"), `AccessibilityInfo.announceForAccessibility` em aumento de aposta e fim de mão, alvos de pelo menos 44 pt, contraste AA. Carta coberta alheia: verso; a própria coberta: verso com miniatura da identidade de `ownCovered`. Mão de ferro: três versos com "?" selecionáveis. Nick e chat sempre `<Text>`.

## 5. Testes

- `packages/ui` e `apps/mobile`: Vitest com `@testing-library/react-native`. **A confirmar:** a combinação Vitest e RN 0.88 é frágil (RN é Flow/CJS); se emperrar, usar `jest-expo` só nesses dois pacotes (o `turbo test` não se importa). Testar projeção (`tableStore`), seletores de `legalActions`, fila de refresh (fake timers), tradução de erros e componentes puros.
- Playwright (web): sobe o servidor real em `NODE_ENV=test`, com o fluxo convidado real (`TokenStore` em memória e repositório em memória, já suportados) e 4 contextos de navegador. Semente fixa via `TRUCO_SEED` só em dev/test (pedir ao caio, opcional). Anti-flakiness: esperar por estado (`data-testid` com `phase`/`turn`), nunca `sleep`; `JOIN_MIN_LATENCY_MS=0`; timeouts generosos no turno; 1 retry no CI.
- Maestro: só o esqueleto de fluxo em `apps/mobile/.maestro/`, sem rodar no CI (sem simulador).

## 6. Segurança do cliente (Vitor audita 3C, 3D, 3E e 3I)

Tokens (storage web, nunca em log, nunca na URL nem em `_authToken`); refresh em fila única e persistido antes de prosseguir; `SERVER_URL` por `EXPO_PUBLIC_*` sem segredo; deep link `trucaco://table/CODE` só preenche o campo (nunca entra sozinho); chat e nick como `<Text>`, validação com `parseClientMessage`; CORS com a origem exata do host web; sem `console.log` de payload em produção; dependências novas listadas com justificativa (`@colyseus/sdk`, `zustand`, Expo); sem Sentry nesta fase.

## 7. Blocos

| Bloco | Agente                                                                                           | Tam. | Depende de | Pronto quando                                                    | Revisão               |
| ----- | ------------------------------------------------------------------------------------------------ | ---- | ---------- | ---------------------------------------------------------------- | --------------------- |
| 3A    | protocol: `http.ts`, `state.ts`, constantes, teste de contrato no servidor (fabio + caio)        | P    | —          | typecheck em todo o monorepo; teste de contrato verde            | Rita-C                |
| 3B    | servidor: `/auth/logout`, `.env.example`, teste do subprotocolo via SDK, `TRUCO_SEED` dev (caio) | P    | 3A         | testes de sala e REST verdes                                     | Rita-C + Vitor        |
| 3C    | esqueleto Expo: SDK 58, Router, `app.json`, Metro no monorepo, `pnpm dev` web (fabio + diego)    | M    | —          | `expo export --platform web` e `pnpm typecheck/lint/test` verdes | Rita-C                |
| 3D    | rede: REST com refresh em fila, `TokenStorage`, `Client` com JWT, reconexão (fabio)              | G    | 3A, 3C     | testes unitários; reconexão manual com servidor local (web)      | Rita-C + Vitor        |
| 3E    | auth e lobby: splash, home, espera, sair (fabio)                                                 | M    | 3D         | 4 abas sentam numa mesa privada e na fila                        | Rita-C + Vitor        |
| 3F    | `packages/ui`: tokens, Card, HandFan, TrickPile, Vira, AvatarPlaceholder, TurnTimer (fabio)      | M    | 3C         | testes de componente                                             | junto com 3G          |
| 3G    | placar em camadas, histórico, anúncios (fabio)                                                   | M    | 3F         | testes; leitor de tela anuncia                                   | Rita-C                |
| 3H    | mesa: projeção, ações, coberta, ferro, onze/dez, resultado, chat texto (fabio)                   | G    | 3D–3G      | série `bo3` completa jogada por 4 humanos no web                 | Rita-C + Vitor (chat) |
| 3I    | E2E Playwright e CI (job `e2e-web`), build web estático em artefato (catia + diego)              | M    | 3H         | verde no GitHub (o CI nunca rodou lá: validar)                   | —                     |
| 3J    | docs: `docs/protocolo-servidor.md`, README do mobile, CHANGELOG, plano (teo)                     | P    | 3I         | —                                                                | —                     |

Paralelo possível: 3B com 3C; 3F com 3D; 3G com 3E. Por padrão sem paralelismo (economia); 3F e 3G podem ser um único agente depois do 3D.

## 8. Riscos e decisões do usuário

**Riscos:**

1. JWT no upgrade de reconexão (§3) exige subclasse ou shim do SDK.
2. Metro com pnpm isolado e pacotes do workspace com `dist` (precisa `turbo build` antes do `expo start`; alternativa: `exports` com condição `source`).
3. RN 0.88 e React 19.3 muito recentes: bibliotecas de teste podem atrasar.
4. `ws` do SDK no bundle: o campo `browser` aponta para um stub e `globalThis.WebSocket` existe no RN, então não deve quebrar (a confirmar no Metro).
5. **Nada nativo é testável na nuvem** (sem simulador, sem EAS): iOS e Android ficam em "compila no `expo prebuild`/`expo export`" e validação manual do usuário no Expo Go.
6. O CI do GitHub nunca rodou.

**Decisões (padrão proposto):**

- (a) Refresh no `localStorage` no web, com `TokenStorage` abstraído. Padrão: sim.
- (b) Chat de texto já na Fase 3. Padrão: sim (P).
- (c) `POST /auth/logout` agora. Padrão: sim.
- (d) Vitest ou `jest-expo` para RN. Padrão: tentar Vitest e cair para `jest-expo` só em `ui` e `mobile`.
- (e) Nome do bundle e scheme `com.mcdtec.trucaco` e `trucaco://`. A confirmar.
- (f) `TRUCO_SEED` em dev para E2E determinístico. Padrão: sim, só dev/test.
- (g) O usuário valida no Expo Go ou no aparelho o que a nuvem não cobre.
