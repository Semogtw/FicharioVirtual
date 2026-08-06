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
├── PostgreSQL + RLS
├── Storage privado temporário
├── Edge Functions Drive e Gemini
├── manifestos e filas OCR
└── API restrita do worker desktop

Computador confiável
└── Fichário Desktop OCR Worker
```

Cloudflare não recebe documentos privados. O Gemini permanece isolado no backend. O worker local inicia somente conexões HTTPS de saída e não exige porta pública.

Runbooks complementares:

- `docs/CLOUDFLARE_SETUP.md`;
- `docs/DESKTOP_OCR_WORKER.md`;
- `docs/GOOGLE_DRIVE_SETUP.md`;
- `docs/SUPABASE_STAGING.md`;
- `docs/OCR_STAGING.md`.

## 1. Preparar o Supabase

Crie o projeto e aplique as migrations em ordem:

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase test db
```

O rollout de OCR em lotes depende, no mínimo, de:

```text
202608060014_provider_only_ocr_batches.sql
202608060015_ocr_batch_usage_and_hardening.sql
202608060016_harden_ocr_batch_transitions.sql
```

Essas migrations:

- removem a assinatura com limite diário do aplicativo;
- criam `ocr_batches` e vínculos ordenados em `ocr_jobs`;
- mantêm páginas, lotes, chamadas e tentativas como telemetria;
- restringem escrita de manifestos aos RPCs validados;
- tornam transições terminais idempotentes;
- preservam `blocked_quota` somente para quota real do provedor.

Depois regenere os tipos:

```bash
supabase gen types typescript --linked > src/lib/types/database.ts
pnpm format src/lib/types/database.ts
```

O arquivo versionado é um espelho provisório. Não promova a release sem comparar os tipos gerados com o schema implantado.

Migrations são forward-only. Corrija por nova migration; não edite uma migration já aplicada.

## 2. Configurar usuário autorizado

Crie a conta no Supabase Auth e adicione o UUID em `public.app_users`:

```sql
insert into public.app_users (user_id, is_active)
values ('<auth-user-uuid>', true);
```

Email não é chave de autorização nas políticas. A PWA usa `auth.uid()` e allowlist fail-closed.

Credenciais do worker desktop usam tabelas e funções próprias. Elas não substituem a sessão Supabase e não recebem SQL direto.

## 3. Configurar Storage

Confirme:

- bucket `documents` privado;
- uploads somente em `<auth.uid()>/<document-id>/...`;
- download negado sem sessão;
- URL assinada curta;
- remoção recusada para outro usuário;
- temporário preservado enquanto existir rota pendente;
- limpeza somente depois de persistência segura ou cancelamento confirmado.

O original permanente fica no Google Drive. O Storage Supabase contém páginas derivadas, fallback transitório e migração controlada.

O `supabase/config.toml` mantém `file_size_limit = "20MiB"` para o ambiente local. Já a migration `202608060014_provider_only_ocr_batches.sql` eleva o bucket remoto `documents` para pelo menos 50 MiB como compatibilidade transitória durante a migração Drive-first. Esse valor não é o limite arquitetural do documento: o fluxo normal envia o original diretamente ao Drive, enquanto páginas temporárias acima de 12 MiB recebem uma segunda renderização conservadora antes do envio ao Storage. Não aumente o bucket além disso sem necessidade e não trate os 50 MiB transitórios como autorização para guardar originais permanentemente no Supabase.

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

Uploads locais grandes usam sessão retomável do Drive. O download direto do Picker no navegador aceita até 50 MiB; acima disso o arquivo precisa permanecer ou ser copiado dentro do fluxo Drive-first, sem ser baixado integralmente pelo navegador.

A troca do host público altera a origem da aplicação e os retornos autorizados. O callback OAuth continua em Edge Function do Supabase.

## 5. Configurar Gemini e Edge Functions

Crie projeto Gemini sem billing vinculado e escolha versão estável disponível no nível gratuito na data do deployment.

Secrets obrigatórios:

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

Esses controles protegem memória, tamanho e duração; não são franquia diária. Valores padrão em código:

