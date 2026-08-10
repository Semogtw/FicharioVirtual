# Configuração Cloudflare do Fichário Virtual

**Status:** infraestrutura Pages provisionada; primeiro deployment pendente  
**Última revisão:** 10 de agosto de 2026

Este runbook descreve o frontend estático na Cloudflare Pages e a distribuição pública de artefatos de modelos usados pelo worker do computador. Ele não move arquivos privados, banco, autenticação ou OCR para a Cloudflare.

## 1. Topologia

```text
fichario-virtual.pages.dev / app.<dominio>
└── Cloudflare Pages
    └── build estático da PWA

fichario-models.pages.dev / models.<dominio>
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

## 2. Estado provisionado em 10 de agosto de 2026

Os dois projetos Pages já existem:

```text
fichario-virtual
fichario-models
```

No projeto `fichario-virtual` já estão configurados:

```text
Production branch:    main
Build command:        corepack enable && pnpm install --frozen-lockfile && pnpm build
Build output:         build
Root directory:       /
Build cache:          enabled
NODE_VERSION:         22.16.0
```

A configuração pública foi separada por ambiente:

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

Ainda não existe Supabase de produção. Manter URL e chave de backend ausentes em `production` é um bloqueio fail-closed deliberado para impedir que um build futuro de produção reutilize staging silenciosamente.

A publishable key é pública por definição, mas seu valor não deve ser duplicado em documentação ou commits. Nenhum secret backend foi colocado no Pages.

A integração Git e o auto-deploy permanecem desligados enquanto a `main` recebe features concorrentes. O rollout usa **Direct Upload de artifact preso a um SHA**, evitando que um push novo mude o conteúdo entre build, smoke e promoção.

## 3. Separação de ambientes e credenciais

O build e a publicação possuem fronteiras diferentes no GitHub:

```text
staging
└── configuração pública usada para construir o artifact de staging

staging-deploy
└── credenciais operacionais de deployment

production
└── reservado para configuração pública de build de produção

production-deploy
└── reservado para credenciais de promoção de produção
```

`staging` não deve receber token Cloudflare. O workflow de publicação usa `staging-deploy` para staging e `production-deploy` para produção.

Secrets exigidos no environment de deploy:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

O token deve ter somente o escopo necessário para publicar no Pages da conta correta. Não reutilizar service-role do Supabase, segredo Gemini ou credenciais Google.

Produção possui ainda uma trava explícita:

```text
CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED=true
```

Essa variável pertence a `production-deploy` e só deve ser criada/ativada depois que backend, artifact de produção e gates de promoção estiverem prontos. Sem ela, o workflow falha antes do Wrangler.

No estado atual existem `staging` e `staging-deploy`; os ambientes de produção ainda não estão provisionados, o que mantém a promoção de produção bloqueada por desenho.

## 4. Referências oficiais

- SvelteKit no Pages: https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/
- Limites do Pages: https://developers.cloudflare.com/pages/platform/limits/
- Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Redirect para domínio canônico: https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 billing: https://developers.cloudflare.com/r2/get-started/

Na revisão original de 6 de agosto de 2026, o Pages aceitava até 25 MiB por asset. Este projeto usa partes de modelos de até 20 MiB para manter margem operacional. Limites externos devem ser verificados novamente antes da publicação dos modelos.

## 5. Projeto Pages da PWA

### 5.1 Build

Configuração canônica:

```text
Framework preset:   None
Build command:      corepack enable && pnpm install --frozen-lockfile && pnpm build
Build output:       build
Root directory:     /
Node.js:            22.16.0
```

O projeto usa `@sveltejs/adapter-static`; não instalar `@sveltejs/adapter-cloudflare` enquanto o frontend continuar inteiramente estático. O output correto permanece `build/`, não `.svelte-kit/cloudflare`.

### 5.2 Variáveis públicas de build

Obrigatórias por artifact:

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

Deixar os três ausentes é válido enquanto o Picker real ainda não foi provisionado. Configurar somente parte do trio falha no workflow de artifact.

Nunca cadastrar no Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

A ausência desses secrets no Pages é requisito de release.

### 5.3 Build reproduzível e artifact imutável

O workflow manual `Build deployable Fichário artifact`:

1. recebe `staging` ou `production`;
2. usa o environment protegido correspondente para a configuração pública;
3. executa `pnpm verify`;
4. confirma que a configuração pública correta foi congelada no output;
5. empacota somente o site e metadados verificáveis;
6. grava `DEPLOYMENT-MANIFEST.txt` schema 2;
7. gera `SHA256SUMS` com cobertura exata;
8. revalida o pacote antes de publicar o artifact do Actions.

Estrutura:

```text
fichario-deploy/
├── DEPLOYMENT-MANIFEST.txt
├── SHA256SUMS
├── checks/
│   ├── check-deployed-site.mjs
│   └── deployment-contract.mjs
├── source/
│   ├── package.json
│   └── pnpm-lock.yaml
└── site/
    └── build estático publicável
