# @trucaco/ui

Biblioteca visual pura (React Native + react-native-web): sem rede, Colyseus, Zustand ou Rive. Consumida por `apps/mobile`. O cliente não importa `@trucaco/rules`; os componentes só traduzem o que o servidor manda (`legalActions`, snapshot, eventos públicos).

## Acessibilidade e plataformas

- **Carta selecionada**: web usa `aria-pressed` (`aria-selected` não vale para `role=button`); nativo usa `aria-selected`, que o RN 0.88 converte em `accessibilityState.selected` (`View.js`/`Pressable.js`; o RN 0.88 não tem `aria-pressed` em View/Pressable). A escolha é feita por `Platform.select` em `selectedProps` (`Card.tsx`). O rótulo falado acrescenta ", selecionada".
- Estados disabled/expanded usam `aria-disabled`/`aria-expanded`: o RNW 0.21 ignora `accessibilityState`.
- Anúncios: `useAnnouncer` usa `AccessibilityInfo.announceForAccessibility` no nativo e a região `LiveRegion` (`aria-live`) no web, sempre com fila (`createAnnouncementQueue`).
- Cores "Nós" (azul) e "Eles" (laranja) são fixas por perspectiva (`teamColors.mine/theirs`).

## Contratos que o 3H precisa cumprir

- `TurnTimer.clockOffsetMs`: diferença servidor − cliente em ms. O 3H calcula o offset (por exemplo, pelo horário do servidor numa mensagem ou pelo `Date` da resposta HTTP) e o repassa; o cronômetro usa `Date.now() + offset` contra `turnDeadlineAt`. O ticker de 250 ms para sozinho ao chegar a zero e religa se `deadlineAt` ou o offset mudarem.
- `BetButtons.nextValue/pendingValue/raising`: valores vêm do servidor/estado; o rótulo do botão (`Truco!`, `Seis!`, `Doze!`...) deriva de `betCry(nextValue)`.
- Manilha: `HandSnapshot` só traz a vira; `manilhas`/`manilhaLabel` precisam chegar prontas.
- Anúncio da própria carta coberta: o evento público traz a carta só ao dono.

## Testes

`pnpm --filter @trucaco/ui test` (Vitest, alias para react-native-web, `renderToStaticMarkup`). Sem jsdom nem react-test-renderer: interação é testada percorrendo a árvore de elementos e chamando `onPress`, e os efeitos nas funções puras que os hooks usam (`startCountdown`, `createAnnouncerBinding`). O hook em si (cola de `useEffect`) não tem teste automatizado.
