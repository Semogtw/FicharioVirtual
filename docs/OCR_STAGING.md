# Validação de OCR real em staging

O workflow `Verify OCR staging` executa uma única leitura real contra as Edge Functions e o provedor configurado no projeto Supabase de staging. Ele usa somente uma conta autorizada, uma chave publicável e uma imagem sintética gerada durante o job.

A execução é **manual** e exige marcar `confirm_external_ocr`. Essa confirmação existe porque a chamada sai da infraestrutura local e pode consumir quota do provedor. O workflow não habilita billing, não escolhe fallback pago e não recebe a chave Gemini.

## Pré-requisitos no Supabase

Antes da primeira execução:

1. crie e valide o projeto Supabase de staging descrito em `docs/SUPABASE_STAGING.md`;
2. aplique todas as migrations da branch que será testada;
3. implante as Edge Functions `process-ocr` e `delete-document`;
4. mantenha a conta `STAGING_AUTHORIZED_EMAIL` ativa em `public.app_users`;
5. configure no ambiente das Edge Functions:

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_PROMPT_VERSION
OCR_DAILY_HARD_LIMIT
```

`APP_ORIGIN` precisa ser uma origem HTTPS válida do host de staging. `OCR_DAILY_HARD_LIMIT` deve ser um inteiro positivo e conservador. A credencial Gemini permanece somente no Supabase.

Não cadastre `GEMINI_API_KEY` nem service-role key no GitHub Actions. O job usa os mesmos secrets públicos da verificação Supabase:

```text
STAGING_SUPABASE_URL
STAGING_SUPABASE_PUBLISHABLE_KEY
STAGING_AUTHORIZED_EMAIL
STAGING_AUTHORIZED_PASSWORD
```

## Executar

No GitHub Actions:

1. abra `Verify OCR staging`;
2. escolha a branch ou SHA desejado;
3. marque `confirm_external_ocr`;
4. execute e aprove o environment `staging`, se ele estiver protegido.

Sem a confirmação, o job termina antes de instalar dependências ou fazer qualquer chamada OCR.

Também é possível executar o verificador localmente, assumindo que o projeto remoto já está preparado:

```bash
STAGING_SUPABASE_URL=https://PROJECT.supabase.co \
STAGING_SUPABASE_PUBLISHABLE_KEY=... \
STAGING_AUTHORIZED_EMAIL=... \
STAGING_AUTHORIZED_PASSWORD=... \
pnpm test:staging:ocr
```

Prefira variáveis temporárias ou um gerenciador de secrets; não grave senhas no histórico do shell.

## Contratos verificados

A execução:

- autentica a conta pela API pública;
- confirma que `is_authorized_user()` permanece verdadeiro;
- registra a versão de consentimento OCR;
- gera em memória um PNG válido e legível com o texto `FICHARIO OCR 2718`;
- adiciona um nonce privado ao PNG para produzir SHA-256 diferente a cada execução;
- envia original e miniatura ao prefixo privado do UUID autenticado;
- cria documento, página e trabalho OCR por `create_image_import`;
- invoca `process-ocr` com o `pageId` sintético;
- exige resposta terminal `complete`;
- confirma que documento, página e trabalho terminam alinhados em `ready` ou `needs_review`;
- exige `extraction_source = 'ocr'` e transcript contendo `fichario`, `ocr` e `2718` após normalização;
- exige tentativa e timestamp terminal persistidos, sem `last_error_code`;
- invoca `delete-document` antes de encerrar a sessão;
- preserva simultaneamente falhas da verificação e da limpeza.

O job não imprime transcript, tokens, URLs assinadas ou credenciais. O conteúdo enviado é totalmente sintético.

## Relatório sanitizado

Toda execução publica por sete dias o artifact `ocr-staging-report-<run-id>`. O arquivo JSON é inicializado antes da confirmação manual, portanto uma execução recusada ainda registra `status = not_run` sem instalar dependências nem chamar o OCR.

Quando o verificador executa, ele substitui o arquivo com um relatório schema 1 contendo somente:

- `status`: `pass`, `fail` ou `not_run`;
- `failureStage`: etapa enumerada, sem mensagem de erro bruta;
- flags de autenticação, autorização, consentimento, importação, função e persistência;
- estados terminais, contagens e presença booleana dos tokens sintéticos;
- resultado da remoção do documento e do encerramento da sessão.

O relatório não contém e-mail, UUID de usuário, IDs de documento/página/job, caminhos de Storage, URL, transcript, mensagem do provedor ou secrets. O upload usa `if: always()`, permitindo comparar falhas de configuração, execução e cleanup sem consultar dados privados.

## Interpretação de falhas

Falhas antes de `process-ocr` normalmente indicam Auth, allowlist, migrations, Storage ou configuração do environment GitHub.

Falhas com `ocr_not_configured` indicam ausência ou valor inválido em uma das variáveis da Edge Function. Falhas de provider devem ser interpretadas pela classificação persistida em `ocr_jobs`, sem substituir automaticamente modelo, chave ou plano.

Se o transcript não contiver os três tokens, trate como falha do smoke test. Não enfraqueça o contrato para aceitar texto vazio ou irrelevante; revise primeiro a imagem, o modelo e o prompt configurados.

## Recuperação

O fluxo normal remove o documento pela Edge Function, incluindo original, miniatura, página e trabalho relacionado. Se o job for interrompido depois da criação:

1. procure um documento da conta de teste com título `__staging_ocr_probe__`;
2. confirme que os caminhos estão sob `<uuid-da-conta>/<document-id>/`;
3. use o fluxo normal `delete-document` para removê-lo;
4. não use service-role dentro do workflow para ocultar uma falha de cleanup.

A conta de teste pode manter o consentimento OCR registrado entre execuções. Ela não deve ser reutilizada como conta pessoal ou de produção.

## Limites desta prova

Um resultado verde comprova uma chamada real bem-sucedida para uma imagem sintética. Ele não substitui:

- injeção controlada de 429 diário e transitório;
- 503, timeout e payload inválido;
- PDFs digitalizados ou mistos;
- retomada depois de encerramento do navegador;
- medição de memória em dispositivo físico;
- confirmação administrativa de billing desativado.
