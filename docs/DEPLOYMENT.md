# Deployment do Fichário Virtual

**Última revisão:** 10 de agosto de 2026

Este documento é o runbook canônico de promoção do site. A regra central é simples: **o conteúdo validado em preview deve ser exatamente o mesmo conteúdo promovido**, identificado por SHA e por checksums. Durante desenvolvimento concorrente, não reconstruir a partir de uma `main` mais nova entre preview e produção.

Runbooks complementares:

- `docs/CLOUDFLARE_SETUP.md` — configuração e operação do Cloudflare Pages;
- `docs/SUPABASE_STAGING.md` — backend de staging;
- `docs/OCR_STAGING.md` — validação do OCR;
- `docs/GOOGLE_DRIVE_SETUP.md` — OAuth/Drive/Picker;
- `docs/DESKTOP_OCR_WORKER.md` — worker local posterior ao site;
- `docs/READINESS.md` — evidências e bloqueios atuais.

## 1. Topologia alvo

```text
Cloudflare Pages — fichario-virtual
└── frontend estático SvelteKit/PWA

Cloudflare Pages — fichario-models
└── artefatos públicos e fragmentados de modelos

Supabase
├── Auth
├── PostgreSQL + RLS
├── Storage privado temporário
├── Edge Functions Drive/Gemini
├── manifestos e filas OCR
└── API restrita do worker desktop

Google Drive
└── originais permanentes

Computador confiável
└── Fichário Desktop OCR Worker
```

Cloudflare não recebe documentos privados, texto OCR, refresh token do Drive, service-role do Supabase ou chave Gemini. O Gemini permanece no backend. O worker local inicia somente conexões HTTPS de saída e não exige porta pública.

## 2. Estado operacional atual

Em 10 de agosto de 2026:

- os projetos Pages `fichario-virtual` e `fichario-models` já existem;
- `fichario-virtual` possui production branch `main`, build para `build/`, cache e Node 22 configurados;
- preview do Pages possui a configuração pública do Supabase staging;
- production do Pages **não** possui URL/chave do Supabase, por fail-closed deliberado;
- não existe backend Supabase de produção;
- auto-deploy Git está desligado enquanto a `main` recebe mudanças concorrentes;
- o primeiro Direct Upload real ainda está pendente;
- build, empacotamento, identidade do artifact e gate HTTP pós-deploy já possuem contratos versionados.

A ausência de backend de produção não deve ser “resolvida” apontando produção para staging.

## 3. Separação de ambientes

Há duas fronteiras diferentes: **construir** um artifact e **publicar** um artifact.

### Build

```text
staging
└── configuração pública usada para construir artifact staging

production
└── configuração pública usada para construir artifact production
```

### Publicação

```text
staging-deploy
└── credenciais Cloudflare para preview/staging

production-deploy
└── credenciais Cloudflare para promoção de produção
```

Não misture credenciais de deploy no environment de build.

### Travas de produção

Construir artifact de produção exige, além de configuração pública válida:

```text
PRODUCTION_ARTIFACT_BUILD_ENABLED=true
```

Essa variável pertence ao environment `production`.

Publicar em produção exige separadamente:

```text
CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED=true
```

Essa variável pertence a `production-deploy`.

As duas travas são independentes. A primeira autoriza gerar bytes de produção; a segunda autoriza publicá-los. Enquanto infraestrutura de produção não existir, ambas devem permanecer ausentes ou diferentes de `true`.

## 4. Preparar o Supabase

Para um ambiente novo:

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase test db
```

Depois regenere e compare os tipos:

```bash
supabase gen types typescript --linked > src/lib/types/database.ts
pnpm format src/lib/types/database.ts
```

Migrations são forward-only. Corrija por uma migration nova; não edite migration já aplicada.

### Usuário autorizado

Crie a conta no Auth e adicione o UUID em `public.app_users`:

```sql
insert into public.app_users (user_id, is_active)
values ('<auth-user-uuid>', true);
```

Email não é chave de autorização. A aplicação usa `auth.uid()` e allowlist fail-closed.

### Storage

Confirme:

- bucket `documents` privado;
- uploads em `<auth.uid()>/<document-id>/...`;
- download negado sem sessão;
- URLs assinadas curtas;
- remoção recusada para outro usuário;
- temporário preservado enquanto existir processamento pendente;
- limpeza somente depois de persistência segura ou cancelamento confirmado.

O original permanente pertence ao Google Drive. Storage Supabase é temporário/derivado, não repositório permanente dos originais.

## 5. Configurar Google Drive

Siga `docs/GOOGLE_DRIVE_SETUP.md`.

Requisitos principais:

- escopo exato `https://www.googleapis.com/auth/drive.file`;
- refresh token somente no backend;
- pasta `Fichário Digital`;
- upload retomável;
- Google Picker explícito;
- feed de mudanças;
- ausência, reconexão e conflitos;
- migração com rollback.

