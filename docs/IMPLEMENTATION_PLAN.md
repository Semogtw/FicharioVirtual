# Fichário Virtual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma PWA pessoal que importe imagens e PDFs de anotações, extraia ou reconheça o texto, indexe-o e encontre rapidamente o documento original, sem modelos locais de IA e sem custo operacional.

**Architecture:** Um aplicativo SvelteKit estático executa interface, preparação de imagens e inspeção de PDFs em Web Workers. Supabase fornece autenticação, PostgreSQL, Storage e Edge Functions; um adaptador de OCR chama um modelo multimodal disponível no nível gratuito da Gemini Developer API. PDFs com texto são processados localmente por `pdf-inspector`; apenas páginas sem texto são renderizadas por PDF.js e enviadas ao OCR.

**Tech Stack:** SvelteKit, TypeScript, pnpm, Vite, Vitest, Playwright, `vite-plugin-pwa`, Supabase, Deno Edge Functions, PostgreSQL FTS, `pg_trgm`, `unaccent`, `pdf-inspector` WASM, PDF.js e Gemini Developer API.

## Global Constraints

- O Samsung Galaxy Tab S6 Lite é o dispositivo de referência.
- Modelos de IA locais são proibidos.
- PDF.js e `pdf-inspector` devem ser carregados sob demanda.
- A interface deve continuar responsiva durante preparação e inspeção.
- O sistema deve permanecer no nível gratuito de todos os serviços.
- Nenhum fallback pode ativar faturamento ou serviço pago.
- Apenas uma conta autorizada terá acesso.
- Arquivos e transcrições são privados.
- A interface deve ter identidade editorial e não parecer um chatbot.
- Commits devem ser pequenos e feitos após cada tarefa testável.

---

## Estrutura de arquivos prevista

```text
FicharioVirtual/
├── src/
│   ├── app.html
│   ├── hooks.client.ts
│   ├── routes/
│   │   ├── +layout.svelte
│   │   ├── +layout.ts
│   │   ├── +page.svelte
│   │   ├── login/+page.svelte
│   │   ├── library/+page.svelte
│   │   ├── notebooks/+page.svelte
│   │   ├── notebooks/[id]/+page.svelte
│   │   ├── import/+page.svelte
│   │   ├── review/+page.svelte
│   │   ├── documents/[id]/+page.svelte
│   │   └── settings/+page.svelte
│   └── lib/
│       ├── components/
│       ├── design/
│       ├── domain/
│       ├── export/
│       ├── import/
│       ├── pdf/
│       ├── search/
│       ├── services/
│       ├── stores/
│       ├── types/
│       └── utils/
├── static/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   ├── _shared/
│   │   └── process-page/
│   └── tests/
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
├── package.json
├── svelte.config.js
├── vite.config.ts
└── playwright.config.ts
```

---

### Task 1: Fundação do aplicativo e gates locais

**Files:**

- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `svelte.config.js`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/routes/+page.svelte`
- Create: `src/lib/env/public.ts`
- Create: `src/lib/env/private.ts`
- Create: `tests/unit/smoke.test.ts`

**Interfaces:**

- Produces: aplicativo SvelteKit estático; scripts `dev`, `build`, `check`, `lint`, `test`, `test:e2e`.
- Produces: `publicEnv` com `PUBLIC_SUPABASE_URL` e `PUBLIC_SUPABASE_PUBLISHABLE_KEY` validados.

- [ ] **Step 1: Inicializar SvelteKit com TypeScript**

Run:

```bash
pnpm dlx sv create . --template minimal --types ts --no-add-ons --install pnpm
```

Expected: projeto SvelteKit criado na raiz sem sobrescrever `docs/` e `README.md`.

- [ ] **Step 2: Instalar ferramentas de qualidade**

```bash
pnpm add -D vitest @vitest/coverage-v8 eslint prettier prettier-plugin-svelte \
  @playwright/test vite-plugin-pwa
