# Estado atual do Fichário Virtual

_Atualizado: 2026-08-03_  
_Branch ativa: `main`_  
_Estado: MVP implementado e validado localmente; gates externos prontos, sem deployment ou release_

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

Estimativa de engenharia atual:

- **99% do MVP implementado em código**;
- **85% de prontidão operacional para release**;
- **95% de progresso total ponderado**.

Os percentuais e critérios estão detalhados em `docs/READINESS.md`. Eles não significam que o ambiente remoto já foi validado.

## Checkpoint funcional verde

O commit funcional `ddfb122f5190ade9e44e534e2c192ab116ed2a06` recebeu `SUCCESS` no workflow `Validate current head`, run `30784989610`.

A execução comprovou:

```text
pnpm install --frozen-lockfile
Prettier + ESLint
svelte-check: 0 erros, 0 warnings
167 testes unitários em 52 arquivos
build estático + validação PWA
5 gates offline de fonte
3 testes E2E no Chromium
5 módulos Edge verificados com Deno
27 migrations aplicadas em banco limpo
54 testes pgTAP
concorrência e replay OCR idempotente
rejeição de replay OCR divergente
cota e retomada na virada do dia UTC
```

Recibo persistente: issue `#1`, `[CI] Fichário current HEAD validation`.

Commits posteriores que alteram somente Markdown não modificam esse checkpoint executável. O workflow leve `Validate documentation` verifica README e `docs/**` sem repetir banco e Chromium.

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
- retomada sem reupload e rollup automático do estado do documento.

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

A fabricação portátil atual usa o commit de toolchain `1eb6bbfba6ea5ae291f48917a8509413da20845d`, run `30785368504`, fixado no source `ddfb122f5190ade9e44e534e2c192ab116ed2a06`. O smoke instalou 521 pacotes exclusivamente pelo store local, passou lint, tipos, 167 unitários em 52 arquivos, build/PWA, cinco gates de fonte, três E2E e cinco módulos Edge com o registry bloqueado; o `doctor` terminou em `PASS`. O manifest schema 2, os snapshots de package/lockfile e as duas partes do archive foram auditados: hashes dos snapshots conferem, checksums das partes estão publicados e o archive final possui SHA-256 `3fc4ff14b1cd62fbd124a7b92ecaeb12695fa8f37605ac82938ac82ca2eaae25`.

Docker e as imagens Supabase continuam externos ao bundle.

## Ainda não validado externamente

- migrations, Auth, RLS e Storage no projeto remoto;
- expiração da URL assinada no serviço real;
- modelo Gemini e quota reais;
- injeção de 429, 503, timeout e payload inválido;
- PDFs extensos e mistos em dispositivo físico;
- instalação e atualização do PWA no navegador-alvo;
- headers do host final;
- limites gratuitos, billing desativado, backup e rollback operacionais.

## Próximas prioridades

1. criar um projeto Supabase de staging sem dados reais;
2. aplicar migrations e cadastrar duas contas exclusivas de teste;
3. configurar o environment `staging` e executar `Verify Supabase staging`;
4. implantar `process-ocr` e `delete-document`, configurar secrets no Supabase e executar `Verify OCR staging`;
5. injetar as falhas externas previstas sem habilitar fallback pago;
6. publicar um host HTTPS e executar `Verify deployed Fichário`;
7. testar PDFs e retomada em tablet/celular;
8. confirmar billing desativado, backup e rollback;
9. somente então decidir entre staging prolongado e release privada.

## Regras de continuidade

- não inserir chaves privadas no frontend, GitHub, artifacts ou logs;
- não transformar falha de OCR em perda ou novo upload;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
