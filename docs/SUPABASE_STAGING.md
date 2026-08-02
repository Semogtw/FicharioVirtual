# Validação do Supabase em staging

O workflow `Verify Supabase staging` verifica autenticação, allowlist e isolamento RLS em um projeto remoto sem usar service-role key e sem depender de dados reais.

## Preparar o projeto

1. Crie um projeto Supabase exclusivo para staging.
2. Aplique todas as migrations da branch que será validada.
3. Crie duas contas Auth exclusivas para testes automatizados.
4. Adicione somente a primeira conta em `public.app_users` com `is_active = true`.
5. Confirme que a segunda conta autentica normalmente, mas não possui linha ativa na allowlist.
6. Não copie documentos pessoais ou secrets de produção para o projeto.

As contas precisam ser diferentes e devem permanecer reservadas ao gate. Não reutilize a conta pessoal administradora.

## Configurar o environment do GitHub

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

No GitHub Actions:

1. abra `Verify Supabase staging`;
2. escolha `Run workflow` na branch ou SHA desejado;
3. aprove o environment `staging`, caso exista proteção;
4. confirme o resultado do job `verify`.

Também é possível executar localmente com as mesmas variáveis:

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
- remove a sentinela em um bloco `finally`;
- encerra as duas sessões.

A sentinela possui prefixo `__staging_probe_` e não contém conteúdo do usuário.

## O que este gate não cobre

A verificação não substitui:

- teste de upload e URL assinada no Storage;
- execução real das Edge Functions;
- OCR com Gemini;
- injeção de 429, 503, timeout ou payload inválido;
- instalação PWA e headers do host final;
- teste em tablet/celular;
- confirmação de billing desativado.

Esses gates permanecem etapas separadas da preparação de release.

## Recuperação

Se o job for interrompido depois de criar a sentinela, procure na tabela `notebooks` da conta autorizada por nomes iniciados com `__staging_probe_` e remova somente esses registros.

Nunca automatize essa limpeza com service-role key dentro do workflow. Uma sentinela residual é preferível a conceder privilégios administrativos ao gate.