pnpm add @supabase/supabase-js zod
```

- [ ] **Step 3: Definir scripts obrigatórios**

Em `package.json`:

```json
{
	"scripts": {
		"dev": "vite dev",
		"build": "vite build",
		"preview": "vite preview",
		"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
		"lint": "prettier --check . && eslint .",
		"format": "prettier --write .",
		"test": "vitest run",
		"test:watch": "vitest",
		"test:e2e": "playwright test",
		"verify": "pnpm lint && pnpm check && pnpm test && pnpm build"
	}
}
```

- [ ] **Step 4: Escrever o teste de fumaça**

```ts
import { describe, expect, it } from 'vitest';

describe('project foundation', () => {
	it('runs the test harness', () => {
		expect(true).toBe(true);
	});
});
```

- [ ] **Step 5: Executar os gates**

```bash
pnpm verify
```

Expected: todos os comandos terminam com código 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml svelte.config.js vite.config.ts tsconfig.json src tests
git commit -m "chore: establish SvelteKit application foundation"
git push
```

---

### Task 2: Sistema visual editorial e shell responsivo

**Files:**

- Create: `src/lib/design/tokens.css`
- Create: `src/lib/design/global.css`
- Create: `src/lib/components/AppShell.svelte`
- Create: `src/lib/components/TopSearch.svelte`
- Create: `src/lib/components/MobileNavigation.svelte`
- Create: `src/lib/components/Button.svelte`
- Create: `src/lib/components/EmptyState.svelte`
- Modify: `src/routes/+layout.svelte`
- Test: `tests/unit/components/button.test.ts`
- Test: `tests/e2e/navigation.spec.ts`

**Interfaces:**

- Produces: `AppShell` com slot de conteúdo e navegação adaptativa.
- Produces: componentes básicos sem biblioteca visual pesada.

- [ ] **Step 1: Criar tokens visuais**

```css
:root {
	--paper: #f7f4ee;
	--surface: #fcfaf6;
	--ink: #202124;
	--muted: #66706b;
	--line: #ddd7cc;
	--accent: #a65e43;
	--archive: #536a5b;
	--danger: #9b3f36;
	--radius-sm: 8px;
	--radius-md: 14px;
	--shadow-soft: 0 10px 30px rgb(32 33 36 / 8%);
	--font-heading: Georgia, Cambria, 'Times New Roman', serif;
	--font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
```

- [ ] **Step 2: Implementar shell tablet-first**

Regras:

- até 767 px: navegação inferior;
- de 768 a 1099 px: barra lateral compacta;
- a partir de 1100 px: barra lateral completa;
- busca fixa no topo em todas as telas privadas.

- [ ] **Step 3: Garantir acessibilidade do botão**

Teste esperado:

```ts
expect(button.getAttribute('type')).toBe('button');
expect(button.textContent).toContain('Importar');
```

- [ ] **Step 4: Testar navegação em viewport de tablet**

```ts
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1200, height: 800 } });

test('shows persistent library navigation', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('navigation')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Biblioteca' })).toBeVisible();
});
```

- [ ] **Step 5: Verificar semântica e contraste**

Run:

```bash
pnpm test && pnpm test:e2e
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/design src/lib/components src/routes/+layout.svelte tests
git commit -m "feat: add editorial responsive design system"
git push
```

---

### Task 3: Banco, extensões, busca e Row Level Security

**Files:**

- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608020001_extensions.sql`
- Create: `supabase/migrations/202608020002_schema.sql`
- Create: `supabase/migrations/202608020003_rls.sql`
- Create: `supabase/migrations/202608020004_search.sql`
- Create: `supabase/tests/rls.sql`
- Create: `src/lib/types/database.ts`

**Interfaces:**

- Produces: tabelas `app_users`, `notebooks`, `documents`, `pages`, `ocr_jobs`, `tags`, `document_tags`, `import_sessions`, `usage_daily`.
- Produces: RPC `search_pages(search_query, notebook_filter, result_limit, result_offset)`.

- [ ] **Step 1: Criar extensões**

```sql
create extension if not exists unaccent;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
```

- [ ] **Step 2: Criar enums e tabelas**

Exemplo para status:

```sql
create type processing_status as enum (
  'pending', 'processing', 'ready', 'retryable',
  'blocked_quota', 'needs_review', 'failed'
);
```

Cada tabela de domínio deve possuir `user_id uuid not null references auth.users(id)`.

- [ ] **Step 3: Criar texto efetivo e vetor de busca**

```sql
create or replace function public.page_effective_text(p public.pages)
returns text
language sql
immutable
as $$
  select coalesce(nullif(p.corrected_text, ''), nullif(p.native_text, ''), p.ocr_raw_text, '');
