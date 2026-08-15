# Embeddings visuais adaptativos e busca multimodal

**Status:** implementado e validado em staging; indexação visual habilitada de forma seletiva e ranking visual mantido em `shadow` por padrão.

**Última validação:** 15 de agosto de 2026.

## Objetivo

O Fichário usa o texto extraído apenas como uma das formas de localizar o documento real. Para páginas em que OCR/texto nativo não descrevem bem o conteúdo visual — manuscritos, scans degradados, diagramas, tabelas, matemática e layouts — existe um canal semântico visual complementar.

O sistema **não cria um único embedding para um PDF inteiro**. A unidade visual é a página. O fluxo textual continua sendo OCR/texto nativo → chunks normalizados → `gemini-embedding-2` → `page_semantic_chunks`; quando o roteador considera útil, a imagem da página também gera um embedding no mesmo espaço multimodal e é persistida em `page_visual_embeddings`.

## Roteamento adaptativo

O roteador local e determinístico fica em `supabase/functions/_shared/visual-embedding-routing.ts` e usa a versão `visual-v1`. Ele não faz uma chamada de IA extra para classificar a página.

O canal visual é evitado quando já existe texto nativo suficiente, em páginas de livro limpas e em páginas praticamente vazias. Ele é elegível para escrita manual, scan degradado, conteúdo misto, tabelas/layout, matemática, páginas marcadas para revisão, warnings de OCR e páginas esparsas que ainda tenham conteúdo útil.

A decisão é integrada aos fluxos de OCR web, OCR em background e OCR desktop. O derivado JPEG preparado para OCR pode ser preservado temporariamente quando também será necessário para o embedding visual; ele é removido depois de sucesso ou falha terminal.

## Persistência, fila e isolamento

A migration visual cria superfícies separadas para o terceiro canal:

- `page_visual_embeddings`: um vetor de 768 dimensões por página/modelo, com `source_hash` dos bytes efetivamente enviados, `routing_version` e HNSW cosseno;
- `page_visual_embedding_jobs`: fila privada e retomável;
- `semantic_visual_events`: telemetria operacional sem conteúdo sensível;
- RPCs de enqueue, claim, reuse, completion, failure, cleanup, busca e estatísticas.

RLS é forçado nas tabelas privadas e os RPCs verificam ownership/allowlist. O worker usa service role apenas para executar trabalho já autorizado e não expõe escrita direta ao cliente.

## Worker e Gemini Embedding 2

`semantic-visual-worker` usa `_shared/background-visual-indexer.ts` e `_shared/gemini-embedding-client.ts`.

Regras principais:

- somente PNG/JPEG;
- no máximo 6 imagens por request;
- limites explícitos por imagem e por batch;
- `source_hash` calculado dos bytes visuais reais;
- reuse idempotente quando página/modelo/router/hash não mudaram;
- 429 vira `blocked_quota` com backoff e não bloqueia OCR nem índice textual;
- falhas transitórias recebem retry; 4xx permanentes terminam o job;
- limpeza do derivado temporário ocorre após sucesso/reuse/falha terminal.

A indexação visual é de baixa prioridade e degradável: uma indisponibilidade do canal visual nunca torna OCR ou busca textual indisponíveis.

## Recuperação multimodal

A busca global pode combinar três sinais independentes:

1. lexical/fuzzy (`search_pages`);
2. embedding textual (`search_pages_semantic`);
3. embedding visual por página (`search_pages_visual_semantic`).

A consulta textual é embeddada uma vez com `gemini-embedding-2` e o mesmo vetor pode consultar os índices textual e visual, pois os dois canais vivem no mesmo espaço multimodal.

O limiar visual calibrado está em `_shared/semantic-config.ts` e atualmente é `0.36`.

### Fusão RRF calibrada

`_shared/semantic-ranking.ts` mantém o RRF textual original intacto quando o canal visual está ausente ou em shadow. Quando o visual participa:

