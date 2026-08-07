# Validação do Supabase em staging

O workflow `Verify Supabase staging` verifica autenticação, allowlist, isolamento RLS e Storage privado em um projeto remoto sem usar service-role key e sem depender de dados reais.

## Preparar o projeto

1. Crie um projeto Supabase exclusivo para staging.
2. Aplique todas as migrations da branch que será validada.
3. Crie duas contas Auth exclusivas para testes automatizados.
4. Adicione somente a primeira conta em `public.app_users` com `is_active = true`.
5. Confirme que a segunda conta autentica normalmente, mas não possui linha ativa na allowlist.
6. Confirme que o bucket privado `documents` foi criado pelas migrations.
7. Não copie documentos pessoais ou secrets de produção para o projeto.

As contas precisam ser diferentes e devem permanecer reservadas ao gate. Não reutilize a conta pessoal administradora.

## Sincronizar migrations antes do gate

O histórico remoto precisa corresponder aos arquivos versionados em `supabase/migrations/`. O repositório oferece o workflow manual `Deploy Supabase staging migrations`, que preserva os números das migrations, lista o drift, executa `db push --dry-run` e só então aplica as migrations pendentes.

O fluxo equivalente pelo Supabase CLI é:

```bash
supabase link --project-ref <project-ref>
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Não substitua esse fluxo por várias chamadas avulsas ao Management API nem aplique somente a migration mais nova quando o staging estiver atrasado. Esses atalhos podem executar DDL fora de ordem ou registrar versões diferentes das existentes no Git, fazendo um `supabase db push` posterior interpretar incorretamente o histórico.

### Environment administrativo de deploy

Crie um environment separado chamado `staging-deploy`. Ele deve ser usado somente pelo workflow `Deploy Supabase staging migrations` e, quando a configuração da conta permitir, exigir aprovação manual.

Configure nele:

```text
Secret: STAGING_SUPABASE_ACCESS_TOKEN
Secret: STAGING_SUPABASE_DB_PASSWORD
Variable: STAGING_SUPABASE_PROJECT_REF
```

O workflow mapeia esses valores para as variáveis esperadas pelo Supabase CLI, usa `contents: read`, desabilita credenciais persistidas no checkout e fixa `supabase/setup-cli@v2` com CLI `2.111.0`. Nenhuma service-role key é necessária para aplicar migrations.

O environment `staging-deploy` não deve conter as credenciais de usuários de teste descritas abaixo. Separar deploy administrativo de verificação pública reduz o blast radius caso um dos jobs seja alterado no futuro.

Depois do push, confirme que a última versão listada em `supabase migration list --linked` é a mesma migration mais recente do diretório local. Só então execute os testes de staging e os advisors de segurança/performance.

## Configurar o environment de verificação do GitHub

Crie um environment chamado `staging` no repositório e cadastre os seguintes secrets:

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

Para aplicar migrations no GitHub Actions:

1. abra `Deploy Supabase staging migrations`;
2. escolha `Run workflow` na branch ou SHA desejado;
3. aprove o environment `staging-deploy`;
4. confira no log a lista de migrations e o dry-run antes da etapa de aplicação;
5. confirme que `Confirm linked migration history` termina com o histórico local/remoto alinhado.

Depois, para verificar Auth/RLS/Storage:

1. abra `Verify Supabase staging`;
2. escolha `Run workflow` na mesma branch ou SHA;
3. aprove o environment `staging`, caso exista proteção;
4. confirme o resultado do job `verify`.

Também é possível executar a verificação localmente com as mesmas variáveis:

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

## Contratos verificados

O gate:

- autentica as duas contas com a API pública;
- exige que os UUIDs Auth sejam distintos;
- confirma `is_authorized_user() = true` para a conta permitida;
- confirma `is_authorized_user() = false` para a segunda conta;
- verifica que a conta permitida lê a própria linha ativa de `app_users`;
- cria um caderno-sentinela temporário pertencente à conta permitida;
- confirma que a conta proprietária encontra exatamente a sentinela;
- confirma que a segunda conta recebe zero linhas ao consultar o mesmo UUID;
- envia um PNG sintético de 1 × 1 para `documents/<uuid>/__staging_probe_<uuid>/probe.png`;
- exige que somente a conta proprietária liste e baixe o objeto;
- compara os bytes baixados com o payload original, sem coerção para texto;
- cria uma URL assinada de 60 segundos e confirma origem, caminho, token e bytes retornados;
- cria uma segunda URL de 2 segundos, confirma os bytes antes do prazo e exige negação 4xx após a expiração, com cache desabilitado;
- exige que a segunda conta não consiga baixar nem assinar o objeto da proprietária;
- remove objeto e caderno antes de encerrar as sessões;
- preserva simultaneamente falhas da verificação e da limpeza, sem mascarar a causa original.

As sentinelas possuem prefixo `__staging_probe_`, usam somente dados sintéticos e não contêm conteúdo do usuário. Tokens de URLs assinadas não são escritos nos logs.

## O que este gate não cobre

A verificação não substitui:

- execução real das Edge Functions;
- OCR com Gemini, coberto separadamente por `Verify OCR staging`;
- injeção de 429, 503, timeout ou payload inválido;
- instalação PWA e headers do host final;
- teste em tablet/celular;
- confirmação de billing desativado.

Esses gates permanecem etapas separadas da preparação de release.

## Recuperação

Se o job for interrompido depois de criar sentinelas:

1. procure na tabela `notebooks` da conta autorizada por nomes iniciados com `__staging_probe_`;
2. procure no bucket `documents`, dentro do prefixo do UUID dessa conta, por pastas `__staging_probe_`;
3. remova somente os registros e objetos sintéticos correspondentes.

Nunca automatize essa recuperação com service-role key dentro do workflow. Uma sentinela residual é preferível a conceder privilégios administrativos ao gate.
