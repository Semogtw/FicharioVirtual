# Validação e deploy do Supabase em staging

O staging do Fichário separa duas responsabilidades:

- `Deploy Supabase staging`: deploy administrativo manual de migrations e Edge Functions versionadas;
- `Verify Supabase staging`: verificação de Auth, allowlist, RLS e Storage privado usando apenas credenciais públicas e contas sintéticas de teste.

## Estado confirmado

Não há evidência de sucesso de OCR staging no HEAD `a8fdd0dda551def9af7bc7f256bc515f273542b4`. O `Verify OCR staging` `31296994849` está `WAITING/approval`; este documento não afirma OCR aprovado, histórico remoto de OCR, status live de funções ou configuração de secrets como concluídos.

O `Verify Supabase staging` verde mais recente foi o [run 31296568886](https://github.com/Semogtw/FicharioVirtual/actions/runs/31296568886), executado no SHA anterior `b39e3eb`. Esse run validou apenas Auth, allowlist, RLS e Storage privado com dados sintéticos. Ele não valida OCR, Google Drive, Gemini ou o runtime do HEAD atual.

No SHA anterior `b39e3eb`, o `Deploy Supabase staging` `31296564374` e o `Verify Supabase staging` `31296568886` terminaram com sucesso; o `Verify OCR staging` `31296573162` falhou. No HEAD `a8fdd0d`, o `Verify OCR staging` `31296994849` está `WAITING/approval` e não constitui sucesso.

O `401` observado no OCR anterior foi causado por workflows concorrentes compartilhando a mesma conta protegida: `auth.signOut()` invalida a sessão globalmente. A correção no HEAD serializa os verificadores no grupo `staging-contract-verification`, com `cancel-in-progress: false`. Essa correção ainda precisa de um run concluído; não declarar OCR aprovado.

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
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
supabase functions deploy --project-ref "$STAGING_SUPABASE_PROJECT_REF"
supabase functions list --project-ref "$STAGING_SUPABASE_PROJECT_REF"
```

Não use `--include-all` para contornar drift de histórico e não use `--no-verify-jwt` global no deploy de funções. As políticas individuais de JWT pertencem ao `supabase/config.toml` versionado.

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

Não há evidência atual neste repositório de GitHub Environment protegido ou de execução live desse workflow. Antes do próximo deploy pelo Actions, crie/proteja `staging-deploy` e configure os três valores acima; o deploy só poderá ser considerado confirmado com um recibo do mesmo SHA promovido.

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

O conector usado na auditoria não expõe enumeração de Edge Function secrets. Assim, a presença de todos os valores customizados não foi inferida a partir do deploy. Quando o environment administrativo estiver disponível, confirme a configuração com o mecanismo oficial de secrets do Supabase antes do teste end-to-end real.

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

A chave deve ser a publicável/anon do projeto. Não cadastre service-role key neste workflow.

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
- OCR real com Gemini;
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
