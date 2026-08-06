# Implementação de OCR por cota real e PDFs grandes

**Data:** 6 de agosto de 2026  
**Branch:** `main`  
**Estado:** implementação de código concluída; validação completa do SHA atual ainda pendente em CI e staging

## Escopo implementado

O fluxo ativo de OCR deixou de depender de uma franquia diária criada pelo Fichário. A assinatura antiga de `claim_ocr_job`, que recebia um limite diário, é removida por migration. A nova assinatura aceita apenas página, modelo e horário da reivindicação. Contadores locais continuam existindo como telemetria e não podem impedir uma chamada que o provedor ainda aceitaria.

O processamento de PDFs visualmente reconhecidos agora usa lotes adaptativos de páginas renderizadas. O original permanece intacto no Google Drive. Texto nativo continua sendo extraído localmente e somente páginas sem texto suficiente recebem artefatos temporários de OCR.

## Banco de dados

As migrations novas são:

```text
202608060014_provider_only_ocr_batches.sql
202608060015_ocr_batch_usage_and_hardening.sql
202608060016_harden_ocr_batch_transitions.sql
```

Elas adicionam:

- `ocr_batches` com páginas, números originais, rota, bytes, profundidade de divisão, modelo, tentativas e chamadas;
- `batch_id` e `batch_ordinal` em `ocr_jobs`;
- métricas `ocr_batches`, `ocr_calls` e `ocr_attempts` em `usage_daily`;
- RLS para manifestos;
- criação e alteração de lotes apenas por RPCs validados;
- transições terminais idempotentes;
- remoção da assinatura antiga de claim com quarto argumento diário;
- manutenção de `blocked_quota` somente para bloqueio real do provedor.

Os testes pgTAP provam que um contador informativo de `999999` páginas não bloqueia uma nova reivindicação e que outro usuário não consegue ler ou finalizar o lote.

## Planejamento e execução

O planejador puro em `src/lib/ocr/batch-planner.ts`:

- ordena por número original;
- rejeita IDs ou números duplicados;
- separa rotas incompatíveis;
- inicia normalmente com até 40 páginas;
- usa até 20 páginas para conteúdo denso;
- respeita bytes derivados acumulados;
- oferece bisseção determinística;
- valida omissão, duplicação e resultados inesperados.

O executor em `src/lib/pdf/ocr-batching.ts`:

- executa lotes em série;
- persiste páginas aceitas antes de repetir o restante;
- divide somente `splitRequiredPageIds`;
- nunca reenvia páginas já concluídas;
- limita tentativas de divisão;
- deixa uma página isolada pendente em vez de entrar em loop;
- preserva páginas não iniciadas quando há cancelamento.

A retomada de um documento usa o mesmo executor, portanto a lógica continua válida depois de reload ou fechamento do aplicativo.

## Contrato Gemini

O cliente em lote envia várias imagens na mesma chamada, cada uma precedida por:

- `pageId` estável;
- número original da página.

A resposta exigida contém um item por página com:

- `pageId`;
- `pageNumber`;
- texto;
- avisos conservadores.

Páginas omitidas, duplicadas, inesperadas, com número divergente ou JSON truncado não são aceitas silenciosamente. Resultados válidos são mantidos, e a parte afetada volta para divisão. O cliente unitário anterior continua disponível para compatibilidade.

## Edge Function

`process-ocr` aceita:

```json
{ "pageId": "<uuid>" }
```

ou:

```json
{ "pageIds": ["<uuid>", "<uuid>"] }
```

Também aceita `batchId` quando o chamador possui manifesto persistido.

Controles técnicos padrão:

```text
OCR_BATCH_MAX_PAGES=40
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

Eles limitam memória, tamanho e duração, não uso diário.

A função:

- valida que todas as páginas pertencem ao mesmo documento;
- reivindica cada trabalho;
- ignora páginas já concluídas;
- baixa derivados sequencialmente;
- envia o maior prefixo seguro;
- registra manifesto e chamada antes da inferência;
- persiste resultados por página;
- solicita divisão para omissão, duplicação ou truncamento;
- limpa somente derivados de páginas concluídas;
- diferencia rate limit temporário de quota diária real.

## PDFs grandes

O teto fixo de 20 MB saiu da validação local. PDFs locais maiores seguem pelo upload retomável do Drive.

Páginas que precisam de OCR são renderizadas inicialmente em WebP. Quando uma derivação supera 12 MiB, somente aquela página recebe uma segunda renderização conservadora com dimensão e qualidade menores. O PDF original nunca é recomprimido ou substituído.

O caminho de download direto do Google Picker aceita até 50 MiB e verifica o tamanho antes de baixar. Esse é um limite técnico do navegador, não do documento lógico. A importação por referência ou cópia de arquivos externos maiores que 50 MiB continua dependente do restante do fluxo Drive-first.

## Telemetria e interface

A tela de uso mostra:

- páginas;
- lotes;
- chamadas;
- tentativas;
- tamanho médio de lote;
- bloqueios reais de quota do provedor;
- estados pendentes, revisão e falha.

Não existe indicador de “páginas restantes” baseado em contador local.

As telas de importação local e Drive foram atualizadas para distinguir:

- tamanho do documento lógico;
- limite técnico de download ou armazenamento transitório;
- limite do lote de OCR.

## Testes adicionados ou atualizados

- planejador e bisseção;
- parser estrito do lote;
- cliente Gemini multi-imagem;
- cliente browser do lote;
- importação de PDF de 21 MiB;
- agrupamento de 45 páginas em 40 + 5;
- rerenderização de página temporária grande;
- cancelamento;
- retomada em lote;
- truncamento e página isolada;
- Picker com limite direto de 50 MiB;
- claim sem quota interna;
- concorrência;
- idempotência;
- RLS e transições de lote;
- gate estático contra regressão de `OCR_DAILY_HARD_LIMIT`.

## Limites honestos desta entrega

Ainda não estão validados no ambiente externo:

- execução de todos os gates no mesmo SHA atual;
- migrations e pgTAP em banco limpo depois das últimas alterações;
- chamada real Gemini com lote multipágina;
- fixtures reais acima de 50 MB e 1.000 páginas;
- comportamento em tablet com PDF muito grande;
- importação de arquivo externo do Picker acima de 50 MiB sem download integral;
- worker desktop e modelo local, que pertencem a outra etapa aprovada.

A release continua bloqueada até `docs/OCR_STAGING.md` e `docs/DEPLOYMENT.md` receberem evidências do mesmo SHA.
