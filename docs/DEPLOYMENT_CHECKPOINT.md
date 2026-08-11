# Checkpoint de deploy

_Atualizado: 2026-08-11_

Este arquivo registra a evidência operacional mais recente do caminho de release. Ele complementa os documentos históricos de arquitetura e substitui checkpoints antigos quando houver conflito de status.

## SHA validado e staging

O checkpoint operacional atual é:

```text
SHA: 6ea434f65714c665a62037e7c4c0a561bdcccf74
Validate current head: 31457054179 — PASS
Verify Supabase staging: 31457552460 — PASS
Verify OCR staging: 31457554164 — PASS
```

Esses recibos comprovam os gates locais completos, Auth/RLS/Storage privado, pareamento desktop por código de uso único e OCR real com imagem sintética. O primeiro deploy do artifact no Cloudflare Pages continua pendente: o projeto existe, mas não há deployment, e os verificadores registraram a ausência dos secrets Google Picker e `CLOUDFLARE_API_TOKEN`.

O checkpoint funcional mais recente validado antes deste documento é:

```text
SHA: db188a5b65d1fa1fd8650603762b63a897155645
Validate current head: 31430428156 — PASS
Deploy Supabase staging: 31430894313 — PASS
```

No `Validate current head` passaram no mesmo SHA:

- frontend (`pnpm verify`);
- source/offline security gates;
- Chromium e E2E;
- Deno / Edge Functions;
- Supabase local + pgTAP;
- agregador fail-closed `Reject incomplete verification`.

No `Deploy Supabase staging` passaram:

- resolução do SHA validado;
- detecção de mudanças de runtime;
- link do projeto protegido de staging;
- inspeção de drift de migrations;
- dry-run com `--include-all`;
- aplicação das migrations pendentes;
- confirmação do histórico ligado;
- deploy das Edge Functions versionadas;
- listagem do runtime remoto;
- Auth, allowlist, RLS e Storage privado;
- pareamento Desktop OCR de uso único;
- OCR real com imagem sintética e persistência terminal.

## Evidência OCR real

Artifact sanitizado:

```text
ocr-staging-report-31430894313
artifact id: 9079117176
sha256: 746b827962717df067497254118a1853820dca34dcc8c70dc853a925f2b0fd1f
```

Resultado sanitizado observado:

```text
status: pass
authenticated: true
authorized: true
consentRecorded: true
importCreated: true
functionCompleted: true
persistenceVerified: true
documentStatus: ready
pageStatus: ready
jobStatus: ready
needsReview: false
warningCount: 0
attemptCount: 1
expected OCR tokens: all present
document cleanup: success
session cleanup: success
```

Nenhum token, senha, texto privado ou corpo bruto de erro do provedor faz parte desse artifact.

## Correções fechadas neste ciclo

### Drift de RPC e source gate

O espelho TypeScript e o gate de cobertura foram alinhados às RPCs novas de importação e roteamento OCR. O source gate também passou a exigir a RPC real de conclusão com geometria, `complete_ocr_job_with_geometry`.

### Artifact de staging ligado ao SHA validado

`Build deployable Fichário staging artifact` agora falha fechado se:

- o SHA do run não for o HEAD atual da `main`;
- não existir um `Validate current head` concluído com sucesso para exatamente esse SHA, branch `main` e evento `push`.

O pipeline dedicado de deployment provou formatação, sintaxe, fronteiras de workflow, build, headers/PWA, configuração pública congelada, empacotamento determinístico, checksums e contrato staging-only.

### Histórico de migrations de staging

O staging continha quatro versões remotas renumeradas que correspondiam ao SQL final de quatro migrations canônicas do repositório:

```text
20260810110013 -> 202608101045  ocr_provider_telemetry
20260810120319 -> 202608101235  ocr_image_preprocessing
20260810120356 -> 202608101236  ocr_preprocessing_telemetry
20260810120429 -> 202608101237  ocr_image_source_display
```

Foi comprovado que cada conteúdo aplicado correspondia à versão final do arquivo canônico e que não havia target canônico já registrado. A correção alterou somente os metadados de versão em `supabase_migrations.schema_migrations`, com pré-condições fail-closed; nenhum DDL foi reaplicado ou removido. O deploy seguinte confirmou o histórico ligado e aplicou normalmente as migrations realmente pendentes.

### Verificadores pós-deploy protegidos