```text
páginas por lote: 40
bytes derivados por chamada: 12 MiB
prazo da chamada: 120 segundos
```

Limites absolutos da Edge Function:

```text
até 100 páginas por invocação
até 48 MiB de derivados por chamada
até 14 MiB por página derivada
```

Remova o segredo obsoleto depois da implantação:

```bash
supabase secrets unset OCR_DAILY_HARD_LIMIT
```

A função não lê esse valor. Mantê-lo no painel não bloqueia o código novo, mas removê-lo evita confusão operacional.

Implante todas as funções atualmente usadas pela PWA:

```bash
supabase functions deploy process-ocr
supabase functions deploy delete-document
supabase functions deploy drive-oauth-start
supabase functions deploy drive-oauth-callback
supabase functions deploy drive-access-token
supabase functions deploy drive-resolve-folder
supabase functions deploy drive-run-jobs
supabase functions deploy drive-sync
```

A política JWT está versionada em `supabase/config.toml`. Todas as APIs autenticadas usam `verify_jwt = true`. Somente `drive-oauth-callback` usa `verify_jwt = false`, pois o redirecionamento do Google não carrega uma sessão Supabase; essa função valida a origem configurada, o `state` OAuth de uso único e o fluxo PKCE antes de concluir a conexão. Não use `supabase functions deploy --no-verify-jwt` nem enfraqueça as demais funções na linha de comando.

Funções futuras do worker precisam de autenticação de dispositivo explícita e fail-closed.

## 6. Contrato de OCR implantado

`process-ocr` aceita:

```json
{ "pageId": "<uuid>" }
```

para compatibilidade, ou:

```json
{ "pageIds": ["<uuid>", "<uuid>"] }
```

Um `batchId` persistido pode acompanhar a lista quando o chamador já possui manifesto.

A função:

1. valida páginas únicas de um único documento;
2. reivindica cada trabalho sem teto diário local;
3. baixa derivados sequencialmente;
4. respeita limite agregado;
5. registra um manifesto e uma chamada;
6. envia várias imagens em uma única requisição Gemini;
7. exige retorno associado por `pageId` e número original;
8. persiste páginas válidas independentemente;
9. marca omissões, duplicações e truncamento para divisão;
10. limpa somente temporários concluídos;
11. preserva quota real e falhas transitórias para retomada.

O original não é reescrito ou comprimido. A compressão significa apenas uma segunda renderização temporária conservadora quando uma página derivada ultrapassa 12 MiB.

