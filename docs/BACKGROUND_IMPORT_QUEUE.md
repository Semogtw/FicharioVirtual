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

- o documento já está salvo e pode ser aberto no Fichário;
- páginas com texto nativo já podem ser usadas sem esperar o Gemini;
- o OCR pode continuar com o Fichário fechado;
- uma queda de uma Edge Function não perde o job;
- claims `processing` antigos são recuperados depois do limite de staleness;
- rate limits e retries futuros são reavaliados pelo despertador periódico do backend;
- ao reabrir o app, a fila consulta um resumo user-scoped para refletir conclusão, revisão necessária ou falha.

## Múltiplas abas

A exclusão por browser lock continua impedindo que duas abas executem a mesma etapa crítica ao mesmo tempo. Com OCR server-side, `waiting` deixou de ser terminal; por isso a coordenação também usa as mensagens entre abas.

Quando uma aba observa que outra já publicou um estado pós-lock (`Preparando`, `Enviando`, `Leitura iniciada` ou `Leitura em segundo plano`), ela cede somente sua cópia do item em memória e deixa de competir pelo retry. O registro compartilhado no IndexedDB não é apagado: ele permanece como checkpoint enquanto o OCR estiver pendente no servidor. O estado `Na fila` não é usado como prova de posse, porque duas abas podem restaurar o mesmo item antes da eleição do lock.

O E2E multitab trava que uma restauração concorrente produz uma única criação de metadados, não duplica os uploads, não chama `process-ocr` diretamente no navegador e preserva o checkpoint em `waiting` até a conclusão no backend.

## Worker Gemini

`ocr-queue-worker` é uma Edge Function server-to-server. Cada execução:

1. recupera claims Gemini antigos quando necessário;
2. seleciona um conjunto limitado de candidatos elegíveis;
3. reutiliza os RPCs existentes de claim, falha, quota e conclusão por meio de um dispatcher restrito a `service_role`;
4. baixa somente os derivados privados necessários;
5. reserva o orçamento compartilhado do modelo antes de chamar o Gemini e usa o fallback quando o primário recebe `429` ou está bloqueado pelo orçamento diário local;
6. persiste resultado, geometria e telemetria;
7. limpa derivados temporários concluídos;
8. reconcilia o estado do lote;
9. encadeia outra execução curta apenas quando ainda há trabalho imediatamente elegível.

O disparo autenticado pelo navegador (`ocr-queue-kick`) usa o modo síncrono
limitado do worker para retirar pelo menos um lote da fila antes de confirmar
`accepted`. A resposta só é aceita quando contém o recibo estrito
`{ completed: true, hasMore: boolean }`. Isso evita que a UI mostre um aceite
falso enquanto a chamada assíncrona ainda não iniciou ou já perdeu sua execução;
o encadeamento e o cron continuam responsáveis por lotes adicionais e retries.

O botão de retomada de um documento segue uma regra diferente do worker: como
as páginas pendentes não carregam metadados de bytes/densidade no RPC de
retomada, o frontend usa `processPageOcr` individualmente, com no máximo duas
páginas concorrentes. Isso evita que um manuscrito inteiro seja classificado
como um lote de um byte por página e expire no timeout do provedor. Batching
continua permitido apenas para callers que injetam um planner e seus limites
calibrados.

Limites configuráveis por ambiente:

- `OCR_BACKGROUND_MAX_PAGES` — padrão 8 páginas por execução;
- `OCR_BACKGROUND_MAX_BYTES` — padrão 8 MiB agregados por chamada;
- `OCR_BACKGROUND_TIMEOUT_MS` — padrão 90 s para a chamada ao provedor.

Esses limites mantêm cada execução curta em vez de transformar um PDF grande em uma única Edge Function longa.

## Orçamento Gemini: RPM e RPD

O projeto trata os limites de requisição como orçamento compartilhado do backend, e não como algo que cada Edge Function tenta descobrir isoladamente.

Para os limites atuais do projeto no AI Studio:

- cada modelo possui teto de 15 RPM;
- o Fichário reserva no máximo 12 RPM por modelo, mantendo margem antes do teto do provedor;
- cada modelo possui um circuit breaker local de 190 RPD, mantendo margem antes
  do limite esperado de 200 RPD;
- o banco mantém um contador diário separado por nome de modelo, portanto o orçamento do `gemini-3.1-flash-lite` não consome o orçamento do `gemini-3.5-flash-lite`.