A composição anterior via reusable workflow não recebia os secrets do environment `staging` na cadeia automática, embora o mesmo workflow standalone funcionasse. Os gates pós-deploy foram movidos para jobs reais do orquestrador com `environment: staging`, checkout do SHA validado e concorrência serializada.

O run `31430894313` comprovou que esses jobs recebem corretamente o ambiente protegido e passam Auth/RLS/Storage, pairing e OCR real.

### Contrato legado do OCR

O frontend exige no sucesso legado:

```text
state=complete
needsReview=<boolean>
warningCount=<integer>
```

A Edge Function persistia corretamente warnings, mas não devolvia `warningCount`. O runtime agora calcula a contagem a partir das warnings realmente persistidas e a devolve no contrato legado. O smoke real passou com `warningCount=0`.

O cliente também possui compatibilidade idempotente para respostas agregadas de uma página já concluída: quando o corpo de lote confirma que a página pedida já está completa, o cliente converte o resultado para `already_complete` e preserva `needsReview`. Existe teste dedicado para esse cenário.

### Retry OCR no navegador

O banco oculta jobs retryable até `next_retry_at`. Antes da correção, o runner do navegador podia receber `retry_later`, sondar novamente em +5 s, observar uma fila temporariamente vazia e encerrar antes da janela de retry do banco (~45 s).

O runner agora mantém os IDs com retry adiado durante polls vazios e continua a janela finita `0 / 5 s / 20 s / 60 s`. O teste reproduz tentativa inicial, duas filas vazias, reaparecimento do mesmo job e conclusão. O smoke de staging usa a mesma janela finita e continua exigindo sucesso terminal — `retry_later` esgotado nunca é tratado como PASS.

## Schema e tipos TypeScript

Os tipos canônicos foram gerados a partir do projeto Supabase de staging já reconciliado. A saída confirma que o schema remoto contém campos, relações, enums e RPCs mais novos que o espelho manual atual, incluindo Drive, preprocessing, geometria, Desktop OCR e RPCs recentes.

`src/lib/types/database.ts` e `src/lib/types/database-rpc-extensions.ts` ainda devem ser consolidados a partir dessa saída gerada. Isso é dívida de tipagem/higiene e não bloqueou os gates de runtime, porque o gate de cobertura RPC e o CI estão verdes. Não substituir o arquivo manual cegamente: preservar aliases/extensões locais conscientemente e remover a bridge somente depois da comparação completa.

## Bloqueios externos restantes

Os itens abaixo não são resolvíveis apenas por alteração no repositório:

### Cloudflare Pages

O frontend final ainda depende de credenciais válidas no environment protegido `staging-deploy`:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Use `Verify Cloudflare staging credentials` para provar o estado atual sem expor valores. Depois das credenciais, o fluxo canônico continua:

1. `Build deployable Fichário staging artifact` para o HEAD verde;
2. verificar manifest/checksums do artifact;
3. `Deploy Fichário artifact to Cloudflare Pages` com o run ID e o SHA exato;
4. executar o verificador HTTP/PWA/headers sobre a URL retornada pelo Direct Upload.

O conector usado nesta sessão não possui ação de `workflow_dispatch`, portanto não é correto contornar o workflow manual nem alterar sua proteção apenas para dispará-lo remotamente.

### Google Drive real

Ainda é necessária uma conta Google real de staging para validar OAuth, Picker, `drive.file`, upload retomável, ranges de PDF grande, feed de mudanças, conflitos e recuperação distribuída.

### Dispositivos e operação

Ainda são manuais/externos:

- matriz física em celular e tablet;
- benchmark/validação do Desktop OCR no hardware alvo;
- confirmação administrativa de billing/fallback pago;
- backup real do projeto e ensaio operacional de rollback/forward-fix;
- backend Supabase isolado de produção, que ainda não foi provisionado.

## Critério para não confundir código pronto com release pronta

O backend de staging e o OCR real estão comprovados. Isso não significa que o frontend já esteja publicado nem que produção esteja provisionada.

Uma release pública só deve ser marcada pronta depois de haver evidência para o mesmo SHA de:

```text
Validate current head: PASS
Deploy Supabase staging: PASS
Verify Supabase staging: PASS
Verify OCR staging: PASS
Build staging artifact: PASS
Cloudflare Direct Upload: PASS
host/PWA/headers: PASS
Google Drive real: PASS ou risco explicitamente aceito
matriz física: PASS ou riscos registrados
billing + backup + rollback: registrados
```
