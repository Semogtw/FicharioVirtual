# Implementação de embedding visual adaptativo

Atualizado em **2026-08-14**.

## Estado atual

**Implementado no código e validado em modo `shadow`.**

O Fichário agora possui um canal semântico visual por página, separado do índice textual. O canal visual usa `gemini-embedding-2` com os bytes da imagem preparada para OCR, é enfileirado **somente depois** de um resultado OCR durável e pode ser consultado pela mesma embedding textual da busca.

A configuração de produção permanece deliberadamente em `shadow`: candidatos visuais são medidos e registrados, mas **não mudam o ranking visível** até haver evidência real de staging suficiente para promover `SEMANTIC_VISUAL_MODE=active`.

Isso significa que a implementação está pronta; o que permanece pendente é o **rollout ativo**, não código faltante.

## Objetivo

Usar embedding visual somente quando ele tende a acrescentar informação que OCR/texto podem perder, preservando:

- OCR como caminho principal para busca lexical, transcrição e highlight;
- embedding textual como caminho semântico padrão;
- custo previsível e degradável;
- privacidade e isolamento por usuário;
- ausência de dependência do Gemini visual para concluir OCR;
- zero alteração de ranking enquanto o modo estiver em `shadow`.

## Arquitetura implementada

```text
upload/importação
  |
  +--> original preservado
  |
  +--> mídia preparada para OCR (JPEG/PNG suportado)
           |
           +--> OCR
           |     |
           |     +--> resultado OCR persistido
           |     |
           |     +--> roteador local visual-v1
           |             |
           |             +--> não elegível -> encerra
           |             |
           |             +--> elegível -> fila visual durável
           |                                 |
           |                                 +--> semantic-visual-worker
           |                                         |
           |                                         +--> hash SHA-256 dos pixels enviados
           |                                         +--> reuse/idempotência
           |                                         +--> gemini-embedding-2
           |                                         +--> page_visual_embeddings
           |                                         +--> telemetria + cleanup
           |
           +--> mídia temporária só é removida quando não houver job visual pendente

busca textual
  |
  +--> embedding da consulta
  +--> lexical
  +--> semantic textual
  +--> visual semantic
          |
          +--> shadow: mede overlap/latência, não muda ranking
          +--> active: terceiro canal no RRF
```

## 1. Roteamento adaptativo

Implementado em `supabase/functions/_shared/visual-embedding-routing.ts`.

O roteador é local, determinístico e versionado como `visual-v1`; ele **não faz uma chamada extra de IA** apenas para decidir se deve gerar embedding visual.

Critérios implementados:

| Sinal                                     | Decisão padrão         |
| ----------------------------------------- | ---------------------- |
| página com texto nativo suficiente        | não gerar              |
| `book_clean` com OCR suficiente           | não gerar              |
| `handwriting`                             | gerar                  |
| `scan_degraded`                           | gerar                  |
| `mixed`                                   | gerar                  |
| `table_layout`                            | gerar                  |
| `math`                                    | gerar                  |
| página `needs_review`/warnings relevantes | gerar                  |
| página `sparse` útil                      | gerar                  |
| página praticamente vazia                 | não gerar              |
| classe desconhecida sem sinal de risco    | conservador: não gerar |

O roteamento ocorre somente **depois** da persistência bem-sucedida do OCR nos três caminhos reais:

- `process-ocr`;
- `ocr-queue-worker`;
- `desktop-ocr-worker`.

Falha no enriquecimento visual nunca reverte um OCR `ready`/`needs_review` para falha.

## 2. Embedding de imagem

O cliente compartilhado `gemini-embedding-client.ts` aceita imagens para `gemini-embedding-2` com as seguintes guardas:

- somente `image/jpeg` e `image/png`;
- máximo de 6 imagens por requisição;
- limite por imagem e por lote;
- vetor normalizado com 768 dimensões, igual ao índice textual;
- erros HTTP, quota, transporte e resposta inválida tratados separadamente.

Para páginas de PDF, novos derivados preparados são JPEG. O original continua preservado e não é alterado pelo pipeline de embedding.

O hash SHA-256 é calculado sobre os bytes realmente enviados ao provedor. Se uma página já possui embedding do mesmo modelo e mesmo `source_hash`, o job é concluído por reuse sem nova chamada Gemini.

## 3. Persistência e fila

Migration principal:

- `supabase/migrations/20260814113500_adaptive_visual_embeddings.sql`

Dispatch/recovery:

- `supabase/migrations/20260814114500_visual_embedding_dispatch.sql`

Objetos principais:

- `page_visual_embeddings`: índice visual separado do textual, `vector(768)`, `source_hash`, modelo, versão e motivo de roteamento;
- `page_visual_embedding_jobs`: fila durável e idempotente por `(user_id, page_id, model)`;
- `semantic_visual_events`: telemetria operacional agregável;
- índice HNSW para cosine similarity;
- RLS forçado e leitura owner-only;
- escrita/claim restritos ao `service_role`.

Estados da fila:

- `queued`;
- `processing`;
- `retryable`;
- `blocked_quota`;
- `ready`;
- `failed`.

O claim usa `FOR UPDATE SKIP LOCKED`; jobs presos em `processing` por mais de 5 minutos são recuperáveis. Retry usa backoff e `429` entra como `blocked_quota` sem afetar OCR/busca textual.

Antes de persistir um vetor, a RPC confirma que a mídia usada ainda é a fonte atual da página. Fonte stale termina o job sem sobrescrever o vetor atual.

