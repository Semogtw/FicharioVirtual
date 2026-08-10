# Fichário Virtual

PWA privada e pesquisável para organizar fotos, capturas de tela e PDFs de anotações manuscritas ou digitadas.

O Google Drive é o armazenamento permanente dos arquivos originais. O Supabase fornece autenticação, PostgreSQL, RLS, Edge Functions, busca, filas, resultados de OCR e estado de sincronização; seu Storage privado fica restrito a processamento temporário, fallback e migração controlada.

## Estado atual

A base funcional do Fichário está implementada em código, mas o produto ainda **não está pronto para release**. O SHA `b39e3eb` possui recibo verde de CI para os gates locais no run `31296404993`; os runs de staging Supabase/OCR desse SHA estão `WAITING` por aprovação, e Google Drive/Gemini reais, host publicado e dispositivos físicos ainda não foram validados.

As responsabilidades da arquitetura permanecem separadas:

- Cloudflare Pages como host preferencial da PWA estática;
- projeto Pages separado para artefatos públicos e fragmentados de modelos;
- Gemini para OCR geral e transcrição imediata;
- fila opcional para manuscritos e páginas difíceis;
- worker no computador do usuário, sem porta pública, que consulta a fila, processa localmente e devolve o resultado ao Supabase. O runtime e a fronteira backend já existem em código; a integração Chandra OCR 2/`llama.cpp` e a validação no hardware físico ainda estão pendentes.

Já existem na `main`:

- autenticação de conta única com allowlist fail-closed;
- biblioteca, cadernos, tags, organização em lote, busca e revisão;
- importação retomável de imagens e PDFs;
- inspeção local de PDFs e OCR seletivo no backend;
- PWA com cache limitado ao shell público;
- exportação portátil sem tokens;
- contratos estritos da API Google Drive;
- reconciliação de arquivo disponível/ausente sem apagar OCR e metadados;
- sincronizador paginado que só avança o token depois de persistir a página;
- modelo PostgreSQL para conexão, hierarquia de pastas, fila idempotente, conflitos e reconexão;
- histórico imutável de resultados OCR, separação dos status de página/OCR, roteamento desktop e lease de jobs;
- testes unitários, contratos SQL/pgTAP locais, gates offline e type-check das Edge Functions.

Ainda faltam execução com OAuth/Google Drive/Gemini reais, deploy e verificação do schema/runtime Supabase no HEAD atual, migração dos originais reais, migração do host, validação física do worker local, dispositivos móveis e validação remota. O código não é tratado como prova desses ambientes.

O último recibo completo está registrado em [`docs/TESTING.md`](docs/TESTING.md); ele valida o SHA atual e inclui uma execução E2E que passou após uma primeira tentativa flaky. Isso mantém o CI verde, mas não elimina a pendência de investigar a flakiness nem prova staging, serviços reais ou hardware.

O estado canônico fica em [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md). A prontidão real fica em [`docs/READINESS.md`](docs/READINESS.md).

## Princípios

1. **O arquivo original permanente pertence ao usuário no Google Drive.**
2. **IDs do Drive são identidade; nomes e caminhos não são.**
3. **OCR, correções, tags e busca sobrevivem ao desaparecimento do arquivo físico.**
4. **Texto nativo nunca é enviado ao OCR sem necessidade.**
5. **Nenhum serviço ativa cobrança ou fallback pago automaticamente.**
6. **Tokens e secrets nunca entram no navegador persistente, exportações ou cache da PWA.**
7. **Um conflito bloqueia somente o item relacionado.**
8. **Cloudflare recebe somente assets públicos; nenhum documento privado passa por ela.**
9. **O worker do computador inicia conexões de saída e nunca exige porta pública.**
10. **Correção manual permanece a autoridade final do texto.**
11. **A interface deve parecer um fichário digital profissional, não um chatbot.**

## Arquitetura

- **Frontend/PWA:** SvelteKit 5, TypeScript, `adapter-static`, build em `build/` e Web Workers.
- **Host público aprovado:** Cloudflare Pages; migração ainda pendente.
- **Artefatos de modelos:** projeto Pages separado com partes verificadas por SHA-256; R2 apenas como opção explícita e não obrigatória.
- **Originais permanentes:** Google Drive API v3 com OAuth `drive.file`.
- **Backend:** Supabase Auth, PostgreSQL, RLS e Edge Functions.
- **Storage Supabase:** artefatos temporários, fallback e migração.
- **OCR geral:** Gemini Developer API no backend.
- **OCR local:** Desktop OCR Worker implementado com backend Ollama atual; **Chandra OCR 2** é o candidato recomendado para o perfil de alta qualidade, com alvo `llama.cpp` + Vulkan na RX 6600 e validação ainda pendente.
- **PDFs:** `@firecrawl/pdf-inspector-wasm` e PDF.js apenas quando necessário.
- **Busca:** PostgreSQL FTS, `unaccent` e `pg_trgm`.

## Desenvolvimento

Requisitos: Node.js `>=22.12`, pnpm `>=10`, Chromium do Playwright, Supabase CLI, Docker, PostgreSQL `psql` e Deno.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm verify
pnpm verify:full
```

Comandos segmentados:

```bash
pnpm test:source:offline
pnpm test:functions:check
pnpm test:db:local
pnpm test:ocr:faults:local
pnpm test:deployment -- https://host.example
pnpm test:staging:supabase
pnpm test:staging:ocr
```

## Documentação

- [Estado atual](docs/CURRENT_STATUS.md)
- [Prontidão](docs/READINESS.md)
- [Especificação canônica](docs/PROJECT_SPEC.md)
- [Design Google Drive](docs/superpowers/specs/2026-08-06-google-drive-primary-storage-design.md)
- [Plano Google Drive](docs/superpowers/plans/2026-08-06-google-drive-primary-storage.md)
- [Design Cloudflare e OCR desktop](docs/superpowers/specs/2026-08-06-cloudflare-pages-and-desktop-ocr-design.md)
- [Configuração Cloudflare](docs/CLOUDFLARE_SETUP.md)
- [Worker local de OCR](docs/DESKTOP_OCR_WORKER.md)
- [Chandra OCR 2 — decisão e integração desktop](docs/CHANDRA_OCR2_DESKTOP_INTEGRATION.md)
- [Runtime local do worker](docs/DESKTOP_OCR_WORKER_LOCAL_RUNTIME.md)
- [Configuração externa Google Drive](docs/GOOGLE_DRIVE_SETUP.md)
- [Estratégia de testes](docs/TESTING.md)
- [Deployment e rollback](docs/DEPLOYMENT.md)
- [Operação gratuita](docs/FREE_TIER_OPERATIONS.md)

## Antes de uma release

É obrigatório concluir e validar:

- OAuth Web com `drive.file` e refresh token somente no backend;
- pasta `Fichário Digital` e pastas aninhadas dos cadernos;
- upload retomável e importação explícita pelo Drive;
- feed de mudanças, arquivo ausente, reconexão e conflitos;
- migração idempotente dos originais atuais;
- Cloudflare Pages, origem canônica, headers e rollback;
- roteamento Gemini/desktop, pareamento, lease, retomada e revogação do worker;
- Chandra OCR 2/`llama.cpp` com licença/proveniência, benchmark Q8_0/Q6_K e validação Vulkan na RX 6600;
- Supabase, OCR, celular/tablet, billing, backup e rollback.
