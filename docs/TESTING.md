# Estratégia de testes e evidência

## Princípio

Um arquivo de teste presente no repositório não prova que o comportamento passou. Registre `PASS` somente com saída fresca no commit exato. Quando a ferramenta não estiver disponível, use `NOT RUN` ou `BLOCKED` e continue trabalho independente.

## Ambiente mínimo

- Node.js `>=22.12`;
- pnpm `>=10`;
- navegador Chromium instalado pelo Playwright;
- Supabase CLI e runtime Docker para testes locais do banco;
- PostgreSQL `psql` para os testes concorrentes reais;
- Deno para verificação das Edge Functions;
- projeto Supabase real somente para validação final de Auth, Storage e Edge Functions.

## Instalação

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

O `pnpm-lock.yaml` é versionado na raiz e deve ser atualizado junto com qualquer alteração de dependências. O workflow rejeita manifesto e lockfile desalinhados por meio da instalação congelada e do gate offline de bootstrap.

## Entry points canônicos

Validação rápida do frontend:

```bash
pnpm verify
```

Validação local completa no commit atual:

```bash
pnpm verify:full
```

`verify:full` executa, nesta ordem:

1. lint, Svelte/TypeScript, unitários e build;
2. Playwright E2E;
3. gates offline de fonte e migrations;
4. `deno check` de todos os módulos/funções Supabase;
5. recriação do banco local, pgTAP e testes OCR reais.

Os blocos também podem ser executados isoladamente:

```bash
pnpm test:source:offline
pnpm test:functions:check
pnpm test:db:local
```

## Gates de frontend

```bash
pnpm lint
pnpm check
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
```

### Escopo dos gates

- `lint`: estilo, regras estáticas e formatação;
- `check`: Svelte e TypeScript completos;
- `test`: contratos unitários de domínio, filas, serviços, PDF, OCR, busca, exportação, PWA, tooling e segurança;
- `build`: bundle estático, workers, WASM, PDF.js e PWA;
- `test:e2e`: autenticação simulada, shell responsivo, importação e rotas principais.

Nenhum desses gates comprova RLS, Storage ou Edge Functions implantadas.

## Gates offline de fonte

```bash
pnpm test:source:offline
```

Esse runner não depende do Supabase ou do navegador. Ele verifica, entre outros contratos:

- segredo/provider ausente do frontend;
- caminhos privados ausentes de componentes e rotas;
- cache do PWA limitado a ativos públicos;
- migrations com `search_path`, grants e padrões de segurança esperados;
- presença do lockfile raiz e cobertura de todas as dependências do manifesto;
- uso do lockfile versionado pelo cache e pela instalação congelada do workflow.

## Edge Functions

```bash
pnpm test:functions:check
```

Executa `deno check` explicitamente em:

- `supabase/functions/_shared/ocr-contract.ts`;
- `supabase/functions/_shared/gemini-ocr-client.ts`;
- `supabase/functions/process-ocr/index.ts`;
- `supabase/functions/delete-document/index.ts`.

Esse gate valida imports e tipos no runtime Deno, mas não substitui uma chamada real ao Storage ou ao modelo.

## Gates do Supabase local

```bash
pnpm test:db:local
```

O runner:

1. inicia ou reutiliza a stack local com `supabase start`;
2. aplica todas as migrations desde zero com `supabase db reset`;
3. executa os testes pgTAP com `supabase test db`;
4. executa duas claims OCR concorrentes com limite diário igual a 1;
5. valida replay idempotente de conclusão, reconciliação após resposta perdida e virada UTC da cota.

Validar no banco local:

- migrações partindo de banco vazio;
- `auth.uid()` ausente, usuário fora da allowlist, usuário inativo e usuário autorizado;
- isolamento entre dois usuários;
- caminhos de Storage restritos ao prefixo do usuário;
- importação de imagem e PDF atômicas;
- páginas contínuas e únicas;
- claim OCR idempotente;
- concorrência no limite diário;
- estados `retryable`, `blocked_quota`, `needs_review` e `failed`;
- rollup do estado de páginas para documentos;
- busca usando correção antes da fonte original;
- exportação sem caminhos privados;
- tags, rascunhos e operações em lote sem vazamento entre usuários.

## Testes da Edge Function OCR

Use um servidor HTTP falso para o endpoint Gemini e cubra:

1. sucesso estruturado;
2. corpo 200 inválido;
3. timeout e cancelamento;
4. falha DNS/transporte;
5. 400/401/403/404 permanentes;
6. 429 diário;
7. 429 transitório;
8. 500/503 retryable;
9. resposta perdida após conclusão no banco;
10. retry exato depois de process death;
11. limpeza de imagem temporária somente após terminal válido.

Nunca registrar API key, imagem, texto integral, token JWT ou corpo bruto do provedor nos logs de teste/produção.

## Testes de PDF em dispositivo

Executar em desktop, tablet e celular com:

- PDF textual;
- PDF digitalizado;
- PDF misto;
- PDF com página vazia;
- PDF com senha;
- PDF malformado;
- PDF próximo de 20 MB;
- documento com muitas páginas sem texto;
- cancelamento durante inspeção, upload, renderização e OCR;
- recarga da aplicação após publicação parcial.

Observar memória e confirmar:

- um PDF pesado por vez;
- uma página renderizada por vez;
- no máximo duas chamadas OCR simultâneas;
- `ImageBitmap`, PDF.js e workers destruídos ao terminar;
- nenhuma página textual enviada para OCR.

## Testes de segurança

Além dos unitários:

```bash
rg -n "GEMINI_API_KEY|service_role|SUPABASE_SERVICE_ROLE|AIza" src static
rg -n "storage_path|temporary_image_path" src/lib/components src/routes
```

A inspeção manual do bundle deve confirmar que apenas valores `PUBLIC_*` aparecem no frontend.

Validar também:

- CSP e demais headers no host final;
- URLs assinadas expirando;
- logout removendo sessão local;
- PWA sem respostas privadas no Cache Storage;
- IndexedDB/localStorage contendo somente estado explicitamente permitido e rascunhos limitados;
- exclusão removendo metadados e objetos;
- exportação não contendo tokens ou caminhos privados.

## Evidência esperada no handoff

Para cada gate:

```text
Command: pnpm test
Commit: <sha>
Exit code: 0
Cases: <passed>/<total>
Duration: <duration>
```

Quando bloqueado:

```text
Command: pnpm build
Status: BLOCKED
Reason: pnpm/dependencies unavailable because DNS could not resolve registry
Next environment: checkout with Node 22, pnpm 10 and network or complete offline bundle
```

Um checkpoint anterior não pode ser automaticamente atribuído a commits posteriores. Depois de qualquer mudança, execute ao menos o gate específico; antes de release, execute `pnpm verify:full` no SHA final.
