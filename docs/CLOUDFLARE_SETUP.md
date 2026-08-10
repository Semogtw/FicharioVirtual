# Configuração Cloudflare do Fichário Virtual

**Status:** infraestrutura Pages provisionada; primeiro Direct Upload de staging pendente  
**Última revisão:** 10 de agosto de 2026

Este runbook descreve o frontend estático na Cloudflare Pages e a distribuição pública de artefatos de modelos usados pelo worker do computador. Ele não move arquivos privados, banco, autenticação ou OCR para a Cloudflare.

O caminho executável atual do app é **staging-only**. Produção permanece fail-closed enquanto não existir backend Supabase e configuração pública próprios.

## 1. Topologia

```text
fichario-virtual.pages.dev / futuro app.<dominio>
└── Cloudflare Pages
    └── build estático da PWA

fichario-models.pages.dev / futuro models.<dominio>
└── Cloudflare Pages com Direct Upload
    └── manifestos, partes de modelos, licenças e checksums

Supabase
└── Auth, PostgreSQL, RLS, Edge Functions, filas e temporários privados

Google Drive
└── originais permanentes
```

Cloudflare Pages não recebe:

- imagens ou PDFs do usuário;
- páginas preparadas para OCR;
- texto reconhecido;
- tokens Google ou Supabase privados;
- chave Gemini;
- credenciais do worker;
- exportações privadas.

## 2. Estado provisionado

Os dois projetos Pages já existem:

```text
fichario-virtual
fichario-models
```

No projeto `fichario-virtual` estão configurados:

```text
Production branch administrativa: main
Build command:                    corepack enable && pnpm install --frozen-lockfile && pnpm build
Build output:                     build
Root directory:                   /
Build cache:                      enabled
NODE_VERSION:                     22.16.0
```

A configuração pública do projeto está separada:

```text
Preview:
  PUBLIC_SUPABASE_URL:             staging
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: staging
  NODE_VERSION:                    22.16.0

Production:
  NODE_VERSION:                    22.16.0
  PUBLIC_SUPABASE_URL:             ausente de propósito
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: ausente de propósito
```

Ainda não existe Supabase de produção. Manter URL e chave de backend ausentes em `production` é um bloqueio fail-closed deliberado; não preencher esses campos com staging.

A publishable key é pública por definição, mas seu valor não deve ser duplicado em documentação ou commits. Nenhum secret backend deve ser colocado no Pages.

A integração Git e o auto-deploy permanecem desligados durante desenvolvimento concorrente. O rollout usa **Direct Upload de artifact preso a SHA**.

## 3. Environments e credenciais do GitHub

O fluxo executável atual usa duas fronteiras:

```text
staging
└── configuração pública usada para construir o artifact

staging-deploy
└── credenciais operacionais de Direct Upload
```

`staging` não deve receber token Cloudflare. `staging-deploy` não deve ser usado como origem de configuração pública do frontend.

Secrets exigidos em `staging-deploy`:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

O token deve possuir somente o escopo necessário para publicar no Pages da conta correta. Não reutilize service-role do Supabase, segredo Gemini ou credenciais Google.

### Produção futura

`production` e `production-deploy` são nomes reservados para uma implementação futura, não environments consumidos pelos workflows executáveis atuais. Não crie uma trava booleana para “habilitar” um caminho incompleto. Primeiro crie backend/configuração/contrato de produção e depois introduza o pipeline correspondente com testes.

## 4. Projeto Pages da PWA

### 4.1 Build estático

Configuração canônica:

```text
Framework preset:   None
Build command:      corepack enable && pnpm install --frozen-lockfile && pnpm build
Build output:       build
Root directory:     /
Node.js:            22.16.0
```

O projeto usa `@sveltejs/adapter-static`; não instalar `@sveltejs/adapter-cloudflare` enquanto o frontend continuar inteiramente estático. O output correto permanece `build/`.

### 4.2 Variáveis públicas

Obrigatórias no artifact staging:

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<valor>
```

O Google Picker usa um trio público opcional que precisa ser configurado de forma atômica:

```text
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

Deixar os três ausentes é válido enquanto o Picker real ainda não tiver sido provisionado. Configurar somente parte do trio falha no workflow de artifact.

