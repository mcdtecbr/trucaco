# Relatório da Fase 5: chat da dupla e combinado de sinais

Data: 2026-11-03. Branch `develop`, direto (sem PR), conforme o modo atual do projeto. Plano de execução: `docs/specs/2026-11-02-fase-5-chat-dupla-plano.md`. Estado da fase: `docs/plano-desenvolvimento.md`. Protocolo e servidor: `docs/protocolo-servidor.md` (seção "Combinado da dupla"). Cliente: `apps/mobile/README.md` (seção "Combinado da dupla e silenciar").

Resumo: a sala de espera virou a "preparação" da dupla (chat da dupla e painel "Combinar sinais"), sem tela nova e sem fase com timer. O combinado de sinais é privado da dupla, trafega pela sala (`setCode` e `codes`) e é gravado em `partner_codes` por par. Balões de 4 s e frases rápidas já existiam desde a Fase 3. A fase fica **concluída com ressalvas**: não houve validação em iOS, Android, leitor de tela nem navegadores além do Chromium, e restam duas pendências de revisão (P3-5 e a contagem de P3) e três divergências registradas abaixo.

## Blocos e commits

| Bloco | Commits                      | Entrega                                                                                                                                                                                                                                                                             |
| ----- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plano | 6bd8e6a                      | `docs/specs/2026-11-02-fase-5-chat-dupla-plano.md` (artur-arquiteto, somente leitura)                                                                                                                                                                                               |
| 5A    | edd6f93                      | Contrato em `packages/protocol`: `setCode` (cliente), `codes` (servidor, só à dupla), `PARTNER_CODE_MAX_LENGTH` = 60, `CODES_COOLDOWN_MS` = 1 s, `cleanPartnerCode`, `CODE_NOT_SAVED` em `ERROR_CODES`. Teto de 140 caracteres do banco e da REST passou a 60                       |
| 5B    | edd6f93                      | Servidor (`TrucoRoom.ts`): `setCode` com cooldown; carga de `partner_codes` quando o par humano se forma; reenvio na retomada e no `ready`; gravação do par que já jogou junto a cada edição; gravação do par novo ao fim da 1ª partida `finished`; chat da dupla na espera         |
| 5C    | c0db943                      | Estado do cliente: `tableStore.codes`, `tableController.onCodes` e `sendCode`, aviso do sinal do parceiro (`partnerSignalNote`, 5 s), chat da dupla na espera (`WAITING_SCOPES`), limpeza por ocupante trocado, silenciar por jogador (`mutedStore`, `trucaco.muted.v1`)            |
| 5D    | c0db943                      | Telas: `CodesPanel.tsx` (painel "Combinar sinais" na espera e na mesa), combinado sob o sinal em `SignalPanel.tsx`, botão "Silenciar" em `ChatPanel.tsx`, textos de erro em `i18n/errors.ts`                                                                                        |
| 5E    | 296741d                      | Testes de sala para gravação e recarga do combinado (`TrucoRoom.test.ts`) e de `mutedStore`                                                                                                                                                                                         |
| 5E    | c0db943                      | Também em c0db943: `codes.int.test.ts` (servidor real, 3 casos), `codes.spec.ts` (E2E, 2 cenários), `codesPanelProps.test.ts`, `tableController.codes.test.ts`, `interaction.test.tsx`                                                                                              |
| Fix   | 738b363                      | `ready` não consome o limite de 150 ms das ações; tem limite próprio de 500 ms (`READY_MIN_INTERVAL_MS`)                                                                                                                                                                            |
| Fix   | 278afb6                      | Combinado não é apagado quando a leitura do banco falha; salvar sem duplo envio; bots fora do "Silenciar"                                                                                                                                                                           |
| Fix   | debe97b                      | Limpeza do combinado também na REST (`assertPartnerCodes` no `PUT`); gravação coalescida (no máximo uma em voo por par); aviso `CODE_NOT_SAVED` no cliente                                                                                                                          |
| 5F    | não há commit                | Auditoria de `vitor-seguranca` (ver "Revisão")                                                                                                                                                                                                                                      |
| 5G    | edd6f93, debe97b, sem commit | Docs: `docs/protocolo-servidor.md`, `docs/banco-de-dados.md`, `apps/server/README.md` (edd6f93); `protocolo-servidor.md` (738b363 e debe97b); `docs/sinais.md`, `apps/mobile/README.md`, `docs/plano-desenvolvimento.md`, `CHANGELOG.md` e este relatório (sem commit nesta sessão) |

Nenhuma variável de ambiente nova (`.env.example` inalterado). Nenhuma migração: o banco impõe só tipo e tamanho; o teto de 60 é da aplicação (`dalva-dba` não foi acionado).

## Decisões do usuário

- **Sala de espera como preparação, sem fase nova e sem timer.** O painel "Combinar sinais" também abre na mesa. Pergunta 1 do plano.
- **Teto de 60 caracteres** por significado, único teto (no protocolo, na REST e no banco da aplicação). Substitui os 140 da rota REST.
- **Par novo grava ao fim da 1ª partida terminada.** Série cancelada não grava (mantém `NOT_PARTNERS`). Par já vinculado grava a cada edição.
- **Silenciar só local, sem filtro de palavrões.** A preferência fica no aparelho (`localStorage` no web, `expo-secure-store` no nativo), é por apelido normalizado e não vai ao servidor. Bloqueio e denúncia ficam na Fase 6.
- **Convidado perde o combinado ao sair da conta, com aviso.** O vínculo entre contas é `POST /auth/link` (Fase 6).

## Revisão