$$;
```

Criar trigger para atualizar `normalized_text` e `search_vector` ao inserir ou alterar texto.

- [ ] **Step 4: Ativar RLS e políticas**

Padrão:

```sql
alter table public.documents enable row level security;

create policy "documents_owner_all"
on public.documents
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Repetir explicitamente para todas as tabelas expostas.

- [ ] **Step 5: Criar RPC de busca ranqueada**

A função deve combinar:

- igualdade normalizada;
- `websearch_to_tsquery('simple', ...)`;
- `ts_rank_cd`;
- `similarity(normalized_text, normalized_query)`;
- filtros por usuário e caderno.

A função deve executar como `security invoker`.

- [ ] **Step 6: Testar isolamento**

O teste SQL cria dois usuários e verifica:

```sql
select lives_ok(..., 'owner reads own document');
select is_empty(..., 'other user cannot read document');
```

- [ ] **Step 7: Aplicar localmente**

```bash
supabase start
supabase db reset
supabase test db
supabase gen types typescript --local > src/lib/types/database.ts
```

Expected: testes RLS passam e tipos são gerados.

- [ ] **Step 8: Commit**

```bash
git add supabase src/lib/types/database.ts
git commit -m "feat: add secure searchable document schema"
git push
```

---

### Task 4: Cliente Supabase e autenticação de usuário único

**Files:**

- Create: `src/lib/services/supabase.ts`
- Create: `src/lib/services/auth.ts`
- Create: `src/lib/stores/session.svelte.ts`
- Create: `src/routes/login/+page.svelte`
- Modify: `src/routes/+layout.ts`
- Test: `tests/unit/services/auth.test.ts`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**

- Produces: `signIn(email, password)`, `signOut()`, `loadAuthorizedSession()`.
- Produces: store `sessionState` com `loading`, `user`, `authorized`, `error`.

- [ ] **Step 1: Criar cliente único**

```ts
export const supabase = createClient<Database>(url, publishableKey, {
	auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
```

- [ ] **Step 2: Verificar allowlist**

Após obter a sessão, consultar:

```ts
.from('app_users')
.select('is_active')
.eq('user_id', user.id)
.eq('is_active', true)
.maybeSingle();
```

Usuário ausente ou inativo deve ter a sessão encerrada.

- [ ] **Step 3: Proteger rotas privadas**

Apenas `/login` e arquivos estáticos são públicos. Durante restauração da sessão, mostrar shell de carregamento, não conteúdo privado.

- [ ] **Step 4: Testar usuário não autorizado**

Mockar sessão válida sem registro em `app_users`; esperar `signOut()` e redirecionamento para `/login`.

- [ ] **Step 5: Executar testes**

```bash
pnpm test tests/unit/services/auth.test.ts
pnpm test:e2e tests/e2e/auth.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/services src/lib/stores src/routes tests
git commit -m "feat: restrict access to the authorized account"
git push
```

---

### Task 5: Biblioteca, cadernos e serviços de domínio

**Files:**

- Create: `src/lib/domain/document.ts`
- Create: `src/lib/domain/notebook.ts`
- Create: `src/lib/services/documents.ts`
- Create: `src/lib/services/notebooks.ts`
- Create: `src/lib/components/DocumentCard.svelte`
- Create: `src/lib/components/NotebookCard.svelte`
- Create: `src/routes/library/+page.svelte`
- Create: `src/routes/notebooks/+page.svelte`
- Create: `src/routes/notebooks/[id]/+page.svelte`
- Test: `tests/unit/services/documents.test.ts`

**Interfaces:**

- Produces: `listDocuments`, `createDocument`, `updateDocument`, `deleteDocument`.
- Produces: `listNotebooks`, `createNotebook`, `updateNotebook`, `deleteNotebook`.

- [ ] **Step 1: Definir modelos de domínio independentes do banco**

```ts
export interface DocumentSummary {
	id: string;
	title: string;
	kind: 'image' | 'pdf';
	status: string;
	pageCount: number;
	thumbnailPath: string | null;
	createdAt: string;
}
```

