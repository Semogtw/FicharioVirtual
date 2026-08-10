# Checkpoint — telemetria OCR orientada por quota

**Data:** 2026-08-10  
**Branch:** `main`  
**Estado:** migration e bundle de telemetria implantados em `fichario-staging`; primeiro evento Gemini real ainda pendente

## Objetivo

Criar dados reais para decidir onde a capacidade gratuita do Gemini agrega mais qualidade e onde o OCR local pode absorver volume sem depender de estimativas ou de uma política FIFO.

## Implementado

- captura sanitizada de `usageMetadata` do Gemini;
- contagem oficial por request de prompt/cache/output/tool/thinking/total tokens;
- detalhes de tokens por modalidade;
- `modelVersion`, `responseId` e `serviceTier` sanitizados;
- latência da chamada ao provedor;
- eventos de sucesso e falha, inclusive quota/rate-limit com código seguro;
- métricas por página sem texto OCR/imagem/prompt;
- classificação visual na mesma resposta Gemini, sem request adicional:
  - `unknown`;
  - `book_clean`;
  - `scan_degraded`;
  - `handwriting`;
  - `mixed`;
  - `table_layout`;
  - `math`;
  - `sparse`;
- parser compatível com respostas anteriores sem `contentClass`, que viram `unknown`;
- RLS forçada e RPC de escrita com validação de ownership/documento/lote/páginas;
- agregação de 1 a 365 dias por requests, páginas, bytes, tokens, tipo de documento, classe visual e dia;
- escrita de telemetria best-effort, isolada do sucesso/falha do OCR;
- versão independente `contentClassificationVersion=1` dentro dos detalhes sanitizados de uso;
- testes unitários do parser, sanitização e payload de telemetria;
- teste estático do contrato da migration;
- plano documentado para shadow evaluation, correction delta e roteamento adaptativo posterior.

## Privacidade

As tabelas de telemetria não recebem:

- texto OCR;
- prompt;
- imagem/PDF/base64;
- URL assinada;
- path privado;
- API key/token;
- corpo bruto de erro do provedor;
- texto corrigido pelo usuário.

Tokens oficiais permanecem no nível do request. Não foi criada atribuição falsa de tokens exatos por página.

## Proveniência

`OCR_PROMPT_VERSION` continua representando a versão do fluxo de transcrição já propagada pelos jobs/importações. A classificação de telemetria é versionada separadamente como:

```text
contentClassificationVersion=1
```

Isso evita alterar apenas a Edge Function e criar divergência entre a versão persistida no job e a versão lida no runtime. Se o prompt de **transcrição** mudar de forma material, `OCR_PROMPT_VERSION` deve ser incrementado de forma coordenada em todos os produtores/ambientes.

## Validação de staging já executada

Projeto conectado: `fichario-staging`.

- migration `ocr_provider_telemetry`: aplicada com sucesso;
- `ocr_provider_usage_events`: `RLS=true`, `FORCE RLS=true`;
- `ocr_provider_page_metrics`: `RLS=true`, `FORCE RLS=true`;
- políticas expostas ao papel `authenticated`: somente `SELECT` owner-scoped;
- `record_ocr_provider_usage`: `SECURITY DEFINER` intencional, com validação interna de `auth.uid`, allowlist, documento, lote e páginas;
- `get_ocr_telemetry_overview`: `SECURITY INVOKER`;
- Supabase Advisor não apontou falta de RLS/policy nas novas tabelas;
- Advisor sinaliza o writer `SECURITY DEFINER` executável por `authenticated`; o aviso é conhecido e intencional nesta arquitetura, pois o `process-ocr` opera com JWT do usuário e o writer valida ownership antes de inserir;
- `process-ocr` foi implantada como versão `21`, `ACTIVE`, com `verify_jwt=true`, contendo captura de `usageMetadata`, classificação de página e writer best-effort;
- logo após o deploy havia `0` eventos e `0` page metrics: o banco está limpo para a primeira amostra real.

### Concorrência observada durante o deploy

A `main` avançou em paralelo depois do checkpoint com uma extensão backward-compatible de `ocr-batch-contract.ts` para geometria de palavras. A comparação mostrou que `process-ocr`, `gemini-ocr-client` e o helper de telemetria não foram alterados por esses commits concorrentes.

Consequência:

- a versão 21 valida e executa a **fundação de telemetria** deste checkpoint;
- ela não deve ser descrita como snapshot completo do HEAD posterior, porque o parser do HEAD passou a aceitar também geometria de palavras;
- essa diferença não bloqueia tokens/classificação atuais, pois o contrato Gemini implantado não solicita geometria e o parser anterior permanece válido para a resposta atual.

## O que ainda não foi ativado

- roteamento automático por score;
- reserva percentual de quota;
- classificação local antes da rota;
- shadow Gemini + OCR local;
- correction delta por edição humana;
- decisão automática entre modelo local pequeno e modelo local de alta qualidade.

Esses itens dependem dos dados desta fundação e não devem ser ativados com amostra zero.

## Gates

```text
migration aplicada em fichario-staging: PASS
RLS + FORCE RLS no catálogo de staging: PASS
políticas SELECT owner-scoped presentes: PASS
bundle de telemetria process-ocr implantado (v21): PASS
process-ocr exatamente igual ao HEAD posterior inteiro: N/A — HEAD avançou com geometria concorrente
unit/DB gates no HEAD: PENDING
smoke Gemini real com usageMetadata: PENDING
contentClass real retornado/persistido: PENDING
RLS owner isolation com sessão real: PENDING
overview com evento real: PENDING
quota/rate-limit persistido sem conteúdo privado: PENDING
```

## Próxima decisão

Depois de uma amostra útil, comparar por classe:

- páginas/request;
- tokens/request e tokens/100 páginas;
- latência;
- `needsReview`;
- taxa de splits/retries;
- correction delta quando disponível;
- ganho do Gemini contra o OCR local em shadow samples.

Somente então promover uma política do tipo `ganho esperado de qualidade / custo esperado de capacidade` para produção.
