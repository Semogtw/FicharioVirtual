# Estratégia de testes

Este documento define a cobertura do Fichário Virtual e serve como checklist de prontidão técnica.

## Último recibo completo conhecido

Source commit: `6ea434f65714c665a62037e7c4c0a561bdcccf74`<br>
Workflow: [`Validate current head`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31457054179)<br>
Conclusão terminal: **success**

No mesmo SHA, as verificações protegidas [`Verify Supabase staging`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31457552460) e [`Verify OCR staging`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31457554164) também terminaram com **success**. A primeira cobriu Auth, RLS, Storage privado e pareamento desktop por código de uso único; a segunda executou OCR real com imagem sintética e publicou somente o relatório sanitizado.

O artifact público ainda não foi promovido: [`Verify staging artifact configuration`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31457371879) falhou de forma fail-closed por ausência de `PUBLIC_GOOGLE_CLIENT_ID`, e [`Verify Cloudflare staging deploy credentials`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31457373696) por ausência de `CLOUDFLARE_API_TOKEN`.

## Recibo histórico completo anterior

Source commit: `f87e1edc47268b4e0d2ea0742dac690c96d93646`<br>
Workflow: [`Validate current head`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333367357)<br>
Run: `31333367357`<br>
Conclusão terminal: **success**

Esse recibo cobre frontend/`pnpm verify`, source/offline, Chromium E2E, Deno/Edge Functions e Supabase local + pgTAP do mesmo SHA. Não atribua o resultado a commits posteriores.

## Estado do OCR em staging

O deploy `31333367356` do mesmo SHA terminou com **success**. A sonda protegida `31333418948` também terminou com **success**: configuração protegida validada, chamada anônima rejeitada com 401 e envelope final sanitizado:

```json
{
	"direct": {
		"httpStatus": 429,
		"category": "provider",
		"code": "gemini_daily_quota",
		"success": false
	},
	"process": { "httpStatus": 200, "category": "provider", "code": "provider_ok", "success": true }
}
```

A sequência de diagnóstico isolou o HTTP 400 nos campos de schema/structured-output enviados em `generationConfig`. O cliente corrigido mantém JSON MIME, move o contrato de schema para o prompt e conserva os parsers fail-closed. O `process-ocr` da sonda obteve resposta real válida do Gemini; a chamada direta separada encontrou quota e permaneceu marcada como falha, sem maquiar o resultado.

O cleanup `31333977753` terminou com **success** e removeu explicitamente apenas `ocr-boundary-probe`. Depois dele, `process-ocr` está `ACTIVE v19` e a sonda não aparece na lista de Edge Functions. O workflow de deploy foi restaurado para manual-only em `9ff4975`.

`STAGING_SERVICE_ROLE_KEY` foi validado como presente sem expor valor. `GEMINI_API_KEY` também nunca é registrada; seu funcionamento é evidenciado apenas pelo sucesso do caminho real do provider.

A causa histórica do `401` entre verificadores era independente: concorrência de workflows compartilhando uma sessão e `auth.signOut()` global. A serialização existente continua sendo a mitigação.

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

No SHA `f87e1edc`, `Validate current head` `31333367357` fornece PASS terminal para frontend, source/offline, Chromium, Deno/Edge e banco local. A fronteira Gemini sintética de staging também passou via `process-ocr`, mas o fluxo normal com página/job e persistência ainda deve ser executado antes de release. Google Drive real, deployment/headers do host, billing e dispositivos físicos permanecem `NOT RUN`, `PENDING` ou `BLOCKED` conforme seus gates próprios.

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

Já comprovado por `31333418948`:

1. proteção de gateway/JWT e rejeição anônima 401;
2. chamada Gemini real pelo `process-ocr` com HTTP 200;
3. parser real do wrapper aceitando a resposta (`provider_ok`);
4. observação separada de quota do provedor (`429 gemini_daily_quota`);
5. ausência de secrets, prompt, modelo ou texto OCR no envelope publicado.

Ainda validar no fluxo normal do produto:

1. página/job + Storage + persistência;
2. lote visual multipágina;
3. 503 e timeout end-to-end;
4. retry sem reupload;
5. cleanup de derivado transitório.

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