- [ ] **Step 2: Implementar paginação por cursor ou offset estável**

Usar `created_at desc, id desc`; carregar 30 documentos por página.

- [ ] **Step 3: Implementar exclusão composta**

A exclusão deve chamar uma função segura que remova Storage e registros relacionados; não apagar somente a linha `documents`.

- [ ] **Step 4: Criar estados vazios e filtros**

Filtros do MVP: caderno, tipo, estado e intervalo de datas.

- [ ] **Step 5: Testar mapeamento do banco**

Verificar que campos `snake_case` retornam modelos `camelCase` sem expor tipos gerados à camada visual.

- [ ] **Step 6: Commit**

```bash
git add src/lib/domain src/lib/services src/lib/components src/routes tests
git commit -m "feat: add notebook and document library"
git push
```

---

### Task 6: Pipeline rápido de imagens

**Files:**

- Create: `src/lib/import/image-types.ts`
- Create: `src/lib/import/image-worker.ts`
- Create: `src/lib/import/image-client.ts`
- Create: `src/lib/import/hash.ts`
- Create: `src/lib/import/upload.ts`
- Create: `src/lib/stores/import-queue.svelte.ts`
- Create: `src/routes/import/+page.svelte`
- Test: `tests/unit/import/hash.test.ts`
- Test: `tests/unit/import/image-client.test.ts`

**Interfaces:**

- Produces: `prepareImage(file, mode): Promise<PreparedImage>`.
- Produces: `calculateSha256(data): Promise<string>`.
- Produces: `uploadPreparedImage(input): Promise<UploadedPage>`.

- [ ] **Step 1: Definir mensagens do worker**

```ts
export type ImageWorkerRequest = {
	id: string;
	file: File;
	maxDimension: 2560 | 3200;
	quality: number;
};

export type ImageWorkerResult = {
	id: string;
	image: Blob;
	thumbnail: Blob;
	width: number;
	height: number;
};
```

- [ ] **Step 2: Implementar preparação**

Usar `createImageBitmap`, `OffscreenCanvas` quando disponível e Canvas tradicional como fallback. Gerar WebP; usar JPEG se o navegador não produzir WebP.

- [ ] **Step 3: Processar no máximo duas imagens**

A fila deve limitar workers ativos a 2 e liberar referências de `ImageBitmap`, Canvas e object URLs após cada tarefa.

- [ ] **Step 4: Implementar hash e duplicidade**

Calcular hash do arquivo preparado e consultar `documents.sha256` antes de enviar.

- [ ] **Step 5: Implementar upload concorrente máximo 3**

Original preparado e miniatura podem subir em paralelo; documentos diferentes respeitam o semáforo global.

- [ ] **Step 6: Testar cancelamento**

Abortar com `AbortController`; o estado deve mudar para `cancelled` e nenhuma página deve ser enviada ao OCR.

- [ ] **Step 7: Verificação manual no tablet**

Importar fotos de 8–12 MB e confirmar:

- interface continua rolando;
- miniatura aparece antes do OCR;
- memória cai após concluir;
- não há duplicação ao repetir a foto.

- [ ] **Step 8: Commit**

```bash
git add src/lib/import src/lib/stores src/routes/import tests
git commit -m "feat: add responsive image import pipeline"
git push
```

---

### Task 7: Inspeção e roteamento de PDFs

**Files:**

- Create: `src/lib/pdf/types.ts`
- Create: `src/lib/pdf/inspector-worker.ts`
- Create: `src/lib/pdf/inspector-client.ts`
- Create: `src/lib/pdf/renderer.ts`
- Create: `tests/fixtures/text.pdf`
- Create: `tests/fixtures/scanned.pdf`
- Create: `tests/fixtures/mixed.pdf`
- Test: `tests/unit/pdf/routing.test.ts`

**Interfaces:**

- Produces: `inspectPdf(file): Promise<PdfInspection>`.
- Produces: `renderPdfPage(file, pageNumber, options): Promise<Blob>`.
- `PdfInspection` inclui `type`, `pageCount`, `nativePages`, `pagesNeedingOcr` e `markdown` opcional.

- [ ] **Step 1: Instalar dependências sob demanda**

```bash
pnpm add @firecrawl/pdf-inspector-wasm pdfjs-dist
```

