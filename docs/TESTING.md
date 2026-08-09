# Estratégia de testes

Este documento define a cobertura do Fichário Virtual e serve como checklist de prontidão técnica.

## Último recibo completo conhecido

Source commit: `b39e3eb55caec06a4cd40aa20833634c32a463d3`<br>
Workflow: [`Validate current head`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31296404993)<br>
Run: `31296404993`<br>
Data: 2026-08-09

Esse recibo cobre exatamente o SHA `b39e3eb`. Não atribua o resultado a outros SHAs.

Evidência executada no GitHub Actions com o mesmo SHA:

```text
Prettier + ESLint: PASS
svelte-check: PASS — 0 erros, 0 warnings
Vitest: PASS — 938 testes em 236 arquivos
build estático/PWA: PASS
gates offline de fonte: PASS
Edge Functions via Deno: PASS
Playwright Chromium: PASS no comando — 4 testes passaram; 1 teste foi flaky na primeira tentativa e passou no retry
Supabase local + pgTAP: PASS — 35 arquivos, 434 testes
```

O workflow e o recibo estão verdes para esse SHA, mas o E2E não foi completamente livre de flakiness. Esse resultado não autoriza inferir interoperabilidade com Google Drive/Gemini, deploy Supabase, host publicado ou dispositivos físicos.

## Estado do HEAD atual

O HEAD `255c28c` contém a correção tipada da instrumentação sanitizada e a correção de serialização dos verificadores. A causa do `401` entre verificadores de staging foi a concorrência de workflows que compartilham uma conta protegida: `auth.signOut()` é global e invalida a sessão do outro workflow. A correção serializa ambos em `staging-contract-verification`, com `cancel-in-progress: false`.

Gates finais do HEAD: `pnpm check` **PASS** (0 erros/0 avisos), `pnpm lint` **PASS**, Vitest **PASS** (940 testes em 236 arquivos), build/PWA **PASS** (131 entradas precache, com aviso de chunks acima de 500 kB) e source/offline **PASS**. E2E está `BLOCKED` sem Chromium. A suíte local completa permanece `BLOCKED` somente pelo fixture desktop não rastreado.

O deploy `31297694093` terminou com sucesso e registra `process-ocr` `ACTIVE v9`. O `Verify OCR staging` do HEAD, run `31298144753`, está `PENDING`, sem jobs, artifact ou conclusão consultáveis; não há OCR aprovado.

A instrumentação de diagnóstico aceita somente códigos Gemini de allowlist, limita o corpo inspecionado a 4 KiB e não registra corpo/headers completos, modelo ou tokens em logs/artifacts.

O `Verify Supabase staging` verde mais recente foi executado no SHA `b39e3eb` (`31296568886`) e cobriu Auth, RLS e Storage. No mesmo SHA, `Deploy Supabase staging` (`31296564374`) terminou com sucesso e `Verify OCR staging` (`31296573162`) falhou. No HEAD `255c28c`, `Deploy Supabase staging` (`31297694093`) terminou com `process-ocr` `ACTIVE v9`; `Verify OCR staging` (`31298144753`) está `PENDING`, sem jobs/artifact/conclusão.

## Ambiente mínimo

- Node.js compatível com `structuredClone()` e Web Crypto;
- pnpm;
- Chromium para Playwright;
- Deno para `deno check` das Edge Functions;
- Docker e imagens do Supabase para os gates de banco local.

A toolchain offline fixa o ambiente de frontend e Edge. Docker e as imagens do Supabase continuam sendo dependências separadas do archive portátil.

## Matriz de gates

| Gate                        | Executa                                   | Quando usar                                  |
| :-------------------------- | :---------------------------------------- | :------------------------------------------- |
| `pnpm lint`                 | Prettier e ESLint                         | Em todo commit de código ou documentação     |
| `pnpm check`                | `svelte-check` e tipos Svelte             | Em toda mudança de rota, store ou componente |
| `pnpm test`                 | Vitest unitário                           | Em todo commit de código                     |
| `pnpm build`                | Prerender e geração do PWA                | Antes de merge ou release                    |
| `pnpm test:source:offline`  | Gates de fonte com rede bloqueada         | Antes de merge                               |
| `pnpm test:functions:check` | `deno check` das Edge Functions           | Antes de merge ou release                    |
| `pnpm test:e2e`             | Playwright Chromium                       | Antes de merge ou release                    |
| `pnpm test:db:local`        | Reset de banco, migrations, RLS e Storage | Antes de release                             |
| `pnpm verify`               | Lint, tipos, Vitest e build               | Em todo checkpoint de desenvolvimento        |
| `pnpm verify:full`          | Suíte completa mais banco local           | Antes de release ou checkpoint operacional   |
| workflows de staging        | Supabase remoto, OCR real e host          | Antes de release privada                     |

No SHA `b39e3eb`, `pnpm verify`, `pnpm test:source:offline`, `pnpm test:functions:check`, `pnpm test:e2e` e `pnpm test:db:local` possuem `PASS` no workflow acima. No HEAD `255c28c`, check/lint/test/build/source passam conforme os gates acima, mas E2E está `BLOCKED` sem Chromium e OCR está `PENDING` sem jobs/artifact/conclusão. Google Drive, Gemini real, deployment/headers do host, billing e dispositivos físicos permanecem `NOT RUN`, `PENDING` ou `BLOCKED`.

