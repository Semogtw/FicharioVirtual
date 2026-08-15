# Fallback OCR Azure — especificação e plano de implementação

**Status:** aprovado para implementação, ainda não ativo no runtime.  
**Ordem de roteamento alvo:** `Gemini 3.1 Flash-Lite -> Gemini 3.5 Flash-Lite -> Azure Vision Read -> fila persistente`.  
**Última revisão externa:** 15 de agosto de 2026.

Este documento define tudo que precisa mudar para acrescentar Azure como terceiro provedor de OCR sem alterar a prioridade dos dois modelos Gemini já usados pelo Fichário Virtual. A implementação deve preservar os contratos atuais de página, busca, geometria, fila, idempotência, telemetria, privacidade e operação sem cobrança.

## 1. Objetivo e não objetivos

### Objetivo

Adicionar um provedor independente da Google que seja usado somente quando os dois modelos Gemini não puderem concluir o OCR por uma condição elegível de capacidade/indisponibilidade. O Azure deve produzir o mesmo contrato interno consumido pelo restante do sistema, de modo que persistência, busca textual, highlight, embedding visual e UI não precisem saber qual provedor executou a leitura.

### Não objetivos da primeira versão

- substituir Gemini 3.1 Flash-Lite como principal;
- colocar Azure antes do Gemini 3.5 Flash-Lite;
- comparar providers em toda página por padrão;
- reprocessar com Azure uma página Gemini já concluída;
- ativar qualquer SKU pago automaticamente;
- migrar OCR para Azure Document Intelligence na primeira entrega;
- enviar o PDF original inteiro ao Azure quando a página renderizada já existe;
- expor chave ou endpoint Azure ao frontend;
- criar um novo estado de página só para Azure.

## 2. Escolha inicial do serviço Azure

A primeira implementação deve usar **Azure Vision Read v3.2 GA** através da API REST, atrás de um adapter isolado.

Motivos para esta escolha no papel específico de fallback gratuito:

1. o tier F0 do Azure Vision informa 5.000 transações gratuitas por mês e 20 transações por minuto;
2. o pipeline do Fichário já converte páginas que precisam de OCR em imagens derivadas, então não depende da capacidade de o Azure interpretar PDFs multipágina;
3. a resposta Read fornece linhas, palavras, polígonos/bounding boxes e confidence por palavra, úteis para o highlight do documento original;
4. português é suportado para texto impresso e manuscrito no modelo Read atual.

### Limitação estratégica

A Microsoft informa que o Azure Vision Read v3.2 não recebe mais atualizações e recomenda Document Intelligence Read para documentos digitais/digitalizados. Por isso a integração **não pode espalhar tipos, endpoints ou parsing Azure pelo `process-ocr`**. Todo detalhe Azure deve ficar atrás de uma interface de provider para permitir troca posterior por Document Intelligence Read ou outra edição sem reescrever o orquestrador.

Document Intelligence não é a escolha inicial do fallback gratuito porque o tier F0 publicado oferece 500 páginas por mês, 1 análise por segundo, documento de até 4 MB e somente as duas primeiras páginas por solicitação. Como o Fichário já trabalha página a página, sua principal vantagem arquitetural não compensa perder aproximadamente 90% da franquia gratuita disponível no Azure Vision F0 para este uso.

Antes de implementar, revisar novamente pricing, disponibilidade regional, limites F0 e status de depreciação. Se o Azure Vision Read F0 deixar de existir ou deixar de oferecer uma vantagem gratuita clara, trocar o adapter planejado antes de escrever o runtime.

## 3. Arquitetura atual que precisa ser preservada

Hoje o fluxo relevante está concentrado em:

- `supabase/functions/process-ocr/index.ts` — claim, download da página, lote, rate limit, fallback Gemini, persistência, telemetria e enfileiramento visual;
- `supabase/functions/_shared/gemini-ocr-client.ts` — transporte Google, prompt, schema estruturado e parsing da resposta;
- `supabase/functions/_shared/gemini-ocr-routing.ts` — modelos padrão, rate limit e decisão atual de fallback;
- `supabase/functions/_shared/ocr-batch-contract.ts` — contrato interno de resultado por página;
- `supabase/functions/_shared/ocr-word-geometry.ts` — geometria normalizada armazenada;
- `supabase/functions/_shared/ocr-failure.ts` e `ocr-contract.ts` — classificação de falhas;
- `supabase/functions/_shared/ocr-provider-telemetry.ts` — telemetria, hoje construída com tipos Gemini;
- `reserve_ocr_provider_rate_slot` — reserva compartilhada de capacidade;
- `ocr-queue-worker` e as tabelas/RPCs de OCR — retomada persistente.

A implementação Azure deve se encaixar nesses contratos. Não duplicar fila, tabela de páginas nem persistência de resultado.

## 4. Refatoração obrigatória antes de adicionar a chamada Azure

O `process-ocr` não deve ganhar um terceiro bloco grande de lógica específico de provider. Primeiro criar uma camada pequena e explícita de provider.

### 4.1 Tipos genéricos

Criar algo equivalente a:

```ts
export type OcrProviderId = 'gemini' | 'azure_vision';

export type OcrProviderPage = {
  pageId: string;
  pageNumber: number;
  mimeType: string;
  bytes: Uint8Array;
};

export type OcrProviderOutcome = OcrBatchParseOutcome & {
  provider: OcrProviderId;
  model: string;
  providerModelVersion: string | null;
  providerResponseId: string | null;
  usage: ProviderUsage | null;
};
```

O contrato comum precisa terminar em `OcrBatchParseOutcome`/`OcrBatchPagePayload`; qualquer schema externo é responsabilidade do adapter.

### 4.2 Adapter Gemini

O comportamento existente do Gemini não deve ser reescrito funcionalmente. Encapsular `requestGeminiOcrBatch` em um adapter que entregue o contrato genérico, mantendo:

- prompt atual;
- schema JSON atual;
- `thinkingLevel: minimal`;
- batching de várias páginas em uma chamada;
- limites atuais de bytes;
- parsing atual;
- usage/token telemetry.

Esse passo deve passar os testes atuais sem alterar resultados.

### 4.3 Adapter Azure

Adicionar `supabase/functions/_shared/azure-ocr-client.ts` e, se necessário, `azure-ocr-contract.ts`. O cliente deve aceitar **uma página por operação** e retornar o mesmo payload interno de página usado pelo Gemini.

Nunca fazer o restante da aplicação consumir o JSON nativo do Azure.

## 5. Particularidades Azure que exigem mudança no runtime

### 5.1 Azure não tem o batching multi-imagem usado pelo Gemini

O FAQ do Azure Vision informa que várias imagens numa única chamada não são suportadas. O lote lógico do Fichário deve continuar existindo, mas o adapter Azure precisa processar suas páginas individualmente.

Regra:

- Gemini: `N` páginas -> uma chamada `generateContent`, dentro dos limites atuais;
- Azure fallback: `N` páginas -> `N` operações Read independentes, limitadas pelo scheduler Azure;
- persistência continua por página;
- falha de uma página Azure não invalida páginas Azure já concluídas;
- o `ocr_batch` só termina quando todas as páginas do subconjunto têm decisão persistida.

Não tentar simular batching Azure concatenando imagens.

### 5.2 Read v3.2 é assíncrono

Fluxo obrigatório por página:

1. `POST {AZURE_VISION_ENDPOINT}/vision/v3.2/read/analyze` com os bytes da imagem;
2. validar `202` e capturar `Operation-Location`;
3. extrair/validar o operation id sem confiar cegamente em URL retornada;
4. consultar `GET .../read/analyzeResults/{operationId}`;
5. enquanto `status` for `notStarted` ou `running`, aguardar o intervalo seguro;
6. aceitar somente `succeeded` como resultado;
7. transformar `failed`, timeout e payload inválido em erro tipado e sanitizado.

