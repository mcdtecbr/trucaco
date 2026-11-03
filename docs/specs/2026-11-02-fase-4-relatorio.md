# Relatório da Fase 4: avatar e sinais

Data: 2026-11-02. Branch `develop`, direto (sem PR), conforme o modo atual do projeto. Plano de execução: `docs/specs/2026-11-02-fase-4-avatar-plano.md`. Estado da fase: `docs/plano-desenvolvimento.md`. Decisões: `docs/adr/0001-avatar-em-packages-avatar.md` e `docs/adr/0002-avatar-vetorial-como-producao-e-rive-como-extensao.md`.

Resumo: sinais na mesa, avatares nos quatro assentos e criador de avatar entregues, com o **renderizador vetorial** (`View` e `Animated`) como avatar de produção. Rive web (4G) e nativo (4H) ficam pendentes, porque o arquivo `assets/rive/avatar.riv` não existe. Medição de FPS feita só no Chromium: com 4 sinais simultâneos e CPU 4x de throttle, o FPS cai para 14,6 a 21,7. Não medido em aparelho.

## Blocos e commits

| Bloco   | Commits             | Entrega                                                                                                                                                                                            |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4A      | 63f861c             | Contrato `AvatarParts` em `packages/protocol` (`avatar.ts`): chaves exatas, índices no intervalo, `voice` opcional; `parseAvatarParts`, `DEFAULT_AVATAR_PARTS`                                     |
| 4B      | 63f861c, 948f3d5    | `PUT /me/avatar` validado pelo catálogo (`400 INVALID_AVATAR`); `GET /me` devolve `null` para avatar fora do catálogo; sorteio de sinal do bot (só bot de vaga, ver "Decisões do usuário")         |
| 4C      | ef53540             | `packages/avatar`: `SIGNALS`, `SIGNAL_TRIGGERS`, `PART_VARIANT_NAMES`, `RIVE_CONTRACT`; `docs/avatar-rig.md`; durações por sinal em `docs/sinais.md`                                               |
| 4D      | ef53540             | `<Avatar>` vetorial (`Avatar.tsx`, `AvatarFallback.tsx`, `useSignalAnimation.ts`, `poses.ts`) com os 12 sinais; `reduceMotion` troca a animação por um destaque de 1 s                             |
| 4E      | d24a5bd, 948f3d5    | Sinais na mesa: `SignalPanel` (segurar 400 ms), fila de 1 por assento, anúncio para leitor de tela, avatares nos assentos e na sala de espera; avatares saem da árvore de acessibilidade (948f3d5) |
| 4F      | d24a5bd             | Criador de avatar em `/avatar` (`AvatarEditorScreen`, `AvatarEditorView`), entradas em Início e Configurações, `PUT /me/avatar`                                                                    |
| 4G      | não iniciado        | Rive web (`@rive-app/react-canvas`): depende de `assets/rive/avatar.riv`                                                                                                                           |
| 4H      | não iniciado        | Rive nativo (`rive-react-native`): depende de dev build e do `.riv`                                                                                                                                |
| 4I      | e3eea18, 08a7705    | Script de medição de FPS com 4 avatares, fora da suíte e do CI (e3eea18). Teste do bot de ausência com espera por condição, no onze/dez (08a7705)                                                  |
| Revisão | 948f3d5             | Correções da revisão da Rita-C: bot de ausência não sinaliza; avatares fora da árvore de acessibilidade; docs alinhados                                                                            |
| 4J      | este commit de docs | ADRs 0001 e 0002, nota de divergência na spec §7, plano, CHANGELOG, `apps/mobile/README.md`, `docs/protocolo-servidor.md` e `apps/server/README.md` (nota sobre bot de vaga), handoff da Fase 4    |

Nenhuma variável de ambiente nova nesta fase (`.env.example` inalterado).

## Decisões do usuário (2026-11-02)

