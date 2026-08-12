# Configuração externa do Google Drive

_Atualizado: 10 de agosto de 2026_

Este runbook cobre somente o trabalho externo necessário para ativar a integração cujo design está em `docs/superpowers/specs/2026-08-06-google-drive-primary-storage-design.md`. Nenhum segredo deve ser colocado no frontend, no GitHub, em artifacts, issues ou logs.

## Resultado esperado

Ao final deve existir:

- um projeto Google Cloud dedicado ao Fichário;
- Google Drive API habilitada;
- tela de consentimento OAuth configurada para a conta autorizada;
- um cliente OAuth do tipo aplicação Web;
- uma URI HTTPS de callback apontando para a Edge Function implantada;
- fluxo Authorization Code protegido por PKCE S256;
- escopo exato `https://www.googleapis.com/auth/drive.file`;
- `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` somente nos secrets do Supabase;
- refresh token armazenado somente no backend protegido;
- pasta raiz `Fichário Digital` criada ou reconectada;
- token inicial do feed de mudanças persistido;
- smoke tests de upload, mudança, remoção e reconexão concluídos.

## 0. Regras obrigatórias

- Não solicite `https://www.googleapis.com/auth/drive` nem outro escopo amplo no MVP.
- Não coloque client secret ou refresh token em variável pública, tabela exposta, localStorage ou service worker.
- Não use OAuth implícito para manter sincronização em segundo plano.
- Use fluxo de código de autorização para aplicação Web, com `state` único, curto e de uso único e PKCE S256.
- Gere o `code_verifier` no backend; persista-o somente no state privado de curta duração e nunca o envie ao navegador.
- Envie ao Google somente `code_challenge` e `code_challenge_method=S256`; a callback deve recuperar o verifier do state privado e enviá-lo apenas na troca do código.
- Solicite acesso offline somente pelo backend para obter refresh token.
- A URI de redirecionamento cadastrada deve coincidir exatamente com a callback implantada.
- Não registre código de autorização, verifier PKCE, token, secret ou URL contendo credenciais.
- Não habilite cobrança automaticamente.

## 1. Criar ou selecionar o projeto Google Cloud

No Google Cloud Console:

1. crie um projeto dedicado, por exemplo `fichario-digital`;
2. confirme que a conta proprietária é a mesma que administrará o aplicativo;
3. abra a biblioteca de APIs;
4. habilite **Google Drive API**;
5. não habilite APIs adicionais sem necessidade demonstrada.

## 2. Configurar a tela de consentimento

Configure o público conforme a conta e o modo de publicação pretendidos. Durante staging:

1. mantenha o aplicativo em teste quando aplicável;
2. cadastre somente a conta autorizada como usuário de teste;
3. use nome, e-mail de suporte e domínio coerentes com o host HTTPS;
4. declare apenas o escopo `drive.file`;
5. descreva claramente que o aplicativo cria e administra arquivos escolhidos ou criados por ele dentro de `Fichário Digital`.

O escopo `drive.file` dá acesso por arquivo aos itens criados/abertos pelo aplicativo e funciona com Google Picker. Ele deve permanecer como o único escopo do Drive no MVP.

## 3. Criar o cliente OAuth Web

Crie uma credencial **OAuth client ID** do tipo **Web application**.

Cadastre como origem autorizada a origem HTTPS final do frontend, sem caminho. Exemplo estrutural:

```text
https://fichario.example
```

Cadastre como URI de redirecionamento a URL exata da Edge Function callback. Exemplo estrutural:

```text
https://<project-ref>.supabase.co/functions/v1/drive-oauth-callback
```

Não use wildcard. Produção e staging devem ter URIs explícitas e credenciais separadas quando possível.

O PKCE não adiciona uma credencial estática no Google Cloud. O Fichário gera um verifier aleatório por tentativa, armazena esse valor apenas no backend privado e deriva dele um challenge S256 descartável.

## 4. Configurar secrets no Supabase

Na CLI ligada ao projeto correto:

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID=<client-id> \
  GOOGLE_CLIENT_SECRET=<client-secret> \
  GOOGLE_DRIVE_REDIRECT_URI=https://<project-ref>.supabase.co/functions/v1/drive-oauth-callback \
  GOOGLE_DRIVE_SCOPE=https://www.googleapis.com/auth/drive.file \
  GOOGLE_DRIVE_ROOT_FOLDER_NAME="Fichário Digital"
