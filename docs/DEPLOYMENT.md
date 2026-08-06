# Deployment do Fichário Virtual

## Topologia alvo

```text
Cloudflare Pages
└── frontend estático SvelteKit

Cloudflare Pages — projeto separado
└── artefatos públicos e fragmentados de modelos

Google Drive
└── arquivos originais permanentes

Supabase
├── Auth
├── PostgreSQL
├── Row Level Security
├── Storage privado temporário
├── Edge Functions Drive e Gemini
└── fila e API restrita do worker desktop

Computador confiável
└── Fichário Desktop OCR Worker
```

Cloudflare não recebe documentos privados. O Gemini continua isolado no backend. O worker local inicia conexões HTTPS de saída e não exige porta pública.

Runbooks complementares:

- `docs/CLOUDFLARE_SETUP.md`;
- `docs/DESKTOP_OCR_WORKER.md`;
- `docs/GOOGLE_DRIVE_SETUP.md`;
- `docs/SUPABASE_STAGING.md`;
- `docs/OCR_STAGING.md`.

## 1. Preparar o Supabase

Crie um projeto e aplique as migrations em ordem:

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase test db
```

Depois regenere os tipos:

```bash
supabase gen types typescript --linked > src/lib/types/database.ts
pnpm format src/lib/types/database.ts
```

Revise o diff antes de publicar. Casts temporárias dos serviços devem ser removidas quando as RPCs aparecerem nos tipos gerados.

As migrations futuras do worker precisam ser aplicadas antes das respectivas Edge Functions. Um worker novo nunca deve ser liberado contra schema antigo incompatível.

## 2. Configurar usuário autorizado

Crie a conta no Supabase Auth e adicione o UUID correspondente em `public.app_users`:

```sql
insert into public.app_users (user_id, is_active)
values ('<auth-user-uuid>', true);
```

Não use email como chave de autorização nas políticas. `auth.uid()` e a allowlist são a fonte de acesso para a PWA.

Credenciais de dispositivos desktop usam tabelas e Edge Functions próprias. Elas não substituem a sessão Supabase e não recebem acesso SQL direto.

## 3. Configurar Storage

A migration cria o bucket privado `documents` e políticas por prefixo do usuário.

Confirme:

- bucket não público;
- uploads somente em `<auth.uid()>/<document-id>/...`;
- download direto negado sem sessão;
- URL assinada com validade curta;
- remoção recusada para outro usuário;
- página temporária preservada enquanto existir rota Gemini ou desktop pendente;
- limpeza somente depois de conclusão ou cancelamento de todas as rotas necessárias.

Depois da migração Drive, o Storage permanece apenas para temporários, fallback e migração controlada.

## 4. Configurar Google Drive

Siga `docs/GOOGLE_DRIVE_SETUP.md`.

Requisitos:

- escopo exato `https://www.googleapis.com/auth/drive.file`;
- refresh token somente no backend;
- pasta `Fichário Digital`;
- upload retomável;
- Google Picker explícito;
- feed de mudanças;
- ausência, reconexão e conflitos;
- migração com rollback.

A troca do host público exige atualizar apenas a origem do aplicativo e links de retorno. O callback OAuth continua na Edge Function do Supabase.

## 5. Configurar Edge Functions

Secrets obrigatórios atuais:

```bash
supabase secrets set \
  APP_ORIGIN=https://app.example.com \
  GEMINI_API_KEY=<secret> \
  OCR_MODEL_PRIMARY=<modelo-estavel> \
  OCR_PROMPT_VERSION=1
```

A implementação atual ainda exige `OCR_DAILY_HARD_LIMIT`; essa exigência é incompatibilidade transitória e precisa ser removida antes de declarar a política de ausência de limite interno como concluída.

Secrets Drive são configurados conforme o runbook específico. Nunca prefixe secrets com `PUBLIC_`.

Implantação atual:

```bash
supabase functions deploy process-ocr
supabase functions deploy delete-document
```

Implantação futura do worker:

```text
desktop-worker-pair
desktop-ocr-claim
desktop-ocr-source
desktop-ocr-heartbeat
desktop-ocr-complete
desktop-ocr-fail
```

Essas funções devem ser implantadas somente depois das migrations correspondentes e dos testes locais. Elas validam credencial de dispositivo própria, não JWT público como substituto improvisado.

