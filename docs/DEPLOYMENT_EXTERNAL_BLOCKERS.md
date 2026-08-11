# Bloqueios externos atuais do deploy

_Atualizado: 2026-08-11_

Este documento registra apenas o que ainda depende de provisionamento externo para concluir o staging do Fichário Digital. Não coloque valores reais de tokens, chaves, senhas ou client secrets neste arquivo, em issues, artifacts ou logs.

O código e os workflows devem continuar **fail-closed** quando uma dessas configurações estiver ausente. Não enfraqueça gates para contornar credenciais ainda não provisionadas.

## Estado atual resumido

Os cinco valores que atualmente bloqueiam a conclusão do frontend de staging são:

```text
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Destino correto:

| Nome | Origem | Destino | Impacto enquanto ausente |
| --- | --- | --- | --- |
| `PUBLIC_GOOGLE_CLIENT_ID` | Google Auth Platform | GitHub Environment `staging` → Environment secret | OAuth/Picker do Drive não pode ser habilitado no artifact |
| `PUBLIC_GOOGLE_PICKER_API_KEY` | Google Cloud Credentials | GitHub Environment `staging` → Environment secret | Google Picker não pode funcionar no frontend |
| `PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER` | Google Cloud Project settings | GitHub Environment `staging` → Environment secret | Picker não pode inicializar com o App ID esperado |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Tokens | GitHub Environment `staging-deploy` → Environment secret | Direct Upload no Cloudflare Pages fica bloqueado |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account details | GitHub Environment `staging-deploy` → Environment secret | Wrangler não consegue publicar no projeto Pages correto |

Além desses cinco valores públicos/operacionais, o fluxo Google Drive completo também usa `GOOGLE_CLIENT_SECRET` no backend. Esse valor **não** deve ir para o frontend nem para os GitHub secrets públicos do artifact; ele pertence aos secrets das Edge Functions no projeto Supabase de staging.

## Ordem recomendada de provisionamento

1. criar/confirmar o projeto Cloudflare Pages `fichario-virtual`;
2. obter `CLOUDFLARE_ACCOUNT_ID` e criar `CLOUDFLARE_API_TOKEN`;
3. cadastrar os dois no GitHub Environment `staging-deploy`;
4. confirmar a URL HTTPS de staging do Pages, normalmente `https://fichario-virtual.pages.dev` enquanto não houver domínio próprio;
5. criar/selecionar o projeto Google Cloud dedicado ao Fichário;
6. habilitar Google Drive API e Google Picker API;
7. configurar Google Auth Platform / consentimento / usuário de teste;
8. criar o OAuth Client do tipo Web application usando a URL HTTPS de staging;
9. criar a API key restrita ao Google Picker e à origem do site;
10. obter o Project Number numérico;
11. cadastrar os três `PUBLIC_GOOGLE_*` no GitHub Environment `staging`;
12. cadastrar os secrets privados Google no Supabase staging;
13. rerodar os workflows de readiness/build/deploy e os smokes Google Drive.

## Cloudflare Pages

### 1. Criar ou abrir o projeto Pages

Painel:

https://dash.cloudflare.com/?to=/:account/workers-and-pages

O projeto esperado pelo workflow atual é:

```text
fichario-virtual
```

O workflow de deploy usa Direct Upload e publica o artifact previamente validado; não faça rebuild manual entre a geração e a promoção do artifact.

### 2. Obter `CLOUDFLARE_ACCOUNT_ID`

Abra:

https://dash.cloudflare.com/?to=/:account/workers-and-pages

Localize `Account details` / `Account ID` da conta que contém o projeto Pages.

Cadastre o valor em:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging-deploy

Nome exato do Environment secret:

```text
CLOUDFLARE_ACCOUNT_ID
```

### 3. Criar `CLOUDFLARE_API_TOKEN`

Abra:

https://dash.cloudflare.com/?to=/:account/api-tokens

