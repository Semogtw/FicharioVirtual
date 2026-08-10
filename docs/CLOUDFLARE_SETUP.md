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
- tokens Google ou Supabase;
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
PUBLIC_SUPABASE_URL:  staging
PUBLIC_SUPABASE_PUBLISHABLE_KEY: staging
```

A publishable key é pública por definição, mas seu valor não deve ser duplicado em documentação ou commits. Nenhum secret backend foi colocado no Pages.

A integração Git e o auto-deploy permanecem desligados de propósito enquanto a `main` recebe features concorrentes. O primeiro rollout deve usar **Direct Upload de um artifact preso a um SHA**, evitando que um novo push mude silenciosamente o conteúdo entre build, smoke e promoção.

O checkpoint atual de staging é o SHA `baac227473c0613b2ffd0de9c7e52ad738def040`. O workspace foi montado pelo repo `Semogtw/Offline-Toolchains`, teve archive e fragmentos verificados por SHA-256, produziu `build/` com sucesso usando o Supabase staging real e passou o contrato de artifact de deployment. Ele é um candidato reproduzível para preview, não uma release aprovada: o CI global desse SHA continua vermelho por regressões paralelas de OCR/desktop/viewer.

## 3. Referências oficiais

- SvelteKit no Pages: https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/
- Limites do Pages: https://developers.cloudflare.com/pages/platform/limits/
- Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Redirect para domínio canônico: https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 billing: https://developers.cloudflare.com/r2/get-started/

Na revisão original de 6 de agosto de 2026, o Pages aceitava até 25 MiB por asset. Este projeto usa partes de modelos de até 20 MiB para manter margem operacional. Limites externos devem ser verificados novamente antes da publicação dos modelos.

## 4. Projeto Pages da PWA

### 4.1 Build

Configuração canônica:

```text
Framework preset:   None
Build command:      corepack enable && pnpm install --frozen-lockfile && pnpm build
Build output:       build
Root directory:     /
Node.js:            22.16.0
```

O projeto usa `@sveltejs/adapter-static`; não instalar `@sveltejs/adapter-cloudflare` enquanto o frontend continuar inteiramente estático. O output correto permanece `build/`, não `.svelte-kit/cloudflare`.

### 4.2 Variáveis de build

Obrigatórias:

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

Deixar os três ausentes é válido enquanto o Picker real ainda não foi provisionado. Configurar apenas parte do trio deve falhar no workflow de artifact.

Não cadastrar no Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

A ausência desses secrets no Pages é requisito de release, não limitação temporária.

### 4.3 Build reproduzível

Para um SHA candidato:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test:deployment:artifact -- <artifact-dir>
```

Antes da promoção final, o mesmo SHA também precisa satisfazer os gates globais aplicáveis. Um artifact cujo build e contrato de deployment passam pode ser usado em preview para investigar a superfície hospedada, mas não deve ser chamado de release verde se `lint`, `check`, `unit` ou gates de segurança do mesmo SHA estiverem vermelhos.

### 4.4 Headers, Google APIs e fallback

O deploy precisa publicar:

```text
_headers
200.html
manifest.webmanifest
sw.js
registerSW.js
```

`static/_headers` permanece versionado no repositório. A CSP permite somente as origens adicionais exigidas hoje pelo código browser:

```text
script-src  https://apis.google.com
connect-src https://www.googleapis.com
```

A primeira origem carrega o loader oficial do Picker. A segunda cobre uploads retomáveis e downloads/ranges do Drive feitos diretamente pelo navegador. Não ampliar a política para curingas Google sem evidência de runtime. Se o Picker real exigir uma origem de frame adicional, capturar a origem efetivamente bloqueada em preview e liberar somente a origem mínima necessária.

O gate de build valida o arquivo `_headers` emitido e o gate pós-deployment confirma CSP, HSTS, `nosniff`, framing, permissions, cache dos assets e `no-cache` para service worker e fallback.

O fallback `200.html` não pode substituir arquivos em `/assets/*`. Uma URL de asset inexistente deve falhar como asset, não retornar HTML com status de sucesso.

