# Configuração Cloudflare do Fichário Virtual

**Status:** arquitetura aprovada; implantação pendente  
**Última revisão:** 6 de agosto de 2026

Este runbook descreve a migração do frontend estático para Cloudflare Pages e a distribuição pública de artefatos de modelos usados pelo worker do computador. Ele não move arquivos privados, banco, autenticação ou OCR para a Cloudflare.

## 1. Topologia

```text
app.<dominio>
└── Cloudflare Pages com integração Git
    └── build estático da PWA

models.<dominio>
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

## 2. Referências oficiais

- SvelteKit no Pages: https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/
- Limites do Pages: https://developers.cloudflare.com/pages/platform/limits/
- Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Redirect para domínio canônico: https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 billing: https://developers.cloudflare.com/r2/get-started/

Na revisão de 6 de agosto de 2026, o Pages aceitava até 25 MiB por asset. Este projeto usa partes de até 20 MiB para manter margem operacional. Limites externos devem ser verificados novamente antes da implantação.

## 3. Projeto Pages da PWA

### 3.1 Criar o projeto

No painel Cloudflare:

1. abrir **Workers & Pages**;
2. criar uma aplicação Pages;
3. selecionar integração com GitHub;
4. autorizar somente o repositório necessário;
5. escolher `Semogtw/FicharioVirtual`;
6. definir `main` como branch de produção.

Configuração:

```text
Framework preset:   None ou SvelteKit com valores sobrescritos
Build command:      corepack enable && pnpm install --frozen-lockfile && pnpm build
Build output:       build
Root directory:     /
Node.js:            >=22.12
```

O projeto usa `@sveltejs/adapter-static`; não instalar `@sveltejs/adapter-cloudflare` enquanto o frontend continuar inteiramente estático. O output correto permanece `build/`, não `.svelte-kit/cloudflare`.

### 3.2 Variáveis de build

Somente variáveis públicas:

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<valor>
```

Não cadastrar no Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

A ausência desses secrets no Pages é requisito de release, não limitação temporária.

### 3.3 Build reproduzível

Antes de ligar deploy automático, o mesmo commit precisa passar localmente:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm verify:full
```

O build do Pages deve usar lockfile e falhar se a instalação congelada não for reproduzível.

### 3.4 Headers e fallback

O deploy precisa publicar:

```text
_headers
200.html
manifest.webmanifest
sw.js
registerSW.js
```

`static/_headers` permanece versionado no repositório. O gate pós-deployment confirma CSP, HSTS, `nosniff`, framing, permissions, cache dos assets e `no-cache` para service worker e fallback.

O fallback `200.html` não pode substituir arquivos em `/assets/*`. Uma URL de asset inexistente deve falhar como asset, não retornar HTML com status de sucesso.

## 4. Domínio canônico

Adicionar o domínio final em **Pages > Custom domains**. Depois:

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

### Google Drive

O callback OAuth continua pertencendo à Edge Function do Supabase. Atualizar origens, links de retorno e telas de consentimento que mencionem o host do aplicativo, sem mover refresh token para Cloudflare.

### CSP e CORS

A PWA só precisa conectar-se ao Supabase e aos destinos públicos aprovados. Se o navegador não baixar modelos, `models.<dominio>` não precisa entrar em `connect-src`. O desktop worker não obedece à CSP do navegador.

## 5. Projeto Pages de modelos

### 5.1 Motivo para projeto separado

Modelos não devem:

- inflar o repositório principal;
- ser baixados pelo tablet ao instalar a PWA;
- entrar no precache do service worker;
- invalidar todo o site a cada atualização;
- compartilhar cache com assets da interface.

O projeto separado usa Direct Upload por Wrangler e recebe somente artefatos públicos já empacotados.

### 5.2 Estrutura de publicação

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

### 5.3 Criar o projeto Direct Upload

```bash
npx wrangler login
npx wrangler pages project create
```

Nome recomendado:

```text
fichario-models
```

Publicação:

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

### 5.4 Domínio dos modelos

Conectar um subdomínio separado, por exemplo:

```text
models.<dominio>
```

O worker usa HTTPS e valida checksum, portanto o domínio é uma conveniência operacional e não a única camada de integridade.

Não habilitar listagem de diretório. O worker descobre versões por `index.json` ou por uma versão explicitamente configurada.

### 5.5 Rollback de modelos

Modelos publicados são imutáveis. Rollback significa alterar a versão recomendada no `index.json`, nunca substituir bytes de uma versão existente.

Um modelo já instalado continua utilizável se o host ficar temporariamente indisponível. O worker não apaga automaticamente a última versão válida.

## 6. R2 não obrigatório

Cloudflare R2 não é o caminho padrão do MVP. Ele é um produto de cobrança por uso, exige assinatura e pode cobrar excedentes mesmo possuindo franquia incluída.

R2 só pode ser habilitado após uma decisão explícita que registre:

- motivo pelo qual as partes do Pages deixaram de ser adequadas;
- forma de monitorar armazenamento e operações;
- risco de cobrança e responsável pela conta;
- procedimento de desativação;
- confirmação de que apenas modelos públicos serão armazenados;
- atualização de `docs/FREE_TIER_OPERATIONS.md`.

Sem essa decisão, não criar bucket, assinatura ou método de pagamento em nome do projeto.

## 7. Deploy e promoção

Fluxo de staging:

1. build local e artifact reproduzível;
2. deploy em preview Pages;
3. executar `pnpm test:deployment -- https://<preview>`;
4. validar login com conta de teste sem dados reais;
5. validar fallback, assets, PWA e headers;
6. validar que nenhum secret aparece no bundle;
7. promover para domínio de staging;
8. atualizar `APP_ORIGIN` somente na janela planejada;
9. repetir gates;
10. promover produção.

Nunca apontar o domínio de produção para um deployment que não corresponde ao commit registrado.

## 8. Validação pós-deployment

```bash
pnpm test:deployment -- https://app.<dominio>
```

Verificações manuais adicionais:

- refresh de rota privada preserva navegação;
- logout remove acesso;
- sessão expirada volta ao login;
- URL do `pages.dev` redireciona corretamente;
- service worker não menciona Supabase privado no cache;
- documento autenticado não aparece no cache público;
- preview não recebe dados de produção;
- download de modelo ocorre somente no computador;
- tablet não baixa partes de modelos ao abrir a PWA.

## 9. Rollback

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

## 10. Critério de prontidão

```text
Cloudflare Pages conectado à main: PASS
Build congelado e reproduzível: PASS
Output build/ correto: PASS
Fallback 200.html: PASS
_headers aplicado: PASS
Origem HTTPS canônica: PASS
pages.dev redirecionado: PASS
Supabase Auth atualizado: PASS
APP_ORIGIN atualizado: PASS
Google Drive sem regressão: PASS
Nenhum secret no Pages: PASS
Nenhum conteúdo privado na Cloudflare: PASS
Projeto de modelos separado: PASS
Partes e checksums válidos: PASS
Tablet não baixa modelos: PASS
R2 desativado ou decisão explícita registrada: PASS
Rollback ensaiado: PASS
```

A migração não está concluída apenas porque o Pages exibiu a página inicial. Todos os gates acima precisam corresponder ao mesmo commit e à mesma origem de produção.
