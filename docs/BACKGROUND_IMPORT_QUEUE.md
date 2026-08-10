# Fila global de importação e OCR em segundo plano

Este documento descreve o fluxo em que a preparação inicial continua no dispositivo, mas o OCR Gemini deixa de depender do navegador assim que os jobs persistentes estão disponíveis no backend.

## Experiência do usuário

A entrada principal em `/import/` aceita, na mesma seleção:

- PDF;
- JPG;
- PNG;
- WebP;
- várias fotos e arquivos simultaneamente.

Imagens e PDFs continuam usando motores internos separados porque possuem etapas e garantias diferentes, porém a interface apresenta uma única fila global no shell do aplicativo.

Não há priorização inteligente por página ou consulta. A ordem continua determinada pelos contratos existentes de fila e criação dos jobs.

## Quando o dispositivo ainda é necessário

O navegador continua responsável pelas etapas que dependem do arquivo local e das APIs do dispositivo:

1. preparação conservadora de imagens;
2. inspeção de PDFs;
3. upload/cópia do original para o Google Drive;
4. renderização das páginas de PDF que realmente precisam de OCR;
5. upload dos derivados temporários;
6. publicação dos metadados, páginas e jobs persistentes.

Enquanto a fila mostra estados como `Preparando`, `Analisando páginas`, `Enviando`, `Preparando páginas` ou `Salvando no fichário`, o dispositivo ainda participa da ingestão. O usuário pode navegar por outras telas do Fichário, mas fechar/suspender o navegador pode interromper essa fase; os mecanismos de retomada existentes continuam responsáveis pela recuperação.

## Quando o aplicativo pode ser fechado

Depois que o documento foi publicado e os jobs de OCR existem no banco, o navegador não chama mais o Gemini diretamente no fluxo normal. Chamadas de `processPageOcr` e `processOcrBatch` sem cliente explicitamente injetado apenas acordam a fila de servidor e retornam como trabalho pendente.

A fila passa a mostrar `Leitura em segundo plano`. A partir desse ponto:

- o documento já está salvo;
- o OCR pode continuar com o Fichário fechado;
- uma queda de uma Edge Function não perde o job;
- claims `processing` antigos são recuperados depois do limite de staleness;
- rate limits e retries futuros são reavaliados pelo despertador periódico do backend;
- ao reabrir o app, a fila consulta um resumo user-scoped para refletir conclusão, revisão necessária ou falha.

## Worker Gemini

`ocr-queue-worker` é uma Edge Function server-to-server. Cada execução:

1. recupera claims Gemini antigos quando necessário;
2. seleciona um conjunto limitado de candidatos elegíveis;
3. reutiliza os RPCs existentes de claim, falha, quota e conclusão por meio de um dispatcher restrito a `service_role`;
4. baixa somente os derivados privados necessários;
5. chama o cliente Gemini compartilhado;
6. persiste resultado, geometria e telemetria;
7. limpa derivados temporários concluídos;
8. reconcilia o estado do lote;
9. encadeia outra execução curta apenas quando ainda há trabalho imediatamente elegível.

Limites configuráveis por ambiente:

- `OCR_BACKGROUND_MAX_PAGES` — padrão 8 páginas por execução;
- `OCR_BACKGROUND_MAX_BYTES` — padrão 8 MiB agregados por chamada;
- `OCR_BACKGROUND_TIMEOUT_MS` — padrão 90 s para a chamada ao provedor.

Esses limites mantêm cada execução curta em vez de transformar um PDF grande em uma única Edge Function longa.

## Wake-up e retries sem navegador

`ocr-queue-kick` é o endpoint autenticado usado pelo aplicativo para acordar o worker. Ele valida a sessão e a allowlist antes de fazer a chamada server-to-server.

Além disso, a migration `202608101205_background_ocr_cron.sql` agenda um wake-up a cada minuto com Supabase Cron + `pg_net`. O cron lê as credenciais do Vault em runtime e é deliberadamente no-op quando elas ainda não foram provisionadas.

O ambiente hospedado precisa possuir no Vault:

- `project_url` — URL HTTPS do projeto Supabase;
- `ocr_background_worker_key` — segredo aceito pelo `ocr-queue-worker`.

Na implementação atual o worker compara `ocr_background_worker_key` com a service-role key recebida por variável de ambiente. O valor nunca deve ser versionado, exibido em logs ou incorporado à definição do cron.

## Segurança

Os RPCs de infraestrutura de background são `service_role` only:

- `recover_background_stale_ocr_jobs()`;
- `list_background_gemini_ocr_candidates(integer)`;
- `background_ocr_as_user(uuid, text, jsonb)`;
- `reconcile_background_ocr_batches(uuid[], timestamptz)`.

O dispatcher aceita somente uma lista fixa de operações e reutiliza os contratos user-scoped já existentes. `anon` e `authenticated` não recebem `EXECUTE` nesse dispatcher.

O resumo usado pela UI (`get_document_ocr_summary`) é diferente: ele é `security invoker`, exige usuário autorizado e só agrega jobs pertencentes ao documento do próprio usuário.

## Estado parcial do documento

PDFs com texto nativo continuam aproveitando esse texto sem OCR. Somente páginas visuais recebem jobs Gemini. Portanto um PDF de 500 páginas pode ter, por exemplo, centenas de páginas indexáveis imediatamente e um conjunto menor em `Leitura em segundo plano`.

A conclusão de uma página não depende da conclusão das outras. Falhas permanecem associadas ao job/página correspondente e não invalidam resultados já persistidos.

## Validação

Os gates relevantes são:

```bash
pnpm verify
pnpm test:source:offline
pnpm test:functions:check
pnpm test:db:local
pnpm test:e2e
```

A branch também possui `Validate feature branches`, sem permissão de escrita, para executar esses gates antes da integração na `main`.
