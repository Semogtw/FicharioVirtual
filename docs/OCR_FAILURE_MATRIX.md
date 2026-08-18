# Matriz de falhas OCR

Este documento descreve como o backend classifica falhas, qual estado deve ser persistido e como obter evidência em staging sem adicionar flags ocultas, bypasses de autenticação ou respostas artificiais à Edge Function.

A fonte de verdade executável continua sendo:

- `supabase/functions/_shared/ocr-contract.ts` para classificação do provedor;
- `supabase/functions/_shared/ocr-failure.ts` para backoff, decisão de persistência e resposta pública;
- `supabase/functions/process-ocr/index.ts` para executar a decisão contra o Supabase;
- `claim_ocr_job`, `fail_ocr_job` e `block_ocr_job_quota` para transições SQL;
- testes unitários, integração loopback e pgTAP para contratos determinísticos.

## Estados persistidos

| Condição                                                    | Código persistido              | Página/job                                            | Retry                             | Resposta da função         |
| ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------- | --------------------------------- | -------------------------- |
| 429 identificado como quota diária do provedor              | `gemini_daily_quota`           | `blocked_quota`                                       | próximo período do provedor       | `202 quota_exhausted`      |
| 429 transitório                                             | `gemini_rate_limited`          | `retryable`                                           | base 60 s, exponencial com jitter | `202 retry_later`          |
| 408, 425 ou 5xx                                             | `gemini_service_unavailable`   | `retryable`                                           | base 30 s, exponencial com jitter | `202 retry_later`          |
| 401 ou 403 do provedor                                      | `gemini_authentication_failed` | `failed`                                              | não                               | HTTP do provedor           |
| 400 com `ErrorInfo.reason = API_KEY_INVALID`                | `gemini_authentication_failed` | `failed`                                              | não                               | `400`                      |
| 404 do modelo                                               | `gemini_model_unavailable`     | `failed`                                              | não                               | `404`                      |
| 400 ou 422 sem sinal allowlisted de credencial/configuração | `gemini_invalid_request`       | `failed`                                              | não                               | HTTP do provedor           |
| resposta JSON inválida                                      | `ocr_response_invalid`         | `retryable` até a terceira tentativa; depois `failed` | base 45 s enquanto retryable      | `202 retry_later` ou `422` |
| transporte, timeout ou abort                                | `ocr_request_failed`           | `retryable` até a terceira tentativa; depois `failed` | base 45 s enquanto retryable      | `202 retry_later` ou `503` |
| arquivo/documento ausente                                   | `ocr_source_missing`           | `failed`                                              | não                               | `409`                      |
| objeto temporariamente indisponível no Storage              | `ocr_source_unavailable`       | `retryable`                                           | base 30 s                         | `202 retry_later`          |
| imagem individual acima de 14 MiB                           | `ocr_source_too_large`         | `failed`                                              | não                               | `413`                      |

O atraso efetivo inclui backoff exponencial por `attempt_count`, jitter abaixo de um segundo e teto de uma hora. `attemptCount` ausente, fracionário ou menor que 1 é recusado como `ocr_claim_failed`; ele nunca é convertido silenciosamente em primeira tentativa.

Uma retomada foreground não possui, por definição, metadados confiáveis de
bytes/densidade das páginas já persistidas. Por isso o fluxo padrão não cria
um lote sintético: ele envia uma página por requisição, com no máximo duas em
paralelo. Um timeout real de lote multipágina continua sendo retryable, mas
não é mais provocado pelo botão de retomada quando o caller não forneceu um
plano de batching explícito.

`OCR_DAILY_HARD_LIMIT`, `daily_hard_limit` e equivalentes pertencem somente ao histórico anterior à migração provider-only. Eles são proibidos no runtime ativo pelo gate `tools/checks/check-provider-only-ocr.mjs`. A capacidade diária é determinada pela quota real do provedor; o runtime mantém apenas um circuit breaker preventivo de 190 reservas RPD por modelo, com telemetria do provedor capaz de fechá-lo antes quando a quota real acabar.

Para o caminho inline de imagem, a documentação do Gemini limita a requisição `generateContent` completa — mídia Base64, prompt e JSON — a menos de 20 MB. Por isso o contrato ativo usa teto bruto de 14 MiB para página/lote, deixando margem para a expansão Base64 e o restante do envelope. O padrão de staging continua menor, 12 MiB.

## Fallback Azure planejado — ainda não ativo

A especificação completa está em `docs/AZURE_OCR_FALLBACK_IMPLEMENTATION.md`. Quando implementado, o roteamento padrão será:

```text
Gemini 3.1 Flash-Lite -> Gemini 3.5 Flash-Lite -> Azure Vision Read -> fila persistente
```

A matriz Azure abaixo é **contrato planejado**, não descrição do runtime atual.