## 7. Variáveis públicas do frontend

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<valor>
PUBLIC_GOOGLE_CLIENT_ID=<quando o Picker estiver habilitado>
PUBLIC_GOOGLE_PICKER_API_KEY=<chave pública restrita>
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=<número do projeto>
```

Nunca cadastrar no Cloudflare Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

## 8. Construir o frontend

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

O output estático fica em `build/`.

O workflow manual `Build deployable Fichário artifact` usa environment protegido e executa `pnpm verify` antes de empacotar. Depois de baixar:

```bash
cd fichario-deploy
sha256sum -c SHA256SUMS
cat DEPLOYMENT-MANIFEST.txt
```

Do checkout do mesmo SHA:

```bash
pnpm test:deployment:artifact -- /caminho/para/fichario-deploy
```

Sirva somente `fichario-deploy/site/` como raiz pública.

## 9. Hospedar no Cloudflare Pages

O projeto usa `@sveltejs/adapter-static`.

```text
Production branch: main
Build command: corepack enable && pnpm install --frozen-lockfile && pnpm build
Build directory: build
```

O host precisa:

- servir `build/`;
- usar `200.html` como fallback de SPA;
- preservar `static/_headers`;
- usar HTTPS e origem canônica única;
- não reescrever `/assets/*` para HTML;
- servir service worker e manifesto com tipos corretos;
- nunca receber conteúdo privado.

Siga `docs/CLOUDFLARE_SETUP.md`.

## 10. Distribuir e implantar o worker desktop

Siga `docs/DESKTOP_OCR_WORKER.md`.

Modelos públicos ficam em projeto Pages separado, fragmentados em partes de até 20 MiB, com licença e SHA-256. O tablet não baixa esses modelos.

Ordem do worker:

1. migrations de dispositivos, resultados e fila;
2. Edge Functions exclusivas;
3. UI de pareamento e revogação;
4. pacote CPU-first;
5. serviço systemd de usuário;
6. instalação de modelo com checksums;
7. claim, lease, heartbeat e conclusão;
8. queda, spool e retomada;
9. benchmark Vulkan e RX 6600.

O worker nunca recebe service-role, chave Gemini ou refresh token do Drive. Esta funcionalidade continua separada do rollout de lotes Gemini.

## 11. Gates pré-release

No mesmo SHA que será implantado:

```bash
pnpm format:check
pnpm check
pnpm lint
pnpm test:unit
pnpm check:edge
pnpm check:offline
pnpm test:db
pnpm build
pnpm test:e2e
```

Gates específicos de OCR:

- `supabase/tests/ocr_batches.sql`;
- `supabase/tests/ocr_batch_transitions.sql`;
- `tools/checks/test-ocr-claim-contracts.sh`;
- `tools/checks/test-ocr-claim-concurrency.sh`;
- `tools/checks/test-ocr-idempotency.sh`;
- `tools/checks/check-provider-only-ocr.mjs`.

Não use um SHA verde antigo para aprovar um SHA novo. Artifacts de reparo ou passos E2E pulados impedem `PASS`.

## 12. Validação de staging

Siga `docs/OCR_STAGING.md`.

A promoção exige:

- smoke real de imagem;
- PDF textual com zero chamadas;
- PDF visual multipágina com menos chamadas do que páginas;
- omissão, duplicação e JSON truncado sem perda;
- cancelamento e retomada sem repetir páginas concluídas;
- contador local elevado sem bloqueio;
- `429` temporário e quota diária real preservados;
- fixtures acima de 50 MB e 1.000 páginas;
- hash do original inalterado;
- confirmação administrativa de billing desativado.

## 13. Validação pós-deployment

Execute:

```bash
pnpm test:deployment -- https://app.example.com
```

Valide ainda:

### Autenticação e dados

- allowlist funciona;
- outra conta não lista dados;
- URL assinada expira;
- PWA offline não revela documentos;
- Cloudflare não recebe documentos privados.

### Importação e Drive

- original fica no Drive;
- PDF textual não chama OCR;
- PDF misto envia somente páginas necessárias;
- PDF grande não é rejeitado por teto de 20 MB;
- cancelamento preserva estado;
- reload retoma páginas persistidas;
- ausência preserva OCR e metadados.

### OCR Gemini

- consentimento obrigatório;
- segredo ausente falha fechado;
- lotes aparecem no painel;
- páginas, chamadas e tentativas são coerentes;
- 429 preserva trabalho;
- resposta parcial divide somente afetados;
- correção manual permanece autoridade final.

### Worker desktop

- executar somente depois da implementação e dos gates próprios;
- computador offline mantém fila;
- credencial revogada deixa de reivindicar;
- conclusão é idempotente;
- logs não contêm texto;
- CPU funciona sem GPU.

## 14. Rollback

### Frontend

Selecione deployment anterior no Cloudflare, preserve banco e Drive e reexecute os gates do host.

### Banco

Use migration corretiva. Não remova `ocr_batches` nem volte à assinatura diária de `claim_ocr_job`; versões antigas incompatíveis devem falhar fechado.

### Edge Functions

Mantenha commit anterior disponível. Um rollback precisa compreender o schema implantado ou recusar inicialização sem corromper estado.

### Modelos e worker

Nunca substitua bytes de versão publicada. Preserve spool e última versão compatível. Não reprocese páginas automaticamente.

## 15. Proibições

- não publicar secrets;
- não tornar bucket privado público;
- não cachear endpoints autenticados;
- não colocar documentos no Cloudflare;
- não ativar R2 ou billing automaticamente;
- não abrir porta doméstica para o worker;
- não reinserir teto diário interno;
- não inserir fallback pago silencioso;
- não declarar release pronta sem gates locais, CI, staging e dispositivo no mesmo SHA.
