# Validação de OCR real em staging

O workflow `Verify OCR staging` executa uma leitura real contra as Edge Functions e o provedor configurado no projeto Supabase de staging. Ele usa uma conta autorizada, uma chave publicável e conteúdo sintético gerado durante o job.

A execução é **manual** e exige marcar `confirm_external_ocr`. A confirmação existe porque a chamada sai da infraestrutura local e consome quota real do provedor. O workflow não habilita billing, não escolhe fallback pago e não recebe a chave Gemini.

## Pré-requisitos no Supabase

Antes da primeira execução:

1. crie e valide o projeto descrito em `docs/SUPABASE_STAGING.md`;
2. aplique todas as migrations, incluindo:
   - `202608060014_provider_only_ocr_batches.sql`;
   - `202608060015_ocr_batch_usage_and_hardening.sql`;
   - `202608060016_harden_ocr_batch_transitions.sql`;
3. implante as Edge Functions `process-ocr` e `delete-document`;
4. mantenha a conta `STAGING_AUTHORIZED_EMAIL` ativa em `public.app_users`;
5. configure nas Edge Functions:

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_PROMPT_VERSION
```

Controles técnicos opcionais:

```text
OCR_BATCH_MAX_PAGES=40
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

`OCR_DAILY_HARD_LIMIT` não pertence mais ao contrato. Remova o segredo antigo depois de confirmar que a Edge Function nova foi implantada. A capacidade é determinada pela quota real do provedor; contadores locais servem somente para telemetria.

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
3. marque `confirm_external_ocr`;
4. execute e aprove o environment `staging`, quando protegido.

Sem confirmação, o job termina antes de instalar dependências ou chamar o OCR.

Também é possível executar o verificador localmente:

```bash
STAGING_SUPABASE_URL=https://PROJECT.supabase.co \
STAGING_SUPABASE_PUBLISHABLE_KEY=... \
STAGING_AUTHORIZED_EMAIL=... \
STAGING_AUTHORIZED_PASSWORD=... \
pnpm test:staging:ocr
```

Prefira variáveis temporárias ou gerenciador de secrets; não grave senhas no histórico do shell.

## Contratos do smoke de imagem

A prova atual:

- autentica a conta pela API pública;
- confirma `is_authorized_user()`;
- registra consentimento OCR;
- gera em memória um PNG sintético com `FICHARIO OCR 2718`;
- usa nonce privado para SHA-256 diferente em cada execução;
- envia original e miniatura ao prefixo privado da conta;
- cria documento, página e trabalho por `create_image_import`;
- invoca `process-ocr` com o `pageId` legado, que internamente usa um lote de uma página;
- exige resposta terminal `complete`;
- confirma documento, página e trabalho em `ready` ou `needs_review`;
- exige `extraction_source = 'ocr'` e transcript contendo os três tokens após normalização;
- exige tentativa e timestamp terminal, sem `last_error_code`;
- invoca `delete-document` antes de encerrar a sessão;
- preserva simultaneamente falhas da prova e da limpeza.

O job não imprime transcript, tokens, URLs assinadas ou credenciais.

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
- páginas omitidas ou duplicadas recebem `ocr_batch_split_required`;
- JSON truncado é tratado como páginas ausentes daquele lote;
- somente o subconjunto afetado é dividido;
- páginas aceitas não são reenviadas;
- uma página isolada que continua falhando permanece pendente, sem loop infinito.

### Limite agregado de bytes

Configure temporariamente `OCR_BATCH_MAX_BYTES` para um valor pequeno.

Esperado:

- o maior prefixo seguro é enviado;
- as páginas restantes voltam em `splitRequiredPageIds`;
- o cliente cria lotes menores;
- nenhuma chamada ultrapassa o limite configurado;
- o original não é recomprimido.

### Página temporária grande

Faça a primeira renderização superar 12 MiB.

Esperado:

- somente essa página recebe uma segunda renderização conservadora;
- o original permanece intacto;
- uma derivação ainda grande não é enviada silenciosamente nem causa estouro de memória.

### Cota do provedor

Teste separadamente:

- `429` temporário: página e lote ficam `retryable`, com backoff finito;
- quota diária real: páginas ficam `blocked_quota` até o período seguinte;
- contador local elevado: não bloqueia chamada aceita pelo provedor.

Nenhum cenário pode ativar billing ou fallback pago.

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

O download direto pelo Google Picker continua limitado a 50 MiB no navegador. Esse é um limite técnico do caminho de download, não do documento lógico. Arquivos maiores precisam permanecer ou ser copiados no Drive pelo fluxo Drive-first.

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

Toda execução manual publica por sete dias o artifact `ocr-staging-report-<run-id>`. O JSON é inicializado antes da confirmação, então uma execução recusada registra `status = not_run` sem instalar dependências nem chamar OCR.

O relatório contém somente:

- `status`: `pass`, `fail` ou `not_run`;
- `failureStage` enumerado;
- flags de autenticação, autorização, consentimento, importação, função e persistência;
- estados terminais, contagens e presença booleana dos tokens sintéticos;
- resultado da remoção e encerramento da sessão.

Ele não contém e-mail, IDs, caminhos, URL, transcript, mensagem do provedor ou secrets.

## Interpretação de falhas

Falhas antes de `process-ocr` normalmente indicam Auth, allowlist, migrations, Storage ou configuração do environment.

`ocr_not_configured` indica variável ausente ou inválida. Falhas do provedor devem ser interpretadas pelos estados persistidos, sem troca automática de modelo, chave ou plano.

Se o transcript sintético não contiver os três tokens, não enfraqueça o contrato. Revise imagem, modelo e prompt.

## Recuperação

Se o job for interrompido depois da criação:

1. procure documento da conta de teste com título `__staging_ocr_probe__`;
2. confirme que os caminhos estão sob `<uuid-da-conta>/<document-id>/`;
3. remova pelo fluxo normal `delete-document`;
4. não use service-role no workflow para ocultar falha de cleanup.

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
- `429` e quota real preservam estado;
- original mantém o mesmo hash;
- nenhum billing ou fallback pago foi ativado.

Registre SHA, modelo, data, limites técnicos e evidências em `docs/CURRENT_STATUS.md` e `docs/DEPLOYMENT.md`.
