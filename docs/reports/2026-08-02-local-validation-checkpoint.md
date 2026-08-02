# Checkpoint de validação local — 2026-08-02

_Branch: `main`_  
_Escopo: snapshot público atualizado, dependências do lockfile, stack Supabase local e Chromium Playwright_  
_Deployment: não realizado_

## Ambiente

```text
Node.js: 22.16.0
pnpm: 10.x
Frontend: dependências instaladas a partir de pnpm-lock.yaml
Browser E2E: Chromium provisionado pelo Playwright
Banco: stack local iniciada pelo Supabase CLI em Docker
Edge Functions: verificação estática pelo compilador Deno
```

O ambiente inicialmente não resolvia GitHub nem o registro de pacotes. Os endereços foram obtidos por DNS-over-HTTPS e inseridos temporariamente em `/etc/hosts`; isso permitiu provisionar as ferramentas sem GitHub Actions.

## Gates executados

```text
pnpm install --frozen-lockfile --offline: PASS
pnpm lint: PASS
pnpm check: PASS
pnpm test: PASS
pnpm test:coverage: PASS
pnpm build: PASS
pnpm test:e2e: PASS
bash tools/checks/run-offline-source-gates.sh: PASS
supabase db reset: PASS
supabase test db: PASS
deno check supabase/functions/_shared/ocr-contract.ts: PASS
deno check supabase/functions/_shared/gemini-ocr-client.ts: PASS
deno check supabase/functions/process-ocr/index.ts: PASS
deno check supabase/functions/delete-document/index.ts: PASS
```

## O que esses gates validam

- formatação, ESLint, Svelte e TypeScript do frontend;
- testes unitários de domínio, filas, PDF, OCR, busca, revisão, exportação, tags, uso, PWA e segurança;
- geração do site estático, workers, WASM, PDF.js e service worker;
- rotas E2E no Chromium com autenticação e APIs simuladas;
- aplicação de todas as migrations partindo de banco vazio;
- contratos pgTAP de RLS, bucket privado, funções e grants;
- imports e tipos das Edge Functions no runtime Deno;
- ausência de segredos/provider endpoint no frontend e cache restrito a ativos públicos.

## Correções feitas durante a validação

- lockfile pnpm gerado e versionado;
- arquivos normalizados por Prettier e ESLint autofix;
- matcher do service worker tornado autocontido para não depender de fechamento externo;
- editor de correção remontado quando a página selecionada muda;
- endpoint OCR refatorado para separar falha de transporte, HTTP do provedor e payload estruturado inválido;
- origem permitida da Edge Function tornou-se configuração obrigatória.

## Limites da evidência

Não foi validado:

- Auth, RLS, Storage e URLs assinadas em projeto Supabase remoto;
- secret real e resposta real do modelo Gemini configurado;
- limites reais do provedor, quota diária no dia seguinte ou billing;
- falha de rede real durante upload, resposta perdida ou process death;
- PDFs extensos e uso de memória em tablet/celular físico;
- PWA instalado, atualização e cache em navegador físico;
- cabeçalhos no host estático final;
- deployment, domínio, release ou dados reais.

E2E com mocks não substitui a validação de infraestrutura real. `deno check` não executa chamadas ao modelo nem Storage.

## Próximos gates

1. implantar um projeto de staging gratuito sem dados reais;
2. criar usuário de teste na allowlist e validar isolamento entre duas contas;
3. configurar secrets e testar OCR com imagens sintéticas;
4. injetar 429 diário/transitório, 503 e resposta inválida;
5. validar PDF textual, digitalizado e misto em celular/tablet;
6. verificar headers, PWA e expiração de URLs no host final;
7. só então considerar release.
