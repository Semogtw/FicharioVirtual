# Fichário Virtual

PWA privada e pesquisável para organizar fotos, capturas de tela e PDFs de anotações manuscritas ou digitadas, preservando os arquivos originais no Google Drive e tornando seu conteúdo pesquisável por meio de extração de texto e OCR seletivo.

## Visão geral

O Fichário Virtual foi pensado para funcionar como um fichário digital pessoal: documentos podem ser organizados em cadernos, classificados com tags, pesquisados pelo conteúdo e revisados sem transformar a interface em um chatbot.

O projeto separa o arquivo original dos dados que tornam esse arquivo útil. O original permanece sob controle do usuário no Google Drive; metadados, índices de busca, resultados de OCR, sincronização e filas ficam no backend.

### Principais capacidades

- biblioteca de imagens e PDFs;
- cadernos, tags e organização em lote;
- pesquisa por texto e conteúdo extraído;
- importação de arquivos locais e integração com Google Drive;
- extração de texto nativo de PDFs quando disponível;
- OCR seletivo para páginas que realmente precisam dele;
- revisão e correção manual do texto reconhecido;
- suporte a PWA para desktop, tablet e celular;
- exportação portátil de dados sem incluir tokens ou secrets;
- rota opcional de OCR local para documentos mais difíceis.

## Como funciona

```text
Arquivos do usuário
      │
      ├── Google Drive ─────── originais permanentes
      │
      └── Fichário Virtual
              │
              ├── Frontend/PWA
              ├── Supabase
              │     ├── Auth + RLS
              │     ├── PostgreSQL
              │     ├── busca e metadados
              │     ├── filas e sincronização
              │     └── Edge Functions
              │
              └── OCR
                    ├── texto nativo, quando existente
                    ├── Gemini para OCR geral
                    └── worker local opcional para casos difíceis
```

### Componentes

- **Frontend/PWA:** SvelteKit 5, TypeScript, `adapter-static` e Web Workers.
- **Arquivos originais:** Google Drive API v3 com OAuth `drive.file`.
- **Backend:** Supabase Auth, PostgreSQL, RLS e Edge Functions.
- **Armazenamento temporário:** Supabase Storage apenas para derivados, processamento e migrações controladas.
- **Host estático:** Cloudflare Pages.
- **OCR:** extração de texto nativo primeiro, Gemini no backend para OCR geral e worker local opcional para rotas especializadas.
- **PDFs:** `@firecrawl/pdf-inspector-wasm` e PDF.js quando necessário.
- **Busca:** PostgreSQL FTS, `unaccent` e `pg_trgm`.

## Princípios do projeto

1. **O arquivo original permanente pertence ao usuário no Google Drive.**
2. **IDs do Drive são identidade; nomes e caminhos não são.**
3. **OCR, correções, tags e busca sobrevivem ao desaparecimento do arquivo físico.**
4. **Texto nativo nunca é enviado ao OCR sem necessidade.**
5. **Nenhum serviço ativa cobrança ou fallback pago automaticamente.**
6. **Tokens e secrets nunca entram no armazenamento persistente do navegador, exportações ou cache da PWA.**
7. **Um conflito bloqueia somente o item relacionado.**
8. **A camada de hospedagem pública recebe somente assets públicos; documentos privados não passam por ela.**
9. **O worker local inicia conexões de saída e não exige porta pública.**
10. **Correção manual permanece a autoridade final do texto.**
11. **A interface deve parecer um fichário digital profissional, não um chatbot.**

## Desenvolvimento local

### Requisitos

- Node.js `>=22.12`;
- pnpm `>=10`;
- Chromium do Playwright para testes E2E;
- Supabase CLI, Docker, PostgreSQL `psql` e Deno para os gates locais completos.

### Instalação

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

### Executar em desenvolvimento

```bash
pnpm dev
```

### Verificações principais

```bash
pnpm verify
pnpm verify:full
```

Outros comandos de teste e validação estão descritos em [`docs/TESTING.md`](docs/TESTING.md).

## Configuração

Use [`.env.example`](.env.example) como referência para as variáveis de ambiente locais. Configurações que dependem de serviços externos possuem runbooks próprios em `docs/`.

Nunca versione tokens, chaves privadas, refresh tokens ou credenciais de service role.

## Documentação

A documentação técnica e operacional possui um índice próprio em [`docs/README.md`](docs/README.md).

Pontos de entrada principais:

- [Especificação do projeto](docs/PROJECT_SPEC.md)
- [Estado atual do desenvolvimento](docs/CURRENT_STATUS.md)
- [Prontidão para release/deploy](docs/READINESS.md)
- [Plano de implementação](docs/IMPLEMENTATION_PLAN.md)
- [Estratégia e recibos de testes](docs/TESTING.md)
- [Deployment e rollback](docs/DEPLOYMENT.md)

O `README` descreve o projeto e sua arquitetura de forma estável. **Progresso recente, SHAs, runs de CI, pendências de implementação e decisões ainda em validação devem ser registrados nos documentos dedicados em `docs/`, não aqui.**

## Segurança e privacidade

O projeto assume conteúdo pessoal e potencialmente sensível. Por isso, autenticação, RLS, URLs assinadas de curta duração, segregação de secrets e minimização de dados enviados a provedores externos fazem parte do desenho da aplicação, não de uma camada opcional adicionada depois.