A reserva acontece **antes** da chamada HTTP ao Gemini. Pressão normal de RPM recebe uma espera curta ou volta à fila sem consumir RPD. Ao atingir 190 reservas diárias, novas chamadas daquele modelo são bloqueadas localmente antes de chegar ao provedor.

Quando o orçamento diário do modelo primário fecha, uma espera longa é interpretada como indisponibilidade diária e o roteamento pode usar o modelo fallback. Se o fallback também estiver sem orçamento, o job permanece persistido com retry futuro; não existe polling apertado contra o Gemini.

O reset de RPD segue `America/Los_Angeles`, incluindo horário de verão, porque a renovação diária do Gemini ocorre à meia-noite no horário do Pacífico. O cron de cinco minutos continua sendo apenas o despertador: jobs com `next_retry_at` no futuro não são selecionados até a janela correta.

Além do contador preventivo, um evento de telemetria com `gemini_daily_quota` fecha imediatamente o circuit breaker compartilhado daquele modelo até o próximo reset do Pacífico. Isso cobre o caso em que a mesma cota foi consumida fora do Fichário e o provedor acusa esgotamento antes de o contador local chegar a 190.

## Wake-up e retries sem navegador

`ocr-queue-kick` é o endpoint autenticado usado pelo aplicativo para acordar o worker. Ele valida a sessão e a allowlist antes de fazer a chamada server-to-server, aguarda a execução síncrona limitada do primeiro lote e só então devolve o aceite à fila do navegador.

Além disso, a migration `202608111705_background_ocr_cron.sql` agenda um wake-up a cada cinco minutos com Supabase Cron + `pg_net`. Trabalho ativo não espera o cron: o worker encadeia outra execução curta quando ainda existem candidatos imediatamente elegíveis. O cron existe para recuperar trabalho diferido, rate limits e filas que ficaram sem um navegador aberto.

O cron lê as credenciais do Vault em runtime e é deliberadamente no-op quando elas ainda não foram provisionadas.

O ambiente hospedado usa três nomes de configuração:

- Edge Function `OCR_BACKGROUND_WORKER_KEY` — segredo aleatório usado exclusivamente para autenticar chamadas server-to-server ao worker;
- Vault `project_url` — URL HTTPS do projeto Supabase;
- Vault `ocr_background_worker_key` — cópia do mesmo segredo interno.

Isso **não exige uma key nova criada manualmente pelo usuário**. O deploy deve garantir `project_url`, gerar `ocr_background_worker_key` caso ainda não exista, mascarar o valor no runner e sincronizá-lo para `OCR_BACKGROUND_WORKER_KEY` antes de publicar as Edge Functions. O valor não deve ser salvo no repositório ou aparecer em logs.

A service-role key continua sendo usada somente dentro do worker para o cliente administrativo do Supabase. Ela não é reutilizada como credencial HTTP do worker, não entra no cron e não deve ser registrada em logs.

A rotação do segredo deve acontecer pelo mesmo caminho administrativo, mantendo Vault e Edge Functions sincronizados como uma única operação.

## Segurança

Os RPCs de infraestrutura de background são `service_role` only:

- `recover_background_stale_ocr_jobs()`;
- `list_background_gemini_ocr_candidates(integer)`;
- `background_ocr_as_user(uuid, text, jsonb)`;
- `reconcile_background_ocr_batches(uuid[], timestamptz)`;
- `reserve_ocr_provider_rate_slot(text, integer, integer)`.

O dispatcher aceita somente uma lista fixa de operações e reutiliza os contratos user-scoped já existentes. `anon` e `authenticated` não recebem `EXECUTE` nesse dispatcher nem no reservador compartilhado de orçamento do provedor.

O resumo usado pela UI (`get_document_ocr_summary`) é diferente: ele é `security invoker`, exige usuário autorizado e só agrega jobs pertencentes ao documento do próprio usuário.

Jobs `blocked_quota` só voltam à seleção do worker quando possuem `next_retry_at` definido e a janela de retry realmente chegou. Isso evita ciclos de wake-up em estados de quota incompletos ou malformados.

## Estado parcial do documento

PDFs com texto nativo continuam aproveitando esse texto sem OCR. Somente páginas visuais recebem jobs Gemini. Assim que a ingestão local termina e o documento é publicado, as páginas nativas ficam disponíveis sem esperar a conclusão das páginas em `Leitura em segundo plano`.

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

Antes da integração no `main`, o SHA exato da branch combinada é validado pelo checkout privado no `Offline-Toolchains`; após o merge, o `Validate current head` confirma novamente o SHA público final.
