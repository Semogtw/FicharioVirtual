# Estado atual do Fichário Virtual

_Atualizado: 2026-08-03_  
_Branch ativa: `main`_  
_Estado: MVP implementado; hardening OCR adicional no HEAD, ainda sem validação integral desse novo checkpoint ou release_

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

Estimativa de engenharia atual:

- **99% do MVP implementado em código**;
- **85% de prontidão operacional para release**;
- **95% de progresso total ponderado**.

Os percentuais e critérios estão detalhados em `docs/READINESS.md`. Eles não significam que o ambiente remoto já foi validado.

## Checkpoint funcional verde

O commit funcional `17f510396740ff78da9b76ce7a9c5d515b382015` recebeu `SUCCESS` no workflow `Validate current head`, run `30788491641`.

A execução comprovou:

```text
pnpm install --frozen-lockfile
Prettier + ESLint
svelte-check: 0 erros, 0 warnings
183 testes unitários em 55 arquivos
7 cenários de falha OCR por HTTP loopback
build estático + validação PWA
5 gates offline de fonte
3 testes E2E no Chromium
6 módulos Edge verificados com Deno
27 migrations aplicadas em banco limpo
54 testes pgTAP
concorrência e replay OCR idempotente
rejeição de replay OCR divergente
cota e retomada na virada do dia UTC
```

Recibo persistente: issue `#1`, `[CI] Fichário current HEAD validation`.

Esse checkpoint não cobre as alterações de código posteriores descritas abaixo. `PASS` continua atribuído somente a `17f5103` até que os gates sejam executados novamente em um SHA novo.

## Hardening OCR posterior ao checkpoint verde

A continuação de 2026-08-03 avançou diretamente na `main`, com testes e implementação separados em commits pequenos. O HEAD anterior a esta atualização documental é `236853e6511d06a07d8a45765f61c39f79f67dbc`.

Foram corrigidos:

- limpeza da imagem temporária quando outra execução conclui a página entre a leitura inicial e o claim;
- parser cliente fail-closed para respostas OCR, com formas exatas e limite de `warningCount`;
- falhas de transporte sem resposta HTTP mantidas como retryable;
- erros OCR retryable preservados como pendentes durante retomada;
- validação estrita das linhas retornadas por `list_resumable_ocr_pages`;
- mapeamento seguro dos estados de rejeição do claim para erros de domínio;
- envelopes de erro HTTP com campos extras ou códigos inválidos ignorados;
- validação de correspondência entre estado de rejeição e status HTTP;
- propagação de `needsReview` em `already_complete` desde a Edge Function até cliente, fila de imagem, importador de PDF e retomada;
- releitura do status terminal após uma corrida de claim, sem assumir que toda conclusão concorrente ficou `ready`.

Evidência criada no mesmo conjunto:

- testes unitários de serviço para formas de resposta, transporte, erros e status HTTP;
- testes de retomada para retryable e revisão concorrente;
- teste do importador de PDF para página já concluída com revisão;
- testes de fonte da Edge Function para cleanup e releitura do status;
- teste de fonte da fila de importação para preservação de `needs_review`.

### Validação do novo HEAD

O workspace desta sessão tinha Node.js 22 e TypeScript 5.8, mas não conseguiu resolver `github.com` nem `registry.npmjs.org`. Por isso, clone, instalação congelada e gates dependentes do repositório completo ficaram bloqueados por DNS.

Estado honesto dos gates no HEAD novo:

```text
pnpm verify: NOT RUN — pnpm/store do projeto indisponível e registry sem resolução DNS
pnpm test:e2e: NOT RUN — workspace completo e dependências indisponíveis
pnpm test:functions:check: NOT RUN — Deno indisponível no workspace
pnpm test:db:local: NOT RUN — Supabase CLI/Docker e checkout completo indisponíveis
GitHub commit status: nenhum status publicado para o HEAD consultado
```

As inspeções de contrato e buscas de consumidores foram concluídas pelo conteúdo versionado no GitHub, mas não substituem execução. O próximo agente deve priorizar `pnpm verify:full` em um workspace funcional antes de atribuir um novo checkpoint verde.

## Produto implementado

### Fundação e interface

- SvelteKit 5, TypeScript e adapter estático com fallback SPA;
- interface editorial responsiva para desktop, tablet e celular;
- login separado do shell privado;
- biblioteca, cadernos, tags, organização em lote e painel de uso;
- leitor lado a lado, revisão manual e rascunhos locais recuperáveis;
- PWA opcional com cache limitado a shell e ativos públicos.

### Importação e OCR

- preparação de imagens em worker, miniaturas, SHA-256 e deduplicação;
- inspeção local de PDFs e preservação de texto nativo por página;
- renderização PDF.js somente quando OCR é necessário;
- publicação atômica de documentos, páginas e trabalhos;
- consentimento persistido, claim concorrente, idempotência e limite diário;
- estados explícitos de retry, quota, revisão e falha;
- contrato JSON estrito e classificação de erros do provedor;
- planejador compartilhado de persistência, resposta pública e backoff;
- `attemptCount` ausente, fracionário ou menor que 1 recusado antes do provedor;
- retomada sem reupload e rollup automático do estado do documento.

### Falhas OCR seguras

`pnpm test:ocr:faults:local` usa somente um servidor HTTP efêmero em `127.0.0.1` e o cliente Gemini compartilhado. O gate comprova:

- 429 transitório separado de quota diária;
- 503 retryable;
- payload inválido retryable e terminal;
- timeout/abort real retryable e terminal;
- chave enviada somente no header;
- payload de imagem e resposta estruturada;
- bases de backoff e respostas públicas.

