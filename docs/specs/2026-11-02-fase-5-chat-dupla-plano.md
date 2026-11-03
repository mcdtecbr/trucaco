# Fase 5: plano do chat da dupla, combinado de sinais e balões

Autor: `artur-arquiteto` (somente leitura), 2026-11-02. Complementa `docs/plano-desenvolvimento.md` (Fase 5) e as §5 e §6 do design. Tudo o que está em "existe" foi conferido no código; o que está em "falta" não existe hoje.

## 1. O que já existe (conferido)

| Item                                 | Onde                                                                                                                                                                                                                                      | Estado                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat `table` e `partner`             | `apps/server/src/rooms/TrucoRoom.ts` (`social`, `isChatRecipient`, `canReceiveChat`)                                                                                                                                                      | `partner` vai só à dupla (`teamOf(seat)`) com eco; cooldown 2 s; **ignorado fora de `playing`** (`if (msg.scope === 'partner' && !playing) return`). `canReceiveChat` é o gancho para silenciar/bloquear |
| Validação do texto                   | `packages/protocol/src/messages.ts` (`cleanChatText`, `parseClientMessage`)                                                                                                                                                               | 140 caracteres; controle, ZWJ, bidi e zalgo rejeitados (`CHAT_BLOCKED`). Mesma função no cliente e no servidor                                                                                           |
| Frases rápidas                       | `packages/protocol/src/catalogs.ts` (`QUICK_PHRASES`, 8 ids)                                                                                                                                                                              | Validadas pelo servidor; botões no `ChatPanel`. **Atende o critério "frases rápidas" da Fase 5**                                                                                                         |
| Painel de chat com abas Mesa e Dupla | `apps/mobile/src/screens/ChatPanel.tsx`, `chatPanelProps.ts`, `table/tableStore.ts`, `table/tableController.ts`                                                                                                                           | Na espera só a aba Mesa (`WAITING_SCOPES` em `TableRoomScreen.tsx`). O controlador descarta chat `partner` de outro time (defesa em profundidade)                                                        |
| Balão sobre o avatar, 4 s            | `packages/ui/src/ChatBubble.tsx` (`CHAT_BUBBLE_MS`, 80 code points, rótulo "Dupla"), `TableView.tsx` (`Bubble`)                                                                                                                           | **Feito na Fase 3**. Só na mesa; a sala de espera não mostra balão                                                                                                                                       |
| Sala de espera                       | `apps/mobile/src/screens/WaitingRoomView.tsx`                                                                                                                                                                                             | Código, 4 assentos com avatar, chat da mesa, sair. **Não há tela "Preparação"** em `apps/mobile/app/` nem em `screens/`                                                                                  |
| Painel e catálogo de sinais          | `apps/mobile/src/screens/SignalPanel.tsx`; `packages/avatar/src/signals.ts` (`SIGNALS` com `meaning` padrão)                                                                                                                              | 12 botões, segurar 400 ms. **Não mostra significado** (nem o padrão, nem combinado)                                                                                                                      |
| `partner_codes`                      | `apps/server/prisma/schema.prisma` (`PartnerCodes`), `db/validation.ts` (`assertPartnerCodes`, 140), `db/prismaRepositories.ts` (`havePlayedTogether`, `getPartnerCodes`, `savePartnerCodes`), `db/memoryRepositories.ts`, `http/rest.ts` | Completo no servidor. `savePartnerCodes` exige partida `finished` na mesma dupla (`NotPartnersError` → `403 NOT_PARTNERS`). **Nenhum uso no cliente** (`apps/mobile/src/net/api.ts` não tem a rota)      |
| Identidade do parceiro               | `TrucoRoom.userBySeat` (memória); `docs/protocolo-servidor.md` §6: `userId` não está no estado                                                                                                                                            | **O cliente não conhece o `userId` do parceiro** e não consegue chamar a rota REST de códigos                                                                                                            |
| `ready`                              | `TrucoRoom.ts` (`case 'ready'`)                                                                                                                                                                                                           | Aceito e ignorado; a partida começa no tick seguinte ao 4º assento (`onJoin` → `startGame`)                                                                                                              |
| Regra dos 4 `userId` distintos       | `docs/gamificacao.md` (nota de revanche)                                                                                                                                                                                                  | Só para conquistas e ranking (Fases 6 e 9). `havePlayedTogether` ignora bot (`user_id` NULL) e não filtra `bot_from`                                                                                     |