O polling deve respeitar o `AbortSignal` usado pelo timeout global.

Não seguir redirects/URLs arbitrárias retornadas pelo provedor com a chave. O host de polling deve ser reconstruído a partir do endpoint Azure configurado e de um operation id validado.

### 5.3 Teto de 4 MB no F0

O pipeline Gemini aceita atualmente páginas derivadas muito maiores. O Azure Vision Read F0 documenta imagem abaixo de 4 MB.

Portanto, **não reduzir o teto global do OCR para 4 MB**. A preparação Azure deve ser provider-specific:

1. se a página já estiver abaixo do teto conservador Azure, reutilizar os bytes;
2. caso contrário, produzir uma derivação temporária adicional, sem alterar o original nem a derivação Gemini;
3. reduzir primeiro dimensões excessivas preservando aspecto;
4. depois ajustar qualidade/encoding de forma conservadora;
5. nunca aplicar compressão destrutiva ao arquivo original;
6. se não for possível ficar abaixo do teto sem degradação insegura, declarar a página `azure_ineligible` e devolvê-la à fila para uma tentativa futura de Gemini, em vez de marcá-la como falha permanente.

Usar um teto operacional abaixo do limite nominal para margem de headers/implementação, por exemplo `OCR_AZURE_MAX_IMAGE_BYTES=3800000`, validado em staging. Não usar 4 MiB se a documentação do provedor define 4 MB decimal.

A preparação deve reutilizar a infraestrutura conservadora de imagem já existente sempre que possível, evitando outro pipeline de resize sem testes.

### 5.4 Formatos

Para a primeira versão, enviar ao Azure somente imagens derivadas em formato oficialmente suportado e já usado pelo pipeline (`image/jpeg` ou `image/png` preferencialmente). Não depender de PDF/TIFF no fallback inicial.

Se o derivado atual for WebP, converter para JPEG/PNG antes do Azure, porque Read v3.2 documenta JPEG, PNG, BMP, PDF e TIFF. Essa conversão ocorre apenas no temporário de fallback.

### 5.5 Geometria

Azure já devolve palavras com `boundingBox` e `confidence`. Isso deve ser aproveitado diretamente em vez de reconstruir palavras a partir de caixas de linha como o Gemini faz hoje.

O formato persistido atual é:

```ts
[text, left, top, right, bottom]
```

com coordenadas inteiras `0..10000`.

Para cada palavra Azure:

1. validar texto e polígono;
2. obter `minX`, `minY`, `maxX`, `maxY` dos pontos;
3. normalizar por `readResult.width` e `readResult.height`;
4. converter para inteiros `0..10000`;
5. clamp nos limites;
6. exigir `right > left` e `bottom > top`;
7. aplicar os mesmos limites de quantidade e tamanho textual de `ocr-word-geometry.ts`;
8. persistir com `complete_ocr_job_with_geometry` sem criar coluna Azure.

Para texto rotacionado, o armazenamento atual aceita somente retângulo axis-aligned. Na primeira versão usar o retângulo envolvente do polígono. Não aplicar rotação manual sem fixture que prove alinhamento com o mesmo bitmap exibido na UI.

Essa geometria tende a ser mais fiel que a geometria Gemini atual, porque as caixas de palavra são nativas do OCR em vez de derivadas proporcionalmente da caixa de linha.

### 5.6 Texto

Reconstruir a transcrição usando a ordem de `readResults[].lines[]` fornecida pelo Azure:

- preservar `line.text`;
- separar linhas por `\n`;
- não "corrigir" ortografia;
- não usar LLM para pós-corrigir automaticamente o resultado Azure na primeira versão;
- preservar palavras da geometria exatamente como retornadas pelo Azure, depois da sanitização.

Se houver mais de um `readResult` para uma entrada que deveria representar uma página, tratar como contrato inesperado e não concatenar silenciosamente sem teste explícito.