- **Só o fallback vetorial nesta fase; Rive web depois** (4G). Rive nativo (4H) sem decisão formal; o plano recomenda a Fase 7.
- **Bot de ausência não sinaliza.** Só bot de vaga pode sinalizar. Hoje o servidor não cria vagas de bot: `botSeats` só recebe o bot de ausência (`TrucoRoom.ts`, `becomeBot`), e o sorteio de `botSignals` pula esses assentos. **Na prática nenhum bot sinaliza.** O código fica como está; decidir se e quando o servidor cria vagas de bot é pendência.
- **Catálogo de partes: 4, 6, 8, 4, 4, 6, 5, 8** (face_shape, skin, hair, eyes, mouth, outfit, accessory, bg_color). Só cresce; reordenar invalida avatares gravados.
- **`voice` fica para a Fase 5b.** Já existe no contrato (`VOICE_IDS`, `AvatarParts.voice`), mas nenhuma tela ou servidor o usa.

## Verificado executando comandos (2026-11-02)

- `pnpm exec turbo run test --force`: 11 tarefas com sucesso, sem cache. Contagens: protocol 54 (8 arquivos), rules 174 (12), ui 75 (9), avatar 26 (3), mobile 489 (34), server 430 (28). As mensagens de `stderr` no log do servidor vêm de um teste que confirma a recusa de host forjado; não são falhas.
- `pnpm build`: 7 tarefas com sucesso.
- `pnpm test:e2e`: 11 cenários passam (2,9 min). `e2e/table.spec.ts` (8) e `e2e/avatar.spec.ts` (3), Chromium, um worker.
- `pnpm --filter @trucaco/mobile test:int`: 23 passam e 1 pulado (`INT_SLOW`, só com `INT_SLOW=1`), em 4 arquivos. Inclui o teste de latência de sinal (7 casos em `table.int.test.ts`).
- `pnpm format:check`: sem diferenças (depois de formatar os `.md` desta fase). `pnpm lint` e `pnpm typecheck`: passam com `turbo run lint typecheck --force` (17 tarefas, sem cache).
- Latência de sinal: `test:int` (`apps/mobile/src/table/table.int.test.ts`, caso "sinal de um jogador aparece nos 4 ... em menos de 500 ms") roda contra o servidor real. Medição em rede real não feita.
- Script de FPS: ver a seção "Desempenho". A saída dele (`apps/mobile/test-results-perf/`) não era ignorada pelo Git nem pelo Prettier; foi adicionada a `.gitignore` e `.prettierignore` nesta fase.

## Desempenho (Chromium, `apps/mobile/e2e/perf`)

Números medidos em 2026-11-02 na máquina de desenvolvimento, informados pelo orquestrador da sessão de implementação. O observador é o jogador 0, com 4 avatares na mesa; cada medição dura `PERF_SECONDS` (padrão 10 s). Estes valores não foram reexecutados na sessão do relatório, exceto onde indicado abaixo.

| Cenário                            | CPU | FPS medio     | Observação                              |
| ---------------------------------- | --- | ------------- | --------------------------------------- |
| Ocioso                             | 1x  | 59,6 a 60     | respiração e piscada dos 4 avatares     |
| 4 sinais simultâneos               | 1x  | 59,6 a 60     | rajadas a cada ~3,3 s (cooldown de 3 s) |
| Ocioso                             | 4x  | 36 a 40       |                                         |
| 4 sinais simultâneos               | 4x  | 14,6 a 21,7   | **abaixo da meta de 50 FPS**            |
| Controle: `prefers-reduced-motion` | 4x  | 57,9 (ocioso) | sem animação contínua                   |

**Causa mais provável**: `useSignalAnimation.ts` e `useIdleAnimation` usam `useNativeDriver: Platform.OS !== 'web'`, então na web o `Animated` roda na thread JavaScript. Isso é leitura do código; não foi confirmado com perfil (painel Performance do Chromium).

**Medição de 2026-11-02 em aparelho**: nenhuma. A meta do plano (≥ 50 FPS em aparelho intermediário) continua aberta.

**Opções** (decisão do usuário, não tomada aqui):

1. Rebaixar ou desligar a respiração e o olhar ociosos só no web.
2. Resolver com Rive web (4G), o renderizador previsto para o web. Não medido.
3. Antes do beta, medir em aparelho intermediário com o Expo Go ou um build de teste.