```

Os verificadores em `checks/` pertencem ao mesmo SHA e são cobertos por `SHA256SUMS`. Assim o gate HTTP pós-deploy não depende de um checkout mais novo do repositório.

Validação manual equivalente:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm test:deployment:artifact -- <artifact-dir>
```

Antes da promoção final, o mesmo SHA também precisa satisfazer os gates globais aplicáveis. Um artifact cujo build e contrato de deployment passam pode ser usado em preview para investigar a superfície hospedada, mas não deve ser chamado de release verde se gates obrigatórios do mesmo SHA estiverem vermelhos ou incompletos.

### 5.4 Headers, Google APIs e fallback

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

Não ampliar a política para curingas Google sem evidência de runtime. Se o Picker real exigir origem de frame adicional, capturar a violação em preview e liberar somente a origem mínima necessária.

O gate de build valida o `_headers` efetivamente emitido em `build/`. O gate pós-deployment confirma CSP, HSTS, `nosniff`, framing, permissions, cache de assets e `no-cache` para service worker e fallback.

O fallback `200.html` não pode substituir arquivos em `/assets/*`. Uma URL de asset inexistente deve falhar como asset, não retornar HTML com sucesso.

## 6. Rollout por Direct Upload

Enquanto a `main` receber commits concorrentes, preview e produção devem partir do **mesmo artifact imutável**, sem rebuild entre as etapas.

### 6.1 Workflow de publicação

Use `Deploy validated artifact to Cloudflare Pages` com:

```text
target_environment: staging | production
artifact_run_id:     run que produziu o artifact
expected_source_commit: SHA completo de 40 caracteres
```

O workflow deliberadamente **não faz checkout** e não executa `pnpm install`, `pnpm build` ou `pnpm verify`.

Antes de chamar Wrangler ele:

- baixa somente o artifact cujo nome contém SHA + ambiente;
- verifica manifesto, repositório, SHA e target environment;
- recalcula hash de `package.json` e lockfile;
- executa `sha256sum -c SHA256SUMS`;
- rejeita symlinks;
- exige os arquivos públicos mínimos;
- exige os verificadores pós-deployment pinados no artifact;
- rejeita URL/chave fake do Supabase local.

Wrangler fica pinado em versão explícita no workflow e recebe:

```text
--project-name=fichario-virtual
--branch=staging | main
--commit-hash=<SHA validado>
--commit-dirty=false
```

### 6.2 Verificação da identidade retornada pela Cloudflare

O workflow define `WRANGLER_OUTPUT_FILE_PATH` e consome o registro estruturado `pages-deploy-detailed` produzido pelo Wrangler.

Ele rejeita o deploy se a Cloudflare retornar:

- projeto diferente de `fichario-virtual`;
- ambiente diferente do solicitado;
- production branch diferente de `main`;
- `commit_hash` diferente do artifact;
- deployment ID inválido;
- URL que não seja uma origem HTTPS limpa.

O gate HTTP é executado contra a **URL única retornada pelo próprio deployment**, não contra um alias presumido. Isso evita corrida entre deployments concorrentes.

Para produção, depois do gate na URL única, o mesmo verificador também testa:

```text
https://fichario-virtual.pages.dev
```

A execução só é considerada concluída quando checksum/identidade do artifact e contrato HTTP passam.

### 6.3 Preview manual equivalente

Quando necessário fora do Actions:

```bash
npx wrangler pages deploy <artifact-dir>/site \
  --project-name=fichario-virtual \
  --branch=staging \
  --commit-hash=<sha>

node <artifact-dir>/checks/check-deployed-site.mjs https://<url-exata-retornada>
```

Também valide manualmente login, refresh de rotas, service worker, Picker/Drive quando configurados e ausência de dados reais de produção.

### 6.4 Promoção do mesmo artifact

Somente depois de preview + gates e com a infraestrutura de produção pronta:

```bash
npx wrangler pages deploy <artifact-dir>/site \
  --project-name=fichario-virtual \
  --branch=main \
  --commit-hash=<mesmo-sha>
```

Nunca reconstruir a partir de uma `main` mais nova entre preview e produção.

### 6.5 Limitação do conector administrativo atual

A integração administrativa disponível consegue configurar o projeto Pages e obter o token temporário emitido pelo serviço de upload, mas não permite substituir sua própria autenticação pela credencial temporária nos endpoints `/pages/assets/*`.

Não exporte, mostre nem persista esse JWT para contornar a limitação. Use Wrangler em executor autenticado — o workflow artifact-only existe para esse fim — ou outro caminho oficialmente compatível com Direct Upload.

### 6.6 Quando considerar auto-deploy Git

Só habilitar integração Git/auto-deploy depois de uma decisão explícita de promoção. No mínimo:

- build do commit precisa ser reproduzível;
- gates obrigatórios precisam estar verdes antes da promoção;
- não pode haver race entre preview validado e push mais novo em `main`;
- rollback precisa identificar deployment e SHA.

Até lá, Direct Upload é uma decisão de integridade, não workaround.

## 7. Domínio canônico