### 5.7 Warnings e `needsReview`

Azure não produz o mesmo array de warnings semânticos solicitado ao Gemini. O adapter deve gerar warnings internos determinísticos e mínimos.

Regras iniciais:

- texto vazio -> `empty_page`;
- confidence de palavra abaixo do limiar calibrado -> um único `uncertain_text` agregado por página;
- resposta estruturalmente incompleta -> erro de provider, não warning;
- não copiar mensagens brutas do Azure para `warnings`;
- não criar um warning por palavra, para evitar ruído e estourar limites.

O threshold de confidence deve ser calibrado com fixtures reais antes do rollout. Pode existir `OCR_AZURE_REVIEW_CONFIDENCE`, mas o default só deve ser fixado depois do benchmark de staging.

`needsReview` continua derivado de texto vazio ou warnings, preservando a semântica atual.

### 5.8 `contentClass`

Azure Read não entrega a classificação `book_clean | scan_degraded | table_layout | math | ...` usada pelo prompt Gemini.

Na primeira versão:

- usar `handwriting` somente quando o sinal de estilo manuscrito for claro e consistente;
- usar `mixed` quando houver sinal confiável de manuscrito e texto impresso na mesma página;
- para os demais casos usar `unknown`;
- não inferir `table_layout`, `math` ou `book_clean` apenas por heurística frágil.

O roteamento de embedding visual precisa aceitar `unknown` sem regressão. Se `unknown` alterar demais a política visual, mover a classificação de conteúdo para uma etapa provider-independent antes do rollout Azure.

## 6. Autenticação, secrets e SSRF

Secrets planejados no Supabase:

```text
AZURE_VISION_ENDPOINT
AZURE_VISION_KEY
OCR_AZURE_PROVIDER_ID=azure_vision
OCR_AZURE_MODEL=read-v3.2
OCR_AZURE_RPM=18
OCR_AZURE_MAX_IMAGE_BYTES=3800000
OCR_AZURE_POLL_INTERVAL_MS=3000
OCR_AZURE_POLL_TIMEOUT_MS=60000
```

Os nomes e defaults finais devem ser validados contra a documentação vigente antes do merge da implementação.

Regras:

- `AZURE_VISION_KEY` somente em Edge Function secret;
- usar header `Ocp-Apim-Subscription-Key`;
- endpoint somente HTTPS;
- endpoint não pode vir do usuário, documento ou request;
- normalizar endpoint removendo `/` final;
- validar hostname contra os formatos oficiais aceitos para o recurso configurado;
- nunca logar key, body OCR, `Operation-Location` completo ou resposta bruta;
- testes de transporte devem injetar `fetchImpl`, não habilitar um endpoint arbitrário por request;
- atualizar o gate que hoje proíbe endpoints de fault injection para permitir especificamente `AZURE_VISION_ENDPOINT`, mantendo proibidos `OCR_PROVIDER_URL`, query/header overrides e equivalentes.

## 7. Rate limiting e polling

O Azure F0 publica 20 transações por minuto. A configuração padrão deve manter margem, por exemplo 18 submissões/minuto, e nunca assumir que a franquia aumentou.

### Duas categorias de tráfego

Separar conceitualmente:

1. **analyze submissions** — consomem a capacidade de OCR e devem passar por `reserve_ocr_provider_rate_slot` com uma chave como `azure_vision:read-v3.2`;
2. **polling GET** — também deve ter scheduler/concurrency próprios para não transformar várias páginas em tempestade de polling.

Como Read v3.2 é assíncrono e a documentação recomenda polling espaçado, iniciar de forma conservadora:

- concurrency Azure F0 pequena;
- polling por operação >= intervalo configurado;
- backoff moderado se continuar `running`;
- respeitar `Retry-After` quando presente e validado;
- teto global pelo timeout da operação.

Não usar `Promise.all` irrestrito em um lote de 40 páginas.

### Quota mensal

