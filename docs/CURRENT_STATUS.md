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
- biblioteca, cadernos, tags e organização em lote;
- RLS e Storage privado;
- PWA sem cache de conteúdo autenticado;
- busca textual, leitor lado a lado e correção manual;
- exportação JSON portátil sem tokens;
- coordenação entre abas;
- URLs assinadas curtas;
- Edge Functions autenticadas com política JWT explícita;
- CORS fail-closed compartilhado nas APIs do navegador;
- callback OAuth separado, sem JWT de gateway, protegido por origem, `state` de uso único e PKCE;
- gates que impedem workflows versionados com `contents: write` ou checkout autenticado.

### Importação e PDFs

- importação cancelável e retomável de imagens e PDFs;
- preparação local, miniaturas, SHA-256 e deduplicação;
- inspeção local de PDFs;
- texto nativo preservado sem OCR;
- PDF misto envia somente páginas sem texto suficiente;
- teto artificial de 20 MB removido da importação local;
- upload retomável do original diretamente ao Drive;
- renderização separada das páginas visuais;
- segunda renderização conservadora quando um derivado ultrapassa 12 MiB;
- original nunca é recomprimido ou substituído;
- Google Picker com validação antecipada e download direto de até 50 MiB.

O `file_size_limit = "20MiB"` do Storage local limita apenas temporários e o caminho legado injetável. No fluxo normal, o original vai ao Drive e os derivados são mantidos abaixo de 12 MiB. Não existe migration que eleve o bucket a 50 MiB.

### OCR por lotes e quota real

Migrations principais:

```text
202608060014_provider_only_ocr_batches.sql
202608060015_ocr_batch_usage_and_hardening.sql
202608060016_harden_ocr_batch_transitions.sql
```

A implementação inclui:

- `ocr_batches` com páginas, números originais, rota, bytes, modelo, tentativas e chamadas;
- vínculo ordenado em `ocr_jobs`;
- métricas informativas de páginas, lotes, chamadas e tentativas;
- `claim_ocr_job` sem argumento de limite diário;
- RLS e escrita de manifestos somente por RPCs validados;
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

Documentação detalhada:

- `docs/checkpoints/2026-08-06-provider-only-ocr-large-pdf-implementation.md`;
- `docs/superpowers/specs/2026-08-06-provider-only-ocr-quota-and-adaptive-batching-design.md`;
- `docs/superpowers/specs/2026-08-06-oversized-pdf-splitting-and-compression-design.md`.

### Google Drive-first

Já estão implementados:

- OAuth start e callback;
- armazenamento privado do refresh token no backend;
- token de acesso efêmero para operações permitidas;
- escopo `drive.file`;
- criação e resolução da pasta `Fichário Digital`;
- upload retomável do original;
- Google Picker explícito;
- importação local para Drive;
- feed paginado de mudanças;
- checkpoint somente depois de persistência;
- identidade por IDs remotos;
- reconexão de documento ausente;
- filas de sincronização e leases;
- executor de criação, atualização, movimento e exclusão;
- retries e conflitos persistidos;
- interfaces de conexão, jobs, conflitos e migração;
- migração dos originais legados com rollback;
- contratos TypeScript, migrations, pgTAP e testes unitários;
- type-check Deno do runner e dos helpers de mutação;
- gates CORS e cache para as funções Drive.

Isso ainda precisa ser validado em uma conta Google real. A existência do código não substitui OAuth, Picker, upload, mudanças, conflitos e migração executados no ambiente final.

## Pendência funcional de maior porte

### Arquivo já existente no Drive acima de 50 MiB

O Picker recusa antes do download integral arquivos maiores que 50 MiB. Copiar o arquivo dentro do Drive não resolve sozinho a inspeção, a detecção de texto nem a renderização seletiva, pois o pipeline atual recebe um `File` local.

A solução correta exige uma arquitetura de leitura remota por intervalos ou processamento equivalente, capaz de:

1. preservar ou copiar o arquivo dentro do escopo `drive.file`;
2. inspecionar o PDF sem download integral no navegador;
3. renderizar somente páginas necessárias;
4. manter autenticação e URLs fora de logs e cache;
5. retomar intervalos sem duplicar derivados;
6. preservar o hash e a identidade do original.

Essa é a única limitação de tamanho relevante que permanece no importador Drive externo. Uploads locais grandes já usam sessão retomável e não passam pelo teto do Picker.

## Cloudflare Pages

A arquitetura e os gates estão prontos para:

- frontend estático em `build/`;
- integração Git com `main`;
- nenhum documento privado na Cloudflare;
- projeto separado para partes públicas de modelos;
- R2 desativado por padrão;
- nenhum billing automático;
- artefato implantável com manifest e SHA-256;
- verificação pós-deployment.

Pendências externas:

1. criar os projetos reais;
2. configurar origem final, headers e fallback;
3. construir e publicar o artifact do mesmo SHA aprovado;
4. validar deploy e rollback;
5. validar PWA instalada em celular e tablet.

## Worker desktop

A arquitetura está documentada, mas o worker não foi implementado nesta etapa.

Decisões preservadas:

- HTTPS somente de saída;
- nenhuma porta pública;
- pareamento e revogação;
- claim, lease e heartbeat;
- resultado separado do Gemini;
- CPU como fallback obrigatório;
- Vulkan candidato;
- RX 6600 e ROCm experimentais até benchmark;
- nenhum service-role, chave Gemini ou refresh token no computador.

## Gates e hardening adicionados nesta revisão

- remoção do último token de configuração de quota antiga em código ativo;
- Deno passa a verificar `google-drive-mutations.ts`, `drive-job-runner.ts` e `drive-run-jobs/index.ts`;
- gate de segurança cobre as cinco APIs Drive chamadas pelo navegador;
- callback OAuth recebe verificações separadas de origem, redirect, cache e referrer;
- `supabase/config.toml` declara JWT explicitamente para todas as funções;
- somente `drive-oauth-callback` possui `verify_jwt = false`;
- runbook de deployment lista todas as oito Edge Functions;
- três workflows one-shot antigos, falhos e capazes de fazer push foram removidos;
- teste impede reintrodução de `contents: write` e checkout com credencial persistida;
- workflow temporário de formatação possui somente leitura e publica patch como artifact.

## Estado de validação

Uma execução intermediária anterior alcançou frontend, gates offline, Deno e banco, mas não aprovou o código atual. Ela continha divergências de Prettier, artifacts de reparo e etapas de navegador puladas.

O log de documentação identificou divergência de formatação em:

- `docs/DESKTOP_OCR_WORKER.md`;
- `docs/READINESS.md`;
- `docs/superpowers/plans/2026-08-06-provider-only-ocr-and-large-pdf-implementation.md`.

Um patch determinístico está sendo gerado sem permissão de escrita no repositório. Até sua aplicação e a execução completa do CI no novo head, o estado permanece **não aprovado para release**.

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

1. aplicar o patch de Prettier e remover o workflow temporário;
2. obter CI integralmente verde no head resultante;
3. aplicar migrations em Supabase limpo;
4. regenerar tipos pelo schema real;
5. executar staging Supabase, Google Drive e Gemini;
6. validar PDFs grandes em computador e tablet;
7. projetar e implementar leitura remota do Picker acima de 50 MiB;
8. implantar Cloudflare;
9. implementar o worker desktop em etapa separada.

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