Adicionar o domínio final em **Pages > Custom domains** somente depois do primeiro preview validado. Depois:

- redirecionar HTTP para HTTPS;
- redirecionar `*.pages.dev` para a origem canônica quando aplicável;
- preservar caminho e query;
- evitar duas origens de produção simultâneas;
- usar previews apenas para validação sem dados reais.

Depois de ativar o domínio, atualizar no mesmo rollout:

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

O callback OAuth continua pertencendo à Edge Function do Supabase. Atualizar origens, links de retorno e tela de consentimento sem mover refresh token para Cloudflare.

## 8. Projeto Pages de modelos

### 8.1 Motivo para projeto separado

Modelos não devem:

- inflar o repositório principal;
- ser baixados pelo tablet ao instalar a PWA;
- entrar no precache do service worker;
- invalidar todo o site a cada atualização;
- compartilhar cache com assets da interface.

O projeto separado usa Direct Upload e recebe somente artefatos públicos já empacotados.

### 8.2 Estrutura de publicação

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

### 8.3 Publicação de modelos

O projeto `fichario-models` já existe:

```bash
npx wrangler pages deploy model-dist --project-name=fichario-models --branch=main
```

Publicar somente depois de confirmar:

- nenhuma parte acima de 20 MiB;
- cobertura exata dos checksums;
- ausência de symlinks e arquivos privados;
- licença presente;
- `minimumWorkerVersion` compatível;
- hash final reproduzível após remontagem.

### 8.4 Rollback de modelos

Modelos publicados são imutáveis. Rollback altera a versão recomendada no `index.json`; nunca substitui bytes de uma versão existente.

## 9. R2 não obrigatório

Cloudflare R2 não é o caminho padrão do MVP. É um produto com cobrança por uso e pode cobrar excedentes.

R2 só pode ser habilitado depois de decisão explícita registrando:

- por que Pages deixou de ser adequado;
- como armazenamento/operações serão monitorados;
- risco de cobrança e responsável;
- procedimento de desativação;
- confirmação de que somente modelos públicos serão armazenados;
- atualização de `docs/FREE_TIER_OPERATIONS.md`.

Sem essa decisão, não criar bucket, assinatura ou método de pagamento em nome do projeto.

## 10. Validação pós-deployment

O gate automatizado usa o checker contido no artifact. Para execução manual:

```bash
node <artifact-dir>/checks/check-deployed-site.mjs https://<deployment-origin>
```

Verificações manuais adicionais:

- refresh de rota privada preserva navegação;
- logout remove acesso;
- sessão expirada volta ao login;
- service worker não contém endpoint privado do Supabase;
- documento autenticado não aparece em cache público;
- preview não recebe dados de produção;
- Drive carrega Picker e transfere dados sem violação de CSP;
- modelo é baixado somente no computador;
- tablet não baixa partes de modelos ao abrir a PWA.

## 11. Rollback

### Frontend

- selecionar deployment anterior no Pages;
- restaurar a origem canônica para um deployment validado;
- manter Supabase e Drive inalterados;
- reexecutar o checker do artifact correspondente.

### Domínio

Se a origem Cloudflare falhar, o domínio pode voltar temporariamente ao host anterior se:

- artifact e schema forem compatíveis;
- `APP_ORIGIN` for atualizado de forma coordenada;
- redirects Supabase forem revisados;
- não existirem duas origens aceitando sessão simultaneamente.

### Modelos

- alterar somente o índice de versão recomendada;
- não apagar a última versão conhecida como válida;
- não forçar reprocessamento de páginas concluídas.

## 12. Critério de prontidão

```text
Projetos Cloudflare Pages criados: PASS
Build/output do app configurados: PASS
Preview com configuração pública staging: PASS
Production sem backend staging reaproveitado: PASS fail-closed
Artifact preso a SHA e reproduzível: PASS
Artifact carrega checker HTTP pinado: PASS
Output build/ correto: PASS
Fallback 200.html: PASS
_headers/CSP do build: PASS
Workflow de promoção artifact-only: PASS em código
Credenciais Cloudflare em staging-deploy: PENDING
Primeiro preview Direct Upload: PENDING
Gate HTTP do preview real: PENDING
CI global do candidato final: PENDING
Ambientes/configuração de produção: PENDING
Origem HTTPS canônica: PENDING
Supabase Auth atualizado para origem final: PENDING
APP_ORIGIN atualizado: PENDING
Google Drive real sem regressão: PENDING
Nenhum secret backend no Pages: PASS
Nenhum conteúdo privado na Cloudflare: PASS por arquitetura; validar em runtime
Projeto de modelos separado: PASS
Publicação/checksums dos modelos: PENDING
Tablet não baixa modelos: PENDING
R2 desativado ou decisão explícita registrada: PASS com R2 desativado
Rollback ensaiado: PENDING
```

A implantação não está concluída apenas porque existe um projeto Pages ou porque `build/` foi gerado. Preview, gates externos e promoção precisam corresponder ao mesmo artifact e ao mesmo SHA.