Não criar um hard limit local de 5.000 como fonte de verdade. A regra do projeto continua sendo provider-only para capacidade real. Registrar contagem mensal em telemetria para observabilidade, mas deixar o recurso F0 rejeitar chamadas quando a franquia real terminar.

A garantia de custo deve vir da configuração do recurso Azure em **F0**, não de migrar automaticamente para S1. O runbook de deploy precisa exigir verificação visual do SKU e ausência de upgrade automático.

## 8. Política de roteamento

### Ordem padrão

A primeira versão deve manter uma cadeia simples e previsível:

```text
Gemini 3.1 Flash-Lite
  -> Gemini 3.5 Flash-Lite
    -> Azure Vision Read
      -> fila persistente
```

Não otimizar saltos entre providers antes de coletar telemetria.

### Elegibilidade para 3.1 -> 3.5

Preservar a política atual inicialmente: fallback Gemini ocorre nas condições já reconhecidas pelo runtime (principalmente 429/capacidade diária sinalizada pelo limiter compartilhado).

### Elegibilidade para 3.5 -> Azure

O Azure só deve ser tentado quando a falha do fallback Gemini indicar indisponibilidade/capacidade e a página for tecnicamente elegível para Azure.

Elegíveis inicialmente:

- `429` do Gemini fallback;
- quota/capacidade do Gemini fallback;
- 408/425/5xx do fallback, depois de classificação segura;
- timeout/transport do fallback quando ainda houver budget de execução para Azure.

Não elegíveis automaticamente:

- request local inválido;
- source ausente/corrompido;
- falha de persistência;
- auth/secret Gemini inválido, para não mascarar configuração quebrada;
- resposta inválida causada por bug de contrato até que a política seja deliberadamente testada;
- página acima do limite Azure que não possa ser derivada com segurança.

Depois de staging, pode-se decidir se falha global Google deve pular diretamente do 3.1 para Azure. Isso não faz parte da primeira implementação para reduzir mudança comportamental.

### Resultado parcial

Se Azure concluir somente parte das páginas:

- persistir imediatamente páginas válidas;
- colocar somente as restantes de volta na fila;
- não repetir Gemini/Azure nas páginas concluídas;
- manter split/retry idempotente.

## 9. Classificação de erros Azure

Criar erros tipados, sem reutilizar `GeminiHttpError`:

```text
AzureOcrTransportError
AzureOcrHttpError
AzureOcrResponseError
AzureOcrOperationFailedError
AzureOcrEligibilityError
```

Adicionar classificação provider-independent em `ocr-failure.ts`, sem remover os códigos Gemini existentes de uma vez.

Códigos planejados:

| Condição Azure | Código interno | Retry | Ação |
| --- | --- | --- | --- |
| 429 | `azure_rate_limited` | sim | fila/backoff |
| 408/425/5xx | `azure_service_unavailable` | sim | fila/backoff |
| timeout/transport | `azure_request_failed` | sim | fila/backoff |
| 401/403 | `azure_authentication_failed` | não | falha operacional visível |
| 400/415 por request incompatível | `azure_invalid_request` | não para Azure | preservar possibilidade de Gemini futuro |
| operação assíncrona `failed` transitória | `azure_operation_failed` | conforme código allowlisted | fila ou falha |
| JSON/status/geometry inválidos | `ocr_response_invalid` | sim até limite existente | fila |
| bytes/formato não elegíveis ao F0 | `azure_ineligible` | não consumir Azure | fila aguardando Gemini |

Não inferir "quota mensal esgotada" de qualquer 429 genérico. Só persistir bloqueio de quota quando o provider fornecer sinal allowlisted e inequívoco. Caso contrário tratar como rate limit transitório.

Nunca persistir mensagens brutas do Azure. O parser de erro deve allowlistar somente status/códigos necessários.

## 10. Telemetria

O schema SQL atual já aceita `provider` genérico e `model` textual. Não é necessária migration apenas para registrar Azure.