Crie um token dedicado ao CI/CD do Fichário. A permissão mínima esperada para o Pages é:

```text
Account
Cloudflare Pages
Edit
```

Restrinja o recurso à conta correta sempre que o painel permitir.

Cadastre o token em:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging-deploy

Nome exato do Environment secret:

```text
CLOUDFLARE_API_TOKEN
```

Não grave esse token no repositório, `.env`, issue ou output de workflow.

## Google Cloud / Drive / Picker

Use o mesmo projeto Google Cloud para Drive API, Picker API, OAuth Client e Project Number de staging.

### 1. Criar ou selecionar o projeto

https://console.cloud.google.com/projectselector2/home/dashboard

Use um projeto dedicado ao Fichário, por exemplo `fichario-digital`.

### 2. Habilitar Google Drive API

https://console.cloud.google.com/apis/library/drive.googleapis.com

O escopo esperado pelo backend é:

```text
https://www.googleapis.com/auth/drive.file
```

Não amplie silenciosamente para o escopo completo `drive`.

### 3. Habilitar Google Picker API

Fluxo direto de ativação:

https://console.cloud.google.com/apis/enableflow;apiid=picker.googleapis.com

Biblioteca da API:

https://console.cloud.google.com/apis/library/picker.googleapis.com

### 4. Configurar Google Auth Platform

Visão geral:

https://console.cloud.google.com/auth/overview

Audience / usuários de teste:

https://console.cloud.google.com/auth/audience

Scopes / Data Access:

https://console.cloud.google.com/auth/scopes

Durante staging, mantenha o aplicativo em teste quando aplicável e cadastre somente contas de teste deliberadas.

### 5. Criar o OAuth Client Web

https://console.cloud.google.com/auth/clients

Crie:

```text
Application type: Web application
```

Authorized JavaScript origin de staging:

```text
https://fichario-virtual.pages.dev
```

Se um domínio próprio for adotado depois, adicione também sua origem HTTPS exata.

Authorized redirect URI do backend:

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/drive-oauth-callback
```

O Client ID criado deve ser cadastrado no GitHub como:

```text
PUBLIC_GOOGLE_CLIENT_ID
```

Destino:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging

O Client Secret gerado junto com esse OAuth Client deve ser guardado para o backend e **não** cadastrado como `PUBLIC_*`.

### 6. Criar a API key do Picker

https://console.cloud.google.com/apis/credentials

Crie uma `API key` e, depois, restrinja-a.

Recomendação para staging:

```text
Application restrictions: Websites
Allowed referrer: https://fichario-virtual.pages.dev/*
API restrictions: Google Picker API
```

Se desenvolvimento local precisar do Picker, adicione somente as origens localhost realmente utilizadas.

Cadastre a chave em:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging

Nome exato:

```text
PUBLIC_GOOGLE_PICKER_API_KEY
```

Apesar do prefixo `PUBLIC_`, o pipeline atual consome esse valor de um GitHub Environment secret e o congela conscientemente no artifact público. A segurança dessa API key deve depender também das restrições de origem/API configuradas no Google Cloud.

### 7. Obter o Project Number

https://console.cloud.google.com/iam-admin/settings

Copie o campo `Project number` numérico. Não confunda com o Project ID textual.

Cadastre em:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging

Nome exato:

```text
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

## Secrets privados Google no Supabase staging

Painel de Edge Function secrets:

https://supabase.com/dashboard/project/_/functions/secrets

Selecione explicitamente o projeto Supabase de **staging** antes de alterar qualquer valor.

O conjunto esperado para o fluxo Drive inclui:

```text
GOOGLE_CLIENT_ID=<mesmo Client ID do OAuth Web>
GOOGLE_CLIENT_SECRET=<Client Secret do OAuth Web>
GOOGLE_DRIVE_REDIRECT_URI=https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/drive-oauth-callback
GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.file
GOOGLE_DRIVE_ROOT_FOLDER_NAME=Fichário Digital
APP_ORIGIN=https://fichario-virtual.pages.dev
```

