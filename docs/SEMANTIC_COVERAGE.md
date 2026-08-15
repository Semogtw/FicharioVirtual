# Busca e cobertura semântica

Este documento descreve o contrato operacional atual da camada semântica do Fichário Virtual. Semântica melhora recuperação e cobertura, mas continua degradável: busca textual/fuzzy permanece disponível quando índice, cota ou Gemini não estiverem disponíveis.

## Contrato canônico

- modelo de embeddings: `gemini-embedding-2`;
- dimensionalidade: `768`;
- índice textual persistido: `page_semantic_chunks`;
- índice visual seletivo: `page_visual_embeddings`;
- distância: cosseno via pgvector;
- ANN: HNSW;
- similaridade mínima da busca textual semântica: `0.46`;
- similaridade mínima da cobertura: `0.50`;
- similaridade mínima do canal visual global: `0.36`;
- fusão determinística por Reciprocal Rank Fusion (RRF), sem misturar diretamente rank textual e cosine.

Os valores compartilhados ficam em `supabase/functions/_shared/semantic-config.ts`.

## Dois índices, responsabilidades diferentes

### Semântica textual

OCR, texto nativo ou correção da página são normalizados e divididos deterministicamente em chunks. Os chunks são embeddados e persistidos em `page_semantic_chunks` com `source_hash` versionado.

Esse índice é compartilhado por:

- busca global;
- cobertura de tópicos;
- backfill semântico.

### Semântica visual adaptativa

Páginas que se beneficiam de contexto visual podem receber, adicionalmente, **um embedding por página** em `page_visual_embeddings`.

O roteador `visual-v1` é local e determinístico. Ele evita custo visual quando há texto nativo suficiente, página de livro limpa ou conteúdo praticamente vazio e favorece manuscritos, scans degradados, conteúdo misto, tabelas/layout, matemática, warnings e revisão.

O índice visual é usado pela **busca global**, não substitui `page_semantic_chunks` e não altera o mecanismo de classificação da cobertura de tópicos.

## Chunking e invalidação textual

O texto efetivo é normalizado e dividido com os limites canônicos do projeto. Cada conjunto de chunks guarda um SHA-256 do conteúdo normalizado/versionado. Mudança de OCR, texto nativo ou correção torna os vetores antigos inelegíveis e permite reindexação segura.

`replace_page_semantic_chunks` substitui o conjunto de uma página atomicamente.

## Indexação textual e backfill

`semantic-search` e `semantic-coverage` podem indexar pequenos lotes oportunisticamente. `semantic-index` fornece backfill retomável com batch e concorrência limitados.

`semantic_index_failures` mantém apenas metadados operacionais e `retry_after`; não persiste texto, prompt, embedding ou mensagem bruta do provedor. Falhas usam backoff e não podem monopolizar a fila.

## Indexação visual

O fluxo visual usa fila independente e worker de baixa prioridade:

- `page_visual_embedding_jobs`;
- `semantic-visual-worker`;
- `_shared/background-visual-indexer.ts`;
- `_shared/gemini-embedding-client.ts`.

Regras principais:

- PNG/JPEG;
- até 6 imagens por request;
- hash dos bytes reais do input;
- reuse idempotente quando página/modelo/router/hash não mudam;
- 429 entra em backoff sem bloquear OCR nem índice textual;
- derivado temporário é preservado somente enquanto ainda for necessário e removido depois.

## Cache de consultas

`semantic_query_embedding_cache` evita gerar novamente o embedding de consultas repetidas.

A consulta normalizada não é persistida. A chave é um hash versionado de modelo + consulta normalizada e o cache é privado.

Na busca global, o mesmo embedding de consulta pode alimentar `search_pages_semantic` e `search_pages_visual_semantic`, aproveitando o espaço multimodal comum do modelo.

## Recuperação

### Busca global

A Edge Function `semantic-search` combina até três sinais:

1. lexical/fuzzy (`search_pages`);
2. semântico textual (`search_pages_semantic`);
3. semântico visual por página (`search_pages_visual_semantic`).

`SEMANTIC_VISUAL_MODE` controla o terceiro canal:

- `off`: visual não é consultado;
- `shadow`: visual é consultado/medido, mas não muda a ordenação entregue;
- `active`: visual participa do ranking final.

O default versionado permanece `shadow`.

### Cobertura de tópicos

`semantic-coverage` continua combinando busca lexical e o índice **textual** compartilhado. Para cada tópico, recupera candidatos, faz RRF e pode verificar poucos trechos com o Gemini. O canal visual da busca global não é usado para afirmar que um tópico textual está coberto.

## RRF

O RRF textual mantém:

- `k = 28`;
- peso lexical `0.48`;
- peso vetorial textual `0.52`;
- bônus textual conjunto `0.012`;
- cosine apenas como pequeno desempate.

Quando o visual está ativo, a extensão multimodal usa parâmetros calibrados em staging:

- peso visual `0.475`;
- confiança visual `0.04` limitada a margem `0.1` acima do threshold;
- guarda lexical top-1 `0.0045`.

Texto e imagem correlacionados não são somados integralmente: usa-se o sinal mais forte mais um pequeno bônus de corroboração. Sem visual ativo, o score textual antigo permanece inalterado.

## Telemetria e privacidade

Telemetria de provedor e recuperação registra apenas metadados operacionais. O canal visual adiciona `semantic_visual_events`, também sem página, OCR, consulta, prompt ou vetor.

A chave `GEMINI_API_KEY` permanece somente nas Edge Functions.

## Fallback

Fallbacks esperados:

- sem chave/configuração → lexical;
- quota/rate limit → lexical ou híbrido textual;
- Gemini indisponível → lexical;
- RPC vetorial textual indisponível → lexical;
- RPC visual indisponível → híbrido textual;
- visual em `off`/`shadow` → nenhum impacto negativo obrigatório no resultado do usuário;
- índice textual incompleto → híbrido sobre a parte indexada + lexical sobre todo o corpus.

## Evidência operacional atual

SHA validado: `a254e43d248943fad6ccf71203dc9059e6b40c63`.

- `Validate current head` `31863888994`: verde em frontend, browser, Edge, banco local/migrations/pgTAP e receipt final;
- artifact `31863889014`: verde;
- deploy Supabase staging `31864139871`: verde, incluindo verificações pós-deploy e OCR real;
- benchmark visual `31864249498`: verde.

No benchmark visual, `active` obteve Recall@1 global `0.8667`, Recall@3 `0.9333`, MRR `0.9067`, visual Recall@1 `0.8571` e visual MRR `0.9000`, preservando o match lexical de controle e sem candidatos negativos acima do threshold visual. O staging foi restaurado para `shadow` e o corpus temporário foi removido integralmente.

Para detalhes da terceira via, consulte [ADAPTIVE_MULTIMODAL_EMBEDDING.md](./ADAPTIVE_MULTIMODAL_EMBEDDING.md).