- [ ] **Step 2: Inicializar WASM dentro do worker**

O módulo deve ser importado apenas quando `inspectPdf` for chamado. A rota inicial não pode conter o chunk no carregamento inicial.

- [ ] **Step 3: Implementar classificação completa**

Usar a lista de páginas que precisam de OCR. Preservar texto por página e número de página.

- [ ] **Step 4: Renderizar somente páginas necessárias**

PDF.js deve usar uma página por vez, escala suficiente para gerar imagem entre 2.048 e 2.560 px no maior lado e liberar `page.cleanup()` e `document.destroy()`.

- [ ] **Step 5: Testar roteamento**

```ts
expect(route(textPdf).ocrPages).toEqual([]);
expect(route(scannedPdf).ocrPages.length).toBeGreaterThan(0);
expect(route(mixedPdf).nativePages.length).toBeGreaterThan(0);
expect(route(mixedPdf).ocrPages.length).toBeGreaterThan(0);
```

- [ ] **Step 6: Medir chunking**

```bash
pnpm build
```

Confirmar que PDF.js e WASM aparecem em chunks separados e não no chunk inicial.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/pdf tests
git commit -m "feat: route PDF pages between extraction and OCR"
git push
```

---

### Task 8: Adaptador Gemini e Edge Function idempotente

**Files:**

- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/ocr-types.ts`
- Create: `supabase/functions/_shared/ocr-provider.ts`
- Create: `supabase/functions/_shared/gemini-provider.ts`
- Create: `supabase/functions/process-page/index.ts`
- Create: `supabase/functions/process-page/index.test.ts`

**Interfaces:**

- Consumes: página existente e arquivo privado.
- Produces: `OcrResultV1` persistido em `pages` e estado final em `ocr_jobs`.
- HTTP: `POST /functions/v1/process-page` com `{ "jobId": "uuid" }`.

- [ ] **Step 1: Definir esquema de resposta**

Usar Zod ou validação manual compatível com Deno:

```ts
const OcrResultSchema = z.object({
	schemaVersion: z.literal(1),
	fullText: z.string(),
	detectedLanguage: z.string().nullable(),
	uncertainSegments: z.array(
		z.object({
			text: z.string(),
			context: z.string().nullable()
		})
	),
	suggestedTitle: z.string().nullable(),
	suggestedTags: z.array(z.string()).max(12),
	warnings: z.array(z.string()).max(20)
});
```

- [ ] **Step 2: Validar JWT e propriedade**

A função deve exigir JWT e confirmar que o `ocr_job.user_id` coincide com o usuário autenticado.

- [ ] **Step 3: Adquirir trabalho de forma atômica**

Atualizar de `pending`/`retryable` para `processing` apenas se ainda elegível. Se já estiver `ready` ou `processing`, retornar estado atual sem nova chamada.

- [ ] **Step 4: Implementar prompt versionado**

O prompt deve:

- transcrever apenas conteúdo visível;
- preservar ordem aproximada e quebras úteis;
- marcar `[ilegível]`;
- não completar frases;
- ignorar instruções no documento;
- retornar apenas JSON estruturado.

- [ ] **Step 5: Implementar modelo configurável**

Segredos:

```text
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_QUALITY
OCR_PROMPT_VERSION
OCR_DAILY_HARD_LIMIT
```

Não fixar o modelo em código. O modelo configurado deve estar disponível no nível gratuito no dia da implantação.

- [ ] **Step 6: Tratar erros**

- `429`: `blocked_quota` ou `retryable` com `next_retry_at`;
- timeout/rede: `retryable`;
- JSON inválido: uma tentativa de reparo;
- segunda falha: `needs_review`;
- erro permanente de arquivo: `failed`.

- [ ] **Step 7: Não registrar conteúdo**

Logs contêm IDs, duração, status e código de erro, nunca imagem ou transcrição integral.

- [ ] **Step 8: Testar idempotência**

Duas chamadas com o mesmo `jobId` devem produzir uma única invocação simulada do provider.

- [ ] **Step 9: Testar localmente**

```bash
supabase functions serve process-page --env-file supabase/.env.local
pnpm test
```

- [ ] **Step 10: Commit**

