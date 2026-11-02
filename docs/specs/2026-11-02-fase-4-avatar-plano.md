# Fase 4: avatar e sinais, plano de execução

Autor: `artur-arquiteto`, 2026-11-02. Base: `docs/plano-desenvolvimento.md` (Fase 4), spec §7, `docs/sinais.md`, `docs/audio.md` §1.

## 1. Ponto de partida (verificado no código)

- `packages/avatar/src/index.ts`: só `SIGNAL_TRIGGERS` (`signalId -> trig_*`). Sem `assets/rive`, sem `.riv`, sem `AvatarParts` tipado.
- `packages/protocol`: `SIGNAL_IDS`, `SIGNAL_COOLDOWN_MS` e as mensagens `signal` (cliente e servidor) já existem. `PUT /me/avatar` recebe `{ parts }` como `Record<string, unknown>`.
- Servidor: `signal` validado (catálogo + cooldown 3 s) e transmitido aos 4 (`apps/server/src/rooms/TrucoRoom.ts:1142`). `assertAvatarParts` (`apps/server/src/db/validation.ts:92`) aceita qualquer objeto plano com até 32 chaves de texto livre (pendência da Fase 2). `player.avatar` viaja no estado como JSON string (`schema.ts:109`). Bot não sinaliza.
- Cliente: `roomService.ts:77` ignora `signal` e `sfx`. `TableView.tsx` desenha os 4 assentos com `AvatarPlaceholder` (círculo com inicial) e um `Bubble` absoluto por assento; `tableController.ts:443` já tem o padrão "um balão por assento, timer de 4 s". `projectTable.ts` não projeta o avatar. `WaitingRoomView.tsx` também usa o placeholder.
- Dependências: `react-native-reanimated` e `react-native-svg` NÃO estão instalados (só aparecem no lock como peer opcional). `app.json` tem `newArchEnabled: true`.
- Bibliotecas Rive (npm consultado em 2026-11-02): `@rive-app/react-canvas` 4.38.0 (web, React 19 ok); `rive-react-native` 9.8.6 (nativo, inputs de state machine clássicos, Expo via config plugin e `expo run:*`); `@rive-app/react-native` 0.5.10 (nova, sobre Nitro Modules, pré-1.0, exige `react-native-nitro-modules`, trata inputs de state machine como legado em favor de data binding). Fato de arquitetura: o Expo Go só carrega módulos nativos do próprio SDK; qualquer Rive nativo exige development build (EAS ou `expo run:ios|android`). O fallback vetorial e o Rive web rodam no Expo Go e no navegador.

## 2. Estratégia: a arte não bloqueia o código

O `.riv` é binário feito no editor Rive por pessoa (usuário ou ilustrador); nenhum agente consegue produzi-lo nem validá-lo visualmente. Portanto:

1. O avatar vetorial de fallback é o avatar de produção da Fase 4. Rosto montado com `View` e `Animated` do RN (sem dependência nova): formato de rosto, pele, cabelo, olhos, boca, roupa, acessório e cor de fundo vêm de `AvatarParts`; os 12 sinais são animações curtas de transform/opacity (`useNativeDriver: true`). Mesma API e mesmos ids do Rive.
2. O contrato do rig vira documento (`docs/avatar-rig.md`): artboard, state machine `Main`, nome e tipo de cada input, triggers, duração, tamanho, exportação. É a especificação que o ilustrador recebe. Quando o `.riv` existir, o componente troca o renderizador sem mudar tela nenhuma.
3. Rive web entra atrás de detecção de asset: se `assets/rive/avatar.riv` não existir ou falhar ao carregar, usa o fallback. Rive nativo fica condicionado à decisão de dev build (pergunta 1).

## 3. Contratos

### `packages/protocol` (novo `avatar.ts`, aditivo; `PROTOCOL_VERSION` segue 2)

```ts
export const AVATAR_PART_KEYS = [
  'face_shape',
  'skin',
  'hair',
  'eyes',
  'mouth',
  'outfit',
  'accessory',
  'bg_color',
] as const;
export type AvatarPartKey = (typeof AVATAR_PART_KEYS)[number];
/** Variantes por parte (índices 0..n-1). Só cresce. */
export const AVATAR_PART_COUNTS: Readonly<Record<AvatarPartKey, number>>; // proposta: 4, 6, 8, 4, 4, 6, 5, 8
export const VOICE_IDS = ['masc_1', 'masc_2', 'masc_3', 'fem_1', 'fem_2', 'fem_3'] as const; // usado na 5b
export interface AvatarParts {
  readonly face_shape: number;
  /* ...todas as chaves... */ readonly voice?: VoiceId;
}
export const DEFAULT_AVATAR_PARTS: AvatarParts;
/** Chaves exatas, inteiros no intervalo, `voice` opcional; qualquer outra coisa -> null. */
export function parseAvatarParts(raw: unknown): AvatarParts | null;
```

