# Busca e cobertura semântica

Este documento é o contrato operacional da camada semântica do Fichário Virtual antes do primeiro deploy. A semântica melhora recuperação e cobertura, mas **não é requisito para o produto funcionar**: busca textual/fuzzy permanece como fallback completo quando consentimento, cota, índice ou Gemini estiverem indisponíveis.

## Contrato de primeira produção

Como ainda não houve deploy, existe um único contrato canônico, sem compatibilidade com variantes antigas:

- modelo de embeddings: `gemini-embedding-2`;
- dimensionalidade: `768`;
- índice persistido: `page_semantic_chunks`;
- distância: cosseno via pgvector;
- índice ANN: HNSW com `m = 16`, `ef_construction = 64` e `hnsw.ef_search = 80` nas consultas;
- similaridade mínima da busca global: `0.46`;
- similaridade mínima da cobertura: `0.50`;
- fusão lexical + vetorial: Reciprocal Rank Fusion (RRF), sem somar diretamente rank FTS e cosine;
- consentimento semântico: versão `1`.

Os valores compartilhados ficam em `supabase/functions/_shared/semantic-config.ts`. Trocar modelo ou dimensionalidade exige migração e reindexação deliberadas; não existe override de `SEMANTIC_EMBEDDING_MODEL` em runtime.

## Arquitetura compartilhada

Busca global, cobertura de tópicos e backfill usam a mesma infraestrutura:

- `_shared/semantic-config.ts` — contrato canônico;
- `_shared/semantic-chunks.ts` — chunking determinístico;
- `_shared/semantic-indexer.ts` — indexação de páginas;
- `_shared/semantic-query-cache.ts` — cache e batching de embeddings de consulta;
- `_shared/semantic-ranking.ts` — RRF;
- `_shared/semantic-provider-telemetry.ts` — uso/latência do Gemini;
- `_shared/semantic-retrieval-telemetry.ts` — métricas de recuperação;
- `semantic-search` — busca híbrida;
- `semantic-coverage` — cobertura híbrida e verificação opcional;
- `semantic-index` — backfill explícito e retomável.

Essa arquitetura evita que cobertura e busca mantenham modelos, dimensões ou indexadores diferentes.

## Chunking e invalidação

O texto efetivo da página é normalizado e dividido de forma determinística:

- até 1.800 caracteres por chunk;
- overlap aproximado de 220 caracteres;
- preferência por parágrafo/pontuação e depois espaço;
- até 16 chunks por página;
- texto enviado pelo RPC de fila limitado a 24.000 caracteres.

Cada conjunto de chunks guarda `source_hash`, SHA-256 do `page_effective_text` completo. Uma busca só aceita vetores cujo modelo e hash ainda correspondam ao conteúdo atual. Qualquer alteração por OCR, importação ou edição invalida imediatamente os vetores antigos para recuperação.

`replace_page_semantic_chunks` substitui o conjunto de uma página atomicamente. A versão de produção também remove variantes antigas daquela página, porque não existe necessidade de preservar índices de modelos nunca deployados.

## Indexação e backfill

### Oportunista

`semantic-search` e `semantic-coverage` podem indexar um pequeno lote antes da recuperação. O padrão é 8 páginas, com concorrência limitada para reduzir rajadas de quota.

### Backfill explícito

`semantic-index` executa lotes retomáveis para preencher o índice sem depender de ações do usuário. A função recebe opcionalmente:

- `notebookId`;
- `batchSize` (1–24);
- `maxBatches` (1–32);
- `concurrency` (1–4).

Cada execução tem timeout, informa progresso e pode encerrar por:

- `complete`;
- `batch_limit`;
- `rate_limited`;
- `no_progress`;
- `timeout`;
- `provider_error`.

### Quarentena de páginas problemáticas

`semantic_index_failures` guarda apenas metadados operacionais: usuário, página, modelo, contador, código seguro e `retry_after`. **Nenhum texto, prompt, embedding ou mensagem de erro do provedor é persistido.**

Falhas recebem backoff exponencial, limitado a 24 horas. Enquanto `retry_after` estiver no futuro, a página não domina a cabeça da fila. Uma indexação bem-sucedida remove automaticamente a quarentena da página. O backfill encerra um lote que não indexou página alguma em vez de consumir repetidamente o orçamento do provedor.

## Cache de embeddings de consulta

`semantic_query_embedding_cache` evita regenerar embeddings para consultas repetidas.

Privacidade:

- a consulta normalizada nunca é persistida;
- a chave é SHA-256 de `modelo + consulta normalizada`;
- o vetor fica em tabela privada, sem leitura direta por `authenticated`;
- TTL padrão de 7 dias;
- entradas expiradas ou inativas são podadas.

Na cobertura, misses de vários tópicos são deduplicados e enviados ao Gemini em **um batch**, mantendo o benefício do cache sem criar uma chamada por tópico.

## Recuperação híbrida

### Busca global

`semantic-search` executa a recuperação lexical e vetorial e funde os resultados por página.

### Cobertura de tópicos

`semantic-coverage` executa, para cada tópico:

1. `search_pages`;
2. `search_pages_semantic`;
3. deduplicação por página;
4. RRF;
5. verificação opcional de poucos candidatos pelo Gemini.

A cobertura não possui mais implementação própria de embeddings/indexação; usa os mesmos helpers da busca global.