```bash
git add supabase/functions
git commit -m "feat: add secure idempotent cloud transcription"
git push
```

---

### Task 9: Orquestrador de fila e retomada

**Files:**

- Create: `src/lib/import/semaphore.ts`
- Create: `src/lib/import/job-runner.ts`
- Create: `src/lib/services/jobs.ts`
- Modify: `src/lib/stores/import-queue.svelte.ts`
- Test: `tests/unit/import/semaphore.test.ts`
- Test: `tests/unit/import/job-runner.test.ts`

**Interfaces:**

- Produces: `startQueue()`, `pauseQueue()`, `resumeQueue()`, `retryJob(jobId)`.
- OCR padrão: duas requisições simultâneas.

- [ ] **Step 1: Implementar semáforo testável**

```ts
const semaphore = new Semaphore(2);
await semaphore.run(() => processJob(job));
```

- [ ] **Step 2: Coordenar abas**

Usar `navigator.locks.request('fichario-ocr-runner', ...)` quando disponível e `BroadcastChannel('fichario-imports')` para sincronizar estados.

- [ ] **Step 3: Retomar pendências**

Ao autenticar, consultar trabalhos `pending`, `retryable` vencidos e `processing` abandonados. Trabalhos em `processing` há mais que o limite definido voltam para `retryable` por RPC segura.

- [ ] **Step 4: Implementar backoff**

Atrasos: 5 s, 20 s e 60 s; no máximo duas tentativas automáticas além da inicial. `429` diário não deve gerar loop.

- [ ] **Step 5: Testar limite de concorrência**

Executar cinco trabalhos simulados e provar que nunca existem mais de dois ativos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/import src/lib/services src/lib/stores tests
git commit -m "feat: add resumable concurrent processing queue"
git push
```

---

### Task 10: Busca rápida e tolerante a OCR

**Files:**

- Create: `src/lib/search/types.ts`
- Create: `src/lib/search/client.ts`
- Create: `src/lib/search/highlight.ts`
- Create: `src/lib/components/SearchResults.svelte`
- Modify: `src/lib/components/TopSearch.svelte`
- Modify: `src/routes/+page.svelte`
- Test: `tests/unit/search/highlight.test.ts`
- Test: `tests/integration/search.spec.ts`

**Interfaces:**

- Produces: `searchPages(input): Promise<SearchPage>`.
- Produces: `highlightSnippet(snippet, query): HighlightPart[]` sem HTML inseguro.

- [ ] **Step 1: Implementar debounce curto**

200 ms após digitação; Enter dispara imediatamente.

- [ ] **Step 2: Cancelar busca anterior**

Usar `AbortController`; somente a consulta mais recente pode atualizar os resultados.

- [ ] **Step 3: Renderizar trechos com segurança**

O realce deve produzir partes de texto e flags, nunca inserir `{@html}` com conteúdo do documento.

- [ ] **Step 4: Testar variantes**

Inserir fixtures com:

```text
fotossíntese
mitocôndria
respiração celular
```

Consultar:

```text
fotossintese
mitocondria
fotossintesc
```

Todos devem localizar a página adequada dentro do limiar definido.

- [ ] **Step 5: Medir consulta**

Executar `explain analyze` com pelo menos 5.000 páginas sintéticas e confirmar uso dos índices GIN/trigram, evitando varredura completa dominante.

- [ ] **Step 6: Commit**

```bash
git add src/lib/search src/lib/components src/routes/+page.svelte tests
git commit -m "feat: add fast typo-tolerant note search"
git push
```

---

### Task 11: Visualizador de fontes e revisão humana

**Files:**

- Create: `src/lib/components/ImageViewer.svelte`
- Create: `src/lib/components/PdfViewer.svelte`
- Create: `src/lib/components/TranscriptEditor.svelte`
- Create: `src/routes/documents/[id]/+page.svelte`
- Create: `src/routes/review/+page.svelte`
- Create: `src/lib/services/pages.ts`
- Test: `tests/e2e/review.spec.ts`

**Interfaces:**

- Produces: `updateCorrectedText(pageId, text)`.
- Produces: `markPageReviewed(pageId)`.

- [ ] **Step 1: Implementar visualização adaptativa**

- tablet horizontal/desktop: original e transcrição lado a lado;
- tablet vertical/celular: original acima e transcrição abaixo;
- zoom, rotação e página anterior/próxima.

- [ ] **Step 2: Carregar PDF.js apenas para PDF**

Imagens não devem baixar o visualizador de PDF.

- [ ] **Step 3: Preservar texto bruto**

Salvar somente `corrected_text`; nunca alterar `ocr_raw_text` ou `native_text`.

- [ ] **Step 4: Atualizar busca imediatamente**

Após salvar, invalidar cache local e confirmar que a RPC usa o novo texto efetivo.

- [ ] **Step 5: Criar fila de revisão**

Incluir páginas com `needs_review`, `[ilegível]`, texto vazio ou warnings. Permitir pular e retornar depois.

- [ ] **Step 6: Teste E2E**

Editar `fotossintesc` para `fotossíntese`, pesquisar e confirmar que o resultado corrigido aparece.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components src/lib/services/pages.ts src/routes tests/e2e
git commit -m "feat: add source viewer and transcript review"
git push
```