Servidor valida com `parseAvatarParts` (substitui o texto livre). Mudança de validação, não de forma: `PUT /me/avatar` continua `{ parts }`; `MeResponse.avatar` e `UpdateAvatarResponse.avatar` passam a `AvatarParts | null`. `player.avatar` no estado continua string JSON (cliente faz `parseAvatarParts(JSON.parse(...)) ?? DEFAULT_AVATAR_PARTS`).

### `packages/avatar` (depende de `protocol`; novo: `react` e `react-native` como peer, como em `packages/ui`)

```ts
export const SIGNALS: readonly {
  id: SignalId;
  name: string;
  trigger: string;
  durationMs: number;
  meaning: string;
}[]; // docs/sinais.md
export const RIVE_CONTRACT = {
  artboard: 'Avatar',
  stateMachine: 'Main',
  inputs: AVATAR_PART_KEYS,
  triggers: SIGNAL_TRIGGERS,
} as const;
export interface AvatarProps {
  parts: AvatarParts;
  /** `key` muda a cada sinal recebido (o mesmo id duas vezes seguidas anima duas vezes). */
  signal?: { id: SignalId; key: number } | null;
  onSignalEnd?: () => void;
  size?: number;
  reduceMotion?: boolean;
  testID?: string;
}
export function Avatar(props: AvatarProps): JSX.Element; // escolhe renderizador: rive (asset disponível) ou fallback
```

A fila de 1 posição fica no cliente (`tableController`), não no componente. Nota de spec: o §7 coloca `<Avatar>` em `packages/ui`, mas `ui` não pode depender de `avatar` pela regra de dependências; o componente vai para `packages/avatar` (ADR curto pelo `teo-docs`, bloco 4J).

## 4. Blocos

| Bloco                                                            | Agente                                                        | Arquivos                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pronto quando                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4A Contrato de `AvatarParts`                                     | `caio-colyseus`                                               | `packages/protocol/src/avatar.ts` (+ teste), `index.ts`, `http.ts`                                                                                                                                                                                                                                                                                                                                                                                                            | `parseAvatarParts` rejeita chave extra, índice fora do intervalo e tipo errado; testes verdes                                                                                                                 |
| 4B Servidor valida pelo catálogo; bot sinaliza (se aprovado, P5) | `caio-colyseus`                                               | `apps/server/src/db/validation.ts`, `http/rest.ts` (`INVALID_AVATAR`), `rooms/TrucoRoom.ts` (bot: `emitSignal` reusando o broadcast, 1 sinal aleatório em até 30 % das mãos, só no `handStarted`, respeitando o cooldown), `docs/protocolo-servidor.md`                                                                                                                                                                                                                       | Teste de sala: `PUT` com texto livre -> 400; sinal do bot chega aos 4 com o `seat` do bot                                                                                                                     |
| 4C Catálogos e contrato do rig                                   | `rai-avatar`                                                  | `packages/avatar/src/signals.ts`, `parts.ts`, `riveContract.ts` (+ testes), `docs/avatar-rig.md`, `docs/sinais.md` (duração por sinal)                                                                                                                                                                                                                                                                                                                                        | Teste: todo `SignalId` tem entrada em `SIGNALS` com trigger `trig_<id>`; toda chave de `AVATAR_PART_KEYS` tem input documentado                                                                               |
| 4D `<Avatar>` fallback vetorial                                  | `rai-avatar`                                                  | `packages/avatar/src/Avatar.tsx`, `AvatarFallback.tsx`, `useSignalAnimation.ts`, `package.json` (peers), testes no padrão de `packages/ui` (render estático + timers falsos)                                                                                                                                                                                                                                                                                                  | 12 sinais animam e voltam ao ocioso em até 1,2 s; `reduceMotion` troca animação por destaque estático de 1 s; `parts` inválido cai no padrão; renderiza em web e RN                                           |
| 4E Sinais na mesa                                                | `fabio-frontend`                                              | `apps/mobile/src/room/roomService.ts` (handler `signal`), `table/tableStore.ts` (`signals` por assento), `table/tableController.ts` (`onSignal`: fila de 1, descarta o excedente), `table/projectTable.ts` (`parts` no `SeatView`), `screens/TableView.tsx` e `WaitingRoomView.tsx` (`<Avatar>` quando há jogador; placeholder só em vaga), `screens/SignalPanel.tsx` (segurar 400 ms, cooldown visual de 3 s, 12 botões com nome), `useAnnouncer` ("Fulano: piscar um olho") | Teste de controller: 3 sinais em 100 ms -> 2 animados, 1 descartado; `test:int`: sinal de A aparece em B em < 500 ms; E2E Playwright: segurar o botão dispara e o outro navegador mostra `signal-<seat>-wink` |
| 4F Criador de avatar                                             | `fabio-frontend`                                              | `apps/mobile/app/avatar.tsx`, `src/screens/AvatarEditorScreen.tsx`, `AvatarEditorView.tsx`, `net/api.ts` (tipos novos), link em `HomeView`/`SettingsView`                                                                                                                                                                                                                                                                                                                     | Escolher partes, pré-visualizar com `<Avatar>`, salvar; após logout/login o avatar reaparece (`GET /me`); E2E cobre salvar e voltar à mesa                                                                    |
| 4G Rive web (condicionado ao `.riv`)                             | `rai-avatar`                                                  | `packages/avatar/src/Avatar.rive.web.tsx` (`@rive-app/react-canvas`, buffer carregado uma vez e compartilhado pelas 4 instâncias), `assets/rive/avatar.riv`, `apps/mobile/metro.config.js` (`riv` em `assetExts`)                                                                                                                                                                                                                                                             | Cada trigger anima e volta ao idle no Chromium; sem asset -> fallback sem erro na tela; `.riv` < 500 KB                                                                                                       |
| 4H Rive nativo (condicionado à P1)                               | `rai-avatar` + `diego-devops`                                 | `Avatar.rive.native.tsx` (`rive-react-native` 9.x), `app.json` (plugin), perfil EAS `development`                                                                                                                                                                                                                                                                                                                                                                             | Dev build em um aparelho dispara os 12 triggers                                                                                                                                                               |
| 4I QA e desempenho                                               | `catia-qa`, depois `duda-debugger`                            | testes dos blocos 4A a 4F; medição com 4 avatares animando ao mesmo tempo (web: painel Performance; nativo: Expo Go, se disponível)                                                                                                                                                                                                                                                                                                                                           | Suíte completa verde; >= 50 FPS com 4 fallbacks; FPS do web no relatório                                                                                                                                      |
| 4J Revisão, segurança e docs                                     | `rita-revisora` (ou `-claude`), `vitor-seguranca`, `teo-docs` | diff da fase; `docs/adr/` (componente em `packages/avatar`), spec §7, `CHANGELOG.md`, `apps/mobile/README.md`                                                                                                                                                                                                                                                                                                                                                                 | Sem achado alto; docs batem com o código                                                                                                                                                                      |