Não usar `--no-verify-jwt` em funções voltadas à PWA. Funções de dispositivo precisam de autenticação explícita e fail-closed definida no design, nunca de endpoint anônimo com confiança no payload.

## 6. Variáveis públicas do frontend

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<valor>
```

Essas são as únicas variáveis do build do Cloudflare Pages.

Não cadastrar no Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

## 7. Construir o frontend

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

O output estático fica em `build/`.

### Artifact implantável reproduzível

O workflow manual `Build deployable Fichário artifact` fabrica o mesmo output usando a configuração pública armazenada em environment protegido do GitHub.

Escolha `staging` ou `production`. O environment selecionado precisa fornecer:

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

A Action:

- aceita somente origem Supabase HTTPS sem credentials, caminho, query ou fragmento;
- aceita somente chave com prefixo `sb_publishable_`;
- executa `pnpm verify` antes de empacotar;
- confirma que URL e chave escolhidas foram incorporadas ao build;
- rejeita placeholders locais usados pelos E2E;
- publica artifact por sete dias;
- inclui manifest, checksums e snapshots de `package.json` e `pnpm-lock.yaml`;
- não aplica migrations, não implanta Edge Functions e não publica em host.

Depois de baixar e extrair:

```bash
cd fichario-deploy
sha256sum -c SHA256SUMS
cat DEPLOYMENT-MANIFEST.txt
```

A partir de checkout da mesma versão:

```bash
pnpm test:deployment:artifact -- /caminho/para/fichario-deploy
```

Sirva somente `fichario-deploy/site/` como raiz pública. Manifest, checksums e snapshots ficam fora da raiz.

## 8. Hospedar no Cloudflare Pages

O projeto continua usando `@sveltejs/adapter-static`; não trocar para adapter de funções enquanto não existir requisito real de SSR.

Configuração:

```text
Production branch: main
Build command: corepack enable && pnpm install --frozen-lockfile && pnpm build
Build directory: build
```

O host precisa:

- servir `build/` como raiz pública;
- usar `200.html` como fallback de SPA;
- preservar `static/_headers`;
- usar HTTPS;
- redirecionar HTTP para a mesma origem HTTPS;
- não reescrever `/assets/*` para `200.html`;
- servir `sw.js`, `registerSW.js` e manifesto com tipos corretos;
- usar uma única origem canônica de produção;
- redirecionar ou restringir `*.pages.dev`;
- nunca receber conteúdo privado.

Siga `docs/CLOUDFLARE_SETUP.md` para a configuração completa.

## 9. Distribuir modelos do worker

O caminho padrão usa outro projeto Cloudflare Pages com Direct Upload.

Artefatos:

```text
index.json
models/<model-id>/<version>/manifest.json
models/<model-id>/<version>/part-000.bin
models/<model-id>/<version>/part-001.bin
models/<model-id>/<version>/LICENSE.txt
models/<model-id>/<version>/NOTICE.txt
```

Regras:

- partes com no máximo 20 MiB;
- versão imutável;
- SHA-256 por parte e total;
- licença e origem obrigatórias;
- nenhuma página ou documento privado;
- nenhum modelo no precache da PWA;
- tablet não baixa modelos ao abrir o site.

Publicação planejada:

```bash
npx wrangler pages deploy model-dist --project-name=fichario-models --branch=main
```

Cloudflare R2 permanece opcional e desativado por padrão. Ele só pode substituir partes após decisão explícita sobre cobrança por uso e atualização de `docs/FREE_TIER_OPERATIONS.md`.

## 10. Implantar o worker desktop

Siga `docs/DESKTOP_OCR_WORKER.md`.

Ordem:

1. migrations de dispositivos, resultados e fila;
2. Edge Functions do worker;
3. UI de pareamento e revogação;
4. pacote do worker CPU-first;
5. serviço systemd de usuário;
6. instalação de modelo com checksums;
7. pareamento de dispositivo de staging;
8. teste de claim, lease, heartbeat e conclusão;
9. teste de queda e retomada;
10. benchmark Vulkan e RX 6600;
11. promoção do mesmo conjunto compatível.

O worker nunca recebe service-role, chave Gemini ou refresh token do Drive.

## 11. Validação automática pós-deployment

Execute contra a origem HTTPS, sem caminho adicional:

```bash
pnpm test:deployment -- https://app.example.com
```

O comando deve falhar se encontrar:

- URL sem HTTPS, com credentials, query, fragmento ou subcaminho;
- ausência de redirect HTTP para a mesma origem HTTPS;
- headers de CSP, HSTS, referrer, framing, MIME, permissions ou isolamento inconsistentes;
- HTML raiz ou fallback sem manifesto e registrador externo adiado;
- manifesto sem modo `standalone`, `start_url` raiz ou ícone válido;
- `registerSW.js` ou `sw.js` com cache longo;
- service worker mencionando Supabase privado ou modelos desktop;
- asset inexistente recebendo HTML indevidamente.

Esse gate valida host e assets públicos. Ele não substitui RLS, Drive, Gemini ou worker real.

## 12. Validação funcional pós-deployment

### Autenticação

- usuário autorizado entra;
- usuário fora da allowlist recebe bloqueio;
- logout remove acesso;
- refresh em rota privada preserva sessão válida;
- sessão expirada volta ao login;
- origem `pages.dev` não cria sessão paralela de produção.

### Dados privados

- outra conta não lista documentos;
- URL assinada expira;
- caminho de Storage não aparece na UI ou exportação;
- PWA offline não revela documentos vistos anteriormente;
- Cloudflare não recebe requests de documentos ou páginas temporárias.

### Importação e Drive

- imagem preparada e deduplicada;
- PDF textual não chama OCR;
- PDF misto marca somente páginas necessárias;
- cancelamento mantém estado coerente;
- reload retoma páginas persistidas sem reupload;
- original permanente fica no Drive;
- ausência preserva OCR e metadados.

### Gemini

- consentimento obrigatório;
- segredo ausente retorna configuração indisponível;
- 429 do provedor preserva trabalho;
- 503 entra em retry com backoff;
- resposta classifica `printed`, `handwritten`, `mixed` ou `unknown`;
- caderno manuscrito pode pular chamada Gemini;
- resultado preliminar não apaga resultado aceito.

### Worker desktop

- pareamento é de uso único;
- credencial revogada deixa de reivindicar;
- computador offline mantém `waiting_desktop`;
- claim concorrente é recusado;
- heartbeat prolonga lease dentro dos limites;
- lease expirado permite retomada;
- URL expirada é recusada;
- hash divergente impede processamento;
- conclusão é idempotente;
- queda de rede preserva spool;
- logs não contêm texto;
- CPU funciona sem GPU;
- RX 6600 recebe evidência ou limitação registrada.

### Busca e revisão

- correção manual substitui resultado automático na busca;
- resultado desktop e Gemini permanecem comparáveis;
- realce não interpreta HTML;
- fila de revisão abre a página correta;
- exportação JSON valida o schema ativo.

## 13. Rollback

### Frontend

- selecionar deployment anterior no Cloudflare Pages;
- preservar banco e Drive;
- coordenar `APP_ORIGIN` e redirects se a origem mudar;
- reexecutar o gate pós-deployment.

### Banco

- migrations são forward-only;
- criar migration corretiva, não editar migration aplicada;
- antes de mudança destrutiva, exportar manifest e fazer backup.

### Edge Functions

- manter commit anterior disponível;
- funções antigas precisam tolerar estados persistidos ou falhar fechado;
- rollback de função não reverte tabela automaticamente.

### Modelos

- alterar a versão recomendada no índice;
- nunca substituir bytes de versão publicada;
- preservar última versão válida instalada;
- não reprocessar páginas automaticamente.

### Worker

- preservar compatibilidade de schema ou recusar inicialização;
- manter spool ao voltar para versão anterior compatível;
- revogar versões comprometidas explicitamente;
- não perder trabalhos no servidor durante reinstalação.

## 14. Proibições

- não publicar chave Gemini, service-role ou segredo Google;
- não tornar bucket privado do Supabase público;
- não cachear endpoints autenticados;
- não colocar documentos no Cloudflare Pages ou projeto de modelos;
- não ativar R2 automaticamente;
- não abrir porta doméstica para o worker;
- não colocar token do worker em arquivo de configuração;
- não declarar RX 6600 suportada sem benchmark;
- não inserir fallback pago silencioso;
- não declarar release pronta sem gates locais, remotos e em dispositivo.