O callback OAuth continua em Edge Function do Supabase. Trocar o host do site exige revisar origens/retornos autorizados, mas não mover segredos Google para Cloudflare.

## 6. Configurar Gemini e Edge Functions

Secrets backend típicos:

```bash
supabase secrets set \
  APP_ORIGIN=https://app.example.com \
  GEMINI_API_KEY=<secret> \
  OCR_MODEL_PRIMARY=<modelo-estavel> \
  OCR_PROMPT_VERSION=1
```

Controles técnicos opcionais:

```bash
supabase secrets set \
  OCR_BATCH_MAX_PAGES=40 \
  OCR_BATCH_MAX_BYTES=12582912 \
  OCR_REQUEST_TIMEOUT_MS=120000
```

Esses valores protegem memória/tamanho/duração. Não representam franquia diária da aplicação.

Implante as funções usadas pela PWA conforme o runbook Supabase. A política JWT fica versionada em `supabase/config.toml`; não enfraqueça funções autenticadas na linha de comando. O callback OAuth é a exceção documentada porque recebe redirecionamento externo e aplica `state` de uso único + PKCE.

O segredo antigo `OCR_DAILY_HARD_LIMIT` não deve ser reintroduzido como autoridade de bloqueio.

## 7. Configuração pública do frontend

Obrigatória por artifact:

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<valor>
```

Google Picker, quando habilitado, usa o trio público opcional:

```text
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

Os três precisam estar presentes juntos ou todos ausentes. O workflow de artifact falha em configuração parcial.

Nunca fornecer ao frontend/Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

## 8. Etapa A — construir artifact imutável

Workflow:

```text
Build deployable Fichário artifact
```

Entrada:

```text
target_environment: staging | production
```

O workflow é manual e usa o environment protegido correspondente. Ele:

1. faz checkout do SHA que disparou o workflow com `persist-credentials: false`;
2. usa Node/pnpm pinados;
3. instala com `pnpm install --frozen-lockfile`;
4. bloqueia produção sem `PRODUCTION_ARTIFACT_BUILD_ENABLED=true`;
5. valida URL e publishable key públicas;
6. valida o trio do Google Picker como all-or-none;
7. executa `pnpm verify`;
8. confirma que a configuração pública correta foi congelada no build;
9. rejeita URL/chave fake de desenvolvimento;
10. empacota site, identidade mínima da fonte e checker pós-deploy;
11. gera `DEPLOYMENT-MANIFEST.txt` schema 2;
12. gera `SHA256SUMS` com cobertura exata;
13. revalida o próprio pacote;
14. publica o artifact do GitHub Actions.

Nome do artifact:

```text
fichario-static-<sha-completo>-<environment>
```

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

`checks/` pertence ao mesmo SHA e é coberto por `SHA256SUMS`. O gate pós-deploy não consulta uma versão mais nova do repositório.

### Verificação manual do pacote

```bash
cd fichario-deploy
sha256sum -c SHA256SUMS
```

Do workspace do mesmo SHA:

```bash
pnpm test:deployment:artifact -- /caminho/para/fichario-deploy
```

Sirva/publice somente `fichario-deploy/site/`.

## 9. Etapa B — publicar exatamente o artifact validado

Workflow:

```text
Deploy validated artifact to Cloudflare Pages
```

Entradas:

```text
target_environment:      staging | production
artifact_run_id:         run que produziu o artifact
expected_source_commit:  SHA completo de 40 caracteres
```

O workflow de publicação deliberadamente:

- **não faz checkout**;
- não executa `pnpm install`;
- não executa `pnpm build`;
- não executa `pnpm verify`;
- não cria/substitui o projeto Pages.

Ele baixa somente o artifact nomeado pelo SHA + ambiente a partir do run informado e, antes do Wrangler:

- confirma manifesto schema 2;
- confirma `Semogtw/FicharioVirtual` como repositório de origem;
- confirma SHA completo;
- confirma target environment;
- recalcula hashes de `package.json` e lockfile;
- executa `sha256sum -c SHA256SUMS`;
- rejeita symlinks;
- exige `_headers`, fallback, manifest, service worker e checker pinado;
- rejeita configuração Supabase local/fake.