## 2. O que falta

1. Chat da dupla na sala de espera (servidor ignora `partner` fora de `playing`; cliente só mostra a aba Mesa).
2. Combinado de sinais: painel com os 12 sinais, significado padrão e campo para o combinado, na espera e na mesa; o parceiro vê a edição ao vivo; o combinado aparece no painel de sinais e quando o parceiro sinaliza.
3. Transporte e persistência do combinado sem expor `userId` (hoje só existe REST por `partnerId`).
4. Primeira dupla: `savePartnerCodes` recusa antes da primeira partida terminada; o combinado da primeira mesa precisa sobreviver até o fim dela.
5. Moderação mínima e auditoria do chat (filtro, rate limit, vazamento entre canais).

## 3. Solução proposta

**Sem tela nova e sem fase nova.** A sala de espera vira a "preparação" (chat da dupla e painel "Combinar sinais"); o mesmo painel abre na mesa. A fila pública senta os 4 de uma vez e começa no mesmo tick, então na pública a dupla combina durante o jogo. Ver pergunta 1.

**O combinado trafega pela sala, não por REST.** O servidor conhece `userBySeat`, o par da dupla e o repositório; o cliente nunca vê `userId`. Fluxo:

- Carregar: quando os dois assentos de um time ficam com humanos (`onJoin` ou retomada), a sala chama `users.getPartnerCodes(a, b)` uma vez por par, guarda `codesByTeam: Map[Team, PartnerCodesMap]` e `linkedByTeam` (resultado de `havePlayedTogether`) e envia `codes` aos dois. Troca de ocupante antes da partida: recarrega para o novo par e manda `codes {}` ao parceiro que ficou.
- Editar: `setCode { signalId, meaning }` (`meaning` vazio apaga). Validação igual ao chat (`cleanChatText`), teto `PARTNER_CODE_MAX_LENGTH`, cooldown de 1 s por assento; o servidor atualiza o mapa do time e envia o mapa completo (`codes`) aos dois assentos.
- Persistir: par já vinculado (`linkedByTeam`) grava a cada `setCode` (upsert em segundo plano; falha só loga). Par novo grava em `persistMatch`, depois de `saveMatch` resolver com `status: 'finished'`, só para times com 2 `userId` humanos distintos e mapa não vazio. Série cancelada não grava (coerente com `NOT_PARTNERS`).
- Reconexão e retomada: reenvia `codes` ao assento retomado (como o `sync` do estado). Bot de ausência não recebe.

**Contrato em `packages/protocol` (aditivo; `PROTOCOL_VERSION` segue 2):**

```ts
// catalogs.ts
export const PARTNER_CODE_MAX_LENGTH = 60; // substitui PARTNER_CODE_MAX (140) de apps/server/src/db/validation.ts
export const CODES_COOLDOWN_MS = 1000;
// messages.ts, ClientMessage
{
  type: 'setCode';
  signalId: SignalId;
  meaning: string;
}
// messages.ts, ServerMessage (só aos 2 assentos da dupla; by = -1 quando carregado do banco)
{
  type: 'codes';
  codes: Readonly<Partial<Record<SignalId, string>>>;
  by: Seat | -1;
  at: number;
}
```

Erros reaproveitados: `INVALID_PAYLOAD` (id fora de `SIGNAL_IDS`; conta strike como hoje), `CHAT_BLOCKED` (texto recusado pela limpeza), `RATE_LIMITED`. Nenhum código novo; `TABLE_PHASES` não muda. `setCode` é unitário porque o mapa inteiro com 140 caracteres estouraria `MAX_MESSAGE_BYTES` (1024); o `codes` do servidor não passa por esse limite (só entrada).