## Testes unitários

### Domínio

Cobrir:

- transições de status de documento e página;
- retry, quota, falha e revisão;
- validação de título e paginação;
- contratos do manifest de exportação;
- duplicação e deduplicação de importação;
- filtros, timestamps e identificadores.

### Serviços

Cobrir:

- mapeamento estrito de RPC;
- rejeição de payload extra;
- rejeição de UUID e timestamp malformados;
- normalização de erro de transporte;
- cancelamento com `AbortError`;
- filtros e entradas validados antes do Supabase;
- parsers fail-closed para documentos, cadernos, tags, busca, revisão, exportação e uso.

### Importação

Cobrir:

- hash SHA-256;
- validação de imagem e resposta de worker;
- deduplicação;
- publicação atômica;
- colisão de metadados da fila;
- consentimento OCR;
- cancelamento e fallback seguro;
- seleção de caderno na URL;
- falha de listagem do caderno sem fallback silencioso;
- PDF com texto nativo, misto e escaneado;
- contagem de progresso, retry e cancelamento.

### Rotas e componentes

Cobrir por testes comportamentais, de contrato ou componente:

- query reativa e cancelamento da busca;
- versionamento de requests;
- invalidação no teardown;
- falha parcial com conteúdo preservado;
- retry independente;
- exclusão mútua de ações incompatíveis;
- conclusão de domínio separada da navegação;
- rascunhos em lotes e fallback local;
- carga, associação e mutações de tags;
- saves paralelos por linha na organização em lote;
- retry parcial da home;
- login, logout, exportação e prompt de instalação após teardown;
- bootstrap cliente da sessão, logout externo e supressão de revalidação no logout explícito.

## Testes de contrato de banco

Os testes de banco devem falhar por padrão quando o ambiente obrigatório não estiver disponível e consumir apenas contas e fixtures de teste.

Cobrir:

- `app_users` fail-closed;
- políticas RLS de todas as tabelas privadas;
- bucket privado e prefixo por `auth.uid()`;
- URL assinada com expiração;
- claim idempotente do OCR;
- deduplicação concorrente;
- rollup do estado do documento;
- limite diário e eventos de uso;
- exclusão composta;
- cleanup de arquivos e metadados.

## Edge Functions

Cobrir com `deno check` e testes unitários:

- CORS centralizado;
- parser do contrato OCR;
- decisão de falha e retry;
- cliente do provedor externo;
- claim idempotente;
- exclusão de documento;
- ausência de segredo no frontend.

## Testes E2E

Cenários mínimos:

1. rota de login carrega;
2. rota privada redireciona sem sessão;
3. navegação entre home, biblioteca, importação, revisão e configurações;
4. importação PDF preserva a rota e o seletor de caderno;
5. busca global abre a rota de resultados com a consulta atual;
6. build estático é servido por `vite preview`.

## Gates offline de fonte

Executar:

```bash
pnpm test:source:offline
```

Esse gate bloqueia acesso à rede e executa verificações de:

- segurança do source;
- roteamento estático;
- migrations;
- tipos RPC;
- bundle PWA;
- artifact de deploy;
- contratos de staging.

## Golden path recomendado

Para um checkpoint comum:

```bash
pnpm verify
pnpm test:source:offline
pnpm test:functions:check
pnpm test:e2e
```

Para checkpoint operacional com Docker:

```bash
pnpm verify:full
```

O workflow `Validate current head` executa frontend, source gates, Chromium, Edge Functions e banco local. Quando o frontend falha, publica um artifact `frontend-failure-<sha>` com o log integral; se houver diferença de formatação, também publica `prettier-repair-<sha>` com o patch produzido pela versão travada do projeto.

## Gates externos

### Supabase staging

Usar workflow dedicado com:

- `PROJECT_REF`;
- `PROJECT_URL`;
- `SERVICE_ROLE_KEY`;
- tokens ou contas exclusivas de teste.

Validar:

1. migrations;
2. autenticação de conta allowlisted;
3. rejeição de conta fora da allowlist;
4. RLS transversal;
5. Storage privado;
6. RPCs críticos;
7. exportação.

### OCR staging

Validar:

1. processamento seletivo;
2. quota e 429;
3. 503;
4. timeout;
5. payload inválido;
6. retry sem reupload;
7. cleanup de resultado transitório.

### Host publicado

Validar:

1. CSP;
2. HSTS;
3. service worker;
4. cache de assets;
5. ausência de cache de respostas autenticadas;
6. roteamento direto.

## Saídas e artifacts

- Testes não devem publicar chaves, tokens, URLs assinadas ou conteúdo privado.
- Relatórios de falha devem reduzir dados sensíveis.
- Playwright deve preservar screenshots somente em falha e com retenção limitada.
- Artifacts de toolchain devem usar checksums e manifest.
- Um `PASS` deve sempre citar o SHA efetivamente executado.

## Disciplina de encerramento

O checkpoint é considerado verde somente quando os gates planejados para o SHA forem executados e documentados.

Caso um gate não possa ser executado no ambiente atual:

1. documentar `NOT RUN` e a razão real;
2. não substituir o gate por uma conclusão inferida;
3. continuar o trabalho resolvível por código;
4. incluir o gate no próximo checkpoint operacional.