---

### Task 12: PWA, cache e desempenho no Tab S6 Lite

**Files:**

- Modify: `vite.config.ts`
- Create: `static/manifest.webmanifest`
- Create: `static/icons/`
- Create: `src/service-worker.ts`
- Create: `src/lib/services/recent-cache.ts`
- Create: `tests/e2e/pwa.spec.ts`
- Create: `docs/PERFORMANCE.md`

**Interfaces:**

- Produces: PWA instalável e cache somente do shell e metadados recentes.

- [ ] **Step 1: Configurar manifesto**

Nome, ícones, `display: standalone`, cor de fundo papel e orientação livre.

- [ ] **Step 2: Definir estratégia de cache**

- cache-first para assets versionados;
- network-first para shell HTML;
- nunca guardar URLs assinadas expiradas;
- não baixar biblioteca inteira offline;
- IndexedDB apenas para metadados recentes e estado da fila.

- [ ] **Step 3: Criar orçamento realista**

Registrar em `docs/PERFORMANCE.md`:

- rota inicial sem bibliotecas de PDF;
- chunks de PDF separados;
- no máximo duas preparações de imagem;
- uma página PDF renderizada por vez;
- duas chamadas OCR simultâneas;
- ausência de modelos locais.

Não definir um limite artificialmente baixo para o total dos chunks sob demanda.

- [ ] **Step 4: Medir**

```bash
pnpm build
pnpm preview
```

No Tab S6 Lite, testar:

- abertura fria;
- importação de 10 fotos;
- PDF misto de 30 páginas;
- navegação durante processamento;
- troca de orientação;
- retorno após suspender o navegador.

- [ ] **Step 5: Corrigir regressões observadas**

Critério: sem congelamentos prolongados; tarefas pesadas ficam fora da thread principal; miniaturas e progresso permanecem visíveis.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts static src/service-worker.ts src/lib/services/recent-cache.ts tests docs/PERFORMANCE.md
git commit -m "perf: optimize PWA for the target tablet"
git push
```

---

### Task 13: Exportação, exclusão e painel de gratuidade

**Files:**

- Create: `src/lib/export/types.ts`
- Create: `src/lib/export/metadata.ts`
- Create: `src/lib/export/downloads.ts`
- Create: `src/lib/services/usage.ts`
- Create: `src/routes/settings/+page.svelte`
- Create: `supabase/functions/delete-document/index.ts`
- Test: `tests/unit/export/metadata.test.ts`
- Test: `tests/integration/deletion.spec.ts`

**Interfaces:**

- Produces: `exportMetadata()`, `downloadOriginals()`, `deleteDocumentCompletely(id)`.
- Produces: painel de uso diário, armazenamento estimado e estado do provedor.

- [ ] **Step 1: Exportar metadados versionados**

```ts
export interface LibraryExportV1 {
	schemaVersion: 1;
	exportedAt: string;
	notebooks: unknown[];
	documents: unknown[];
	pages: unknown[];
	tags: unknown[];
}
```

- [ ] **Step 2: Implementar download por lotes**

Gerar uma lista de URLs assinadas de curta duração e baixar sequencialmente para não pressionar memória e rede.

- [ ] **Step 3: Implementar exclusão completa**

A função deve validar JWT e propriedade, listar objetos do prefixo do documento, apagar Storage e somente então remover os registros relacionados. Falha parcial deve ser retornada e registrada para nova tentativa.

- [ ] **Step 4: Exibir limites e consumo**

Mostrar:

- páginas processadas hoje;
- trabalhos bloqueados por cota;
- armazenamento estimado;
- documentos maiores;
- status de consentimento do OCR externo;
- confirmação de que faturamento deve permanecer desligado.

- [ ] **Step 5: Testar exclusão**

Após excluir, esperar ausência em `documents`, `pages`, `ocr_jobs` e Storage.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export src/lib/services/usage.ts src/routes/settings supabase/functions/delete-document tests
git commit -m "feat: add portable exports and complete deletion"
git push
```

