# Infra: runbook do beta na Fly.io

Topologia (Fase 7, decisões do usuário de 2026-11-05): **uma** máquina Fly com o servidor Colyseus e o web estático na mesma origem; Postgres e Redis gerenciados; só web no beta. Nada aqui foi aplicado: os arquivos estão prontos e os comandos abaixo são para quem tem a conta Fly.

| Arquivo                        | Função                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `infra/fly.toml`               | App, região, máquina única, checks, `release_command` de migração, variáveis não secretas  |
| `infra/Dockerfile.server`      | Estágios `build` (servidor), `web` (export do Expo), `migrate` (CLI do Prisma) e `runtime` |
| `infra/docker-compose.yml`     | Postgres e Redis locais de desenvolvimento (`pnpm db:up`)                                  |
| `.github/workflows/deploy.yml` | Deploy em push na `master`, com CI verde, aprovação manual e smoke                         |

## Como o web fica na mesma origem

O servidor serve `/app/web` (export do Expo copiado para a imagem) quando `WEB_DIST_DIR=/app/web`. Sem `EXPO_PUBLIC_SERVER_URL`, o web de produção usa a origem da própria página (`apps/mobile/src/net/config.ts`), então a mesma imagem serve em qualquer domínio e trocar de domínio não exige novo build. O build arg `EXPO_PUBLIC_SERVER_URL` só serve para apontar o web para outra origem (https em produção).

## Antes do primeiro deploy (uma vez, por quem tem a conta Fly)

Instale o `flyctl` e faça `fly auth login`. Tudo a partir da raiz do repositório.

1. **Nome do app.** Escolha um nome único e troque `trucaco-beta-TROCAR` em `infra/fly.toml` (só a linha `app`). Confirme a região: `fly platform regions` (padrão `gru`).
2. **Criar o app sem implantar:** `fly apps create <nome>`.
3. **Postgres.** Crie o Postgres gerenciado da Fly na mesma região e obtenha a connection string. O servidor precisa de Postgres 16, banco UTF-8 (a migração usa normalização Unicode). Se o produto oferecer `fly postgres attach`, ele define `DATABASE_URL` sozinho; senão defina à mão (abaixo). Verifique o produto atual na documentação da Fly antes de criar: o Postgres "Fly Postgres" não gerenciado e o "Managed Postgres" têm preços, backups e comandos diferentes.
4. **Redis (Upstash, pela Fly):** `fly redis create` (região igual). Exija persistência e política `noeviction`: sem isso famílias de refresh podem sumir e todos perdem a sessão. Confira no painel do Upstash (eviction desligada, persistência ligada) e anote a URL `rediss://...`.
5. **Segredos** (somente por `fly secrets`, nunca em arquivo):

   ```bash
   fly secrets set -a <nome> \
     JWT_SECRET="$(openssl rand -base64 48)" \
     DATABASE_URL="postgresql://..." \
     REDIS_URL="rediss://..."
   ```

   | Secret              | Obrigatório          | Observação                                                                                                                                                                                                                             |
   | ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `JWT_SECRET`        | sim                  | Mínimo 32 bytes, aleatório. O servidor recusa subir sem ele e recusa o valor de exemplo                                                                                                                                                |
   | `DATABASE_URL`      | sim                  | Também usado pelo `release_command`                                                                                                                                                                                                    |
   | `REDIS_URL`         | sim                  | Obrigatório fora de dev/test                                                                                                                                                                                                           |
   | `GOOGLE_CLIENT_IDS` | só com login social  | IDs públicos do Google Cloud, separados por vírgula. Vazio desliga o provedor (`SOCIAL_LOGIN_DISABLED`)                                                                                                                                |
   | `APPLE_CLIENT_IDS`  | não no beta (só web) | Deixe sem definir                                                                                                                                                                                                                      |
   | `METRICS_TOKEN`     | opcional             | Mínimo 32 caracteres (`openssl rand -base64 48`). Sem ele `GET /metrics` não existe (404); com ele, só responde a `Authorization: Bearer <token>`. Defina com `fly secrets set METRICS_TOKEN=...`; o monitor externo usa o mesmo token |

   `CORS_ORIGINS` fica **vazio** (não defina): a mesma origem não precisa de CORS. Não defina `TRUCO_SEED`, `TRUCO_PROGRESSION_RELAXED` nem `AUTH_TEST_IDENTITY`: o servidor se recusa a subir com eles fora de dev/test. As demais variáveis (limites de rate limit, TTLs) têm padrão seguro; lista em `.env.example` e `apps/server/README.md`.

6. **Backup do Postgres: A CONFIRMAR.** Antes de abrir o beta, confirme no painel/CLI da Fly que existe backup diário (ou snapshots) com retenção definida, e faça **um restore de teste** num banco descartável. Sem isso o beta não abre.
7. **Domínio e certificado** (opcional, o `<app>.fly.dev` já tem TLS): `fly certs add <dominio> -a <nome>`, crie o CNAME ou A/AAAA que o comando indicar no DNS e aguarde `fly certs show <dominio>` ficar `Issued`. Defina a variável de repositório `PRODUCTION_URL` no GitHub (usada pelo smoke).

## Primeiro deploy

```bash
fly deploy . --config infra/fly.toml --dockerfile infra/Dockerfile.server --remote-only
fly status -a <nome>
fly logs -a <nome>
```

O ponto final é o contexto de build (raiz do repo). O `release_command` roda `prisma migrate deploy` numa máquina temporária antes de trocar a versão; se a migração falhar, o deploy aborta e a versão antiga continua no ar. Garanta **uma** máquina: `fly scale count 1 -a <nome>` (o estado em memória não funciona com duas instâncias).

## Deploy pelo GitHub Actions

