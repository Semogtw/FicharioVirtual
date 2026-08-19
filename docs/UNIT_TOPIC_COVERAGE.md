# Cobertura de assuntos por unidade

A rota `/coverage/` compara uma ementa, unidade ou disciplina com o material pesquisável do Fichário Virtual. O usuário pode digitar os assuntos ou extrair uma lista de uma foto, revisar cada item em campos independentes e então receber `Coberto`, `Parcial` ou `Não encontrado`, sempre com evidências navegáveis.

A feature possui duas camadas:

1. **textual/fuzzy**, sempre disponível quando a busca normal está disponível;
2. **semântica híbrida**, opcional e consentida, que reutiliza a infraestrutura semântica compartilhada do produto.

A arquitetura de embeddings, índice, cache, backfill, RRF e telemetria está em [`SEMANTIC_COVERAGE.md`](SEMANTIC_COVERAGE.md).

## Objetivo

A tela responde: **“o que desta ementa já aparece de forma relevante no meu fichário?”**

Ela não afirma domínio pedagógico absoluto. `Coberto` significa que o sistema encontrou evidência suficientemente forte segundo os sinais disponíveis; a página original continua sendo a fonte verificável.

## Fluxo do usuário

1. Informar opcionalmente o nome da unidade.
2. Escolher todo o fichário ou um caderno.
3. Adicionar conteúdos manualmente e/ou por foto.
4. Revisar os campos individuais extraídos.
5. Editar, excluir, reordenar e ajustar hierarquia.
6. Opcionalmente ativar **Usar relação semântica com Gemini**.
7. Registrar o consentimento específico quando necessário.
8. Executar **Verificar cobertura**.
9. Consultar percentual, estado e evidências.
10. Abrir a página-fonte para inspeção.

A UX aceita atualmente os resultados em cartões após a análise; os campos editáveis de tópicos não recebem status inline.

## Editor estruturado

Cada assunto vira um `EditableTopic` com:

- identificador local;
- texto editável;
- origem `manual` ou `ocr`;
- confiança heurística de extração;
- sinal de revisão;
- nível hierárquico relativo.

O texto bruto não é a fonte canônica da análise. O usuário pode editar, remover, mover e promover/rebaixar cada campo antes de verificar cobertura.

Duplicatas usam a mesma normalização sem acentos/caixa do domínio de cobertura. O limite público é `MAX_UNIT_TOPICS`.

## Entrada manual

O usuário pode colar uma lista e usar **Transformar em campos**. O parser remove de forma conservadora marcadores comuns, incluindo numeração hierárquica, letras, romanos, bullets e caixas de seleção. Também existe **Adicionar campo vazio**.

## Foto da ementa

Arquivo principal: `src/lib/services/coverage-photo-import.ts`.

O fluxo reutiliza o pipeline real de OCR:

1. registra consentimento de OCR;
2. prepara a imagem;
3. cria/reutiliza documento de importação;
4. executa OCR;
5. lê o texto efetivo;
6. segmenta os assuntos;
7. remove o documento temporário quando ele pertence ao fluxo.

Formatos aceitos: JPEG, PNG e WebP. Em dispositivos compatíveis, a câmera usa `capture="environment"`.

A segmentação em `src/lib/coverage/topic-import.ts` é determinística e trata numeração, continuação de linha, títulos genéricos, hierarquia, deduplicação e sinais de OCR suspeito. `alta`, `média` e `baixa` são indicadores de revisão, não probabilidades.

## Análise textual/fuzzy

`src/lib/services/topic-coverage.ts` reutiliza `searchPages`/`search_pages`. O ranking normal combina full-text, substring e fuzzy/trigram conforme o contrato da busca global.

Classificação lexical em `src/lib/coverage/topic-coverage.ts`:

- `Coberto`: rank `>= 0.85`;
- `Parcial`: rank `>= 0.40` e abaixo de coberto;
- `Não encontrado`: abaixo de `0.40`.

Percentual ponderado:

- coberto = 1;
- parcial = 0,5;
- não encontrado = 0.

## Análise semântica híbrida

A opção semântica começa desligada porque embeddings de documento podem enviar trechos já armazenados ao Gemini. O consentimento é separado do consentimento de OCR.

`semantic-coverage` usa a mesma pilha de produção da busca global:

- modelo canônico `gemini-embedding-2`;
- 768 dimensões;
- `page_semantic_chunks`;
- invalidação por hash do texto efetivo;
- indexador compartilhado;
- cache compartilhado de embeddings de consulta;
- batching dos misses de tópicos;
- `search_pages_semantic`;
- Reciprocal Rank Fusion;
- telemetria sem conteúdo;
- verificador Gemini opcional.

Não existe mais um segundo indexador exclusivo da cobertura.

### Classificação híbrida

`src/lib/coverage/semantic-coverage.ts` mantém a decisão final conservadora:

- `Coberto`: score `>= 0.78`;
- `Parcial`: score `>= 0.42`;
- `Não encontrado`: abaixo disso.

Um veredito `partial` não pode virar `Coberto`; `none` de alta confiança reduz falsos positivos. A força 0–100 é um sinal operacional.

### Fallback obrigatório

A semântica nunca é ponto único de falha:

- sem consentimento → lexical;
- sem chave/configuração → lexical;
- quota/rate limit → lexical;
- provedor indisponível → lexical;
- RPC vetorial indisponível → lexical;
- verificador indisponível → híbrido sem verificação;
- Edge Function indisponível → o browser volta a `searchPages`.

Enquanto o índice está incompleto, a busca textual continua cobrindo o corpus inteiro.

## Índice e backfill

Além da indexação oportunista nas consultas, existe `semantic-index` para backfill explícito e retomável.

O backfill:

- processa lotes limitados;
- usa concorrência limitada;
- é idempotente por modelo + hash;
- remove variantes obsoletas;
- aplica backoff a páginas que falham;
- para quando um lote não faz progresso;
- preserva fallback e não bloqueia a UI.

Páginas em retry são registradas em `semantic_index_failures` apenas com metadados operacionais, sem texto ou prompt.

## Evidências

Cada evidência preserva, quando disponível:

- documento e `documentId`;
- página e `pageId`;
- caderno;
- trecho relevante;
- força final.

A navegação usa `/documents/{documentId}/?page={pageNumber}&highlight={topic}`. Mesmo quando a recuperação foi semântica e não compartilha palavras com o tópico, o usuário chega à página-fonte.

## Componentes principais

### Domínio

- `src/lib/coverage/topic-coverage.ts` — contrato/classificação lexical;
- `src/lib/coverage/semantic-coverage.ts` — classificação híbrida e verificador;
- `src/lib/coverage/topic-import.ts` — segmentação da ementa.

### Serviços browser

- `src/lib/services/coverage-photo-import.ts` — foto/OCR;
- `src/lib/services/semantic-coverage.ts` — consentimento, Edge Function e validação estrita;
- `src/lib/services/topic-coverage.ts` — orquestração e fallback.

### Edge/shared

- `supabase/functions/semantic-coverage/index.ts` — cobertura híbrida;
- `supabase/functions/semantic-search/index.ts` — busca híbrida global;
- `supabase/functions/semantic-index/index.ts` — backfill;
- `supabase/functions/_shared/semantic-indexer.ts` — indexação comum;
- `supabase/functions/_shared/semantic-query-cache.ts` — cache/batching;
- `supabase/functions/_shared/semantic-ranking.ts` — RRF.

### UI

`src/routes/coverage/+page.svelte` cuida de entrada, revisão, consentimentos, filtro, progresso e cartões de resultado.

## Testes

Principais suites:

- `topic-coverage.test.ts` — contrato lexical;
- `topic-import.test.ts` — parsing/hierarquia;
- `photo-topic-import.test.ts` — lifecycle OCR;
- `semantic-coverage.test.ts` — classificação híbrida;
- `semantic-service.test.ts` — contrato Edge → browser;
- `semantic-chunks.test.ts` — chunking;
- `gemini-semantic-clients.test.ts` — contrato Gemini;
- `semantic-edge-contract.test.ts` — stack compartilhada/backoff/segurança;
- `semantic-production-ranking.test.ts` — benchmark determinístico de RRF;
- `supabase/tests/semantic_production_contracts.sql` — RLS/RPCs de produção.

O SHA candidato a deploy deve passar os gates completos descritos em [`SEMANTIC_COVERAGE.md`](SEMANTIC_COVERAGE.md).