Refatorar `buildGeminiTelemetryRpcArgs` em um builder genérico, por exemplo `buildOcrProviderTelemetryRpcArgs`, com adapters opcionais para usage específico.

Para Azure registrar:

```text
provider = azure_vision
model = read-v3.2
provider_model_version = versão retornada quando disponível
route_reason = fallback_azure_after_gemini
provider_response_id = operation id sanitizado/permitido, se decidido seguro
```

`prompt_version` é obrigatório no schema atual apesar de Azure não usar prompt. Na primeira implementação, documentar claramente que o valor representa a versão do **contrato de normalização OCR**, ou criar migration futura para torná-lo nullable/provider-specific. Preferência: renomear conceitualmente o campo em código para `contractVersion` sem migration destrutiva imediata.

Usage/token fields ficam `null` para Azure. `usage_details` pode conter apenas metadata não sensível, por exemplo:

- quantidade de polls;
- confidence média/p10 agregada;
- presença de handwriting;
- bytes antes/depois da derivação Azure;
- versão do normalizador.

Não armazenar palavras, transcript, bounding boxes duplicadas ou body do provider na telemetria.

## 11. Persistência e fila

Não criar uma fila Azure separada.

O estado canônico continua em `pages`, `ocr_jobs` e `ocr_batches`. A fila persistente existente deve receber de volta o trabalho quando:

- ambos Gemini falharem e Azure estiver rate-limited;
- Azure estiver indisponível;
- Azure não puder receber a página com segurança;
- polling exceder timeout;
- todos os providers estiverem momentaneamente sem capacidade.

A próxima tentativa recomeça pela política normal, ou seja, Gemini 3.1 continua tendo prioridade quando sua capacidade retornar. Não gravar "provider fixo" no job sem necessidade.

Se futuramente for necessário evitar repetir providers comprovadamente indisponíveis durante uma janela curta, registrar uma cooldown operacional separada e com expiração; não transformar isso em afinidade permanente.

## 12. Interação com geometria, busca e embedding visual

A saída Azure deve chegar em `complete_ocr_job_with_geometry` no mesmo formato atual. Assim:

- FTS/fuzzy continuam usando o texto persistido;
- busca semântica continua independente do provider OCR;
- highlight usa `wordGeometry` normalizado;
- documento original continua sendo a visualização final;
- transcrição continua sendo representação interna pesquisável;
- visual embedding continua sendo enfileirado pela mesma função pós-OCR.

Adicionar fixtures para provar que uma palavra retornada pelo Azure é destacada na posição correta na página exibida.

O normalizador Azure deve ser testado em:

- página sem rotação;
- página inclinada;
- manuscrito;
- duas colunas;
- tabela;
- acentos portugueses;
- pontuação colada à palavra;
- palavra próxima às bordas;
- resposta com confidence baixa;
- página vazia.

## 13. Mudanças de arquivos previstas

### Novos arquivos

```text
supabase/functions/_shared/ocr-provider.ts
supabase/functions/_shared/azure-ocr-client.ts
supabase/functions/_shared/azure-ocr-contract.ts        # se parsing justificar arquivo próprio
tests/unit/ocr/azure-client.test.ts
tests/unit/ocr/azure-contract.test.ts
tests/unit/ocr/azure-routing.test.ts
tests/integration/azure-ocr-loopback.test.ts            # ou equivalente já usado pelo repo
```

### Arquivos a refatorar

```text
supabase/functions/process-ocr/index.ts
supabase/functions/_shared/gemini-ocr-client.ts          # somente adaptação à interface comum
supabase/functions/_shared/gemini-ocr-routing.ts         # evoluir para routing provider-aware
supabase/functions/_shared/ocr-failure.ts
supabase/functions/_shared/ocr-contract.ts
supabase/functions/_shared/ocr-provider-telemetry.ts
supabase/functions/_shared/ocr-word-geometry.ts          # helper público para normalização nativa
.env.example                                              # somente quando runtime existir
docs/OCR_FAILURE_MATRIX.md
docs/OCR_STAGING.md
docs/FREE_TIER_OPERATIONS.md
docs/EXTERNAL_SETUP_RUNBOOK.md
docs/DEPLOYMENT.md
```