### Credenciais

Staging usa `staging-deploy`. Produção usa `production-deploy`.

Secrets exigidos no environment de publicação:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

O token deve ter somente o escopo necessário para Pages na conta correta.

## 10. Identidade do Direct Upload

O workflow usa Wrangler com versão explícita e parâmetros equivalentes a:

```bash
wrangler pages deploy <artifact>/site \
  --project-name=fichario-virtual \
  --branch=staging \
  --commit-hash=<sha-validado> \
  --commit-dirty=false
```

Produção troca somente a branch para `main` e continua usando o mesmo SHA/artifact já validado.

O workflow habilita `WRANGLER_OUTPUT_FILE_PATH` e consome o registro estruturado `pages-deploy-detailed`. Ele rejeita a publicação se a Cloudflare retornar:

- projeto diferente de `fichario-virtual`;
- ambiente diferente do solicitado;
- production branch diferente de `main`;
- `commit_hash` diferente do SHA validado;
- deployment ID inválido;
- URL que não seja uma origem HTTPS limpa.

Não derive a URL de staging por convenção. Use a URL única retornada pelo deployment.

## 11. Gate HTTP do deployment exato

Depois do upload, o workflow executa:

```bash
node <artifact>/checks/check-deployed-site.mjs https://<url-exata-retornada>
```

Como o checker veio dentro do artifact, a lógica de validação também está presa ao SHA e coberta por checksum.

O contrato valida, entre outros pontos:

- HTTPS;
- CSP;
- HSTS;
- `nosniff`;
- framing/permissions policies;
- manifest PWA;
- service worker;
- fallback SPA;
- cache adequado;
- comportamento de asset inexistente;
- upgrade HTTP → HTTPS.

Produção executa o mesmo checker também contra:

```text
https://fichario-virtual.pages.dev
```

A execução só é concluída com identidade do artifact **e** contrato HTTP aprovados.

## 12. CSP do site hospedado

`static/_headers` é versionado e o build valida o `_headers` realmente emitido.

As origens Google adicionais atualmente necessárias são restritas a:

```text
script-src:  https://apis.google.com
connect-src: https://www.googleapis.com
```

A primeira atende ao loader do Google Picker. A segunda atende a upload resumível e downloads/ranges do Drive feitos pelo navegador.

Não abra `*.google.com` preventivamente. Se o Picker real exigir uma origem de frame, capture a violação no preview e adicione somente a origem exata comprovada.

## 13. Regra de promoção staging → produção

Um preview aprovado não autoriza rebuild.

A promoção correta é:

```text
SHA X
  ↓
Build artifact X/staging ou X/production conforme configuração-alvo
  ↓
checksums + contrato do artifact
  ↓
Direct Upload do artifact X
  ↓
URL exata retornada pela Cloudflare
  ↓
gate HTTP + smoke
  ↓
promoção do MESMO artifact de produção para branch main
  ↓
gate URL exata + alias público
```

Se a configuração pública de produção difere de staging — o caso esperado — construa um artifact `production` separado **a partir do mesmo SHA**, valide-o em preview apropriado e promova exatamente esses bytes. Nunca promova bytes de staging como produção apenas para evitar um build de produção.

## 14. Gates do SHA candidato

No mesmo SHA que será promovido, execute os gates aplicáveis. O `pnpm verify` já cobre a parte frontend principal; o pipeline completo inclui também Edge, banco e E2E conforme workflows do repositório/toolchains.

Não use um SHA verde antigo para aprovar SHA novo. Um gate cancelado também não equivale a PASS.

Se um gate externo não puder executar por rate limit, indisponibilidade de serviço ou limitação da ferramenta, registre a evidência e continue resolvendo código; antes da promoção final, o gate obrigatório precisa de recibo terminal ou risco explicitamente aprovado.

## 15. Smoke de staging

Depois do gate HTTP automatizado, validar no host real:

### Autenticação e dados

- allowlist funciona;
- outra conta não lista dados;
- URL assinada expira;
- PWA offline não revela documentos;
- Cloudflare não recebe documentos privados.

### PWA e navegação

- refresh em rota interna funciona;
- service worker instala/atualiza;
- manifest é carregado;
- asset inexistente não vira fallback HTML silencioso;
- logout remove acesso.

### Drive

- OAuth conclui com a origem correta;
- Picker abre;
- upload retomável funciona;
- downloads/ranges não geram violação de CSP;
- PDF grande permanece no fluxo Drive-first;
- tokens não aparecem em URL/log.