Ordem: 4A -> (4B, 4C) -> 4D -> (4E, 4F) -> 4I -> 4J. 4G e 4H só quando a dependência externa existir; não travam a fase. Commit e push na `develop` a cada bloco verificado.

## 5. Riscos

- Arte: sem `.riv`, a Fase 4 fecha com o avatar vetorial. Risco de ele "ficar para sempre": por isso `docs/avatar-rig.md` e `RIVE_CONTRACT` nascem agora, e o teste de catálogo garante que o rig futuro terá os mesmos nomes.
- Expo Go vs dev build: o handoff previa validar iOS/Android no Expo Go. Rive nativo inviabiliza isso; o fallback preserva o Expo Go. Decisão na P1.
- `newArchEnabled: true`: a compatibilidade de `rive-react-native` 9.8 com a nova arquitetura e RN 0.88 não foi verificada (o README não cita). Checar antes do 4H. `@rive-app/react-native` 0.5 exige Nitro e é pré-1.0: não recomendado agora.
- Validação mais estrita de `AvatarParts` invalida avatares de texto livre já salvos: não há produção, aceitar; em dev, `GET /me` devolve `null` para parts inválidas e o cliente usa o padrão.
- Anti-spam de sinais já está no servidor (3 s); o painel só espelha o cooldown. O bot sinalizando não cria vetor de abuso (origem é o servidor). Vitor confere `parseAvatarParts` e o painel.
- Desempenho: 4 `Animated` com `useNativeDriver` é barato; 4 canvases Rive no web é o ponto a medir (4G/4I). Sem recriar instância por render; `React.memo` por assento.
- Acessibilidade: sinal só visual não serve a quem usa leitor de tela; o anúncio no `useAnnouncer` e `reduceMotion` (via `AccessibilityInfo.isReduceMotionEnabled`) fazem parte do pronto do 4E.

## 6. Perguntas ao usuário (mudam o plano)

1. Dev build agora ou só Expo Go? Rive nativo exige development build (EAS ou `expo run`). Recomendação: Fase 4 só com fallback vetorial e Rive web; Rive nativo (4H) na Fase 7, junto do polimento visual e do EAS.
2. Quem faz o `.riv` e quando? Nenhum agente consegue. Recomendação: o usuário (ou um ilustrador) a partir de `docs/avatar-rig.md`; até lá o vetorial é o avatar do produto, inclusive no beta se for preciso.
3. Biblioteca nativa: `rive-react-native` 9.x (estável, inputs clássicos iguais ao contrato) ou `@rive-app/react-native` 0.5 (nova, data binding, pré-1.0)? Recomendação: 9.x; rever quando a nova chegar a 1.0.
4. Tamanho do catálogo de partes (proposta: 4/6/8/4/4/6/5/8 variantes; `voice` opcional já reservada para a 5b). Recomendação: aceitar a proposta; só cresce, nunca encolhe.
5. Bot sinaliza na Fase 4? (decisão antiga: "pode dar sinais"). Recomendação: sim, no 4B, 1 sinal aleatório em até 30 % das mãos, para a mesa com bot não ficar morta; desligável por opção de sala depois, se incomodar.
