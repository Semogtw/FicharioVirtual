# Deployment do Fichário Virtual

**Última revisão:** 10 de agosto de 2026

Este é o runbook canônico do site. A regra central é: **construir, verificar e publicar bytes identificados por SHA e checksums, sem reconstruir durante a promoção**.

No estado atual, o pipeline executável é deliberadamente **staging-only**. Não existe backend Supabase de produção nem configuração pública de produção pronta; portanto o repositório não oferece atualmente um caminho de artifact/deploy de produção. Não aponte produção para staging para contornar essa ausência.

Runbooks complementares:

- `docs/CLOUDFLARE_SETUP.md` — configuração e operação do Cloudflare Pages;
- `docs/SUPABASE_STAGING.md` — backend de staging;
- `docs/OCR_STAGING.md` — validação do OCR;
- `docs/GOOGLE_DRIVE_SETUP.md` — OAuth/Drive/Picker;
- `docs/DESKTOP_OCR_WORKER.md` — worker local;
- `docs/READINESS.md` — evidências e bloqueios atuais.

## 1. Topologia

```text
Cloudflare Pages — fichario-virtual
└── frontend estático SvelteKit/PWA

Cloudflare Pages — fichario-models
└── artefatos públicos e fragmentados de modelos

Supabase staging
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

Cloudflare não recebe documentos privados, texto OCR, refresh token do Drive, service-role do Supabase ou chave Gemini. O worker local inicia somente conexões HTTPS de saída e não exige porta pública.

## 2. Estado operacional atual

Em 10 de agosto de 2026:

- os projetos Pages `fichario-virtual` e `fichario-models` já existem;
- `fichario-virtual` possui production branch administrativa `main`, build estático para `build/`, cache e Node 22 configurados;
- preview do Pages possui a configuração pública do Supabase staging;
- production do Pages **não** possui URL/chave do Supabase, por fail-closed deliberado;
- não existe backend Supabase de produção;
- auto-deploy Git está desligado enquanto a `main` recebe mudanças concorrentes;
- o primeiro Direct Upload real de staging ainda está pendente;
- build, empacotamento, identidade do artifact e gate HTTP pós-deploy possuem contratos versionados;
- o fluxo executável de build/publicação é restrito a staging até a infraestrutura de produção existir.

## 3. Fronteiras de ambiente

Há duas fronteiras independentes.

### Build de staging

Environment GitHub:

```text
staging
```

Contém somente a configuração pública necessária para congelar o frontend, como URL/publishable key do Supabase e, quando habilitado, o trio público do Google Picker.

### Publicação de staging

Environment GitHub:

```text
staging-deploy
```

Contém as credenciais Cloudflare de escopo mínimo usadas pelo Direct Upload.

Não misture credenciais de deploy no environment de build e não forneça segredos backend ao frontend.

### Produção

`production` e `production-deploy` são estados futuros, não caminhos executáveis atuais. Antes de reintroduzir suporte a produção, precisam existir no mínimo:

1. backend Supabase de produção isolado;
2. configuração pública de produção;
3. secrets/vars de produção nos environments corretos;
4. políticas de proteção/revisão apropriadas;
5. artifact de produção com contrato próprio;
6. promoção do mesmo artifact validado, sem rebuild;
7. smoke e rollback ensaiados.

Até isso existir, qualquer mudança que reintroduza opções de `production` nos workflows atuais deve falhar nos gates offline.

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

A política JWT fica versionada em `supabase/config.toml`; não enfraqueça funções autenticadas na linha de comando. As exceções `verify_jwt=false` são fronteiras deliberadas: o callback OAuth recebe o redirecionamento externo e aplica origem + `state` de uso único + PKCE; `desktop-ocr-pair` permite o resgate inicial por código de uso único antes de existir identidade do dispositivo; e `desktop-ocr-worker` autentica cada chamada pelo esquema dedicado `FicharioWorker`. Nenhuma dessas exceções transforma a função em API irrestrita.

O segredo antigo `OCR_DAILY_HARD_LIMIT` não deve ser reintroduzido como autoridade de bloqueio.

## 7. Configuração pública do frontend

Obrigatória para o artifact staging:

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

## 8. Gate do SHA candidato

O workflow normal do próprio repositório é a fonte principal de validação:

```text
Validate current head
```

Ele cobre frontend, gates source/offline, Chromium/E2E, Deno/Edge Functions e banco local. Durante desenvolvimento concorrente, `cancel-in-progress: true` pode encerrar um run quando a `main` avança. Run cancelado não é PASS nem falha funcional do código.

Para release/deploy, o recibo terminal deve corresponder ao **mesmo SHA** que será empacotado. Não use um SHA verde antigo para aprovar um SHA novo.

O repositório `Offline-Toolchains` continua útil quando for realmente necessário trabalhar a partir de um checkout/snapshot transportável; para gates normais, prefira Actions deste repositório.

## 9. Etapa A — construir artifact imutável de staging

Workflow:

```text
Build deployable Fichário staging artifact
```

O workflow é `workflow_dispatch` manual e não recebe seletor de ambiente. Ele usa `environment: staging` e `TARGET_ENVIRONMENT: staging` fixos.

O fluxo:

1. faz checkout do SHA disparado com `persist-credentials: false`;
2. usa pnpm e Node pinados;
3. instala com `pnpm install --frozen-lockfile`;
4. valida URL e publishable key públicas;
5. valida o trio Google Picker como all-or-none;
6. executa `pnpm verify`;
7. confirma que a configuração pública esperada foi congelada no `build/`;
8. rejeita URL/chave fake de desenvolvimento;
9. chama `tools/deploy/package-static-artifact.sh`;
10. revalida o pacote com `pnpm test:deployment:artifact`;
11. publica o artifact do GitHub Actions.

Nome do artifact:

```text
fichario-static-<sha-completo>-staging
```

### Empacotador compartilhado

`tools/deploy/package-static-artifact.sh` é a única implementação de empacotamento usada pelo workflow. Ele:

- exige `GITHUB_SHA` completo em lowercase;
- exige `TARGET_ENVIRONMENT=staging`;
- restringe o diretório de saída a um nome local simples;
- exige os arquivos essenciais do build e os verificadores de deploy;
- separa site público, snapshot de fonte e checks;
- rejeita symlinks;
- gera manifesto schema 2;
- gera `SHA256SUMS` com cobertura determinística;
- verifica os próprios checksums antes de retornar sucesso.

O campo `created_utc` do manifesto não usa o relógio do runner. Ele deriva de `SOURCE_DATE_EPOCH`, quando explicitamente fornecido, ou do timestamp do próprio `GITHUB_SHA`. Isso evita que duas execuções normais do mesmo commit mudem a identidade do manifesto só por ocorrerem em horários diferentes.

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

## 10. Etapa B — publicar exatamente o artifact validado

Workflow:

```text
Deploy validated staging artifact to Cloudflare Pages
```

Entradas:

```text
artifact_run_id:         run que produziu o artifact
expected_source_commit:  SHA completo de 40 caracteres
```

O workflow usa `environment: staging-deploy` e é deliberadamente artifact-only:

- **não faz checkout**;
- não executa `pnpm install`;
- não executa `pnpm build`;
- não executa `pnpm verify`;
- não cria nem substitui o projeto Pages.

Ele baixa somente `fichario-static-<sha>-staging` do run informado e, antes do Wrangler:

- confirma manifesto schema 2;
- confirma `Semogtw/FicharioVirtual` como repositório de origem;
- confirma SHA completo;
- confirma `target_environment=staging`;
- recalcula hashes de `package.json` e lockfile;
- executa `sha256sum -c SHA256SUMS`;
- rejeita symlinks;
- exige `_headers`, fallback, manifest, service worker e verificadores pinados;
- rejeita configuração Supabase local/fake.

### Credenciais de publicação

Secrets exigidos em `staging-deploy`:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

O token deve ter somente o escopo necessário para Pages na conta correta. Não revele valores em logs ou documentação.

## 11. Identidade do Direct Upload

O workflow usa Wrangler com versão explícita e parâmetros equivalentes a:

```bash
wrangler pages deploy <artifact>/site \
  --project-name=fichario-virtual \
  --branch=staging \
  --commit-hash=<sha-validado> \
  --commit-dirty=false
