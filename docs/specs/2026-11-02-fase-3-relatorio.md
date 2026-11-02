# Relatório da Fase 3: cliente jogável

Data: 2026-11-02. Branch `develop`, direto (sem PR), conforme o modo atual do projeto. Plano: `docs/specs/2026-11-02-fase-3-cliente-plano.md`. Estado da fase: `docs/plano-desenvolvimento.md`.

## Blocos e commits

| Bloco    | Commits                                           | Entrega                                                                                     |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 3A       | 4eb871e, 70c6bb9                                  | Contrato HTTP e snapshot de estado em `packages/protocol`                                   |
| 3B       | 32dd67e, 70c6bb9                                  | `POST /auth/logout`, handshake `trucaco.bearer` testado, `TRUCO_SEED` (dev/test)            |
| 3C       | a533cd8, bc17f60                                  | Esqueleto Expo SDK 58, Expo Router, export web                                              |
| 3D       | 63c15fb, 4025331                                  | Camada de rede: refresh em fila única, lock entre abas, cliente Colyseus com JWT no upgrade |
| 3E       | 613ccb6, de11e9d                                  | Telas de entrada, início, espera, configurações (Zustand)                                   |
| 3F/3G    | 9370620, ab04426                                  | `packages/ui`: cartas, leque, vira, placar em camadas, anúncios                             |
| 3G2      | 8bed41d                                           | Servidor publica manilha e valores de aposta                                                |
| 3H1      | c7a3d3a, 7cbe481                                  | Mesa jogável básica; `hand.actingSeat` publicado                                            |
| 3H2      | d5f71c1                                           | Mesa completa: mão de ferro, onze/dez, coberta, histórico, fim, voto, chat de texto         |
| 3H3      | 9779e86                                           | Balão de chat, chat na sala de espera, testes de interação                                  |
| Revanche | b6bd137 (servidor e protocolo), f09565e (cliente) | "Jogar de novo", `matchNumber`, rodízio do pé na revanche                                   |
| 3I       | dd8ab6e                                           | E2E Playwright (5 cenários) e job `e2e-web` no CI                                           |
| 3J       | (este commit de docs)                             | `protocolo-servidor.md`, `apps/mobile/README.md`, CHANGELOG, plano, este relatório          |

## Verificado executando comandos (2026-11-02)

- `pnpm format:check`: sem diferenças.
- `pnpm exec turbo run test --force`: passa em todos os pacotes. Contagens: rules 138, protocol 44, avatar 1, ui 75, mobile 390 (26 arquivos), server 419 (28 arquivos).
- `pnpm build`: passa.
- `pnpm --filter @trucaco/mobile test:int`: 18 passam, 1 pulado (`INT_SLOW`, só com `INT_SLOW=1`).
- `pnpm test:e2e`: 5 passam, Chromium, 1 worker, cerca de 1,7 min.
- CI do GitHub em `dd8ab6e` (run 41499226931, consultado pela API): `verify`, `integration` e `e2e-web` concluídos com sucesso.
- Dockerfile do servidor (informado pelo coordenador, não reexecutado aqui): `docker build -f infra/Dockerfile.server` ok depois da troca de `corepack prepare` por `npm install -g pnpm@9.15.9`; imagem de cerca de 616 MB; `GET /health` 200; healthcheck `healthy`; `POST /auth/guest` ok contra Postgres 16 e Redis reais após `db:deploy`.

## Revisão

- Revisora das Fases 1 a 3: Rita-C (`rita-revisora-claude`, `opus`). O Codex CLI do Windows falha com erro 1332 do sandbox, então nenhuma revisão por Codex foi feita.
- Achados da revisão do 3H1 (P2 e P3) estão aplicados no 3H2. Conferido por leitura: `actingSeat` em uso, texto "Sua dupla decide", diálogo de saída com `accessibilityViewIsModal`, código morto do `tableStore` removido. Os itens de P3 não foram reconferidos um a um.

## Lacunas

- iOS, Android, aparelho real, Expo Go, leitor de tela e Safari: não testados (sem simulador na nuvem; o E2E é só Chromium).
- Fly.io real e WebSocket de sala dentro do contêiner: não testados.
- Revisão por Codex: pendente.
- Pendências de produto e decisões assumidas por padrão: listadas em `docs/plano-desenvolvimento.md` (Fase 3) e em "Decisões a confirmar" no `CHANGELOG.md`.