## 5. Primeiro rollout por Direct Upload

Enquanto a `main` estiver recebendo commits concorrentes, prefira um SHA fixado e o mesmo diretório `site/` do artifact validado.

### 5.1 Preview

Em um ambiente autenticado no Cloudflare Wrangler:

```bash
npx wrangler pages deploy <artifact-dir>/site \
  --project-name=fichario-virtual \
  --branch=deploy-<short-sha>
```

Depois rode:

```bash
pnpm test:deployment -- https://<preview-origin>
```

Também valide manualmente login, navegação por refresh, service worker, Picker/Drive quando configurados e ausência de dados reais de produção.

### 5.2 Promoção do mesmo artifact

Somente depois de o preview passar, publicar **o mesmo diretório de artifact**, sem rebuild:

```bash
npx wrangler pages deploy <artifact-dir>/site \
  --project-name=fichario-virtual \
  --branch=main
```

Reexecutar o gate contra a origem de produção. Nunca reconstruir a partir de uma `main` mais nova entre preview e produção, pois isso destruiria a identidade do artifact validado.

### 5.3 Limitação do conector administrativo atual

A integração administrativa disponível consegue configurar o projeto Pages e obter o token temporário emitido pelo serviço de upload, mas não permite substituir sua própria autenticação pela credencial temporária nos endpoints `/pages/assets/*`. Não exporte, mostre ou persista esse JWT para contornar a limitação.

Use Wrangler em um ambiente autenticado ou outro executor que suporte oficialmente Direct Upload. O artifact e o SHA continuam sendo a fonte de identidade do rollout.

### 5.4 Quando considerar auto-deploy Git

Só habilitar integração Git/auto-deploy depois que houver uma decisão explícita sobre promoção e concorrência. No mínimo:

- build do commit precisa ser reproduzível;
- gates obrigatórios precisam estar verdes antes da promoção;
- não pode haver race entre um preview validado e um push mais novo em `main`;
- deve existir rollback para um deployment identificado por SHA.

Até lá, Direct Upload é deliberado, não workaround.

## 6. Domínio canônico

Adicionar o domínio final em **Pages > Custom domains** quando o primeiro preview estiver validado. Depois:

- redirecionar HTTP para HTTPS;
- redirecionar o domínio `*.pages.dev` para a origem canônica;
- preservar caminho e query no redirect;
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

O callback OAuth continua pertencendo à Edge Function do Supabase. Atualizar origens, links de retorno e telas de consentimento que mencionem o host do aplicativo, sem mover refresh token para Cloudflare.

### CSP e CORS

A PWA só deve conectar-se ao Supabase e aos destinos públicos aprovados no contrato versionado. Se o navegador não baixar modelos, `models.<dominio>` não precisa entrar em `connect-src`. O desktop worker não obedece à CSP do navegador.

## 7. Projeto Pages de modelos

### 7.1 Motivo para projeto separado

Modelos não devem:

- inflar o repositório principal;
- ser baixados pelo tablet ao instalar a PWA;
- entrar no precache do service worker;
- invalidar todo o site a cada atualização;
- compartilhar cache com assets da interface.

O projeto separado usa Direct Upload por Wrangler e recebe somente artefatos públicos já empacotados.

### 7.2 Estrutura de publicação

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
- não publicar modelo cuja licença não permita redistribuição;
- não publicar checkpoints contendo dados privados do usuário;
- `index.json` pode mudar e recebe cache curto;
- caminhos versionados recebem `Cache-Control: public, max-age=31536000, immutable`.

### 7.3 Publicação de modelos

O projeto `fichario-models` já existe. Publicação:

```bash
npx wrangler pages deploy model-dist --project-name=fichario-models --branch=main
```

O comando deve rodar somente depois de uma verificação local que confirme:

- nenhuma parte acima de 20 MiB;
- cobertura exata dos checksums;
- ausência de symlinks;
- ausência de arquivos privados;
- licença presente;
- `minimumWorkerVersion` compatível;
- hash final reproduzível após remontagem.