| Condição Azure                                 | Código planejado              | Página/job                                                          | Retry                 | Observação                                                       |
| ---------------------------------------------- | ----------------------------- | ------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------- |
| 429 sem sinal inequívoco de quota mensal       | `azure_rate_limited`          | `retryable`                                                         | sim                   | não confundir automaticamente com franquia mensal esgotada       |
| 408, 425 ou 5xx                                | `azure_service_unavailable`   | `retryable`                                                         | sim                   | volta à fila se os Gemini já falharam                            |
| transporte, timeout ou abort                   | `azure_request_failed`        | `retryable`                                                         | sim                   | polling também precisa respeitar timeout/abort                   |
| 401 ou 403                                     | `azure_authentication_failed` | `failed` operacional                                                | não                   | não mascarar secret/recurso quebrado                             |
| 400/415 por request incompatível               | `azure_invalid_request`       | não encerrar definitivamente o OCR se Gemini puder funcionar depois | não para Azure        | preservar possibilidade de retry futuro pelo provider principal  |
| operação assíncrona retorna `failed`           | `azure_operation_failed`      | depende do código allowlisted                                       | depende               | corpo bruto nunca é persistido                                   |
| JSON/status/geometry inválido                  | `ocr_response_invalid`        | `retryable` até limite existente                                    | sim                   | mesmo contrato de resposta interna                               |
| página acima do teto F0 e sem derivação segura | `azure_ineligible`            | `retryable`/fila                                                    | sim via Gemini futuro | não transformar limitação Azure em falha permanente do documento |

### Regras adicionais do Azure

- um `429` genérico do Azure é rate limit até prova allowlisted em contrário;
- a franquia mensal publicada deve ser observada em telemetria, mas não reproduzida como hard limit local;
- o recurso deve permanecer F0; nunca promover para SKU pago automaticamente;
- `Operation-Location` deve ser tratado como metadata de protocolo, não como URL arbitrária confiável;
- o polling deve reconstruir a URL a partir do endpoint configurado e de um operation id validado;
- páginas Azure já concluídas devem ser persistidas imediatamente e nunca repetidas porque outra página do lote falhou;
- `azure_ineligible` significa somente que aquele provider não consegue receber a página de forma segura; a página continua elegível a Gemini numa tentativa posterior;
- auth/configuração inválida do Gemini não deve, na primeira versão, ser mascarada automaticamente por Azure.

### Eligibility do terceiro fallback

Azure só deve ser tentado depois do Gemini 3.5 quando a falha indicar indisponibilidade/capacidade e a página for tecnicamente elegível. A primeira versão pode considerar:

- 429/quota/capacidade do fallback Gemini;
- 408/425/5xx;
- timeout/transport quando ainda houver budget de execução.

Não deve tentar Azure automaticamente para:

- source ausente/corrompido;
- falha de persistência;
- request local inválido;
- auth/secret Gemini inválido;
- página que não pode ser adaptada ao limite/formato Azure sem degradação insegura.

## Cenários determinísticos

Os seguintes contratos já podem ser comprovados sem chamada externa:

- separação entre quota diária real do provedor e 429 transitório;
- códigos e `retryable` para 400, 401, 403, 404, 408, 422, 425 e 5xx;
- reconhecimento allowlisted de `API_KEY_INVALID` mesmo quando o Google usa HTTP 400;
- descarte de mensagem, metadata e valores desconhecidos do corpo de erro antes de qualquer resultado público;
- bases de atraso de 30, 45 e 60 segundos;
- rejeição de resposta fora do schema `{ text, warnings }`;
- mudança de `processing` para `retryable`, `failed` ou `blocked_quota`;
- retomada somente depois de `next_retry_at`;
- desbloqueio de quota conforme o período do provedor;
- abandono de retry automático depois da terceira falha genérica;
- rejeição de lote bruto acima do teto inline antes de abrir conexão com o Gemini.

Quando Azure for implementado, acrescentar provas determinísticas para:

- `POST -> Operation-Location -> polling -> succeeded`;
- `running -> failed`;
- 429/5xx/timeout Azure;
- limite de polling e cancelamento;
- normalização de geometry em pixels para `0..10000`;
- `azure_ineligible` sem perda de job;
- resultado parcial de um lote lógico multi-página;
- ausência de secret/response body em telemetria.

Esses casos pertencem a unitários, pgTAP e testes locais de concorrência. Não precisam consumir quota do provedor.

### Integração HTTP em loopback

Execute:

```bash
pnpm test:ocr:faults:local
```

O gate atual sobe um servidor efêmero em `127.0.0.1`, usa o cliente Gemini compartilhado e prova sete cenários completos de transporte e decisão:

1. 429 transitório;
2. quota diária do provedor;
3. 503;
4. payload inválido antes da terceira tentativa;
5. payload inválido na terceira tentativa;
6. timeout/abort HTTP antes da terceira tentativa;
7. timeout/abort HTTP na terceira tentativa.

O servidor valida método, `Content-Type`, API key apenas no header, bytes da imagem e solicitação de resposta JSON estruturada. A URL não recebe a chave e nenhuma conexão externa é aberta.