## 4. Worker visual

`supabase/functions/semantic-visual-worker/index.ts` reutiliza a autenticação interna do worker de background (`OCR_BACKGROUND_WORKER_KEY`).

O worker:

1. faz claim de até 6 jobs;
2. baixa a mídia do bucket privado;
3. valida MIME e tamanho;
4. calcula SHA-256;
5. tenta reuse por hash;
6. envia apenas jobs necessários ao `gemini-embedding-2`;
7. persiste resultado por RPC protegida;
8. registra telemetria best-effort;
9. remove mídia temporária apenas em estado terminal seguro.

Wakeup imediato é disparado por trigger com debounce global. Um cron de 5 minutos é o fallback para wakeups perdidos e tem prioridade inferior ao canal textual.

## 5. Busca visual e ranking

`semantic-search` usa a **mesma embedding textual da consulta** para:

- `search_pages_semantic`;
- `search_pages_visual_semantic`.

Não existe segunda chamada Gemini apenas para consultar o índice visual.

Configuração:

```text
SEMANTIC_VISUAL_MODE=off|shadow|active
```

Padrão atual: `shadow`.

### `off`

Nenhuma busca visual é executada.

### `shadow`

A busca visual é executada, overlap/latência/status são registrados, mas a resposta visível continua sendo o ranking lexical + textual semântico já existente.

### `active`

O canal visual entra como terceiro canal de RRF. O código de ranking já está implementado e possui fixtures determinísticas, mas a promoção para `active` depende de benchmark real de staging.

Resultados puramente visuais:

- retornam `excerpt: ''`;
- não inventam transcrição;
- não inventam highlight textual;
- abrem diretamente o documento na página encontrada;
- a UI exibe o motivo `Pela página`.

## 6. Telemetria

Eventos visuais registram apenas metadados operacionais necessários, como:

- operação (`index`, `search_shadow`, `search_visible`);
- modelo;
- quantidade de itens;
- overlap;
- bytes;
- duração;
- status;
- versão/motivo de roteamento.

Não são gravados pixels, texto OCR, query em claro ou vetor no log de eventos.

## 7. Benchmark e testes

Fixtures determinísticas:

- `tests/fixtures/search/visual-semantic-benchmark.json`;
- `tests/unit/search/visual-semantic-benchmark.test.ts`;
- `tests/unit/search/visual-semantic-ranking.test.ts`.

Comando dedicado:

```bash
pnpm benchmark:visual-semantic
```

As fixtures cobrem:

- consulta lexical forte;
- consulta conceitual;
- recuperação visual de manuscrito/tabela;
- caso negativo de ruído visual;
- todas as classes principais do roteador.

Essas fixtures verificam **contrato e segurança do ranking**, não qualidade real do provedor. Recall, custo e latência reais precisam ser medidos com corpus de staging antes do rollout ativo.

## 8. Evidência de validação

O commit de código `4b43bdaba3bbaf9c221e771161235a67beab2a5b` passou o `verify:full` privado no `Offline-Toolchains`, run **31801182442**, incluindo:

- Prettier/lint;
- `svelte-check`/TypeScript;
- 378 testes unitários;
- build de produção;
- testes E2E/Chromium;
- source/offline gates;
- `deno check` das Edge Functions;
- Supabase local e migrations/pgTAP.

## 9. Checklist de implementação

### Código e infraestrutura

- [x] roteador determinístico `visual-v1`;
- [x] Gemini Embedding 2 com imagem;
- [x] limites PNG/JPEG, bytes e lote <= 6;
- [x] índice visual separado com HNSW;
- [x] RLS forçado e owner-only read;
- [x] fila durável/idempotente;
- [x] reclaim de job preso;
- [x] retry/backoff/429 degradável;
- [x] SHA-256 sobre bytes enviados;
- [x] reuse por hash;
- [x] proteção contra fonte stale;
- [x] worker interno autenticado;
- [x] trigger de wakeup + cron de recuperação;
- [x] integração pós-OCR nos três caminhos;
- [x] cleanup seguro de mídia temporária;
- [x] shadow retrieval;
- [x] RRF de três canais pronto para `active`;
- [x] UI sem excerpt/highlight falso para resultado puramente visual;
- [x] telemetria sem conteúdo sensível;
- [x] benchmark offline determinístico;
- [x] `verify:full` completo verde.

### Rollout ativo — propositalmente pendente

- [ ] smoke real com ao menos um JPEG elegível;
- [ ] smoke real com ao menos um PNG elegível;
- [ ] corpus real de staging com lexical/conceitual/visual/negativo;
- [ ] comparar Recall@K/MRR/precision contra baseline de staging;
- [ ] medir latência e custo reais;
- [ ] confirmar billing/quota reais do projeto usado em staging;
- [ ] promover `SEMANTIC_VISUAL_MODE` de `shadow` para `active` somente se os resultados forem positivos.

## 10. Critério para promoção a `active`

A implementação **não deve** mudar pesos de produção ou ativar o terceiro canal automaticamente só porque o código está pronto.

Promover para `active` apenas quando o benchmark real mostrar que:

1. recuperação visual melhora casos onde OCR/texto perdem estrutura/conteúdo;
2. consultas lexicais fortes não pioram de forma material;
3. casos negativos não ganham falsos positivos relevantes;
4. custo/latência permanecem aceitáveis;
5. quota/429 continuam degradáveis e observáveis.

Até essa evidência existir, `shadow` é o estado correto e intencional de produção.