### Banco

Nenhuma migration é obrigatória para o primeiro funcionamento se os valores Azure couberem nos checks existentes. Criar migration apenas se:

- `prompt_version` for tornado nullable/renomeado semanticamente;
- cooldown por provider for persistido;
- novos agregados de quota/provider exigirem estrutura própria.

Evitar migration só para enumerar `azure_vision`, porque `provider` já é textual com regex.

## 14. Configuração e runbook externo

Antes de ativar:

1. criar recurso Azure Vision explicitamente no SKU F0;
2. confirmar região compatível;
3. registrar endpoint e uma key apenas em secrets do Supabase;
4. não salvar key no GitHub;
5. confirmar no portal que o recurso continua F0;
6. confirmar franquia vigente e rate limit vigente;
7. testar uma imagem descartável sem dados pessoais;
8. adicionar smoke em staging com página real consentida;
9. registrar como revogar/rotacionar key;
10. registrar como desativar Azure rapidamente removendo secret/flag server-side sem afetar Gemini.

A ativação pode usar `OCR_AZURE_FALLBACK_ENABLED=false` durante rollout, desde que a flag seja operacional explícita e documentada, não um bypass oculto. `false` deve significar "Azure não participa"; ausência de secrets também deve deixar o sistema funcional com Gemini + fila.

## 15. Segurança e privacidade

- Azure recebe somente a página necessária depois de Gemini falhar, não o documento inteiro por conveniência;
- não enviar páginas que já foram concluídas;
- preservar o escopo de consentimento existente para processamento externo;
- não registrar conteúdo em logs;
- limitar body de resposta e erro como já ocorre no cliente Gemini;
- validar `Content-Type` e tamanho antes da rede;
- limitar tamanho máximo do JSON Azure;
- abortar polling no timeout;
- não armazenar `Operation-Location` completo em DB;
- limpar derivados temporários somente quando embedding visual também não precisar deles;
- incluir Azure na documentação de subprocessadores/provedores externos do projeto, se existir uma superfície ao usuário.

## 16. Testes obrigatórios

### Unitários sem rede

- endpoint/auth headers corretos;
- chave nunca aparece na URL;
- POST binário correto;
- parser de `Operation-Location` aceita somente formato esperado;
- polling usa host configurado, não host arbitrário retornado;
- `notStarted -> running -> succeeded`;
- `failed`;
- timeout/abort;
- 400/401/403/408/415/425/429/5xx;
- body de erro acima do limite;
- JSON malformado;
- linha/palavra/geometry inválida;
- normalização pixel -> 0..10000;
- confidence -> warning agregado;
- conteúdo manuscrito -> `contentClass` esperado;
- página > teto Azure -> derivação ou `azure_ineligible`;
- WebP -> conversão segura antes do provider;
- lote lógico com várias páginas -> chamadas Azure sequenciadas/limitadas;
- resultado parcial preservado.

### Integração loopback

Criar um servidor local fake que imite **o protocolo Azure real**: POST retorna `Operation-Location`; GET muda de `running` para `succeeded`/`failed`.

Provar:

- nenhum secret vai para log/body de erro;
- polling respeita intervalo/abort;
- retry/backoff correto;
- telemetria `provider=azure_vision`;
- persistência no contrato comum;
- página já concluída não repete provider.

Não adicionar URL de fault injection ao runtime de produção.

### Banco/pgTAP

- telemetria aceita `azure_vision`;
- RLS continua isolando usuário;
- provider/model/route_reason atendem aos checks;
- resultado Azure conclui job pelas mesmas RPCs;
- retry Azure respeita `next_retry_at`;
- fila não perde job se Azure estiver indisponível.