```

Também preserve `APP_ORIGIN` como a origem canônica HTTPS e configure `APP_ORIGIN_ALLOWLIST` com os aliases oficiais que podem executar o PWA. A política continua fail-closed: não use `*` global. Em Cloudflare Pages, o staging aceita a origem canônica, o alias raiz do mesmo projeto e um único subdomínio de preview/deploy. O `state` OAuth vincula a origem permitida que iniciou a conexão, então a callback retorna ao mesmo alias em vez de trocar de origem no meio do fluxo.

Esses valores não entram em `.env` público. O client ID poderá ser exposto somente quando uma integração de Picker no navegador realmente exigir, nunca como substituto do fluxo backend. O `code_verifier` não é secret de ambiente: ele é efêmero, único por tentativa e fica vinculado ao state privado até a callback consumi-lo.

## 5. Implantar migration e funções

A migration PKCE deve entrar antes das novas versões das Edge Functions. Isso mantém rollout escalonado fail-closed: RPCs legados só consomem states sem verifier e RPCs PKCE só consomem states com verifier.

Depois que as migrations e funções passarem nos gates locais/CI:

```bash
supabase db push
supabase functions deploy drive-oauth-start
supabase functions deploy drive-oauth-callback
supabase functions deploy drive-access-token
```

- `drive-oauth-start` deve exigir JWT válido do usuário do Fichário, gerar state, nonce e verifier no backend, persistir somente o hash do state mais nonce/verifier privados e devolver apenas a URL de autorização com challenge S256.
- `drive-oauth-callback` pode precisar ser implantada sem verificação JWT da plataforma porque recebe o redirecionamento do Google, mas deve validar internamente `state`, expiração, uso único, usuário e verifier antes de trocar o código. O verifier deve sair do backend somente como `code_verifier` para o endpoint de token do Google.
- `drive-access-token` deve exigir JWT válido e devolver somente token de acesso efêmero, nunca refresh token.

## 6. Executar a conexão inicial

1. entre no Fichário com a conta autorizada;
2. abra Configurações;
3. inicie “Conectar Google Drive”;
4. confira no consentimento que o acesso solicitado é limitado aos arquivos usados pelo aplicativo;
5. conclua o redirecionamento;
6. confirme que `drive_connections` ficou `connected`;
7. confirme que `root_folder_id` foi persistido;
8. confirme a existência de uma única pasta `Fichário Digital` criada/reconectada pelo app;
9. confirme que nenhum token ou verifier PKCE apareceu no navegador persistente, logs ou banco público.

Para validar especificamente PKCE, confira em um ambiente de teste que a URL de autorização contém `code_challenge` e `code_challenge_method=S256`, mas não contém `code_verifier`. A troca do código deve falhar se o verifier correto não estiver disponível no state privado.

## 7. Validar o feed de mudanças

A conexão deve obter um token inicial por `changes.getStartPageToken`. A sincronização usa esse token em `changes.list`, pagina com `nextPageToken` e só persiste `newStartPageToken` depois de aplicar a página com sucesso.

Teste:

1. envie um arquivo pelo Fichário;
2. renomeie-o no Drive;
3. mova-o entre duas pastas de caderno;
4. remova-o;
5. abra o Fichário e execute a reconciliação;
6. confirme que a remoção vira `physical_state = missing` sem apagar OCR, correções, título, caderno ou tags;
7. restaure/reconecte o mesmo arquivo e confirme retorno a `available`.

## 8. Validar upload retomável

Uploads persistentes devem usar `files.create` ou `files.update` com `uploadType=resumable`.

Teste em rede instável:

1. inicie um PDF grande;
2. interrompa a conexão depois de pelo menos um chunk;
3. retome consultando a sessão existente;
4. confirme que não foi criado arquivo duplicado;
5. confirme que o `drive_file_id` final foi persistido uma única vez;
6. preserve a cópia temporária do Supabase até a confirmação final e o cleanup idempotente.

## 9. Validar importação explícita

Quando o Google Picker estiver habilitado:

1. selecione um arquivo externo conscientemente;
2. copie-o para `Fichário Digital` ou para o caderno escolhido;
3. vincule o documento ao ID da cópia controlada pelo aplicativo;
4. não varra o restante do Drive;
5. não amplie o escopo silenciosamente.

## 10. Revogação e recuperação

Teste revogar o acesso no Google:

- a conexão deve virar `revoked` ou `error` sanitizado;
- metadados, OCR e índice permanecem disponíveis;
- jobs ficam retomáveis, sem apagar arquivos;
- reconectar deve localizar a raiz e reaproveitar IDs existentes;
- desconectar pelo app deve revogar credenciais backend sem excluir silenciosamente os arquivos do Drive.

## Critério de conclusão

```text
Drive API habilitada: PASS
OAuth Web e redirect exato: PASS
PKCE S256: PASS
Verifier PKCE somente no backend privado: PASS
Escopo drive.file somente: PASS
State de uso único: PASS
Refresh token somente no backend: PASS
Pasta Fichário Digital criada/reconectada: PASS
Feed de mudanças paginado: PASS
Upload retomável: PASS
Arquivo ausente preserva OCR/metadados: PASS
Reconexão pelo mesmo ID: PASS
Importação explícita via Picker: PASS
Revogação e recuperação: PASS
Nenhum segredo em frontend/log/export/cache: PASS
```
