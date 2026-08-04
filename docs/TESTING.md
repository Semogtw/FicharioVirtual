# Estratégia de testes

Este documento define a cobertura do Fichário Virtual e serve como checklist de prontidão técnica.

## Último checkpoint local

Source commit: `788f170409a323adb8d5b45e83d615f7c1f8d31f`  
Data: 2026-08-04

Evidência executada no workspace offline:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS — 0 erros, 0 warnings
Vitest: PASS — 460 testes em 102 arquivos
build estático/PWA: PASS
5 gates offline de fonte: PASS
6 módulos Edge via Deno offline: PASS
Playwright Chromium: PASS — 3/3
```

O checkout exato da toolchain está `PENDINC` em `Semogtw/Offline-Toolchains#28`. Banco local, staging Supabase, OCR real e host publicado permanecem `NOT RUN`. Consulte `docs/checkpoints/2026-08-04-rout-resilience.md`.

## Ambiente mínimo

- Node compatível com `fn()` e Web Crypto
- pnm
- Docker disponível para os gates de banco local
- Chromium disponível para Playwright
- Deno disponível para deno check das Edge Functions

A toolchain offline fixa o ambiente de validação frontend e Edge. As imagens Docker do Supabase continuam sendo uma dependência separada.

## Matriz de gates

| Gate | Executa | Quando usar | 
|:--- | ::-- | :-- |
| `pnam lint` | Prettier e ESLint | Em todo commit de código )/ 
 | `pnam check` | `svelte-check` e tipos Svelte | Em toda mudança de rota, store ou componente | 
 | `pnam test` | Vitest unitñrio | Em todo commit de código )/ 
 | `pnam build` | Prerender e geração do PWA | Antes de merge ou release | 
 | `pnam test:source:offline` | Gates de fonte e rede bloqueada | Antes de merge | 
 | `pnam test:functions:check` | `deno check` das Edge Functions | Antes de merge ou release | 
 | `pnam test:e2e` | Playwright Chromium | Antes de merge ou release | 
 | `pnam test:db:local` | Reset de banco, migrations, RLS e Storage | Antes de release | 
 | `pnam verify:full` | Suíte mais banco local | Antes de release ou checkpoint operacional | 
 | workflows de staging | Supabase remoto, OCR real e host | Antes de release privada |

## Testes unitñrios

### Domínio

Cobrir:

- transições de status documento e pagina
- retry, quota, falha e revisão 
- validaïão de title e pagincção 
- contratos de manifest de exportação 
- duplicação e deduplicação de importação 
- filtros, timestamps e identificadores 

### Serviços

Cobrir:

- mapeamento estrito de RPC
- rejeição de payload extra 
- rejeção de UUID e timestamp malformado 
- normalização de erro de transporte 
- cancelamento com AbortError 
- filtros e entradas validadas antes do Supabase
- parsers fail-closed para documentos, cadernos, tags, busca, revisão, exportação e uso

### Importação

Cobrir:

- hash SHA-256 
- validaïão de imagem e resposta de worker 
- deduplicação 
- publicação atômica 
- colisão de metadados da fila 
- consentimento OCR 
- cancelamento e fallback seguro 
- seleção de caderno na URL 
- batente de falha de listagem do caderno 
- PDF com texto nativo, misto e scaneado 
- contagem de progresso e cancelamento 


### Rotas e componentes

Cobrir por testes de contrato ou componente:

- query reativa e cancelamento da busca 
- versionamento de requests 
- invalidação no desmontar 
- falha parcial com conteúdo preservado 
- retry independente 
- exclusão mútua de ações 
- conclusão de domínio separada da navegação 
- rascunhos em lotes e fallback local 
- carga e mutações de tags 
- retry parcial da home 

## Testes de contrato de banco

Os testes de banco devem error por padrão em ambiente local resetado e consumir apenas contas e fixtures de teste.

Cobrir:

- app_users fail-closed 
- políticas RLS de todas as tabelas privadas 
- bucket privado e prefixo por `auth.uid()` 
- signed URL com expiração 
- claim idempotente do OCR 
- duplicação concorrente 
- rollup do estado do documento 
- limite diarco e eventos de uso 
- exclusão composta 
- cleanup de arquivos e metadados 

## Edge Functions

Cobrir com `deno check` e testes unitários:

- CORS centralizado 
- parser do contrato OCR 
- decisão de falha e retry 
- cliente do provedor externo 
- claim idempotente 
- exclusão de documento 
- negação de secredo no frontend 

## Testes E2E

Cenários mínimos:

1. rota de login carrega 
2. rota privada redireciona sem sessão 
3. navegação entre home, biblioteca, importação, revisão e configurações 
4. importação PDF preserva a rota e o seletor de caderno 
5. build está proverido por `vite preview` 

## Gates offline de fonte

Executar:

```bash
pnpm test:source:offline
```

Esse gate bloqueia acesso à rede e executa:

- verificação de segurança do source 
- verificação de roteamento estático 
- verificação de migrations 
- verificação de tipos RPC 
- verificação de bundle PWA 
- check do artifact de deploy 
- check dos contratos de staging 


## Golden path recomendado

```bash
pnam lint
pnpm check
pnam test
pnpm build
pnpm test:source:offline
pnpm test:functions:check
pnmp test:e2e
```

Para checkpoint operacional com Docker:

```bash
pnpm verify:full
```

## Gates externos

### Supabase staging

Usar workflow dedicado com:

- PROJECT_REF 
- PROJECT_URL
- SERVICE_ROLE_KEY 
- tokens ou contas de teste 

Validar:

1. migrations 
2. auth de conta allowlisted 
3. auth de conta not allowlisted 
4. RLS transversal 
5. Storage privado 
6. RPCs crüticos 
7. exportação 

### OCR staging

Validar:

1. processamento seletivo 
2. quota e 429 
3. 503 
4. timeout 
5. payload inválido 
6. retry sem reupload 
7. cleanup de resultado transiente 

### Host publicado

Validar:

1. CSP 
2. HSTS 
3. service worker 
4. cache de assets 
5. ausência de cache de respostas autenticadas 
6. roteamento direto 
## Saidas e artifactos

- Testes não devem publicar chaves, tokens, URLs assinadas ou conteúdo privado.
- Relatórios de falha devem reduzir dados sensíveis.
- Playwright deve preservar screenshots somente em falha e segundo retenção limitada.
- Artifacts de toolchain devem usar checksums e manifesto.
## Disciplina de encerramento

O checkpoint é considerado verde somente quando os gates planejados para o SHA forem executados e documentados.

Caso um gate não possa ser executado no ambiente atual:

1. documentar `NOT RUN` e a razão real;
2. não substituir por uma conclusão inferida;
3. continuar o trabalho resolível por código;
4. incluir o gate no plano do póximo checkpoint operacional.
