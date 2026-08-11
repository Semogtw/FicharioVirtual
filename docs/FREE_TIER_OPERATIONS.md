# Operação 100% gratuita

Este documento registra os guardrails usados para manter o Fichário sem cobrança automática. Limites externos mudam; o runtime deve tratar a resposta real do provedor como autoridade e preservar o trabalho quando uma quota fica indisponível.

## Política

- não habilitar billing para aumentar quota de OCR;
- não trocar automaticamente para API ou tier pago;
- manter originais permanentes no Google Drive;
- usar Supabase para Auth, PostgreSQL, RLS, fila, telemetria e derivados temporários;
- hospedar no Cloudflare Pages somente frontend/artefatos públicos;
- preservar páginas concluídas e pendentes diante de rate limit, quota, timeout ou interrupção;
- não impor uma franquia diária artificial abaixo da quota do provedor;
- limitar RPM no backend distribuído para evitar desperdiçar requests com `429` evitável.

## Gemini OCR

Configuração esperada:

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

O 3.1 Flash-Lite é o caminho principal. O 3.5 Flash-Lite é reserva de capacidade e só entra quando a chamada primária chega ao provedor e recebe limitação compatível com fallback. Fila local/RPM interno não deve consumir o fallback.

O limiter é global no Supabase, por modelo. O alvo de 12 RPM mantém margem abaixo do limite nominal observado da conta e impede que abas/instâncias independentes multipliquem a concorrência.

## Economia de requests

Antes de chamar Gemini:

- PDF com texto nativo usa a extração local;
- PDF misto envia somente páginas realmente visuais;
- páginas renderizadas são agrupadas;
- páginas válidas de uma resposta parcial são persistidas imediatamente;
- somente o subconjunto omitido/duplicado/truncado é dividido e repetido.

O planner atual limita cada lote por quatro dimensões:

```text
páginas normais: até 28
lote com página densa: até 14
imagens derivadas: até 12 MiB
saída estimada: até 48.000 tokens
```

A estimativa inicial reserva aproximadamente 900 tokens para página esparsa, 1.700 para normal e 3.000 para densa. O teto de 48 mil é deliberadamente inferior aos 65.536 tokens máximos de saída usados na chamada para absorver erro de classificação e páginas excepcionalmente densas.

Exemplo: 45 páginas normais pequenas são planejadas como `28 + 17`, isto é, duas chamadas em vez de 45. Um documento pode gerar lotes menores por bytes ou densidade.

## Geometria espacial sem desperdiçar tokens

O Gemini não devolve mais uma string `coordenadas|palavra` para cada termo. Em lote ele devolve apenas uma caixa compacta por linha não vazia, em `0..1000`, sem repetir o texto da linha.

O backend usa a própria transcrição para derivar localmente caixas por palavra em `0..10000`, que continuam atendendo ao overlay e ao fuzzy search. Isso remove a maior redundância do payload de saída.

Se a geometria estiver malformada mas a transcrição estiver íntegra, o texto é aceito e a geometria é descartada. Não se gasta uma nova chamada apenas para recuperar um overlay.

## Tokens e pensamento

As chamadas batch reservam até 65.536 tokens de saída e usam `thinkingLevel=minimal`. OCR literal não precisa do orçamento de raciocínio de tarefas analíticas complexas; a prioridade aqui é fidelidade, throughput e espaço para a transcrição.

A telemetria registra, quando fornecido pelo Gemini:

- tokens de entrada;
- tokens de saída;
- tokens de pensamento;
- total de tokens;
- páginas e bytes por chamada;
- modelo efetivamente usado;
- latência, status e fallback;
- classe de conteúdo e avisos por página.

Ela nunca deve persistir prompt, texto OCR, bytes de imagem, chave ou corpo bruto de erro do provedor.

## Retomada e páginas grandes

O original nunca é recomprimido. Somente derivados temporários podem receber uma segunda renderização conservadora quando excedem o limite técnico.

Quando o tamanho real de uma página não está disponível durante retomada, o planner usa uma estimativa conservadora de 1 MiB e trata a página normal como densa. Isso evita montar um lote enorme a partir do antigo sentinela de um byte.

Se os blobs reais excederem o limite agregado no backend, o maior prefixo seguro é processado e o restante volta como `splitRequiredPageIds`. Páginas já concluídas não são reenviadas.

## Estados operacionais

- `retryable`: falha temporária, timeout ou rate limit recuperável;
- `blocked_quota`: quota real indisponível;
- `needs_review`: transcrição que exige conferência;
- `failed`: erro permanente de arquivo/configuração/segurança;
- pendente: trabalho ainda não executado ou devolvido à fila.

Nenhum estado ativa billing.

## Storage e privacidade

### Google Drive

Mantém o original permanente. O app usa `drive.file`; falta de espaço ou indisponibilidade pausa o fluxo sem comprar armazenamento automaticamente.

### Supabase

Mantém metadados, resultados, fila, telemetria e derivados privados temporários. RLS e RPCs controlam as transições. Service-role e `GEMINI_API_KEY` nunca chegam ao frontend.

### Cloudflare Pages

Hospeda somente o frontend estático. Documentos, OCR, sessões e tokens não devem ser enviados ao host público.

## Gates mínimos

Antes de promover mudanças de OCR, no mesmo SHA:

```text
pnpm verify
pnpm test:source:offline
pnpm test:functions:check
pnpm test:db:local
pnpm test:e2e
```

Além disso, staging precisa provar:

- OCR real com imagem sintética;
- PDF textual com zero chamadas Gemini;
- lote multipágina com menos chamadas que páginas;
- limites de página/bytes/output;
- omissão e truncamento sem perda de páginas;
- cancelamento e retomada sem repetir páginas concluídas;
- rate limiter distribuído e fallback 3.1 -> 3.5;
- ausência de cobrança/fallback pago.

Consulte também `docs/OCR_STAGING.md`, `docs/OCR_WORD_GEOMETRY.md` e `docs/DEPLOYMENT.md`.