### 7.4 Domínio dos modelos

Conectar um subdomínio separado, por exemplo:

```text
models.<dominio>
```

O worker usa HTTPS e valida checksum, portanto o domínio é uma conveniência operacional e não a única camada de integridade.

Não habilitar listagem de diretório. O worker descobre versões por `index.json` ou por uma versão explicitamente configurada.

### 7.5 Rollback de modelos

Modelos publicados são imutáveis. Rollback significa alterar a versão recomendada no `index.json`, nunca substituir bytes de uma versão existente.

Um modelo já instalado continua utilizável se o host ficar temporariamente indisponível. O worker não apaga automaticamente a última versão válida.

## 8. R2 não obrigatório

Cloudflare R2 não é o caminho padrão do MVP. Ele é um produto de cobrança por uso, exige assinatura e pode cobrar excedentes mesmo possuindo franquia incluída.

R2 só pode ser habilitado após uma decisão explícita que registre:

- motivo pelo qual as partes do Pages deixaram de ser adequadas;
- forma de monitorar armazenamento e operações;
- risco de cobrança e responsável pela conta;
- procedimento de desativação;
- confirmação de que apenas modelos públicos serão armazenados;
- atualização de `docs/FREE_TIER_OPERATIONS.md`.

Sem essa decisão, não criar bucket, assinatura ou método de pagamento em nome do projeto.

## 9. Validação pós-deployment

```bash
pnpm test:deployment -- https://app.<dominio>
```

Verificações manuais adicionais:

- refresh de rota privada preserva navegação;
- logout remove acesso;
- sessão expirada volta ao login;
- URL do `pages.dev` redireciona corretamente depois que houver domínio canônico;
- service worker não menciona Supabase privado no cache;
- documento autenticado não aparece no cache público;
- preview não recebe dados de produção;
- Google Drive consegue carregar o Picker e transferir dados sem violações de CSP;
- download de modelo ocorre somente no computador;
- tablet não baixa partes de modelos ao abrir a PWA.

## 10. Rollback

### Frontend

- selecionar o deployment anterior no Pages;
- restaurar o domínio canônico para o deployment validado;
- manter Supabase e banco inalterados;
- reexecutar o gate pós-deployment.

### Domínio

Se a origem Cloudflare falhar, o domínio pode voltar temporariamente ao host estático anterior, desde que:

- o artifact seja do mesmo schema compatível;
- `APP_ORIGIN` seja atualizado de forma coordenada;
- redirects Supabase sejam revisados;
- não existam duas origens ativas aceitando sessão.

### Modelos

- alterar somente o índice de versão recomendada;
- não apagar a última versão conhecida como válida;
- não forçar reprocessamento de páginas já concluídas.

## 11. Critério de prontidão

```text
Projetos Cloudflare Pages criados: PASS
Build/output/env público do app configurados: PASS
Artifact de staging preso a SHA e reproduzível: PASS
Output build/ correto: PASS
Fallback 200.html: PASS
_headers/CSP do build: PASS
Primeiro preview Direct Upload: PENDING
Gate HTTP do preview: PENDING
CI global do candidato final: PENDING
Origem HTTPS canônica: PENDING
pages.dev redirecionado: PENDING
Supabase Auth atualizado para origem final: PENDING
APP_ORIGIN atualizado: PENDING
Google Drive real sem regressão: PENDING
Nenhum secret no Pages: PASS
Nenhum conteúdo privado na Cloudflare: PASS por arquitetura; validar em runtime
Projeto de modelos separado: PASS
Publicação/checksums dos modelos: PENDING
Tablet não baixa modelos: PENDING
R2 desativado ou decisão explícita registrada: PASS com R2 desativado
Rollback ensaiado: PENDING
```

A implantação não está concluída apenas porque existe um projeto Pages ou porque `build/` foi gerado. Preview, gates externos e promoção precisam corresponder ao mesmo artifact e ao mesmo SHA.