- **Rita-C** (`rita-revisora-claude`, `opus`), por falta do Codex funcional (erro 1332 do sandbox no Windows). Resultado relatado: 2 P2 e 5 P3. Corrigidos: 2 P2 e 3 P3. **Pendente: P3-5**, que é mostrar o significado tradicional em cinza no painel de sinais da mesa e o aviso "combinado salvo para esta dupla" (hoje não existem no código; o campo do painel "Combinar sinais" mostra o significado tradicional como placeholder).
- **Contagem não fecha**: 5 P3 com 3 corrigidos deixam 2 abertos, mas só o P3-5 foi identificado. O outro P3 aberto não foi informado. Confirmar com a Rita antes do beta.
- **vitor-seguranca**, 2 rodadas: 0 achado alto ou médio; 6 baixos corrigidos. Auditoria por leitura do código, **sem script de prova**. O relatório da auditoria não fica no repositório; o registro é este.
- Revisão por Codex: **nunca feita** (pendência antiga, ver handoff).

## Verificado nesta sessão (2026-11-03)

- `pnpm exec turbo run test --force` (sem cache): 11 tarefas com sucesso, 2 min 41 s. Contagens reais: protocol 61 (9 arquivos), rules 174 (12), ui 75 (9), avatar 26 (3), mobile 546 (37), server 456 (28). Total de 1338 testes unitários. Fase 4 tinha protocol 54, mobile 489 e server 430.
- Conferido no código, por leitura e `grep`: `CODE_NOT_SAVED` (`packages/protocol/src/errors.ts`, `TrucoRoom.ts`, `i18n/errors.ts`); `setCode` e `codes` (`messages.ts`, `TrucoRoom.ts`); `READY_MIN_INTERVAL_MS` = 500; `CODES_COOLDOWN_MS` = 1000; `PARTNER_CODE_MAX_LENGTH` = 60; rota `GET`/`PUT /me/partners/:partnerId/codes` em `apps/server/src/http/rest.ts`; `partnerSignalNote` com `PRESENCE_NOTE_MS` = 5000; `mutedStorage` por plataforma.
- `pnpm format:check` (repositório inteiro, depois de formatar os `.md` desta fase): sem diferenças.
- Não executados nesta sessão: `pnpm test:int`, `pnpm test:e2e` (os testes de integração e E2E da Fase 5 existem, mas não foram rodados por esta sessão de documentação) e `pnpm lint`/`pnpm typecheck`/`pnpm build` (fora do escopo desta sessão).

## Divergências encontradas (documentadas, não corrigidas)

1. **Aviso de convidado aparece para todos.** `apps/mobile/src/screens/TableRoomScreen.tsx` passa `guest: true` fixo para `buildCodesPanelProps`. O aviso deveria depender do provedor da sessão. Dono: `fabio-frontend`.
2. **Comentário de `CODE_NOT_SAVED` inexato.** `packages/protocol/src/errors.ts` diz "(falha ou gravação desligada nesta mesa)", mas quando `users` não existe o servidor não emite o erro (`setCode` retorna antes do aviso). Só falha de leitura ou de gravação emite. Dono: `caio-colyseus` (comentário, sem mudança de comportamento).
3. **REST `GET` sem limpeza.** O plano dizia que `GET` e `PUT` usam a limpeza. Só o `PUT` limpa; o `GET` devolve o gravado, então um valor legado de até 140 caracteres volta inteiro (a sala é que descarta). Corrigido na doc (`docs/protocolo-servidor.md`); o código não mudou.
4. **Significado em cinza no painel de sinais da mesa** (P3-5): planejado, não implementado.

## Não validado

- **iOS e Android**: nada nativo testado (sem simulador na nuvem). Inclui o `expo-secure-store` do silenciar.
- **Silenciar no nativo**: a persistência em `expo-secure-store` só tem teste com a implementação de memória.
- **Leitor de tela**: o anúncio do combinado e do sinal do parceiro não foi ouvido.
- **Aparência**: o painel "Combinar sinais" e o combinado sob o sinal não foram vistos renderizados.
- **Layout em tela estreita**: o painel com 12 campos não foi verificado em telas pequenas.
- **Safari e Firefox**: o E2E roda só em Chromium.
- **Postgres lento e multi-instância**: não medidos. O estado da sala está em memória por processo.
- **Toque real**: "segurar" o sinal foi testado com mouse (Chromium), como na Fase 4.

## Lacunas e pendências

- **Pendências de revisão**: P3-5 e o P3 não identificado (ver "Revisão").
- **Convidado**: o combinado some ao sair da conta e não tem expurgo. O vínculo depende de `POST /auth/link` (Fase 6, ainda `501`).
- **Retomada da mesa da fila pública depois de 60 s**: não há rota. `POST /tables/join` serve só mesa privada (ver `apps/mobile/README.md`, "Retomar a mesa").
- **Vagas de bot**: continuam sem ser criadas; o sorteio de sinal do bot não dispara.
- **Revisão por Codex**: pendente (erro 1332 do sandbox no Windows).

## Riscos

- **Convidado**: combinado perdido ao sair da conta, sem expurgo de `partner_codes` de pares órfãos.
- **Estado em memória por processo**: `codesByTeam` (`pairs` na sala) e a fila de gravação vivem no processo. Queda do processo no meio da partida perde o combinado do par novo (a gravação só ocorre ao fim da primeira partida). Multi-instância exige Redis.
- **Gravação do par novo depende do `saveMatch`**: se a gravação da partida falha, o combinado do par novo também não é gravado (o `persistNewPairs` só roda depois do `saveMatch` resolver com `finished`).
- **Silenciar por apelido**: a chave é o apelido normalizado; o cliente não conhece o `userId` dos outros. O servidor garante apelidos únicos (`NICKNAME_TAKEN`), então a chave é estável nesta fase.