Regras:

- `GOOGLE_CLIENT_SECRET` nunca entra no bundle do frontend;
- `GOOGLE_CLIENT_SECRET` nunca é um `PUBLIC_*`;
- não cole o Client Secret em documentação, issue ou chat de diagnóstico;
- a redirect URI cadastrada no Google deve coincidir exatamente com `GOOGLE_DRIVE_REDIRECT_URI`;
- `APP_ORIGIN` deve coincidir com a origem HTTPS efetivamente publicada;
- se a URL pública mudar, revise `APP_ORIGIN`, Authorized JavaScript origins e qualquer referrer restriction da API key.

## GitHub environments

### `staging`

Configuração:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging

Os três valores faltantes de Drive/Picker devem ser cadastrados como Environment secrets com estes nomes exatos:

```text
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

O artifact workflow lê exatamente esses nomes. Não use aliases.

### `staging-deploy`

Configuração:

https://github.com/Semogtw/FicharioVirtual/settings/environments/staging-deploy

Os dois valores Cloudflare devem ser cadastrados como Environment secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Não mova essas credenciais para `staging` apenas para contornar o gate; `staging-deploy` é a fronteira de credenciais capazes de publicar.

## Checklist de provisionamento pendente

### Cloudflare

- [ ] projeto Pages `fichario-virtual` criado/confirmado;
- [ ] `CLOUDFLARE_ACCOUNT_ID` obtido;
- [ ] `CLOUDFLARE_API_TOKEN` dedicado criado com permissão Pages Edit;
- [ ] ambos cadastrados no GitHub Environment `staging-deploy`;
- [ ] workflow de verificação de credenciais Cloudflare verde;
- [ ] Direct Upload do artifact validado executado;
- [ ] URL exata retornada pelo deploy passa no verificador HTTP/PWA.

### Google / Drive / Picker

- [ ] projeto Google Cloud dedicado selecionado;
- [ ] Google Drive API habilitada;
- [ ] Google Picker API habilitada;
- [ ] Auth Platform / consentimento configurado;
- [ ] conta de staging cadastrada como test user quando necessário;
- [ ] OAuth Client do tipo Web criado;
- [ ] origem HTTPS de staging cadastrada no OAuth Client;
- [ ] redirect URI exata da Edge Function cadastrada;
- [ ] `PUBLIC_GOOGLE_CLIENT_ID` cadastrado em `staging`;
- [ ] API key do Picker criada e restrita;
- [ ] `PUBLIC_GOOGLE_PICKER_API_KEY` cadastrado em `staging`;
- [ ] Project Number numérico obtido;
- [ ] `PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER` cadastrado em `staging`;
- [ ] `GOOGLE_CLIENT_SECRET` cadastrado somente nos secrets do Supabase staging;
- [ ] demais secrets `GOOGLE_DRIVE_*` e `APP_ORIGIN` revisados;
- [ ] gate de configuração pública do artifact verde;
- [ ] OAuth real do Drive concluído em staging;
- [ ] Picker real abre e permite seleção dentro do escopo esperado;
- [ ] smoke de upload/reconciliação/revogação passa sem ampliar o escopo além de `drive.file`.

## Critério para considerar estes blockers resolvidos

Esses blockers só podem ser marcados como concluídos quando houver evidência de execução, não apenas quando alguém disser que cadastrou os valores:

```text
Verify staging artifact configuration: PASS
Build deployable Fichário staging artifact: PASS
Verify Cloudflare staging credentials: PASS
Deploy validated staging artifact to Cloudflare Pages: PASS
Verificação HTTP/PWA da URL exata: PASS
Google Drive OAuth staging: PASS
Google Picker staging: PASS
```

Se algum gate falhar, corrija o provisionamento ou o código responsável; não registre valores secretos em logs e não enfraqueça o workflow para obter um verde artificial.