Nunca cadastrar no Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

A ausência desses secrets no Pages é requisito de release.

## 5. Artifact staging reproduzível

Use o workflow manual:

```text
Build deployable Fichário staging artifact
```

Ele não recebe seletor de ambiente. O job usa `environment: staging` e `TARGET_ENVIRONMENT: staging` fixos.

O workflow:

1. faz checkout do SHA com `persist-credentials: false`;
2. usa Node/pnpm pinados;
3. instala pelo lockfile congelado;
4. valida a configuração pública de staging;
5. valida o trio Picker como all-or-none;
6. executa `pnpm verify`;
7. rejeita URL/chave fake local no build;
8. chama `tools/deploy/package-static-artifact.sh`;
9. revalida o pacote com `test:deployment:artifact`;
10. publica `fichario-static-<sha>-staging`.

O empacotador compartilhado exige SHA completo, target staging, arquivos mínimos e verificadores, rejeita symlinks e gera checksums com cobertura exata.

O timestamp do manifesto é reprodutível: usa `SOURCE_DATE_EPOCH` quando explicitamente fornecido ou o timestamp do próprio commit. O relógio do runner não entra na identidade normal do artifact.

Estrutura:

```text
fichario-deploy/
├── DEPLOYMENT-MANIFEST.txt
├── SHA256SUMS
├── checks/
│   ├── check-deployed-site.mjs
│   ├── check-deployment-artifact.mjs
│   ├── deployment-contract.mjs
│   └── validate-pages-deploy-output.mjs
├── source/
│   ├── package.json
│   └── pnpm-lock.yaml
└── site/
    └── build estático publicável
```

Os verificadores pertencem ao mesmo SHA e são cobertos por `SHA256SUMS`. O gate pós-deploy não depende de checkout mais novo.

Validação manual equivalente no mesmo workspace:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
TARGET_ENVIRONMENT=staging GITHUB_SHA=<sha-completo> \
  bash tools/deploy/package-static-artifact.sh fichario-deploy