`.github/workflows/deploy.yml` roda em push na `master` e em `workflow_dispatch`: replica o job `verify` do CI, pede aprovação do ambiente `production`, faz `flyctl deploy --remote-only` e executa o smoke (`/health` com `status: ok` e a `PROTOCOL_VERSION` lida do código; `GET /` com o `index.html`). Configuração no GitHub (quem administra o repositório):

1. Settings, Environments, **New environment** `production`, com **Required reviewers** (a aprovação manual) e **restrição de branch obrigatória** (Deployment branches: só `master`). O job também checa `github.ref == 'refs/heads/master'`, mas a restrição do ambiente é a barreira que protege o secret.
2. No ambiente (não no repositório), secret **`FLY_API_TOKEN`**: `fly tokens create deploy -a <nome>`. Sem ele o job falha com mensagem clara e nada é implantado. O token só é exposto aos passos "Exigir o secret" e "Deploy" (não ao job inteiro) e todas as actions estão fixadas por SHA de commit (tag em comentário).
3. Opcional: variável de repositório `PRODUCTION_URL` (domínio próprio).

## Rollback

```bash
fly releases -a <nome>                 # lista versões e imagens
fly deploy . --config infra/fly.toml --image registry.fly.io/<nome>:<tag-anterior> -a <nome>
```

Cuidado: o rollback troca a imagem, **não desfaz migrações**. Migração que remove ou renomeia coluna só é reversível com restauração do backup; por isso toda migração do beta deve ser aditiva (compatível com a versão anterior da imagem) e o backup deve estar confirmado. O `--image` com o `release_command` roda `migrate deploy` de novo (sem efeito se nada pendente). Todo deploy ou rollback derruba as mesas em andamento (estado em memória): prefira horário de pouco uso e avise os testadores.

## Regras

- **Nunca rodar `pnpm db:migrate` (`prisma migrate dev`) de uma máquina de desenvolvimento contra o banco de produção.** O único caminho de migração em produção é o `release_command`. `db:migrate` de dev pode resetar dados e gera migrações; contra produção é perigoso.
- Segredos só em `fly secrets` e secrets do GitHub. Nada em `fly.toml`, `.env.example` ou logs.
- Sem `latest`: imagens base, Node, pnpm e actions têm versão fixa (a exceção declarada é o `flyctl` instalado pela action, que segue a versão estável dela; o CLI do Prisma da imagem usa a versão exata do `apps/server/package.json`, sem lockfile para as dependências transitivas dele).
- Uma mudança de pipeline por commit.

## Checagens pós-deploy (itens a verificar da auditoria do Vitor)

Faça logo depois do primeiro deploy e registre o resultado no relatório da fase.

1. **`Fly-Client-IP` não é forjável.** Contra o app real: `curl -s -X POST https://<app>/auth/guest -H 'Fly-Client-IP: 203.0.113.9'` várias vezes (acima de `AUTH_GUEST_PER_IP_PER_HOUR`, padrão 10) e confira nos logs (`fly logs`) que o IP registrado é o seu, não `203.0.113.9`, e que o limite dispara para o seu IP. Se o valor forjado vencer, **não abra o beta**: `TRUST_PROXY` precisa ser desligado e o limite rediscutido.
2. **`Sec-WebSocket-Protocol` e `Host` chegam ao servidor.** Jogue uma mesa privada no navegador com duas contas (o WebSocket autentica no subprotocolo `trucaco.bearer, <jwt>`); entrar e reconectar (recarregar a página no meio) devem funcionar.
3. **Scripts inline do `index.html` vs CSP.** A CSP do estático é `script-src 'self' 'wasm-unsafe-eval'` (sem `unsafe-inline`). O export validado em 2026-11-05 só tem `<script src=...>` externos, mas confira no navegador do app real (console sem erros de CSP, tela de carregamento e jogo funcionando) e `curl -s https://<app>/ | grep -c '<script>'` deve dar 0. Um script inline quebra a página em produção sem aparecer nos testes locais.
4. `GET /` responde `index.html`, `GET /health` responde `{"status":"ok","protocol":N,...}` e a rota de página desconhecida (ex.: `/mesa/x`) também devolve o `index.html`.
5. Redis: `noeviction` e persistência confirmados no painel. Login e refresh sobrevivem a um restart (`fly machine restart`).

## Teste local da imagem

```bash
docker build -f infra/Dockerfile.server -t trucaco-server .
docker network create trucaco-t
docker run -d --name t-pg --network trucaco-t -e POSTGRES_USER=trucaco -e POSTGRES_PASSWORD=descartavel -e POSTGRES_DB=trucaco postgres:16.6-alpine
docker run -d --name t-redis --network trucaco-t redis:7-alpine redis-server --appendonly yes --maxmemory-policy noeviction
# migração, como o release_command
docker run --rm --network trucaco-t -e DATABASE_URL=postgresql://trucaco:descartavel@t-pg:5432/trucaco trucaco-server \
  sh -c "cd /app/migrate && node node_modules/prisma/build/index.js migrate deploy"
# servidor + web
docker run -d --name t-app --network trucaco-t -p 25670:2567 -e DATABASE_URL=postgresql://trucaco:descartavel@t-pg:5432/trucaco \
  -e REDIS_URL=redis://t-redis:6379 -e JWT_SECRET="$(openssl rand -base64 48)" -e WEB_DIST_DIR=/app/web trucaco-server
curl -i localhost:25670/health && curl -i localhost:25670/
# limpeza
docker rm -f t-app t-pg t-redis && docker network rm trucaco-t
```

No Git Bash do Windows, prefixe com `MSYS_NO_PATHCONV=1` (senão `/app/web` vira um caminho do Windows).