### Staging real

Usar documentos de teste autorizados e registrar somente métricas sanitizadas.

Cenários mínimos:

1. Gemini principal funcionando: Azure recebe zero chamadas;
2. fallback 3.5 funcionando: Azure recebe zero chamadas;
3. ambos Gemini indisponíveis de forma controlada: Azure conclui;
4. Azure 429: job volta à fila;
5. Azure indisponível: job volta à fila;
6. página > 4 MB: derivação segura funciona ou job aguarda Gemini;
7. manuscrito em português;
8. scan degradado;
9. página inclinada;
10. tabela/duas colunas;
11. highlight visual comparado ao bitmap real;
12. limpeza de temporários;
13. telemetria sem conteúdo sensível;
14. recurso Azure confirmado como F0.

### Benchmark de qualidade antes de `active`

Executar conjunto representativo do Fichário e comparar:

- CER/WER quando houver ground truth;
- recall de palavras usadas em busca;
- acurácia do highlight;
- páginas vazias falsas;
- confidence vs erro real;
- manuscrito;
- português com acentos;
- tabelas e layout;
- latência por página;
- bytes após derivação;
- taxa de `needs_review`.

O benchmark não precisa provar Azure superior ao Gemini. Precisa provar que ele é **bom o suficiente como terceiro fallback** e não corrompe busca/highlight.

## 17. Rollout

### Fase A — refactor neutro

- criar contrato genérico;
- embrulhar Gemini no adapter;
- generalizar telemetria/failure planning;
- todos os testes atuais devem continuar verdes;
- Azure ainda desabilitado.

### Fase B — Azure shadow técnico

- implementar cliente/parser;
- somente testes/fixture e staging manual;
- sem tráfego automático de produção.

### Fase C — fallback em staging

- `3.1 -> 3.5 -> Azure -> fila`;
- coletar qualidade, geometry, latência, 429 e tamanho;
- calibrar confidence e derivação.

### Fase D — produção controlada

- habilitar Azure somente como terceiro fallback;
- observar telemetria separada por provider;
- confirmar zero cobrança e SKU F0;
- não mudar prioridade sem nova decisão.

## 18. Critérios de aceite

A feature só pode ser considerada implementada quando:

- Gemini 3.1 continua principal;
- Gemini 3.5 continua primeiro fallback;
- Azure só roda depois da falha elegível do 3.5;
- uma chamada Azure nunca ocorre para página já concluída;
- Azure não reduz o teto Gemini para 4 MB;
- página Azure grande é derivada sem alterar original;
- polling é limitado e abortável;
- geometria Azure aparece corretamente sobre a página original;
- erros Azure têm classificação própria e sanitizada;
- 429 Azure não é confundido automaticamente com quota mensal;
- telemetria identifica provider/model/route;
- nenhum secret aparece no frontend/log/DB;
- fila persiste quando todos os providers falham;
- retorno posterior do Gemini volta a ter prioridade;
- testes unitários, loopback, DB, staging e gates do repo passam;
- recurso Azure usado em produção está confirmado como F0;
- documentação de deploy, free tier, staging e failure matrix está atualizada.

## 19. Referências externas verificadas em 15/08/2026

- Microsoft Learn — Azure Vision OCR overview: formatos, limites de entrada e recomendação de Document Intelligence para documentos.
- Microsoft Learn — Call Azure Vision v3.2 GA Read API: protocolo assíncrono, `Operation-Location`, polling, boxes e confidence.
- Microsoft Learn — Azure Vision language support: português impresso e manuscrito.
- Azure Pricing — Azure Vision: F0 com 5.000 transações/mês e 20 transações/minuto.
- Microsoft Learn/Azure Pricing — Document Intelligence: F0 com 500 páginas/mês, 4 MB, duas páginas por análise e 1 analyze TPS.

Links oficiais devem ser revalidados antes da implementação porque quotas, SKUs e lifecycle do serviço são externos ao repositório.
