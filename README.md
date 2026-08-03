# Fichário Virtual

PWA privada e pesquisável para organizar fotos, capturas de tela e PDFs de anotações manuscritas ou digitadas.

O aplicativo prepara imagens e inspeciona PDFs no próprio dispositivo, preserva texto nativo sem OCR e encaminha somente as páginas que realmente precisam de reconhecimento. Supabase fornece autenticação, PostgreSQL, Storage privado e Edge Functions; a integração Gemini fica isolada no backend e possui consentimento, idempotência, limite diário e recuperação sem reupload.

## Estado atual

O MVP está implementado na branch `main`, sem deployment ou release público. O repositório inclui:

- autenticação de conta única com allowlist fail-closed;
- biblioteca privada, cadernos, tags e organização em lote;
- importação cancelável e retomável de imagens e PDFs;
- OCR seletivo por página, com quota e backoff explícitos;
- busca textual ranqueada e tolerante a acentos/erros pequenos;
- leitor lado a lado, revisão manual e recuperação de rascunhos locais;
- painel operacional de uso;
- exportação JSON portátil e exclusão completa;
- PWA com cache limitado ao shell e ativos públicos;
- testes unitários, E2E, pgTAP, gates de segurança e verificações locais de concorrência/idempotência OCR.

O estado canônico, o último SHA integralmente validado e as evidências de CI ficam em [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md). Atribua `PASS` somente ao commit exato em que os gates foram executados.

## Princípios

1. **Recuperar o documento é mais importante que gerar respostas sofisticadas.**
2. **Texto nativo nunca é enviado ao OCR sem necessidade.**
3. **Nenhum serviço pode ativar cobrança ou fallback pago automaticamente.**
4. **Arquivos, transcrições e buscas permanecem privados por padrão.**
5. **Falha de OCR não implica perda nem novo upload do arquivo.**
6. **Recursos pesados são carregados apenas quando a tarefa exige.**
7. **A interface deve parecer um fichário digital profissional, não um chatbot.**

## Arquitetura

- **Frontend/PWA:** SvelteKit 5 + TypeScript, build estático e Web Workers.
- **Backend:** Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.
- **OCR:** Gemini Developer API por adaptador backend substituível.
- **PDFs:** `@firecrawl/pdf-inspector-wasm` para classificação/texto e PDF.js somente para páginas sem texto.
- **Busca:** PostgreSQL FTS, `unaccent` e `pg_trgm`; sem banco vetorial no MVP.

## Desenvolvimento

Requisitos: Node.js `>=22.12`, pnpm `>=10`, Chromium do Playwright, Supabase CLI, Docker, PostgreSQL `psql` e Deno.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
```

O `pnpm-lock.yaml` é versionado na raiz e deve acompanhar toda alteração de dependências.

Validação completa local, incluindo E2E, análise offline, Edge Functions e banco Supabase:

```bash
pnpm verify:full
```

Comandos segmentados:

```bash
pnpm test:source:offline
pnpm test:functions:check
pnpm test:db:local
pnpm test:deployment -- https://host.example
pnpm test:staging:supabase
pnpm test:staging:ocr
```

`test:db:local` inicia/reutiliza a stack Supabase, recria o banco, executa pgTAP e roda os testes reais de concorrência, idempotência e virada UTC do OCR.

## Documentação

- [Estado atual canônico](docs/CURRENT_STATUS.md)
- [Especificação do produto e arquitetura](docs/PROJECT_SPEC.md)
- [Plano detalhado de implementação](docs/IMPLEMENTATION_PLAN.md)
- [Estratégia de testes e evidência](docs/TESTING.md)
- [Prontidão e percentual de progresso](docs/READINESS.md)
- [Validação Supabase remota](docs/SUPABASE_STAGING.md)
- [Validação de OCR real em staging](docs/OCR_STAGING.md)
- [Matriz segura de falhas OCR](docs/OCR_FAILURE_MATRIX.md)
- [Deployment e rollback](docs/DEPLOYMENT.md)
- [Operação sem custos e limites](docs/FREE_TIER_OPERATIONS.md)
- [Privacidade](docs/PRIVACY.md)
- [Recuperação](docs/RECOVERY.md)

## Antes de uma release

Ainda é necessário validar em staging e dispositivo real:

- executar os gates preparados de Auth, RLS, Storage e expiração de URLs assinadas no projeto Supabase remoto;
- executar o smoke OCR sintético e validar 429/503/resposta inválida no ambiente configurado;
- PDFs textuais, digitalizados e mistos em tablet/celular;
- instalação/atualização do PWA e headers no host final;
- limites gratuitos e ausência de billing habilitado.