## Reciprocal Rank Fusion

Arquivo: `_shared/semantic-ranking.ts`.

Parâmetros iniciais:

- `k = 28`;
- peso lexical `0.48`;
- peso vetorial `0.52`;
- bônus quando os dois canais encontram a mesma página `0.012`;
- similaridade cosseno serve apenas como pequeno desempate.

O objetivo é evitar combinar diretamente escalas incompatíveis, como rank de FTS/trigram e cosine. Os parâmetros são travados por benchmark determinístico em `tests/unit/coverage/semantic-production-ranking.test.ts`.

A classificação final de cobertura continua em `src/lib/coverage/semantic-coverage.ts`, com limiares conservadores:

- `Coberto`: `>= 0.78`;
- `Parcial`: `>= 0.42`;
- abaixo disso: `Não encontrado`.

`partial` do verificador não pode virar `Coberto`; `none` de alta confiança reduz o score. A força 0–100 é um sinal operacional, não probabilidade estatística.

## Verificador Gemini

`_shared/gemini-coverage-verifier.ts` recebe apenas um conjunto pequeno dos melhores trechos:

- até dois candidatos por tópico;
- até 24 candidatos no lote;
- structured output estritamente validado;
- classificações `strong`, `partial` ou `none`;
- teto de 2.048 tokens de saída;
- tamanho de resposta limitado antes do parse.

Trechos recuperados são tratados como **dados não confiáveis, nunca instruções**. Falha do verificador não invalida busca nem embeddings.

## Telemetria

### Provedor

`semantic_provider_usage_events` registra metadados de chamadas de embedding:

- operação;
- superfície;
- modelo;
- contagem e tamanho das entradas;
- dimensões;
- latência;
- status/código seguro.

Não registra conteúdo, prompts ou vetores.

### Recuperação

`semantic_retrieval_events` registra:

- superfície (`global_search`, `topic_coverage`, `indexer`);
- modo;
- quantidade de resultados lexicais, semânticos e híbridos;
- cobertura do índice;
- latência;
- cache hit agregado;
- razão segura de fallback.

A tabela é privada. `semantic_retrieval_stats` é um RPC `SECURITY DEFINER` com autenticação/allowlist explícitas e retorna somente agregados do próprio usuário.

## Banco e migrações

Migrações relevantes:

- `202608101410_semantic_coverage.sql` — chunks e RPCs base;
- `202608101411_semantic_coverage_consent.sql`;
- `202608101412_semantic_coverage_hardening.sql`;
- `202608101413_semantic_coverage_consent_hardening.sql`;
- `202608101414_semantic_coverage_vector_index.sql` — HNSW;
- `202608101444_semantic_provider_telemetry.sql`;
- `202608102000_semantic_production_ready.sql` — cache, telemetria de recuperação, limpeza canônica e `ef_search`;
- `202608102001_semantic_index_retry_hardening.sql` — quarentena/backoff e fronteira segura dos agregados.

Tabelas operacionais privadas não concedem leitura direta a `authenticated`.

## Consentimento e fallback

OCR e semântica têm consentimentos separados. A opção semântica começa desativada na cobertura porque embeddings de documentos podem enviar trechos já armazenados ao Gemini.

Fallbacks esperados:

- sem consentimento → lexical;
- sem chave/configuração → lexical;
- quota/rate limit → lexical;
- Gemini indisponível → lexical;
- RPC vetorial indisponível → lexical;
- verificador indisponível → híbrido sem verificação;
- índice incompleto → híbrido sobre a parte indexada + lexical sobre todo o corpus.

A chave `GEMINI_API_KEY` permanece somente nas Edge Functions.

## Configuração

Obrigatórias para a camada semântica:

- `SUPABASE_URL`;
- `SUPABASE_ANON_KEY`;
- `GEMINI_API_KEY`;
- `APP_ORIGIN`.

Opcionais:

- `COVERAGE_VERIFY_MODEL` — modelo do verificador;
- `OCR_MODEL_PRIMARY` — fallback do verificador;
- `SEMANTIC_INDEX_BATCH_PAGES` — lote oportunista, padrão 8;
- `SEMANTIC_COVERAGE_TIMEOUT_MS` — padrão 55 s.

`semantic-search`, `semantic-coverage` e `semantic-index` exigem JWT no `supabase/config.toml`.

## Gates para deploy

Antes do primeiro deploy, o SHA candidato deve passar sem mascarar erro:

- Prettier/format;
- ESLint;
- TypeScript/Svelte check;
- testes unitários, incluindo benchmark RRF e contratos semânticos;
- build;
- checks offline de segurança do provedor;
- `deno check` das Edge Functions;
- Playwright;
- migrations + pgTAP local, incluindo `semantic_production_contracts.sql`.

O checkout de validação final é feito no `Offline-Toolchains` contra o SHA exato da feature.

## Critérios de produção

A frente semântica só é considerada pronta quando:

1. busca e cobertura compartilham modelo, cache, indexador e ranking;
2. backfill é retomável e páginas problemáticas não bloqueiam a fila;
3. nenhuma telemetria persiste conteúdo do usuário;
4. fallback lexical funciona sem Gemini;
5. migrations novas passam em banco limpo;
6. todos os gates do SHA final estão verdes.