### OCR

Siga `docs/OCR_STAGING.md`, incluindo PDF textual com zero chamadas, lote visual real, cancelamento/retomada, quota do provedor e persistência.

## 16. Domínio canônico e `APP_ORIGIN`

Só adicione domínio customizado depois de um preview estável.

Ao escolher a origem canônica:

1. configurar domínio no Pages;
2. configurar redirects e HTTPS;
3. atualizar Site URL/redirects do Supabase Auth;
4. atualizar `APP_ORIGIN` nas Edge Functions;
5. revisar tela/origens Google OAuth;
6. reexecutar gate e smoke.

Evite duas origens de produção aceitando sessão simultaneamente.

## 17. Limitação atual do conector Cloudflare

A integração administrativa disponível consegue configurar o projeto Pages e obter o token temporário emitido pelo serviço de upload, mas não permite trocar sua própria autenticação pelo JWT temporário exigido pelos endpoints `/pages/assets/*`.

Uma sonda reproduzindo os headers do Wrangler com JWT novo continua retornando `403` / Cloudflare `8000013` (`Authorization failed`).

Não exporte, revele ou persista o JWT para contornar essa limitação. Use o workflow artifact-only com `CLOUDFLARE_API_TOKEN` de escopo mínimo em `staging-deploy`, ou outro executor oficialmente compatível com Wrangler Direct Upload.

## 18. Worker desktop e modelos

O worker é marco separado do primeiro deploy do site. Siga `docs/DESKTOP_OCR_WORKER.md`.

Modelos públicos ficam no projeto `fichario-models`, fragmentados com licença/checksums. Eles não entram no precache da PWA e o tablet não deve baixá-los automaticamente.

O worker nunca recebe service-role, chave Gemini ou refresh token do Drive.

## 19. Rollback

### Frontend

- selecione um deployment anterior identificado por SHA;
- preserve banco e Drive;
- confirme compatibilidade do schema;
- reexecute o checker correspondente ao artifact;
- reexecute smoke essencial.

### Banco

Use migration corretiva. Não edite migrations aplicadas.

### Edge Functions

Rollback só pode usar versão compatível com o schema implantado; em incompatibilidade, falhar fechado é preferível a corromper estado.

### Modelos

Não substitua bytes de uma versão publicada. Rollback altera a versão recomendada e preserva a última versão válida.

## 20. Checklist de primeiro preview

```text
[ ] SHA candidato capturado
[ ] toolchain/CI do SHA revisado
[ ] artifact staging criado pelo workflow
[ ] artifact contract PASS
[ ] CLOUDFLARE_API_TOKEN provisionado em staging-deploy
[ ] CLOUDFLARE_ACCOUNT_ID provisionado em staging-deploy
[ ] workflow artifact-only executado
[ ] identidade pages-deploy-detailed PASS
[ ] URL exata do deployment registrada
[ ] checker HTTP do artifact PASS
[ ] smoke Auth/PWA PASS
[ ] smoke Drive/Picker PASS ou limitação registrada
[ ] APP_ORIGIN coordenado com a origem escolhida
[ ] nenhum dado privado na Cloudflare
```

## 21. Checklist de produção

```text
[ ] Supabase de produção existe e foi validado
[ ] environment production possui somente configuração pública correta
[ ] PRODUCTION_ARTIFACT_BUILD_ENABLED=true aprovado explicitamente
[ ] artifact production do SHA candidato criado e validado
[ ] preview dos bytes de produção aprovado
[ ] production-deploy criado/protegido
[ ] token Cloudflare de escopo mínimo provisionado
[ ] CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED=true aprovado explicitamente
[ ] o MESMO artifact é publicado na branch main
[ ] URL exata do deployment PASS
[ ] fichario-virtual.pages.dev PASS
[ ] domínio canônico/redirects PASS
[ ] APP_ORIGIN/Auth/OAuth coordenados
[ ] rollback ensaiado
```

## 22. Proibições

- não publicar secrets backend;
- não tornar bucket privado público;
- não cachear endpoints autenticados;
- não colocar documentos privados na Cloudflare;
- não ativar R2 ou billing automaticamente;
- não abrir porta doméstica para o worker;
- não reinserir teto diário interno de OCR;
- não inserir fallback pago silencioso;
- não habilitar produção apontando para staging;
- não reconstruir entre preview aprovado e promoção do mesmo artifact;
- não declarar release pronta sem gates e smoke correspondentes ao SHA promovido.