**Cliente:** `tableStore` ganha `codes`; `tableController` ganha `onCodes` e `sendCode` (valida com `parseClientMessage` antes de enviar); `SignalPanel` mostra sob cada sinal o combinado ou, em cinza, o `meaning` padrão de `SIGNALS`; ao receber `signal` do parceiro, o anúncio e um aviso curto na mesa dizem "Parceiro: piscou = tenho zap" (só quem tem o mapa vê, e só a dupla o tem). `WAITING_SCOPES` passa a `['table', 'partner']`. Ao mudar o ocupante de um assento na espera, o controlador apaga chat `partner` e balão daquele assento (hoje `nicknameOf(seat)` reatribuiria mensagens antigas ao novo jogador).

**Moderação mínima (Fase 5):** silenciar por assento no cliente (esconde chat e balões daquele assento nesta mesa; preferência local, não vai ao servidor). Bloqueio e denúncia persistentes ficam na Fase 6 (`canReceiveChat` já é o gancho). Sem filtro de palavrões (pergunta 4).

## 4. Blocos (S = exige `vitor-seguranca`)

| Bloco                | Agente            | Arquivos                                                                                                                                                                                                                                                                            | Pronto quando                                                                                                                                                                                                                              |
| -------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5A contrato (**S**)  | `caio-colyseus`   | `packages/protocol/src/{catalogs,messages,index}.ts` e testes; `apps/server/src/db/validation.ts` (`PARTNER_CODE_MAX` importa do protocol); `apps/server/src/errorCodes.contract.test.ts` (sem código novo)                                                                         | `parseClientMessage` aceita `setCode` válido e recusa id fora do catálogo, texto sujo e acima de 60; `parseServerMessage` reconhece `codes`; `protocol` e `server` verdes                                                                  |
| 5B servidor (**S**)  | `caio-colyseus`   | `apps/server/src/rooms/TrucoRoom.ts` (config `users?: UserRepository`, `codesByTeam`, `linkedByTeam`, `partner` na espera, `setCode`, reenvio na retomada, gravação em `persistMatch`), `apps/server/src/server.ts` (injeta `deps.users`), `TrucoRoom.test.ts`, `db/db.int.test.ts` | Testes de sala: adversário nunca recebe `codes` nem chat `partner` (espera e jogo); `setCode` em cooldown dá `RATE_LIMITED`; retomada reenvia `codes`; par novo grava só após `finished`; par vinculado grava na hora; cancelada não grava |
| 5C estado do cliente | `fabio-frontend`  | `apps/mobile/src/table/{tableStore,tableController}.ts` e testes; `screens/TableRoomScreen.tsx` (`WAITING_SCOPES`)                                                                                                                                                                  | `onCodes` atualiza o mapa; `sendCode` valida antes de enviar; chat `partner` na espera; limpeza por troca de ocupante; silenciar por assento                                                                                               |
| 5D telas             | `fabio-frontend`  | `screens/CodesPanel.tsx` (novo), `WaitingRoomView.tsx`, `TableView.tsx`, `SignalPanel.tsx`, `ChatPanel.tsx` (silenciar), `i18n/errors.ts`; `views.test.tsx`, `tableView.test.tsx`                                                                                                   | Dupla combina na espera e o combinado aparece no painel de sinais dos dois; sinal do parceiro mostra o combinado; todo texto pelo componente Text, nunca HTML; leitor de tela lê sinal e significado                                       |
| 5E QA                | `catia-qa`        | `apps/mobile/e2e/table.spec.ts` (ou `codes.spec.ts` novo), `apps/mobile/src/net/*.int.test.ts`                                                                                                                                                                                      | E2E: A e C combinam `wink` = "tenho zap" na espera; na mesa C vê o texto quando A pisca; B e D não recebem `codes` (interceptar mensagens). Int: segunda mesa da mesma dupla após partida `finished` recebe `codes` com `by: -1`           |
| 5F auditoria (**S**) | `vitor-seguranca` | Diff de 5A a 5D; `docs/protocolo-servidor.md`                                                                                                                                                                                                                                       | Sem achado alto: vazamento entre canais, `setCode` de assento fora da dupla, rate limit, strikes, nenhum texto em log, schema ou replay                                                                                                    |
| 5G docs              | `teo-docs`        | `docs/protocolo-servidor.md` (§5, §6, §8, §9 e seção "Combinado da dupla"), `docs/sinais.md`, `docs/banco-de-dados.md` (60), design §6 (espera = preparação), `CHANGELOG.md`, `docs/plano-desenvolvimento.md`                                                                       | Docs batem com o código                                                                                                                                                                                                                    |

