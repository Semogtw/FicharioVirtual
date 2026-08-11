# Validação de OCR real em staging

O workflow `Verify OCR staging` executa uma leitura real contra as Edge Functions e o provedor configurado no projeto Supabase de staging. Ele usa uma conta autorizada, uma chave publicável e conteúdo sintético criado durante o job.

A validação não mantém a confirmação pré-lançamento de envio ao provedor. A proteção operacional fica no environment `staging`, nos secrets do projeto de staging e nos limites configurados do OCR. O workflow não habilita billing, não recebe a chave Gemini e não usa `service_role`.

## Pré-requisitos no Supabase

Antes da primeira execução:

1. crie e valide o projeto descrito em `docs/SUPABASE_STAGING.md`;
2. aplique **todas** as migrations do repositório, inclusive as migrations de limpeza pré-lançamento;
3. implante as Edge Functions `process-ocr` e `delete-document`;
4. mantenha a conta `STAGING_AUTHORIZED_EMAIL` ativa em `public.app_users`;
5. configure nas Edge Functions:

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_FALLBACK
OCR_PROMPT_VERSION
```

Controles técnicos opcionais:

```text
OCR_MODEL_PRIMARY_RPM
OCR_MODEL_FALLBACK_RPM
OCR_PROVIDER_MAX_QUEUE_WAIT_MS
OCR_BATCH_MAX_PAGES=40
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

`OCR_DAILY_HARD_LIMIT` não pertence ao contrato de lançamento. A capacidade é determinada pela quota real do provedor; os contadores locais servem para telemetria e não criam uma cota paralela da aplicação.

Não cadastre `GEMINI_API_KEY` nem service-role key no GitHub Actions. O job usa apenas:

```text
STAGING_SUPABASE_URL
STAGING_SUPABASE_PUBLISHABLE_KEY
STAGING_AUTHORIZED_EMAIL
STAGING_AUTHORIZED_PASSWORD
```

## Executar o smoke real

No GitHub Actions:

1. abra `Verify OCR staging`;
2. escolha a branch ou SHA desejado;
3. execute e aprove o environment `staging`, quando protegido.

Também é possível executar o verificador localmente:

```bash
STAGING_SUPABASE_URL=https://PROJECT.supabase.co \
STAGING_SUPABASE_PUBLISHABLE_KEY=... \
STAGING_AUTHORIZED_EMAIL=... \
STAGING_AUTHORIZED_PASSWORD=... \
pnpm test:staging:ocr
```

Prefira variáveis temporárias ou gerenciador de secrets; não grave senhas no histórico do shell.

## Contrato do smoke de imagem

A prova atual:

- autentica a conta pela API pública;
- confirma `is_authorized_user()`;
- gera em memória um PNG sintético com `FICHARIO OCR 2718`;
- usa nonce privado para produzir SHA-256 diferente em cada execução;
- envia somente o PNG sintético ao prefixo privado `<user>/staging-probes/`;
- cria um documento, uma página e um trabalho sintéticos por `create_ocr_staging_probe`;
- invoca `process-ocr` com `{ pageIds: [pageId] }`;
- exige o envelope agregado de lançamento;
- exige que o `pageId` esteja em `completedPageIds` e não esteja em conjuntos pendentes/falhos;
- confirma documento, página e trabalho em `ready` ou `needs_review`;
- exige `extraction_source = 'ocr'` e transcrição contendo `fichario`, `ocr` e `2718` após normalização;
- exige tentativa e timestamp terminal, sem `last_error_code`;
- invoca `delete-document` antes de encerrar a sessão;
- preserva simultaneamente falhas da prova e da limpeza.

O RPC `create_ocr_staging_probe` é deliberadamente estreito: exige usuário autenticado/ativo, IDs explícitos, hash SHA-256 válido e caminho `.png` no prefixo `staging-probes` do próprio usuário. Ele não substitui nenhum fluxo de importação da aplicação.

O job não imprime transcrição, IDs, caminhos, URLs assinadas ou credenciais.

## Contrato de resposta do OCR

`process-ocr` aceita somente os corpos de lote de lançamento:

```json
{ "pageIds": ["<uuid>"] }
```

ou, quando há manifesto registrado:

```json
{ "batchId": "<uuid>", "pageIds": ["<uuid>"] }
```

O retorno é agregado:

```json
{
  "state": "complete",
  "completedPageIds": ["<uuid>"],
  "reviewPageIds": [],
  "pendingPageIds": [],
  "failedPageIds": [],
  "splitRequiredPageIds": [],
  "unexpectedResultPageIds": []
}
```

Não existem no contrato público de lançamento o corpo `{ pageId }`, `warningCount` no retorno da função, nem envelopes de página única como `already_complete`, `busy` ou `quota_exhausted`. Esses nomes podem existir internamente na máquina de estados do banco, mas não são API pública do cliente.

## Matriz obrigatória de lotes e PDFs

O smoke de imagem é necessário, mas não suficiente para promover a implementação adaptativa. Execute também as provas abaixo com documentos sintéticos ou autorizados.

### Texto nativo

Fixture: PDF textual de cinco páginas.

Esperado:

- texto extraído localmente;
- zero chamadas Gemini;
- nenhuma imagem temporária para página textual;
- busca disponível depois da publicação;
- hash do original inalterado.

### PDF misto

Fixture: texto nativo mais três páginas digitalizadas.

Esperado:

- somente páginas visuais aparecem no manifesto OCR;
- números originais são preservados;
- falha visual não invalida texto nativo já persistido.

### Lote normal

Fixture: PDF digitalizado de 45 páginas.

Com os controles padrão, espera-se normalmente:

- duas chamadas iniciais, 40 + 5;
- 45 resultados persistidos por página;
- `ocr_pages = 45`;
- `ocr_batches = 2` e `ocr_calls = 2`, salvo divisão provocada por resposta real;
- tamanho médio de lote visível no painel;
- temporários apagados somente depois da persistência segura.

### Omissão, duplicação e truncamento

Use gateway simulado ou resposta controlada.

Esperado:

- páginas válidas são persistidas imediatamente;
- páginas omitidas ou duplicadas recebem `ocr_batch_response_incomplete` e entram no subconjunto a repetir/dividir;
- JSON truncado é tratado como resposta inválida;
- somente o subconjunto afetado é repetido;
- páginas aceitas não são reenviadas;
- uma página isolada que continua falhando permanece pendente, sem loop infinito.

### Limite agregado de bytes

Configure temporariamente `OCR_BATCH_MAX_BYTES` para um valor pequeno.

Esperado:

- somente o prefixo que cabe no limite é enviado;
- as páginas restantes aparecem em `splitRequiredPageIds`;
- o cliente cria lotes menores;
- nenhuma chamada ultrapassa o limite configurado;
- o original não é recomprimido.

### Página temporária grande

Faça a primeira renderização superar o limite seguro configurado.

Esperado:

- somente a página afetada recebe tratamento conservador;
- o original permanece intacto;
- uma derivação ainda grande não é enviada silenciosamente nem causa estouro de memória.

### Rate limit e quota do provedor

Teste separadamente:

- fila/rate limiter local cheio: página permanece pendente e recebe retry controlado;
- `429` do modelo primário: o fluxo pode tentar o modelo fallback configurado;
- falha do fallback: estado persistido segue a classificação segura do provedor;
- quota diária real: páginas ficam `blocked_quota` conforme a política de persistência;
- contador local elevado: não bloqueia chamada que o provedor aceitaria.

Nenhum cenário pode ativar billing ou escolher plano pago.

### Cancelamento e retomada

Cancele depois do primeiro lote de um PDF com mais de 40 páginas e reabra o documento.

Esperado:

- páginas concluídas permanecem concluídas;
- páginas não iniciadas permanecem pendentes;
- retomada agrupa somente páginas executáveis;
- resposta parcial durante retomada também é dividida;
- temporário necessário a outra rota não é apagado prematuramente.

### PDFs maiores que uma chamada

Fixtures:

- PDF sintético acima de 50 MB;
- PDF sintético acima de 1.000 páginas.

Esperado:

- um único documento lógico permanece no Drive;
- o original não é enviado inteiro ao Gemini;
- somente páginas que precisam de OCR são renderizadas;
- artefatos temporários respeitam bytes e páginas do lote;
- hash do original antes e depois é idêntico.

O download direto pelo Google Picker continua limitado pelo caminho de download no navegador. Arquivos maiores precisam permanecer ou ser copiados no Drive pelo fluxo Drive-first.

## Auditoria do banco

Para cada prova, confira:

- `ocr_batches.page_ids` e `page_numbers` na ordem correta;
- `ocr_jobs.batch_id` e `batch_ordinal`;
- `provider_call_count` igual às chamadas iniciadas;
- tentativas por lote e por página;
- `last_error_code`, `next_retry_at` e terminalidade idempotente;
- RLS impedindo outro usuário de ler ou finalizar o lote;
- `usage_daily` separando páginas, lotes, chamadas e tentativas;
- ausência de qualquer contador apresentado como “páginas restantes”.

Não copie texto de páginas para logs, artifacts ou relatórios.

## Relatório sanitizado

Toda execução publica temporariamente o artifact sanitizado do OCR staging. O relatório contém somente:

- `status`: `pass`, `fail` ou `not_run`;
- `failureStage` enumerado;
- flags de autenticação, autorização, criação do probe, função e persistência;
- estados terminais, contagens e presença booleana dos tokens sintéticos;
- resultado da remoção e encerramento da sessão;
- classificação allowlisted de falhas do provedor, quando aplicável.

Ele não contém e-mail, IDs, caminhos, URL, transcrição, mensagem bruta do provedor ou secrets.

## Interpretação de falhas

Falhas antes de `process-ocr` normalmente indicam Auth, allowlist, migrations, Storage ou configuração do environment.

`ocr_not_configured` indica variável ausente ou inválida. Falhas do provedor devem ser interpretadas pela classificação segura e pelos estados persistidos, sem trocar automaticamente chave, plano ou billing.

Se a transcrição sintética não contiver os três tokens, não enfraqueça o contrato. Revise imagem, modelo e prompt.

## Recuperação

Se o job for interrompido depois da criação:

1. procure na conta de staging um documento com título `__staging_ocr_probe__`;
2. confirme que `storage_path` está sob `<uuid-da-conta>/staging-probes/`;
3. remova pelo fluxo normal `delete-document`;
4. não use `service_role` no workflow para ocultar falha de cleanup.

## Critério de aprovação

A implementação só recebe `PASS` de staging quando:

- migrations e pgTAP passam em banco limpo;
- Edge Functions passam no `deno check`;
- testes unitários, build e E2E passam no mesmo SHA;
- smoke real de imagem passa;
- PDF textual produz zero chamadas;
- PDF visual multipágina usa menos chamadas do que páginas;
- omissão, duplicação e truncamento não perdem páginas;
- cancelamento e retomada não repetem páginas concluídas;
- contador local alto não bloqueia OCR;
- rate limit e quota real preservam estado;
- original mantém o mesmo hash;
- nenhum billing ou fallback pago foi ativado.

Registre SHA, modelo, data, limites técnicos e evidências em `docs/CURRENT_STATUS.md` e `docs/DEPLOYMENT.md`.