**Como repetir** (o script não tem atalho no `package.json`; precisa de `pnpm build` antes):

```bash
pnpm build
pnpm --filter @trucaco/mobile exec playwright test -c e2e/perf/playwright.perf.config.ts
```

Variáveis: `PERF_SECONDS` (duração de cada medição, padrão 10), `PERF_PASSIVE=1` (o observador não sinaliza; só os outros 3 animam), `PERF_REDUCED=1` (controle com `prefers-reduced-motion`), `E2E_SKIP_BUILD=1` (reaproveita o `dist-e2e/` do último `test:e2e`). O script imprime linhas `[perf]` com FPS médio, p50, p95, p99, quadros acima de 33 ms e CPU do Chromium. O resultado depende da máquina.

**Reexecução nesta sessão** (2026-11-02, o comando documentado acima, `PERF_SECONDS` padrão 10, uma rodada, sem testes em paralelo; só comandos leves rodaram durante a medição). Saída do próprio script:

| Medição         | FPS médio | p95      | Quadros > 33 ms |
| --------------- | --------- | -------- | --------------- |
| 1x ocioso       | 60,0      | 16,8 ms  | 0 %             |
| 1x com 4 sinais | 59,7      | 16,8 ms  | 0,1 %           |
| 4x ocioso       | 42,4      | 33,4 ms  | 13,9 %          |
| 4x com 4 sinais | 17,7      | 200,1 ms | 45,9 %          |

Os valores batem com a faixa relatada acima. O 4x ocioso ficou um pouco acima da faixa de 36 a 40, e o 4x com sinais, um pouco abaixo da de 14,6 a 21,7. Uma rodada não mostra a variância; os números servem de ordem de grandeza. A rodada de 4x com sinais teve 3 rajadas (o script faz quantas couberem em `PERF_SECONDS`).

## Revisão

- Revisora da Fase 4: **Rita-C** (`rita-revisora-claude`, `opus`), por decisão do usuário. O Codex CLI do Windows não roda (erro 1332 do sandbox, ver Fase 3); a revisão por Codex segue pendente.
- Resultado relatado: 0 achados P1 e P2; 4 achados P3, corrigidos em 948f3d5. O relatório da revisão não fica no repositório; o registro é este.
- `vitor-seguranca`: **não rodou** nesta fase, por decisão do usuário. A fase toca `PUT /me/avatar` (validação do JSON de partes) e o canal de sinais; a auditoria fica pendente.

## Não validado

- **Aparência renderizada**: nenhum agente viu o avatar desenhado (sem screenshot revisado). Os testes checam estrutura, estado e marcadores, não a imagem.
- **iOS e Android**: nada nativo testado (sem simulador na nuvem).
- **Leitor de tela** (VoiceOver, TalkBack, leitor do navegador): textos de acessibilidade e anúncios dos sinais não foram ouvidos. Os textos não tiveram revisão de UX.
- **Segurar com o dedo**: o painel usa `delayLongPress` de 400 ms, testado com `mouse.down` no Chromium. Toque real em aparelho não foi testado.
- **Safari e Firefox**: o E2E roda só em Chromium.
- **Latência de sinal em rede real**: só o teste com servidor local.
- **Avatar após logout e login**: coberto por E2E só com reload (`avatar.spec.ts`).

## Lacunas e pendências

- **Arte do `.riv`**: quem produz é o usuário ou um ilustrador, a partir de `docs/avatar-rig.md`. Nenhum agente consegue produzir nem validar o arquivo. Sem ele, 4G e 4H não começam.
- **Dev build**: sem decisão do usuário para Rive nativo (4H).
- **Vagas de bot**: o servidor não cria; logo nenhum bot sinaliza. Ver "Decisões do usuário".
- **Desempenho**: meta de 50 FPS em aparelho não medida; web com CPU limitada abaixo da meta (ver "Desempenho").
- **Voz**: `AvatarParts.voice` reservado, não usado (Fase 5b).
- **Pendências antigas**: seguem em `docs/plano-desenvolvimento.md` (Fases 2 e 3) e no handoff `.claude/memory/handoff-fase-4.md`.