`dalva-dba`: sem migração (o banco impõe só tipo e tamanho; o teto de 60 é da aplicação). Só entra se o usuário quiser `updated_at` para o expurgo, fora desta fase.

Ordem: 5A, 5B, 5C, 5D (5C e 5D podem andar em paralelo com 5B depois de 5A), 5E, 5F e revisão (`rita-revisora`, ou Rita-C sem Codex), 5G. Commit e push a cada bloco verificado.

## 5. Segurança (o que 5B e 5F garantem)

- Destino sempre por `teamOf(seat)` do servidor; `seat` e time nunca vêm do cliente. `codes` só a sockets vivos dos 2 assentos do time; bot de ausência e assento caído não recebem (nada enfileirado).
- Texto do combinado passa pela mesma limpeza do chat; nunca vai a `eventLog`, schema, replay nem log (só metadados: assento, sinal, tamanho).
- `setCode`: cooldown 1 s; id inválido conta strike como `INVALID_PAYLOAD`; vale na espera, no jogo e na janela de revanche (não exige `playing`).
- Adversário não infere o combinado por canal nenhum: o sinal segue público (design), o significado fica só na dupla. O cliente continua descartando `codes` e chat `partner` de outro time (defesa em profundidade já existente para o chat).
- As rotas REST `GET` e `PUT /me/partners/:partnerId/codes` ficam como estão (uso futuro no perfil, Fase 6); a sala nunca expõe `partnerId`.

## 6. Riscos

- **Convidado troca de `userId` a cada logout**: o combinado persiste por par de ids; quem sai da conta de convidado perde o vínculo até `POST /auth/link` (Fase 6). Ver pergunta 5.
- **Reduzir 140 para 60** altera `assertPartnerCodes` e a doc do banco; não há dado em produção. Valores de 140 já gravados por REST seriam devolvidos inteiros (só leitura), sem quebrar.
- **Fila pública**: sem espera, o combinado se faz durante o jogo; o painel na mesa tem de abrir com um toque para não atrapalhar o turno de 20 s.
- **`persistMatch` grava em segundo plano**: a gravação dos códigos do par novo depende do `saveMatch` resolver; `onDispose` já espera `pendingSaves` (`DISPOSE_FLUSH_MS`); incluir a segunda gravação na mesma espera.
- **Estado por processo**: `codesByTeam` vive na sala (por mesa, correto); nada novo para multi-instância.

## 7. Perguntas ao usuário (cada uma muda o plano)

1. **Janela de preparação com tempo?** A spec cita uma tela "Preparação" entre Início e Mesa. Proposta: não criar fase nem timer; a sala de espera é a preparação e o painel de combinar fica também na mesa. Alternativa: fase `preparing` de 30 a 45 s com botão "Pronto" (nova `TablePhase`, `ready` passa a valer, testes de sala e E2E com janela 0). **Recomendação: sem fase nova.**
2. **Teto do significado: 60 caracteres** (cabe no painel e numa mensagem) em vez dos 140 atuais da rota REST. **Recomendação: 60, único teto, no protocol.**
3. **Par ainda sem partida terminada**: gravar o combinado ao fim da primeira partida `finished` (mantém `NOT_PARTNERS` e a regra atual) ou relaxar para "sentaram juntos nesta mesa" (grava na hora, cria linhas para pares que nunca jogam). **Recomendação: gravar ao fim da primeira partida.**
4. **Moderação nesta fase**: silenciar por assento só no cliente (sim) e filtro de palavrões (não; listas em pt-BR erram muito, e denúncia e bloqueio vêm na Fase 6). **Recomendação: silenciar local sim, filtro não.**
5. **Convidados**: aceitar que o combinado some ao sair da conta de convidado (até o vínculo da Fase 6) e mostrar "Combinado salvo para esta dupla" só quando o par estiver vinculado. **Recomendação: aceitar e avisar.**
