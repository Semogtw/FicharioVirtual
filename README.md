# Fichário Virtual

PWA privada e pesquisável para organizar fotos, capturas de tela e PDFs de anotações manuscritas ou digitadas.

O Google Drive é o armazenamento permanente dos arquivos originais. O Supabase fornece autenticação, PostgreSQL, RLS, Edge Functions, OCR e estado de sincronização; seu Storage privado fica restrito a processamento temporário, fallback e migração controlada.

## Estado atual

A base funcional anterior do Fichário está implementada, mas o plano original ainda **não está pronto para release** porque a integração real com Google Drive está em desenvolvimento.

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
- testes unitários e pgTAP da nova arquitetura.

Ainda faltam OAuth real, cliente Drive implantado, upload retomável conectado às filas de importação, Google Picker, migração dos originais existentes e validação remota.

O estado canônico fica em [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md). A prontidão real fica em [`docs/READINESS.md`](docs/READINESS.md).

## Princípios

1. **O arquivo original permanente pertence ao usuário no Google Drive.**
2. **IDs do Drive são identidade; nomes e caminhos não são.**
3. **OCR, correções, tags e busca sobrevivem ao desaparecimento do arquivo físico.**
4. **Texto nativo nunca é enviado ao OCR sem necessidade.**
5. **Nenhum serviço ativa cobrança ou fallback pago automaticamente.**
6. **Tokens e secrets nunca entram no navegador persistente, exportações ou cache da PWA.**
7. **Um conflito bloqueia somente o item relacionado.**
8. **A interface deve parecer um fichário digital profissional, não um chatbot.**

## Arquitetura

- **Frontend/PWA:** SvelteKit 5, TypeScript, build estático e Web Workers.
- **Originais permanentes:** Google Drive API v3 com OAuth `drive.file`.
- **Backend:** Supabase Auth, PostgreSQL, RLS e Edge Functions.
- **Storage Supabase:** artefatos temporários, fallback e migração.
- **OCR:** Gemini Developer API por adaptador backend substituível.
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
- [Configuração externa Google Drive](docs/GOOGLE_DRIVE_SETUP.md)
- [Estratégia de testes](docs/TESTING.md)
- [Deployment e rollback](docs/DEPLOYMENT.md)
- [Operação gratuita](docs/FREE_TIER_OPERATIONS.md)
- [Privacidade](docs/PRIVACY.md)
- [Recuperação](docs/RECOVERY.md)

## Antes de uma release

É obrigatório concluir e validar:

- OAuth Web com `drive.file` e refresh token somente no backend;
- pasta `Fichário Digital` e pastas aninhadas dos cadernos;
- upload retomável e importação explícita pelo Drive;
- feed de mudanças, arquivo ausente, reconexão e conflitos;
- migração idempotente dos originais atuais;
- Supabase, OCR, host HTTPS, celular/tablet, billing, backup e rollback.