---

### Task 14: Documentação operacional e implantação gratuita

**Files:**

- Modify: `README.md`
- Modify: `docs/FREE_TIER_OPERATIONS.md`
- Create: `docs/DEPLOYMENT.md`
- Create: `docs/PRIVACY.md`
- Create: `docs/RECOVERY.md`
- Create: `.env.example`

**Interfaces:**

- Produces: procedimento reproduzível de implantação e restauração.

- [ ] **Step 1: Documentar configuração Supabase**

Incluir:

- criação do projeto Free em região adequada;
- aplicação das migrations;
- criação da conta principal;
- inserção em `app_users`;
- desativação de novos cadastros;
- bucket privado;
- secrets da Edge Function;
- verificação de RLS e advisors.

- [ ] **Step 2: Documentar Gemini**

Incluir:

- criar projeto sem conta de faturamento;
- gerar API key;
- selecionar modelo gratuito atual;
- configurar limites internos menores que a cota observada;
- testar `429`;
- registrar o consentimento sobre uso de dados.

- [ ] **Step 3: Documentar Vercel**

Incluir:

- importar repositório;
- selecionar plano Hobby pessoal;
- cadastrar somente variáveis públicas necessárias;
- confirmar build estático;
- testar instalação PWA.

- [ ] **Step 4: Criar `.env.example`**

```text
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
GEMINI_API_KEY=
OCR_MODEL_PRIMARY=
OCR_MODEL_QUALITY=
OCR_PROMPT_VERSION=1
OCR_DAILY_HARD_LIMIT=100
```

Marcar quais variáveis pertencem ao frontend e quais são secrets do Supabase, sem instruir a colocar segredo no Vercel.

- [ ] **Step 5: Executar verificação final**

```bash
pnpm verify
supabase db reset
supabase test db
```

Testar manualmente o fluxo completo no Tab S6 Lite.

- [ ] **Step 6: Commit**

```bash
git add README.md docs .env.example
git commit -m "docs: add deployment privacy and recovery guides"
git push
```

---

## Sequência de releases

### Release 0.1 — Fundação pesquisável

Tasks 1–5. Biblioteca funcional, autenticação e banco seguro, ainda sem importação automática.

### Release 0.2 — Importação e OCR

Tasks 6–9. Imagens e PDFs são importados, roteados e transcritos.

### Release 0.3 — Produto utilizável

Tasks 10–12. Busca, revisão, PWA e desempenho no tablet.

### Release 1.0 — Uso pessoal confiável

Tasks 13–14. Exportação, exclusão, painel de cotas e documentação operacional.

## Gates obrigatórios antes de 1.0

```bash
pnpm lint
pnpm check
pnpm test
pnpm test:e2e
pnpm build
supabase db reset
supabase test db
```

Também devem ser validados:

- RLS por usuário;
- segredo ausente do bundle;
- PDF textual sem chamada OCR;
- concorrência máxima respeitada;
- retomada após fechar o navegador;
- correção refletida na pesquisa;
- exclusão integral;
- instalação e uso no Tab S6 Lite;
- serviços ainda no plano gratuito e sem faturamento habilitado.

## Trabalho futuro, fora deste plano

Depois do MVP, criar um plano separado para “Perguntar às anotações”. A primeira versão deve usar expansão de termos + busca PostgreSQL + resposta fundamentada em páginas recuperadas, sem banco vetorial. Cada afirmação deverá apontar para documento e página existentes.