- uma página puramente visual pode competir com o score visual completo;
- uma página encontrada por texto **e** visual usa o mais forte dos dois sinais, em vez de somar duas evidências correlacionadas;
- há apenas um pequeno bônus de corroboração;
- a contribuição de confiança visual é limitada à janela medida acima do threshold;
- `lexicalRank = 1` recebe uma guarda específica no modo multimodal, impedindo que um decoy visual extremo derrube um match lexical exato;
- desempates permanecem determinísticos por `stableKey`.

Isso corrige o problema observado nos primeiros benchmarks: o embedding visual era bom isoladamente, mas a fusão antiga ainda deixava candidatos semânticos textuais dominarem o ranking visível.

## Modos de rollout

`SEMANTIC_VISUAL_MODE` aceita:

- `off`: não consulta o índice visual;
- `shadow`: consulta/mede o canal visual, mas a ordenação entregue ao usuário permanece textual + semântica;
- `active`: o visual participa da fusão final.

O contrato versionado mantém `shadow` como estado seguro padrão. O workflow de staging testa `active` temporariamente e **sempre restaura `shadow`** antes do cleanup. A evidência atual recomenda promoção (`promote_active`), mas essa mudança de política não é feita silenciosamente pelo benchmark.

## Resultado real de staging

Workflow canônico: `Verify adaptive visual staging`, run `31864249498`, SHA `a254e43d248943fad6ccf71203dc9059e6b40c63`.

O corpus foi recriado com bytes únicos por execução, sem alterar a geometria visual dos PNGs. Foram exercitados 15 documentos principais, smoke JPEG adicional e consultas negativas.

### Shadow / qualidade bruta do índice visual

- raw visual Recall@1: **85,7%**;
- raw visual Recall@3: **92,9%**;
- raw visual MRR: **0,901**;
- mediana de similaridade esperada: **0,437**;
- 14/14 consultas visuais esperadas acima de `0.36`;
- falsos positivos visuais acima do threshold nas negativas: **0**;
- retries: **0**;
- erros do RPC visual: **0**;
- sinal de quota: **não observado**.

### Active / ranking entregue

- Recall@1 global: **86,7%**;
- Recall@3 global: **93,3%**;
- MRR global: **0,907**;
- visual Recall@1: **85,7%**;
- visual Recall@3: **92,9%**;
- visual MRR: **0,900**;
- match lexical de controle permaneceu top-1;
- p95 de latência: **4.882 ms** versus **3.495 ms** no shadow, dentro do gate configurado.

Todos os gates de comparação passaram e o relatório final emitiu `recommendation: promote_active`. O cleanup removeu **16/16 documentos** e o fichário temporário, sem falhas. O staging foi restaurado para `shadow` antes do cleanup.

## Comportamento da interface

O resultado aponta para a página/documento real, não para a transcrição como destino final. Quando a recuperação é puramente visual, não é inventado excerpt textual nem highlight inexistente. A página correta é aberta sobre a mídia original.

Os modos visuais podem ser apresentados como `visual`, `lexical_visual`, `semantic_visual` ou `hybrid_visual`, além dos modos textuais existentes.

## Privacidade e telemetria

A telemetria visual registra somente metadados operacionais como modelo, quantidade, bytes, duração, status, motivo de roteamento e versão. Não persiste imagem, OCR, consulta, prompt ou vetor na tabela de eventos.

O envio de imagem só acontece nas páginas selecionadas pelo roteador. A indisponibilidade do provedor degrada a funcionalidade para os canais textual/fuzzy e semântico textual existentes.

## Evidência de validação

Além do benchmark real:

- `Offline-Toolchains` run `31863518399`: testes focados + `pnpm verify` + checks Deno/Edge; a suíte executou 318 arquivos e 1.358 testes;
- validação oficial da `main` run `31863888994`: frontend, source gates, browser/E2E, Edge Functions, banco local/migrations/pgTAP e gate contra verificação incompleta, todos verdes;
- artifact staging run `31863889014`: build, configuração congelada, pacote e verificação do artifact, todos verdes;
- deploy Supabase staging run `31864139871`: migrations, Edge Functions, Auth/RLS/Storage, Drive OAuth, pairing desktop e OCR real, todos verdes;
- benchmark multimodal run `31864249498`: shadow, active, comparação, restauração e cleanup, todos verdes.
