# Checkpoint — telemetria OCR orientada por quota

**Data:** 2026-08-10  
**Branch:** `main`  
**Estado:** implementação em código concluída; migration/Edge Function/Gemini real ainda precisam de validação em staging

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

## Proveniência do prompt

Adicionar `contentClass` altera o contrato pedido ao Gemini e deve iniciar uma nova série de prompt.

**Requisito de rollout:** configurar `OCR_PROMPT_VERSION=2` no ambiente que receber esta versão antes de coletar dados de produção/staging destinados a comparação histórica.

O conector desta sessão não permitiu editar `.env.example` porque o arquivo contém nomes de secrets; portanto esse valor precisa ser alinhado por um ambiente/tooling autorizado no rollout. Não marcar a proveniência como validada enquanto o ambiente continuar declarando a versão anterior.

## O que ainda não foi ativado

- roteamento automático por score;
- reserva percentual de quota;
- classificação local antes da rota;
- shadow Gemini + OCR local;
- correction delta por edição humana;
- decisão automática entre modelo local pequeno e modelo local de alta qualidade.

Esses itens dependem dos dados desta fundação e não devem ser ativados com amostra zero.

## Gates pendentes

```text
migration aplicada em Supabase limpo/staging: PENDING
Edge Function type-check no HEAD: PENDING
unit/DB gates no HEAD: PENDING
OCR_PROMPT_VERSION=2 no ambiente de validação: PENDING
smoke Gemini real com usageMetadata: PENDING
contentClass real retornado/persistido: PENDING
RLS owner isolation em banco aplicado: PENDING
overview 30 dias consultável: PENDING
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
