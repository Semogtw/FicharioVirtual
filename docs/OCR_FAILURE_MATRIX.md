# Matriz de falhas OCR

Este documento descreve como o backend classifica falhas, qual estado deve ser persistido e como obter evidência em staging sem adicionar flags ocultas, bypasses de autenticação ou respostas artificiais à Edge Function.

A fonte de verdade executável continua sendo:

- `supabase/functions/_shared/ocr-contract.ts` para classificação do provedor;
- `supabase/functions/process-ocr/index.ts` para resposta HTTP e persistência;
- `claim_ocr_job`, `fail_ocr_job` e `block_ocr_job_quota` para transições SQL;
- testes unitários e pgTAP para contratos determinísticos.

## Estados persistidos

| Condição | Código persistido | Página/job | Retry | Resposta da função |
| --- | --- | --- | --- | --- |
| limite diário local antes da rede | `daily_hard_limit` | `blocked_quota` | próximo dia UTC | `202 quota_exhausted` |
| 429 identificado como quota diária do provedor | `gemini_daily_quota` | `blocked_quota` | próximo dia UTC | `202 quota_exhausted` |
| 429 transitório | `gemini_rate_limited` | `retryable` | base 60 s, exponencial com jitter | `202 retry_later` |
| 408, 425 ou 5xx | `gemini_service_unavailable` | `retryable` | base 30 s, exponencial com jitter | `202 retry_later` |
| 401 ou 403 do provedor | `gemini_authentication_failed` | `failed` | não | HTTP do provedor |
| 404 do modelo | `gemini_model_unavailable` | `failed` | não | `404` |
| 400 ou 422 do provedor | `gemini_invalid_request` | `failed` | não | HTTP do provedor |
| resposta JSON inválida | `ocr_response_invalid` | `retryable` até a terceira tentativa; depois `failed` | base 45 s enquanto retryable | `202 retry_later` ou `422` |
| transporte, timeout ou abort | `ocr_request_failed` | `retryable` até a terceira tentativa; depois `failed` | base 45 s enquanto retryable | `202 retry_later` ou `503` |
| arquivo/documento ausente | `ocr_source_missing` | `failed` | não | `409` |
| objeto temporariamente indisponível no Storage | `ocr_source_unavailable` | `retryable` | base 30 s | `202 retry_later` |
| imagem acima de 14 MiB inline | `ocr_source_too_large` | `failed` | não | `413` |

O atraso efetivo inclui backoff exponencial por `attempt_count`, jitter abaixo de um segundo e teto de uma hora.

## Cenários determinísticos

Os seguintes contratos já podem ser comprovados sem chamada externa:

- separação entre quota diária e 429 transitório;
- códigos e `retryable` para 400, 401, 403, 404, 408, 422, 425 e 5xx;
- bases de atraso de 30, 45 e 60 segundos;
- rejeição de resposta fora do schema `{ text, warnings }`;
- mudança de `processing` para `retryable`, `failed` ou `blocked_quota`;
- bloqueio pelo limite diário local antes da rede;
- retomada somente depois de `next_retry_at`;
- desbloqueio de quota na virada UTC;
- abandono de retry automático depois da terceira falha genérica.

Esses casos pertencem a unitários, pgTAP e testes locais de concorrência. Não precisam consumir quota do provedor.

## Cenários remotos controláveis

Use somente um projeto Supabase e uma conta exclusivos de staging. Registre o valor anterior de qualquer secret e restaure-o imediatamente depois da prova.

### Configuração ausente

Remova temporariamente uma variável obrigatória da Edge Function ou use um valor estruturalmente inválido para modelo/limite. A função deve responder `503 ocr_not_configured` antes de reservar cota ou alterar o trabalho.

### Credencial rejeitada

Configure uma chave revogada ou deliberadamente inválida no **Supabase staging**, nunca no GitHub. O trabalho deve terminar em `failed` com `gemini_authentication_failed`, sem `next_retry_at`.

### Modelo indisponível

Configure um identificador sintaticamente válido, mas inexistente, no staging. O trabalho deve terminar em `failed` com `gemini_model_unavailable`, sem fallback automático para outro modelo.

### Limite diário local

Use uma conta de teste isolada e um `OCR_DAILY_HARD_LIMIT` baixo. Depois que o contador diário alcançar o limite, a próxima claim deve ficar `blocked_quota` com `daily_hard_limit` **antes** de chamar o provedor. Restaure o limite após a execução.

## Cenários que exigem infraestrutura externa controlada

429 transitório, 503, timeout e payload inválido não devem ser forçados por body, header, query string ou secret especial reconhecido pela função implantada. Isso criaria uma superfície de teste acessível em produção.

Para obter evidência real, use uma das opções:

1. endpoint/proxy de provedor isolado em um projeto descartável e sem tráfego real;
2. mecanismo oficial de sandbox/fault injection do provedor, quando disponível;
3. ocorrência real capturada pelo relatório sanitizado e pelos estados persistidos;
4. teste de integração local com transporte injetado fora da função implantada.

Nunca direcione produção para um proxy de teste e nunca mantenha uma chave de simulação após a janela de validação.

## Evidência mínima por cenário

Registre, sem conteúdo do documento:

- commit da aplicação e versão implantada da função;
- cenário esperado;
- status HTTP e estado público retornado;
- `page.status` e `ocr_jobs.status`;
- `last_error_code`;
- presença ou ausência de `next_retry_at` e `finished_at`;
- `attempt_count`;
- contador diário antes/depois;
- resultado do cleanup;
- confirmação de que nenhum fallback/modelo alternativo ou billing foi ativado.

Não registre e-mail, UUID, paths de Storage, transcript, resposta bruta do provedor, token ou chave.

## Critérios de aprovação

Uma prova passa somente quando:

- a classificação observada corresponde à tabela;
- estados de página e job permanecem alinhados;
- retryable possui `next_retry_at` futuro e não possui `finished_at` terminal;
- permanente possui `finished_at` e não possui retry agendado;
- quota fica `blocked_quota` e não é repetida no mesmo dia;
- a UI/serviço consegue retomar somente quando permitido;
- arquivo original permanece recuperável;
- nenhuma configuração de teste fica ativa depois do cenário.