Quando o adapter Azure existir, criar um loopback separado ou ampliar o gate para imitar o protocolo Azure real, com `POST` retornando `Operation-Location` e `GET` evoluindo `running -> succeeded/failed`. Não habilitar uma URL de fault injection no runtime de produção.

Esse gate comprova cliente, classificação, backoff e resposta planejada. Ele não comprova a chamada da Edge Function implantada nem a persistência real em `pages` e `ocr_jobs`.

## Cenários remotos controláveis

Use somente um projeto Supabase e uma conta exclusivos de staging. Registre o valor anterior de qualquer configuração temporária e restaure-a imediatamente depois da prova. Nunca copie o valor de secrets para documentação, logs ou artifacts.

### Configuração ausente

Remova temporariamente uma variável obrigatória da Edge Function ou use um valor estruturalmente inválido para modelo/limite. A função deve responder `503 ocr_not_configured` antes de alterar trabalho ou iniciar chamada ao provedor.

Quando Azure for opcional/desabilitado, ausência dos secrets Azure **não** pode derrubar o fluxo Gemini. Somente uma configuração que declara Azure habilitado com secrets inválidos deve falhar como configuração Azure.

### Credencial rejeitada

Configure uma chave revogada ou deliberadamente inválida no **Supabase staging**, nunca no GitHub. O trabalho Gemini deve terminar em `failed` com `gemini_authentication_failed`, sem `next_retry_at`. O Google pode representar essa rejeição como 401/403 ou como HTTP 400 com `ErrorInfo.reason = API_KEY_INVALID`; o runtime trata os dois casos como autenticação e não devolve o corpo bruto do provedor.

Quando Azure estiver implementado, repetir prova equivalente com uma key Azure de staging inválida e exigir `azure_authentication_failed`, sem vazar body/header/endpoint sensível.

### Modelo indisponível

Configure um identificador sintaticamente válido, mas inexistente, no staging. O trabalho deve terminar em `failed` com `gemini_model_unavailable`, sem fallback automático para outro modelo além da política explicitamente documentada.

### Quota do provedor

A quota deve ser observada no provedor real ou em uma infraestrutura externa controlada. Não reintroduza `OCR_DAILY_HARD_LIMIT` para fabricar esse estado. Um `429` transitório continua `retryable`; uma quota diária identificada com segurança fica `blocked_quota` até o próximo período aplicável.

Para Azure, não transformar um 429 comum em `blocked_quota` mensal. O provider precisa fornecer um sinal allowlisted específico antes de esse estado ser usado.

## Cenários que ainda exigem infraestrutura externa controlada

A classificação local de 429 transitório, 503, timeout e payload inválido já possui evidência por HTTP loopback. Ainda falta observar a função implantada, a escrita no banco, a retomada posterior e o cleanup em staging para cada falha externa relevante.

Essas falhas não devem ser forçadas por body, header, query string, endpoint configurável ou secret especial reconhecido pela função implantada. O gate de fonte rejeita superfícies como `GEMINI_API_URL`, `OCR_PROVIDER_URL` e `X-FICHARIO-FAULT` no código de produção.

A futura variável `AZURE_VISION_ENDPOINT` é uma configuração legítima do recurso Azure e precisa ser allowlisted especificamente no gate. Ela não autoriza endpoint fornecido pelo usuário nem endpoint genérico para fault injection.

Para obter evidência remota, use uma das opções:

1. proxy de provedor isolado em um projeto descartável e sem tráfego real, configurado fora da função de produção;
2. mecanismo oficial de sandbox/fault injection do provedor, quando disponível;
3. ocorrência real capturada pelo relatório sanitizado e pelos estados persistidos.

Nunca direcione produção para um proxy de teste e nunca mantenha uma chave de simulação após a janela de validação.

## Evidência mínima por cenário

Registre, sem conteúdo do documento:

- commit da aplicação e versão implantada da função;
- cenário esperado;
- provider/model/route reason;
- status HTTP e estado público retornado;
- `page.status` e `ocr_jobs.status`;
- `last_error_code`;
- presença ou ausência de `next_retry_at` e `finished_at`;
- `attempt_count`;
- contador do provider apenas como telemetria;
- resultado do cleanup;
- confirmação de que nenhum billing/upgrade foi ativado.

Não registre e-mail, UUID, paths de Storage, transcript, resposta bruta do provedor, token ou chave.

## Critérios de aprovação

Uma prova passa somente quando:

- a classificação observada corresponde à tabela;
- estados de página e job permanecem alinhados;
- retryable possui `next_retry_at` futuro e não possui `finished_at` terminal;
- permanente possui `finished_at` e não possui retry agendado;
- quota real fica `blocked_quota` somente quando identificada com segurança e não é fabricada por limite local;
- a UI/serviço consegue retomar somente quando permitido;
- arquivo original permanece recuperável;
- fallback Azure, quando ativo, continua atrás do Gemini 3.5;
- página `azure_ineligible` não é perdida nem marcada permanentemente como inválida;
- nenhuma configuração de teste fica ativa depois do cenário.