O código implantado não aceita endpoint alternativo, secret, query, body ou header de fault injection. O gate de fonte rejeita superfícies como `GEMINI_API_URL`, `OCR_PROVIDER_URL` e `X-FICHARIO-FAULT`.

### Dados e segurança

- allowlist `app_users` fail-closed;
- RLS forçada nas tabelas privadas;
- bucket `documents` privado e prefixado por `auth.uid()`;
- nenhum segredo no bundle do navegador;
- URLs assinadas somente sob demanda;
- CSP, HSTS, Permissions Policy e política de cache verificáveis;
- exportação JSON portátil sem tokens, URLs assinadas ou caminhos internos;
- exclusão composta e idempotente por Edge Function.

## Gates externos preparados

### Artifact estático e host HTTPS

`Build deployable Fichário artifact` fabrica um pacote schema 2 com `site/` separado da proveniência. O pacote inclui manifest, checksums e snapshots de `package.json`/`pnpm-lock.yaml` fora da raiz pública. `pnpm test:deployment:artifact -- <diretório>` valida commit, environment, identidade do projeto, lockfile pnpm v9, hashes declarados, arquivos obrigatórios, cobertura exata, paths portáteis e ausência de links simbólicos antes do upload.

`pnpm test:deployment -- https://host.example` e `Verify deployed Fichário` verificam redirect, headers, CSP, HSTS, fallback SPA, manifesto, service worker e ausência de cache privado depois da publicação.

### Supabase remoto

`pnpm test:staging:supabase` e `Verify Supabase staging` usam duas contas e chave publicável para provar:

- allowlist e RLS;
- sentinela de caderno invisível à segunda conta;
- upload, listagem e download de Storage privado;
- criação segura de URL assinada;
- negação à segunda conta;
- expiração real da URL curta;
- cleanup antes de encerrar as sessões.

### OCR real

`pnpm test:staging:ocr` e `Verify OCR staging`:

- exigem confirmação manual antes de uma chamada externa;
- geram um PNG sintético com `FICHARIO OCR 2718`;
- criam uma importação real com credenciais públicas;
- invocam `process-ocr`;
- verificam transcript e estados persistidos;
- removem o documento por `delete-document`;
- nunca recebem `GEMINI_API_KEY` ou service-role key no GitHub.

Runbook: `docs/OCR_STAGING.md`.

Nenhum desses gates externos foi executado ainda porque o host e o projeto Supabase de staging não estão configurados.

## Workspace offline

O repositório `Semogtw/Offline-Toolchains` fabrica um workspace Linux x64 com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI.

A fabricação portátil atual usa o commit de toolchain `fa810d8f9c9b6979e0c53ee9c6d839174ef65524`, run `30788834267`, fixado no source `17f510396740ff78da9b76ce7a9c5d515b382015`. O smoke:

- instalou 521 pacotes exclusivamente pelo store local;
- passou Prettier, ESLint e `svelte-check` com 0 erros/0 warnings;
- passou 183 unitários em 55 arquivos, incluindo os 7 cenários loopback;
- passou build/PWA, cinco gates de fonte e três E2E;
- verificou seis módulos Edge com o registry bloqueado;
- terminou com `doctor: PASS`.

O manifest schema 2 e os snapshots de package/lockfile foram conferidos. O archive foi publicado em duas partes e possui SHA-256 final `8b955ceb349d450f2724593b1bbcd64e0277506104d68278cbfdde3f13e12a09`.

Checksums das partes:

```text
part-00 ce77a0ac133108bf79522d90b7729f1c1621b78f79db54ee49e5c892df834e9a
part-01 e3bf659273a19ad844523e553a586c1e37865a7428893d7b779f668d6990d4a5
```

Docker e as imagens Supabase continuam externos ao bundle.

## Ainda não validado externamente

- migrations, Auth, RLS e Storage no projeto remoto;
- expiração da URL assinada no serviço real;
- modelo Gemini e quota reais;
- persistência, retomada e cleanup implantados após 429, 503, timeout e payload inválido;
- PDFs extensos e mistos em dispositivo físico;
- instalação e atualização do PWA no navegador-alvo;
- headers do host final;
- limites gratuitos, billing desativado, backup e rollback operacionais.

A classificação, a resposta pública e o cálculo de backoff das falhas OCR já possuem evidência local no checkpoint verde por HTTP loopback. O item externo pendente é observar a função implantada e os estados reais no Supabase. O hardening posterior precisa de uma nova execução integral local antes de herdar essa evidência.

## Próximas prioridades

1. executar `pnpm verify:full` no HEAD atual em workspace com toolchain disponível;
2. corrigir qualquer regressão de tipo, formato ou contrato encontrada pelo gate integral;
3. criar um projeto Supabase de staging sem dados reais;
4. aplicar migrations e cadastrar duas contas exclusivas de teste;
5. configurar o environment `staging` e executar `Verify Supabase staging`;
6. implantar `process-ocr` e `delete-document`, configurar secrets no Supabase e executar `Verify OCR staging`;
7. observar persistência, retomada e cleanup das falhas OCR no ambiente implantado;
8. publicar um host HTTPS e executar `Verify deployed Fichário`;
9. testar PDFs e retomada em tablet/celular;
10. confirmar billing desativado, backup e rollback;
11. somente então decidir entre staging prolongado e release privada.

## Regras de continuidade

- não inserir chaves privadas no frontend, GitHub, artifacts ou logs;
- não transformar falha de OCR em perda ou novo upload;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- não adicionar endpoint ou controle de fault injection à função implantada;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
