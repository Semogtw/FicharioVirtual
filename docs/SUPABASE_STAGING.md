# Validação e deploy do Supabase em staging

O staging do Fichário separa duas responsabilidades:

- `Deploy Supabase staging`: deploy administrativo manual de migrations e Edge Functions versionadas;
- `Verify Supabase staging`: verificação de Auth, allowlist, RLS e Storage privado usando apenas credenciais públicas e contas sintéticas de teste.

## Estado confirmado

O checkpoint `f87e1edc47268b4e0d2ea0742dac690c96d93646` foi validado pelo `Validate current head` `31333367357` e implantado pelo `Deploy Supabase staging` `31333367356`, ambos com **success**.

A sonda protegida `31333418948` confirmou a fronteira Gemini sem persistência: o job validou `STAGING_SERVICE_ROLE_KEY` como não vazio, rejeitou requisição anônima com HTTP 401 e registrou somente o envelope sanitizado. O resultado final foi `direct=429 gemini_daily_quota` e `process=200 provider_ok`. Isso prova que o caminho `process-ocr` alcançou o Gemini e validou uma resposta real após a correção do request; não equivale a um job normal persistido.

O diagnóstico reproduziu que `responseFormat` e campos de schema em `generationConfig` eram rejeitados com HTTP 400 pelo endpoint/modelo de staging. O cliente corrigido envia `responseMimeType: application/json`, carrega o contrato JSON no prompt e mantém o parser local fail-closed.

O cleanup `31333977753` terminou com **success**, incluindo a exclusão explícita e exclusiva de `ocr-boundary-probe`. A consulta posterior ao projeto registra `process-ocr` `ACTIVE v19`, não lista `ocr-boundary-probe` e preserva as funções Drive/desktop. O workflow administrativo permanente foi restaurado no commit `9ff4975bc046004628635834bdedadce8bb5e264` para `workflow_dispatch` apenas e `cancel-in-progress: false`.

O `401` histórico entre verificadores de staging tinha outra causa: workflows concorrentes compartilhavam a mesma conta protegida e `auth.signOut()` invalidava a sessão global. A serialização em `staging-contract-verification` continua sendo a correção desse problema separado.

Nenhum valor de secret foi registrado. `STAGING_SERVICE_ROLE_KEY` e `GEMINI_API_KEY` são citados somente por nome/estado.

## Preparar o projeto

1. Use um projeto Supabase exclusivo para staging.
2. Aplique todas as migrations da branch que será validada.
3. Publique as Edge Functions da mesma branch depois do `db push`.
4. Crie duas contas Auth exclusivas para testes automatizados.
5. Adicione somente a primeira conta em `public.app_users` com `is_active = true`.
6. Confirme que a segunda conta autentica normalmente, mas não possui linha ativa na allowlist.
7. Confirme que o bucket privado `documents` foi criado pelas migrations.
8. Não copie documentos pessoais ou secrets de produção para o projeto.

As contas precisam ser diferentes e devem permanecer reservadas ao gate. Não reutilize a conta pessoal administradora.

## Deploy administrativo versionado

O histórico remoto precisa corresponder aos arquivos em `supabase/migrations/`, e as Edge Functions devem sair de `supabase/functions/` + `supabase/config.toml` do mesmo checkout.

O workflow manual `Deploy Supabase staging` executa, nessa ordem:

```bash
supabase link --project-ref "$STAGING_SUPABASE_PROJECT_REF"
supabase migration list --linked
supabase db push --linked --dry-run --include-all
supabase db push --linked --include-all
supabase migration list --linked
supabase functions deploy --project-ref "$STAGING_SUPABASE_PROJECT_REF"
supabase functions list --project-ref "$STAGING_SUPABASE_PROJECT_REF"
```

O workflow usa `--include-all` deliberadamente para reconciliar arquivos locais pendentes mesmo quando uma migration remota posterior já existe. O dry-run continua failure-visible antes da aplicação. Não use `--no-verify-jwt` global; as políticas individuais de JWT pertencem ao `supabase/config.toml` versionado.

Não aplique somente a migration mais nova quando o staging estiver atrasado. Também não substitua o fluxo versionado por uma sequência de DDLs avulsos que deixe `supabase_migrations.schema_migrations` divergente do Git. Um `db push` posterior depende desse histórico estar correto.

### Environment administrativo de deploy

Crie um environment separado chamado `staging-deploy`. Ele deve ser usado somente pelo workflow `Deploy Supabase staging` e, quando a configuração da conta permitir, exigir aprovação manual.

Configure nele:

```text
Secret: STAGING_SUPABASE_ACCESS_TOKEN
Secret: STAGING_SUPABASE_DB_PASSWORD
Variable: STAGING_SUPABASE_PROJECT_REF
```

O workflow usa `contents: read`, checkout com `persist-credentials: false` e `supabase/setup-cli@v2` com CLI `2.111.0`.

O environment `staging-deploy` está protegido e foi usado nos deploys `31333367356` e `31333977753`. A aprovação manual continua sendo parte do procedimento administrativo.

### Secrets das Edge Functions

Além das variáveis fornecidas automaticamente pelo Supabase hospedado, os fluxos atuais usam configuração de runtime como:

```text
APP_ORIGIN
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_DRIVE_REDIRECT_URI
GOOGLE_DRIVE_ROOT_FOLDER_NAME
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_PROMPT_VERSION
```

