# Validação de OCR real em staging

O workflow `Verify OCR staging` executa uma leitura real contra as Edge Functions e o Gemini configurado no Supabase de staging. A prova usa uma conta autorizada e uma imagem sintética, sem expor a chave do provedor ao GitHub Actions.

## Configuração canônica

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY=gemini-3.1-flash-lite
OCR_MODEL_FALLBACK=gemini-3.5-flash-lite
OCR_PROMPT_VERSION=2
OCR_MODEL_PRIMARY_RPM=12
OCR_MODEL_FALLBACK_RPM=12
OCR_PROVIDER_MAX_QUEUE_WAIT_MS=20000
OCR_BATCH_MAX_PAGES=28
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

`OCR_DAILY_HARD_LIMIT` não pertence ao contrato. A capacidade diária é a quota real do provedor. O limiter distribuído controla apenas RPM e deixa margem abaixo do teto nominal.

## Contrato atual do Gemini

Uma chamada pode conter várias imagens. Cada página é identificada por `pageId` e `pageNumber` e retorna:

- transcrição literal;
- avisos conservadores;
- classe visual para telemetria;
- `lineGeometry`, uma caixa `left,top,right,bottom` em `0..1000` para cada linha não vazia da transcrição.

O Gemini não devolve mais texto repetido em uma caixa para cada palavra. O backend deriva as caixas por palavra localmente e mantém o overlay da busca. Geometria malformada não invalida uma transcrição válida.

As chamadas em lote reservam até 65.536 tokens de saída, mas o planner tenta ficar em até 48.000 tokens estimados para manter margem contra páginas mais densas do que a inspeção previu. O pensamento é configurado em `minimal`, apropriado ao trabalho de transcrição/extração de alto volume.

## Planejamento de lotes

O cliente considera simultaneamente páginas, densidade, bytes e saída estimada:

```text
normal: até 28 páginas
lote com página densa: até 14 páginas
imagens derivadas: até 12 MiB
saída estimada: até 48.000 tokens
```

Estimativas iniciais de saída por página:

```text
sparse: 900 tokens
normal: 1700 tokens
dense: 3000 tokens
```

Essas estimativas não são quota. Servem apenas para evitar uma chamada que provavelmente terminaria truncada e exigiria novos requests.

Durante retomada, páginas cujo tamanho derivado não está mais disponível são tratadas de forma conservadora como 1 MiB e densas. Assim o planner não monta um lote enorme usando o antigo sentinela de um byte como se fosse o tamanho real.

## Smoke de imagem

A prova deve:

1. autenticar a conta autorizada;
2. gerar em memória uma imagem sintética com texto conhecido;
3. criar documento, página e job pelo fluxo público atual;
4. invocar `process-ocr` em lote, mesmo quando há apenas uma página;
5. exigir estado terminal válido;
6. confirmar `extraction_source = 'ocr'` e presença dos tokens sintéticos;
7. confirmar tentativa/timestamp terminal e ausência de erro;
8. remover o documento pelo fluxo normal;
9. nunca imprimir transcript, chave, URL assinada ou conteúdo privado.

## Matriz multipágina

### PDF textual

Um PDF textual não deve chamar Gemini. O texto nativo é extraído localmente e o hash do original permanece inalterado.

### PDF misto

Somente páginas que realmente precisam de OCR entram nos lotes. Números originais devem ser preservados e um erro visual não pode invalidar texto nativo já persistido.

### PDF visual normal

Para 45 páginas normais pequenas, o planner atual deve iniciar normalmente **28 + 17**, portanto duas chamadas em vez de 45. O resultado continua persistido por página.

### Conteúdo denso

Tabelas, colunas, fórmulas e layouts complexos reduzem o teto para 14 páginas por lote. O limite de 48 mil tokens estimados pode reduzir ainda mais um lote antes do teto de páginas.

### Bytes agregados

Nenhuma chamada pode exceder 12 MiB de imagens derivadas. Se o backend descobrir que os blobs reais ultrapassam o planejamento, o maior prefixo seguro é processado e somente o restante volta como `splitRequiredPageIds`.

### Omissão, duplicação ou truncamento

Páginas válidas devem ser aceitas imediatamente. Somente páginas omitidas, duplicadas ou não parseáveis são divididas e reenviadas. Uma página isolada que continua inválida fica pendente em vez de entrar em loop.

### Cancelamento e retomada

Após cancelamento, páginas concluídas não podem ser refeitas. A retomada trabalha apenas nas pendentes e usa o planejamento conservador de tamanho desconhecido.

### Rate limit e quota

- fila local cheia: aguarda a reserva distribuída ou devolve o trabalho à fila;
- `429` real no 3.1 Flash-Lite: permite fallback para 3.5 Flash-Lite segundo a política de roteamento;
- limite temporário: usa retry/backoff;
- quota real esgotada: preserva páginas pendentes/bloqueadas sem ativar billing.

## Auditoria

Para cada prova, confira:

- ordem de `ocr_batches.page_ids` e `page_numbers`;
- `ocr_jobs.batch_id` e `batch_ordinal`;
- número de chamadas versus páginas;
- modelo efetivamente usado e fallback na telemetria;
- `prompt_token_count`, `candidates_token_count` e `total_token_count` quando fornecidos;
- tamanho médio de lote;
- páginas concluídas não reenviadas;
- `word_geometry` persistida apenas a partir da geometria validada/derivada;
- ausência de conteúdo OCR em logs e artifacts.

## Critério de aprovação

A implementação recebe `PASS` quando, no mesmo SHA:

- frontend, testes unitários, lint, build e E2E passam;
- Edge Functions passam em `deno check`;
- migrations e pgTAP passam em banco limpo;
- smoke real de OCR passa;
- PDF textual gera zero chamadas;
- PDF visual multipágina usa menos chamadas do que páginas;
- lotes respeitam os budgets de página, bytes e saída;
- omissão/truncamento não perde páginas nem repete as já aceitas;
- cancelamento/retomada preservam progresso;
- limiter respeita RPM e fallback só ocorre após limitação real do provedor;
- nenhum caminho ativa billing.