pnpm test:deployment:artifact -- fichario-deploy
```

O workflow `Validate current head` do próprio repositório continua sendo o gate global normal. Um run cancelado por push mais novo não é PASS nem falha funcional.

## 6. Headers, Google APIs e fallback

O deploy precisa publicar:

```text
_headers
200.html
manifest.webmanifest
sw.js
registerSW.js
```

`static/_headers` permanece versionado. A CSP permite somente as origens adicionais exigidas hoje pelo código browser:

```text
script-src  https://apis.google.com
connect-src https://www.googleapis.com
```

A primeira origem carrega o loader oficial do Picker. A segunda cobre uploads retomáveis e downloads/ranges do Drive feitos diretamente pelo navegador.

Não amplie para curingas Google sem evidência de runtime. Se o Picker real exigir origem de frame adicional, capture a violação em preview e libere somente a origem mínima necessária.

O gate de build valida o `_headers` emitido. O gate pós-deployment confirma CSP, HSTS, `nosniff`, framing, permissions, cache de assets e `no-cache` para service worker/fallback.

O fallback `200.html` não pode substituir arquivos em `/assets/*`. Uma URL de asset inexistente deve falhar como asset, não retornar HTML com sucesso.

## 7. Direct Upload de staging

Use o workflow manual:

```text
Deploy validated staging artifact to Cloudflare Pages
```

Entradas:

```text
artifact_run_id:         run que produziu o artifact
expected_source_commit:  SHA completo de 40 caracteres
```

O workflow usa `staging-deploy` e deliberadamente:

- não faz checkout;
- não instala dependências;
- não builda;
- não executa `pnpm verify`;
- não cria/substitui o projeto Pages.

Antes do Wrangler ele:

- baixa somente `fichario-static-<sha>-staging` do run informado;
- valida manifesto schema 2;
- valida repositório, SHA e `target_environment=staging`;
- recalcula hash de `package.json` e lockfile;
- executa `sha256sum -c SHA256SUMS`;
- rejeita symlinks;
- exige verificadores e arquivos públicos mínimos;
- rejeita configuração Supabase local/fake.

Wrangler fica pinado e recebe parâmetros equivalentes a:

```bash
wrangler pages deploy <artifact>/site \
  --project-name=fichario-virtual \
  --branch=staging \
  --commit-hash=<sha-validado> \
  --commit-dirty=false
```

## 8. Verificação da identidade Cloudflare

O workflow define `WRANGLER_OUTPUT_FILE_PATH` e consome o registro estruturado `pages-deploy-detailed`.

O verificador transportado no artifact rejeita respostas incompatíveis com o deployment esperado, incluindo projeto, SHA, deployment ID e URL inválidos. A configuração administrativa de production branch do projeto continua sendo conferida quando faz parte do contrato retornado.

O gate HTTP é executado contra a **URL única retornada pelo deployment**, não contra alias presumido. Isso evita corrida entre deployments concorrentes.

Depois do upload:

```bash
node <artifact>/checks/check-deployed-site.mjs https://<url-exata-retornada>
```

A execução só é concluída quando identidade/checksums do artifact e contrato HTTP passam.

### Preview manual equivalente

Quando for necessário reproduzir fora do workflow:

```bash
npx wrangler pages deploy <artifact-dir>/site \
  --project-name=fichario-virtual \
  --branch=staging \
  --commit-hash=<sha>

node <artifact-dir>/checks/check-deployed-site.mjs https://<url-exata-retornada>
```

Não use esse caminho manual para contornar environments ou registrar secrets em terminal/log.

## 9. Smoke pós-deployment

Além do checker automatizado:

- refresh de rota privada preserva navegação;
- logout remove acesso;
- sessão expirada volta ao login;
- service worker não contém endpoint privado sensível;
- documento autenticado não aparece em cache público;
- preview não recebe dados de produção;
- Drive carrega Picker e transfere dados sem violação de CSP;
- PDF grande funciona por referência/ranges;
- nenhum token aparece em URL/log;
- modelo é baixado somente no computador;
- tablet não baixa partes de modelos ao abrir a PWA.

Siga também `docs/OCR_STAGING.md` e `docs/GOOGLE_DRIVE_SETUP.md`.

## 10. Domínio canônico

Adicione o domínio final em **Pages > Custom domains** somente depois do primeiro preview validado. Depois:

- redirecione HTTP para HTTPS;
- decida o tratamento de `*.pages.dev` sem manter duas origens canônicas de sessão;
- preserve caminho e query;
- use previews apenas para validação sem dados reais.

Atualize no mesmo rollout:

### Supabase Auth

```text
Site URL: https://app.<dominio>
Redirect URLs: somente origens e callbacks realmente usados
```

### Edge Functions

```bash
supabase secrets set APP_ORIGIN=https://app.<dominio>
```

`APP_ORIGIN` é backend e não pertence ao Pages.

### Google Drive

O callback OAuth continua pertencendo à Edge Function do Supabase. Atualize origens/retornos e tela de consentimento sem mover refresh token para Cloudflare.

## 11. Produção futura

Não existe workflow executável de produção no estado atual.

Quando backend e configuração próprios existirem, o desenho futuro deve manter:

```text
mesmo SHA
  ↓
artifact construído com configuração de produção
  ↓
checksums + verificadores
  ↓
preview dos mesmos bytes
  ↓
promoção dos mesmos bytes
  ↓
gate HTTP da origem exata e domínio canônico
```

Não publique o artifact de staging como produção apenas para evitar build com configuração correta. Também não reintroduza código morto `production` nos workflows atuais antes de existir a infraestrutura correspondente.

## 12. Projeto Pages de modelos

### 12.1 Motivo para projeto separado

Modelos não devem:

- inflar o repositório principal;
- ser baixados pelo tablet ao instalar a PWA;
- entrar no precache do service worker;
- invalidar todo o site a cada atualização;
- compartilhar cache com assets da interface.

O projeto separado usa Direct Upload e recebe somente artefatos públicos já empacotados.

### 12.2 Estrutura de publicação

```text
model-dist/
├── index.json
└── models/
    └── <model-id>/
        └── <version>/
            ├── manifest.json
            ├── part-000.bin
            ├── part-001.bin
            ├── LICENSE.txt
            └── NOTICE.txt
```

Regras:

- cada parte possui no máximo 20 MiB;
- nomes e versões são imutáveis;
- cada parte possui tamanho e SHA-256 no manifesto;
- o arquivo reconstruído possui SHA-256 próprio;
- licença e origem pública são obrigatórias;
- não publicar modelo sem licença compatível com redistribuição;
- não publicar checkpoints com dados privados;
- `index.json` recebe cache curto;
- caminhos versionados usam cache imutável longo.

### 12.3 Publicação

O projeto `fichario-models` já existe:

```bash
npx wrangler pages deploy model-dist --project-name=fichario-models --branch=main
```

Publique somente depois de confirmar:

- nenhuma parte acima de 20 MiB;
- cobertura exata dos checksums;
- ausência de symlinks e arquivos privados;
- licença presente;
- `minimumWorkerVersion` compatível;
- hash final reproduzível após remontagem.

### 12.4 Rollback de modelos

Modelos publicados são imutáveis. Rollback altera a versão recomendada no `index.json`; nunca substitui bytes de uma versão existente.

## 13. R2 não obrigatório

Cloudflare R2 não é o caminho padrão do MVP. É um produto com cobrança por uso e pode cobrar excedentes.

R2 só pode ser habilitado depois de decisão explícita registrando:

- por que Pages deixou de ser adequado;
- como armazenamento/operações serão monitorados;
- risco de cobrança e responsável;
- procedimento de desativação;
- confirmação de que somente modelos públicos serão armazenados;
- atualização de `docs/FREE_TIER_OPERATIONS.md`.

Sem essa decisão, não crie bucket, assinatura ou método de pagamento em nome do projeto.

## 14. Rollback

### Frontend staging

- selecione deployment/artifact anterior identificado por SHA;
- preserve Supabase e Drive;
- confirme compatibilidade do schema;
- use o checker do artifact correspondente;
- reexecute smoke essencial.

### Domínio

Se a origem Cloudflare falhar, só aponte para host anterior se artifact/schema forem compatíveis e `APP_ORIGIN` + redirects forem atualizados de forma coordenada. Não mantenha duas origens aceitando sessão simultaneamente.

### Modelos

- altere somente o índice de versão recomendada;
- não apague a última versão conhecida como válida;
- não force reprocessamento de páginas concluídas.

## 15. Limitação da integração administrativa

A integração administrativa observada consegue configurar o projeto Pages e obter token temporário do serviço de upload, mas não fornece um caminho seguro equivalente ao Wrangler para autenticar os endpoints `/pages/assets/*`.

Não exporte, mostre nem persista esse token para contornar a limitação. Use o workflow artifact-only com credencial de escopo mínimo em `staging-deploy` ou outro executor oficialmente compatível com Wrangler Direct Upload.

## 16. Critério de prontidão

```text
Projetos Cloudflare Pages criados: PASS
Build/output do app configurados: PASS
Preview com configuração pública staging: PASS
Production sem backend staging reaproveitado: PASS fail-closed
Artifact staging preso a SHA: PASS em código
Manifest/checksums + timestamp reproduzível: PASS em código
Artifact carrega todos os verificadores pinados: PASS em código
Output build/ correto: PASS
Fallback 200.html: PASS
_headers/CSP do build: PASS
Workflow staging artifact-only: PASS em código
Credenciais Cloudflare em staging-deploy: PENDING até confirmação operacional
Primeiro preview Direct Upload: PENDING
Gate HTTP do preview real: PENDING
CI global terminal do candidato final: PENDING
Backend/configuração/pipeline de produção: PENDING
Origem HTTPS canônica: PENDING
Supabase Auth atualizado para origem final: PENDING
APP_ORIGIN atualizado: PENDING
Google Drive real sem regressão: PENDING
Nenhum secret backend no Pages: PASS em código/configuração conhecida
Nenhum conteúdo privado na Cloudflare: requisito obrigatório; validar runtime
Projeto de modelos separado: PASS
Publicação/checksums dos modelos: PENDING
Tablet não baixa modelos: PENDING
R2 desativado ou decisão explícita registrada: PASS com R2 desativado
Rollback ensaiado: PENDING
```

A implantação não está concluída apenas porque existe um projeto Pages ou porque `build/` foi gerado. Preview, gates externos e qualquer promoção futura precisam corresponder a artifacts e SHAs explicitamente verificados.