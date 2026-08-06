# Estado atual do Fichário Virtual

_Atualizado: 2026-08-06_  
_Branch ativa: `main`_  
_Estado: OCR por lotes, quota exclusiva do provedor e Google Drive-first implementados em código; release ainda depende de CI no mesmo SHA, Supabase limpo, staging externo, Cloudflare e dispositivos reais._

## Resumo executivo

O Fichário Virtual é uma PWA privada para organizar imagens e PDFs, preservar originais no Google Drive, extrair texto nativo, executar OCR seletivo, pesquisar, revisar e exportar metadados.

As autoridades permanecem separadas:

- **Google Drive:** originais permanentes;
- **Supabase:** Auth, PostgreSQL, RLS, filas, resultados, sincronização e temporários;
- **Cloudflare Pages:** frontend estático e artefatos públicos, sem documentos privados;
- **computador confiável:** futura rota local para manuscritos e páginas difíceis.

O Gemini usa chamadas multipágina com persistência por página, lotes adaptativos, retomada e divisão seletiva. O aplicativo não possui franquia diária própria: somente uma resposta real de quota do provedor pode produzir `blocked_quota`.

## Implementado em código

### Produto e segurança

- conta única com allowlist fail-closed;
- interface responsiva para desktop, tablet e celular;
- biblioteca, cadernos, tags, busca, revisão e exportação;
- RLS e Storage privado;
- PWA sem cache de conteúdo autenticado;
- URLs assinadas curtas;
- Edge Functions com política JWT explícita;
- CORS fail-closed compartilhado nas APIs do navegador;
- callback OAuth sem JWT de gateway, protegido por origem, `state` de uso único e PKCE;
- gates que impedem workflows versionados com `contents: write` ou checkout autenticado;
- scanner de secrets sem expressões regulares globais reutilizadas entre arquivos.

### Importação, Storage e PDFs

- importação cancelável e retomável de imagens e PDFs;
- preparação local, miniaturas, SHA-256 e deduplicação;
- texto nativo preservado sem OCR;
- PDF misto envia somente páginas sem texto suficiente;
- upload retomável do original diretamente ao Drive;
- renderização separada das páginas visuais;
- segunda renderização conservadora quando um derivado ultrapassa 12 MiB;
- original nunca é recomprimido ou substituído;
- Google Picker com validação antecipada e download direto de até 50 MiB.

O `supabase/config.toml` mantém `file_size_limit = "20MiB"` para desenvolvimento local. A migration `202608060014_provider_only_ocr_batches.sql` eleva o bucket remoto `documents` para pelo menos 50 MiB como compatibilidade transitória da migração Drive-first. No fluxo normal, o original vai ao Drive e os derivados permanecem abaixo de 12 MiB. Os 50 MiB do bucket remoto não são o limite arquitetural do documento nem autorização para manter originais permanentemente no Supabase.

### OCR por lotes e quota real

Migrations principais:

```text
202608060014_provider_only_ocr_batches.sql
202608060015_ocr_batch_usage_and_hardening.sql
202608060016_harden_ocr_batch_transitions.sql
202608060017_harden_ocr_batch_manifest_jobs.sql
202608060018_recover_stale_ocr_batches.sql
```

A implementação inclui:

- `ocr_batches` com páginas, números originais, rota, bytes, modelo, tentativas e chamadas;
- vínculo ordenado e imutável em `ocr_jobs`;
- métricas informativas de páginas, lotes, chamadas e tentativas;
- `claim_ocr_job` sem argumento de limite diário;
- RLS e escrita de manifestos somente por RPCs validados;
- registro atômico apenas quando todas as páginas possuem jobs vinculáveis;
- validação ordinal dos pares `pageId` e número original;
- referências de jobs com `ON DELETE RESTRICT` para preservar manifestos históricos;
- lotes-filhos seguros para páginas vindas de um único pai `retryable` ou `blocked_quota`;
- reagrupamento de múltiplos pais terminais sem inventar uma linhagem falsa;
- recuperação após interrupção que libera job, página e manifesto depois de 15 minutos;
- transições terminais idempotentes;
- `blocked_quota` reservado para quota real do provedor;
- planejamento de até 40 páginas, reduzido para conteúdo denso;
- limite acumulado de bytes;
- uma chamada Gemini para múltiplas imagens;
- identidade estável por `pageId` e número original;
- persistência independente das páginas válidas;
- omissões, duplicações e JSON truncado convertidos em divisão seletiva;
- ausência de loop quando resta uma única página;
- retomada após reload usando o mesmo executor adaptativo;
- distinção entre rate limit temporário e quota diária real;
- painel com páginas, lotes, chamadas, tentativas, média por chamada e bloqueios reais.

### Google Drive-first

Já estão implementados:

- OAuth start e callback;
- refresh token privado no backend e token efêmero;
- escopo `drive.file`;
- pasta `Fichário Digital` e pastas aninhadas;
- upload retomável;
- Google Picker explícito;
- feed paginado de mudanças;
- checkpoint depois da persistência;
- identidade por IDs remotos;
- ausência e reconexão sem perda de OCR;
- fila idempotente, lease, retry e conflito;
- executor de criação, atualização, movimento e exclusão;
- telas de conexão, jobs, conflitos e migração;
- migração de originais legados com rollback;
- migrations, pgTAP, contratos TypeScript e testes unitários;
- type-check Deno e gates de segurança das funções Drive.

Isso ainda precisa ser validado em uma conta Google real. A existência do código não substitui OAuth, Picker, upload, mudanças, conflitos e migração executados no ambiente final.

## Pendências funcionais

### Arquivo já existente no Drive acima de 50 MiB

O Picker recusa antes do download integral arquivos maiores que 50 MiB. Copiar o arquivo dentro do Drive não resolve sozinho a inspeção, a detecção de texto nem a renderização seletiva, pois o pipeline atual recebe um `File` local.

A solução correta exige leitura remota por intervalos ou processamento equivalente para:

1. preservar ou copiar o arquivo dentro do escopo `drive.file`;
2. inspecionar o PDF sem download integral no navegador;
3. renderizar somente páginas necessárias;
4. manter tokens e URLs fora de logs e cache;
5. retomar intervalos sem duplicar derivados;
6. preservar identidade e hash do original.

### Worker desktop

A arquitetura está documentada, mas o worker não foi implementado. Continuam pendentes pareamento, credenciais por dispositivo, claim, lease, heartbeat, spool, backend CPU, modelos verificados, serviço systemd e benchmark da RX 6600.

## Hardening concluído nesta revisão

- remoção do último token de configuração de quota antiga em código ativo;
- Deno verifica `google-drive-mutations.ts`, `drive-job-runner.ts` e `drive-run-jobs/index.ts`;
- gate de segurança cobre as cinco APIs Drive chamadas pelo navegador;
- callback OAuth recebe verificações separadas de origem, redirect, cache e referrer;
- `supabase/config.toml` declara JWT explicitamente para todas as funções;
- somente `drive-oauth-callback` possui `verify_jwt = false`;
- runbook de deployment lista as oito Edge Functions atuais;
- três workflows one-shot antigos com capacidade de push foram removidos;
- teste impede reintrodução de escrita automática no repositório;
- divergências determinísticas de Prettier dos artifacts anteriores foram aplicadas;
- dois erros de sintaxe TypeScript detectados pelo CI foram corrigidos;
- migration 015 deixou de usar palavra reservada como parâmetro e ganhou alias explícito para `unnest`;
- migration 016 qualifica a coluna `finished_at` para não colidir com o parâmetro do RPC;
- migration 017 preserva integridade, ordem, imutabilidade e linhagem dos manifestos;
- migration 018 recupera atomicamente jobs, páginas e lotes interrompidos.

## Estado de validação

O checkpoint `b3089b0d8fe4bb0378d0c1f4355b92603556ad1d` encontrou:

- dois erros de sintaxe TypeScript;
- palavra reservada na migration 015;
- divergências de Prettier;
- E2E pulado porque o frontend não chegou a ficar verde.

Esses problemas foram corrigidos em commits posteriores. O checkpoint não aprova o head atual, e ainda não existe recibo completo do Actions para o SHA final.

### Gates obrigatórios no mesmo SHA

```bash
pnpm format:check
pnpm check
pnpm lint
pnpm test:unit
pnpm check:edge
pnpm check:offline
pnpm test:db
pnpm build
pnpm test:e2e
```

Também são obrigatórios:

- migrations em Supabase limpo;
- tipos TypeScript regenerados pelo schema implantado;
- OAuth e Drive com conta real;
- smoke Gemini real e lote multipágina;
- fixtures acima de 50 MB e 1.000 páginas;
- hash do original antes e depois;
- cancelamento e retomada em dispositivo real;
- tablet e celular;
- confirmação administrativa de ausência de billing.

## Pendências imediatas

1. obter CI integralmente verde no head atual;
2. aplicar migrations em Supabase limpo e executar pgTAP;
3. regenerar tipos pelo schema real;
4. executar staging Supabase, Google Drive e Gemini;
5. validar PDFs grandes em computador e tablet;
6. projetar e implementar leitura remota do Picker acima de 50 MiB;
7. implantar Cloudflare;
8. implementar o worker desktop em etapa separada.

## Regras de continuidade

- não reinserir teto diário interno;
- não apresentar contador local como quota restante;
- não comprimir ou substituir o original;
- não repetir páginas já aceitas;
- não apagar temporário antes de todas as rotas necessárias terminarem;
- não ampliar além de `drive.file` no MVP;
- não persistir tokens no navegador;
- não colocar conteúdo privado na Cloudflare;
- não ativar R2, billing ou fallback pago automaticamente;
- não conceder push automático a workflows temporários;
- não declarar release pronta sem gates, staging e dispositivos no mesmo SHA.