```

`WRANGLER_OUTPUT_FILE_PATH` captura o registro estruturado `pages-deploy-detailed`. `validate-pages-deploy-output.mjs`, transportado dentro do próprio artifact, rejeita respostas incompatíveis com o contrato esperado, incluindo projeto/SHA/deployment ID/URL inválidos.

Não derive a URL de staging por convenção. Use a URL única retornada pelo deployment.

## 12. Gate HTTP do deployment exato

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

A execução só é concluída com identidade do artifact **e** contrato HTTP aprovados.

## 13. CSP do site hospedado

`static/_headers` é versionado e o build valida o `_headers` realmente emitido.

As origens Google adicionais atualmente necessárias são restritas a:

```text
script-src:  https://apis.google.com
connect-src: https://www.googleapis.com
```

A primeira atende ao loader do Google Picker. A segunda atende a upload resumível e downloads/ranges do Drive feitos pelo navegador.

Não abra `*.google.com` preventivamente. Se o Picker real exigir uma origem de frame, capture a violação no preview e adicione somente a origem exata comprovada.

## 14. Smoke de staging

Depois do gate HTTP automatizado, valide no host real.

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
- tokens não aparecem em URL/log;
- crash entre cópia e staging é reconciliado por `appProperties`.

### OCR

Siga `docs/OCR_STAGING.md`, incluindo PDF textual com zero chamadas, lote visual real, cancelamento/retomada, quota do provedor e persistência.

### Worker desktop

Siga `docs/DESKTOP_OCR_WORKER.md` para pareamento, lease, spool, interrupções de rede/processo e benchmark do hardware alvo. O primeiro deploy do site pode registrar o worker como limitação operacional se essa fronteira ainda não tiver sido validada em hardware real.

## 15. Domínio canônico e `APP_ORIGIN`

Só adicione domínio customizado depois de um preview estável.

Ao escolher a origem canônica:

1. configurar domínio no Pages;
2. configurar redirects e HTTPS;
3. atualizar Site URL/redirects do Supabase Auth;
4. atualizar `APP_ORIGIN` (canônico) e `APP_ORIGIN_ALLOWLIST` (aliases oficiais) nas Edge Functions;
5. revisar tela/origens Google OAuth e confirmar que o `state` retorna à origem permitida que iniciou o fluxo;
6. reexecutar gate e smoke.

Não use wildcard CORS global. Se o mesmo artefato precisar funcionar em aliases oficiais do Pages durante staging, limite a allowlist ao domínio raiz e a um único nível de subdomínio do mesmo projeto; produção futura deve voltar a uma origem canônica própria.

## 16. Quando produção puder ser criada

Um preview aprovado **não** autoriza simplesmente publicar os bytes de staging como produção se a configuração pública for diferente.

Quando a infraestrutura de produção existir, o desenho deve preservar esta sequência:

```text
SHA X
  ↓