Também existem ajustes opcionais do OCR, como limites de páginas/bytes e timeout de request. Não versionar os valores desses secrets.

A auditoria não expõe valores de Edge Function secrets. O runtime comprovou que `GEMINI_API_KEY`, modelo e prompt estão configurados em nível suficiente para `process-ocr` completar a chamada sintética real; isso não autoriza registrar seus valores.

## Configurar o environment de verificação do GitHub

Crie um environment separado chamado `staging` e cadastre:

```text
STAGING_SUPABASE_URL
STAGING_SUPABASE_PUBLISHABLE_KEY
STAGING_AUTHORIZED_EMAIL
STAGING_AUTHORIZED_PASSWORD
STAGING_UNAUTHORIZED_EMAIL
STAGING_UNAUTHORIZED_PASSWORD
```

O environment `staging` também possui `STAGING_SERVICE_ROLE_KEY`, validado como não vazio pela sonda protegida temporária. O gate comum de Auth/RLS/Storage deve continuar usando somente a chave publicável/anon; service-role fica reservado a ações administrativas explicitamente protegidas e não deve aparecer em logs.

A chave usada pelo verificador comum deve ser a publicável/anon do projeto.

Quando disponível, configure aprovação obrigatória para o environment. O job só recebe os secrets depois da liberação do environment.

## Executar

Para implantar schema + Edge runtime no GitHub Actions:

1. abra `Deploy Supabase staging`;
2. escolha `Run workflow` na branch ou SHA desejado;
3. aprove o environment `staging-deploy`;
4. confira a lista de migrations e o dry-run;
5. confirme `Confirm linked migration history`;
6. confirme `Deploy versioned Edge Functions`;
7. confira `Confirm deployed Edge Functions`.

Depois, para verificar Auth/RLS/Storage:

1. abra `Verify Supabase staging`;
2. escolha `Run workflow` na mesma branch ou SHA;
3. aprove o environment `staging`;
4. confirme o resultado do job `verify`.

A verificação também pode ser executada localmente:

```bash
STAGING_SUPABASE_URL=https://PROJECT.supabase.co \
STAGING_SUPABASE_PUBLISHABLE_KEY=... \
STAGING_AUTHORIZED_EMAIL=... \
STAGING_AUTHORIZED_PASSWORD=... \
STAGING_UNAUTHORIZED_EMAIL=... \
STAGING_UNAUTHORIZED_PASSWORD=... \
pnpm test:staging:supabase
```

Evite inserir secrets diretamente no histórico do shell. Prefira um gerenciador de secrets ou variáveis temporárias do ambiente de execução.

## Contrato de verificação já executado

No run `31292512306` (SHA antigo `93d76ea`), o gate remoto de Auth/RLS/Storage executou:

- autentica as duas contas com a API pública;
- exige UUIDs Auth distintos;
- confirma `is_authorized_user() = true` para a conta permitida;
- confirma `is_authorized_user() = false` para a segunda conta;
- verifica que a conta permitida lê a própria linha ativa de `app_users`;
- cria um caderno-sentinela temporário pertencente à conta permitida;
- confirma que a conta proprietária encontra exatamente a sentinela;
- confirma que a segunda conta recebe zero linhas ao consultar o mesmo UUID;
- envia um PNG sintético de 1 × 1 para `documents/<uuid>/__staging_probe_<uuid>/probe.png`;
- exige que somente a conta proprietária liste e baixe o objeto;
- compara os bytes baixados com o payload original;
- cria URL assinada curta e valida origem, caminho, token, bytes e expiração;
- exige que a segunda conta não consiga baixar nem assinar o objeto da proprietária;
- remove objeto e caderno antes de encerrar as sessões;
- preserva simultaneamente falhas da verificação e da limpeza.

As sentinelas usam prefixo `__staging_probe_`, somente dados sintéticos e nenhum conteúdo do usuário. Tokens de URLs assinadas não são escritos nos logs.

Essa execução não cobre os contratos SQL adicionados depois desse SHA. Os contratos locais/remotos de banco do HEAD atual cobrem RLS, privilégios, `SECURITY DEFINER`/`INVOKER`, quotas, manifests OCR e cobertura da FK composta de `ocr_batches`, mas a execução remota correspondente está `NOT RUN`.

## O que os gates ainda não provam

A verificação histórica de Auth/RLS/Storage e os contratos do repositório não substituem:

- OAuth Google completo com credenciais reais de staging;
- leitura/alteração real de arquivos no Google Drive;
- fluxo OCR normal com página/job, Storage e persistência real;
- injeção end-to-end de 429, 503, timeout ou payload inválido;
- instalação PWA e headers do host final;
- teste em tablet/celular;
- confirmação operacional de billing.

Esses cenários devem permanecer separados dos contratos determinísticos de banco e frontend.

## Recuperação

Se o gate for interrompido depois de criar sentinelas:

1. procure em `notebooks` por nomes iniciados com `__staging_probe_` da conta de teste;
2. procure no bucket `documents`, sob o UUID dessa conta, por pastas `__staging_probe_`;
3. remova somente os registros e objetos sintéticos correspondentes.

Nunca automatize essa limpeza do gate público com service-role key. Uma sentinela residual é preferível a ampliar o privilégio do workflow de verificação.