build de artifact com configuração de produção
  ↓
checksums + contrato do artifact
  ↓
preview/validação dos mesmos bytes
  ↓
promoção dos mesmos bytes
  ↓
gate HTTP do host exato + alias canônico
```

A implementação futura precisa ser adicionada com gates que provem isolamento de environments, credenciais e artifact. Até lá, não mantenha código morto de produção no workflow staging.

## 17. Rollback

### Frontend staging

- selecione um artifact/deployment anterior identificado por SHA;
- preserve banco e Drive;
- confirme compatibilidade do schema;
- use os checks do artifact correspondente;
- reexecute smoke essencial.

### Banco

Migrations são forward-only. Não reverta editando migration já aplicada. Em caso de defeito, crie migration corretiva compatível com os clientes que ainda possam estar ativos.

### Edge Functions

Redeploy de uma função deve preservar a política JWT versionada e o conjunto mínimo de secrets. Não use flags de deploy para enfraquecer autenticação.

## 18. Limites de ferramentas e segurança operacional

A integração administrativa Cloudflare observada consegue configurar o projeto e emitir token temporário do serviço de upload, mas não fornece um caminho seguro/equivalente ao Wrangler para usar esse JWT nos endpoints `/pages/assets/*`. Não exporte, revele ou persista esse token para contornar a fronteira.

Use o workflow artifact-only com credencial Cloudflare de escopo mínimo em `staging-deploy` para o Direct Upload real.

Para gates normais, use GitHub Actions deste repositório. Use o repo de toolchains apenas quando um checkout/snapshot isolado for realmente necessário.

## 19. Critério mínimo para avançar staging

Antes de tratar o preview como candidato sério:

- `Validate current head` terminal verde no mesmo SHA;
- artifact staging construído desse SHA;
- contrato do artifact aprovado;
- Direct Upload do artifact exato;
- identidade Wrangler aprovada;
- gate HTTP da URL exata aprovado;
- smoke de autenticação/PWA;
- smoke Drive/OCR aplicável ou risco explicitamente registrado;
- nenhum conteúdo privado na Cloudflare.

Os estados detalhados e recibos correntes ficam em `docs/READINESS.md`.
