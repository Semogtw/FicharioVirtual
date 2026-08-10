# Runbook de configuração externa

_Atualizado: 2026-08-10_

Este documento concentra, em ordem operacional, o trabalho que não pode ser concluído apenas pelo código do repositório. O fluxo atual é deliberadamente **staging-only**: produção continua bloqueada até existir um backend Supabase de produção isolado, com credenciais e configuração próprias.

## Resultado esperado

Ao final do staging deve existir:

- um projeto Supabase exclusivo de staging, sem dados pessoais;
- duas contas Auth reservadas aos gates, somente uma na allowlist;
- migrations, RLS, Storage privado e Edge Functions implantados a partir de um SHA validado da `main`;
- OCR configurado nos secrets das Edge Functions, sem chave Gemini no frontend ou no artifact;
- um artifact estático de staging construído somente depois de `Validate current head` verde para o mesmo SHA;
- Cloudflare Pages publicado por Direct Upload do artifact validado, sem rebuild durante a promoção;
- recibos verdes dos gates remotos de Supabase, OCR e host;
- matriz manual concluída em celular e tablet;
- decisão registrada sobre billing, backup, rollback e destino da release.

## 0. Fronteiras e regras de segurança

Os environments têm responsabilidades diferentes:

- `staging`: verificação remota, build do artifact público e sondas administrativas explicitamente protegidas;
- `staging-deploy`: credenciais capazes de alterar Supabase staging ou publicar no Cloudflare Pages;
- produção: **não provisionada**. Não aponte um frontend de produção para o Supabase de staging e não crie um artifact rotulado como produção usando infraestrutura de staging.

Regras obrigatórias:

- não use o projeto Supabase de produção nem contas pessoais nos gates;
- não copie documentos reais para staging;
- não grave senhas, tokens, chaves, signed URLs ou corpos de erro de provedores em commits, artifacts, issues ou logs;
- nunca exponha service-role no frontend, build estático ou artifact público;
- `STAGING_SERVICE_ROLE_KEY`, quando necessário, fica restrito ao environment protegido `staging` e somente a sondas/ações administrativas explícitas;
- `GEMINI_API_KEY` fica nos secrets das Edge Functions do Supabase, não em GitHub Actions nem no frontend;
- não use `--no-verify-jwt` ao implantar Edge Functions;
- não torne o bucket `documents` público;
- não habilite fallback pago ou troca silenciosa de modelo;
- não recrie `OCR_DAILY_HARD_LIMIT`: o fluxo atual não usa uma quota diária artificial. Os limites `OCR_BATCH_*` e `OCR_REQUEST_TIMEOUT_MS` são apenas controles técnicos por request/batch;
- migrations aplicadas são forward-only. Se o histórico remoto divergir, identifique a causa e reconcilie apenas depois de provar que o schema correspondente é o esperado.

## 1. Projeto Supabase de staging

No painel Supabase:

1. use um projeto dedicado ao Fichário de staging;
2. mantenha billing pago desativado enquanto o comportamento gratuito estiver sendo validado;
3. guarde em gerenciador de secrets o project ref, Project URL, publishable key e credenciais administrativas necessárias ao deploy;
4. nunca exporte service-role para o frontend ou para o artifact.

O caminho normal de implantação é o workflow `Deploy Supabase staging`, não um `db push` manual. Ele resolve um SHA da `main` que já passou por `Validate current head`, faz dry-run/listagem de migrations, aplica o banco e implanta as Edge Functions versionadas no environment protegido `staging-deploy`.

Use CLI local ligada ao projeto apenas para diagnóstico/recuperação deliberada. Antes de qualquer reparo de histórico, compare o conteúdo aplicado com as migrations versionadas e preserve evidência da decisão.

Depois que o schema remoto estiver estável, gere tipos a partir do projeto ligado e revise o diff antes de substituir qualquer espelho transitório:

```bash
supabase gen types typescript --linked > /tmp/database.generated.ts
```

Não sobrescreva cegamente `src/lib/types/database.ts`; o repositório pode conter aliases ou extensões locais que precisam ser preservados conscientemente.

## 2. Contas de teste e allowlist

No Supabase Auth, mantenha duas contas exclusivas:

- conta autorizada, usada pelos gates e pelo smoke OCR;
- conta não autorizada, usada para provar o bloqueio fail-closed.

As contas devem ter UUIDs diferentes e não devem ser pessoais.

Adicione somente a conta autorizada à allowlist:

```sql
insert into public.app_users (user_id, is_active)
values ('<uuid-da-conta-autorizada>', true);
```

Confirme:

- a conta autorizada possui uma linha ativa em `public.app_users`;
- a segunda conta não possui linha ativa;
- o bucket `documents` existe e está privado;
- os caminhos privados obedecem ao isolamento por `auth.uid()`.

## 3. Environment `staging` no GitHub

O environment `staging` contém as credenciais de verificação e a configuração pública congelada no build:

```text
STAGING_SUPABASE_URL
STAGING_SUPABASE_PUBLISHABLE_KEY
STAGING_AUTHORIZED_EMAIL
STAGING_AUTHORIZED_PASSWORD
STAGING_UNAUTHORIZED_EMAIL
STAGING_UNAUTHORIZED_PASSWORD
STAGING_SERVICE_ROLE_KEY
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Quando Google Picker for habilitado no frontend, configure o trio público junto:

```text
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

`PUBLIC_SUPABASE_URL` e `STAGING_SUPABASE_URL` normalmente apontam para a mesma origem de staging. As publishable keys também podem ser o mesmo valor, mas permanecem separadas por função operacional.

O gate comum de Auth/RLS/Storage deve continuar usando somente a publishable key. `STAGING_SERVICE_ROLE_KEY` é reservado a sondas administrativas explicitamente protegidas e nunca deve aparecer em logs ou no build.

Não cadastre `GEMINI_API_KEY`, `GOOGLE_CLIENT_SECRET` ou credenciais Cloudflare em `staging`.

## 4. Environment `staging-deploy` no GitHub

Para deploy do Supabase, o workflow espera:

```text
Secret: STAGING_SUPABASE_ACCESS_TOKEN
Secret: STAGING_SUPABASE_DB_PASSWORD
Variable: STAGING_SUPABASE_PROJECT_REF
```

Para promoção do artifact no Cloudflare Pages, o mesmo environment protegido precisa também de:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

A aprovação manual deste environment é uma barreira administrativa intencional.

### Estado conhecido em 2026-08-10

O workflow `Verify Cloudflare staging credentials` comprovou que `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` ainda não estão provisionados no environment `staging-deploy`. Até esses dois nomes existirem com credenciais válidas, o Direct Upload do frontend não pode ser concluído. Não substitua essa ausência por token em arquivo, variável pública ou secret de outro environment.

## 5. Edge Functions, Google Drive e OCR

Defina `APP_ORIGIN` como a origem HTTPS final do frontend de staging, sem caminho, query, fragmento ou credenciais.

Os secrets de runtime ficam no projeto Supabase de staging. O conjunto atual inclui, conforme o recurso utilizado:

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_QUALITY
OCR_PROMPT_VERSION
OCR_BATCH_MAX_PAGES
OCR_BATCH_MAX_BYTES
OCR_REQUEST_TIMEOUT_MS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_DRIVE_REDIRECT_URI
GOOGLE_DRIVE_SCOPE
GOOGLE_DRIVE_ROOT_FOLDER_NAME
```

Valores padrão/versionados de referência estão em `.env.example`. Para OCR, o modelo principal atual é `gemini-3.6-flash` e o prompt versionado começa em `1`.

Os controles opcionais de segurança do request têm os defaults atuais:

```text
OCR_BATCH_MAX_PAGES=40
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

Eles limitam tamanho/tempo de uma chamada; **não** representam quota diária de uso e não devem ser usados para simular o limite gratuito do provedor.

`GEMINI_API_KEY` deve existir somente nos secrets do Supabase. Não use alias de modelo que possa trocar silenciosamente quando a intenção for uma versão explicitamente validada. Qualquer mudança para modelo de menor custo/qualidade deve passar pelo mesmo smoke OCR e ser registrada conscientemente.

O workflow `Deploy Supabase staging` implanta as Edge Functions versionadas do repositório com verificação JWT mantida.

## 6. Gate remoto do Supabase

Depois do deploy do schema/runtime, execute `Verify Supabase staging` no mesmo SHA e aprove o environment `staging` quando necessário.

O gate autentica as duas contas e comprova, com dados sintéticos:

- allowlist;
- isolamento RLS;
- Storage privado;
- upload/download por proprietário;
- negação ao segundo usuário;
- signed URL limitada e expiração real;
- limpeza das sentinelas ao terminar.

Em caso de interrupção, remova manualmente somente recursos sintéticos claramente identificados pelo prefixo usado pelos probes.

## 7. Construir o artifact estático de staging

Use o workflow **`Build deployable Fichário staging artifact`**.

O workflow é manual e staging-only. Não existe seletor de produção. Antes de qualquer build ele:

1. confirma que `GITHUB_SHA` é exatamente o HEAD atual da `main`;
2. procura um run concluído com sucesso de `Validate current head` para esse mesmo SHA, branch `main` e evento `push`;
3. falha fechado se essa evidência não existir;
4. valida a configuração pública do environment `staging`;
5. executa `pnpm verify`;
6. prova que a configuração pública esperada foi congelada no build e que valores locais de desenvolvimento não foram empacotados;
7. cria um artifact determinístico e auto-verificável.

O artifact resultante tem identidade:

```text
fichario-static-<sha>-staging
```

Depois de extrair:

```bash
cd fichario-deploy
sha256sum -c SHA256SUMS
cat DEPLOYMENT-MANIFEST.txt
```

Em um checkout compatível, também é possível executar:

```bash
pnpm test:deployment:artifact -- /caminho/para/fichario-deploy
```

Sirva publicamente somente `fichario-deploy/site/`. Manifest, checksums e snapshots de source não fazem parte da raiz pública.

## 8. Promover o artifact no Cloudflare Pages

A promoção canônica é o workflow **`Deploy Fichário artifact to Cloudflare Pages`**. Ele não recompila o site.

Informe:

- o run ID que produziu o artifact;
- o SHA esperado da source.

O workflow:

1. exige credenciais Cloudflare do environment `staging-deploy`;
2. baixa exatamente `fichario-static-<sha>-staging` do run informado;
3. confere manifest, source commit, target `staging`, checksums, ausência de symlinks e valores proibidos;
4. usa Wrangler pinado para Direct Upload do diretório `site/`;
5. publica no projeto Pages de staging com o SHA esperado;
6. valida a saída estruturada do Wrangler;
7. executa o verificador HTTP empacotado com o próprio artifact contra a URL exata retornada pelo deploy.

Não faça rebuild entre a criação e a promoção do artifact. Se o HEAD da `main` mudar, gere um novo artifact somente depois do novo SHA ficar verde.

## 9. Gate do host publicado

Além do verificador executado durante o Direct Upload, use `Verify deployed Fichário` para validar a origem HTTPS de staging quando necessário.

O equivalente local é:

```bash
pnpm test:deployment -- https://staging.seu-dominio.example
```

O contrato cobre redirect HTTP, CSP, HSTS, framing, MIME, Permissions Policy, manifesto, fallback SPA, service worker e regras de cache.

A URL final precisa coincidir com `APP_ORIGIN`. Se a origem mudar, atualize o secret no Supabase e reimplante as Edge Functions antes dos smokes funcionais.

## 10. OCR real e Google Drive em staging

Somente depois de Supabase, Edge Functions e host estarem alinhados:

1. execute `Verify OCR staging` para o mesmo SHA;
2. confirme explicitamente a chamada externa quando o workflow exigir;
3. examine somente o relatório sanitizado do gate;
4. valide o fluxo normal de importação/OCR e a limpeza da sentinela;
5. execute o smoke Google Drive com credenciais reais de staging, incluindo OAuth, picker/listagem permitida e uma operação real no escopo `drive.file`.

Falhas de provedor devem ser investigadas pelos estados persistidos e códigos seguros. Não habilite fallback pago ou troque de modelo silenciosamente para obter um gate verde.

## 11. Matriz manual em dispositivos físicos

Execute pelo menos em um celular e um tablet no navegador-alvo:

- login, logout, refresh e expiração de sessão;
- instalação, abertura, atualização e remoção da PWA;
- importação de imagem;
- PDF textual sem OCR;
- PDF digitalizado com OCR;
- PDF misto com OCR somente nas páginas necessárias;
- PDF longo, observando memória e temperatura;
- cancelamento durante preparação, upload e OCR;
- encerramento forçado do navegador e retomada;
- duas abas abertas durante a mesma retomada;
- troca entre Wi-Fi, rede móvel, offline, timeout e retorno da conexão;
- confirmação de que conteúdo privado não aparece no cache offline.

Registre dispositivo, sistema, navegador, versão, arquivo sintético usado, resultado e qualquer falha reproduzível.

## 12. Billing, backup e rollback

Antes de promover além de staging:

- confirme no painel que billing pago e limites expansíveis estão desativados ou conscientemente aprovados;
- anote os limites gratuitos observados para banco, Storage, Functions e provedor OCR;
- execute e registre um backup do banco conforme o plano disponível;
- preserve o artifact estático e o commit anterior;
- valide que o frontend pode voltar ao artifact anterior sem reescrever o histórico do banco;
- trate migrations como forward-only;
- preserve estratégia de rollback/forward-fix das Edge Functions;
- registre quem pode aprovar environments e alterar secrets.

## 13. Critério de conclusão do staging

A release de staging está pronta somente quando houver evidência coerente para o mesmo SHA/runtime:

```text
Validate current head: PASS
Deploy Supabase staging: PASS
Verify Supabase staging: PASS
Verify OCR staging: PASS
Build deployable Fichário staging artifact: PASS
Artifact manifest + SHA256SUMS: PASS
Cloudflare Pages Direct Upload: PASS
Verificação da URL exata / headers / PWA: PASS
Smoke Google Drive real: PASS ou risco explicitamente aceito
Matriz em celular: PASS ou riscos registrados
Matriz em tablet: PASS ou riscos registrados
Billing confirmado: PASS
Backup executado: PASS
Rollback/forward-fix documentado: PASS
```

Se algum item depender de credencial ou aprovação externa ainda não provisionada, registre-o como bloqueio operacional; não enfraqueça o código ou o gate para contorná-lo.

## 14. Produção

Produção continua bloqueada até existir, no mínimo:

- projeto Supabase de produção separado;
- configuração Auth/allowlist, Storage e Edge secrets próprios;
- credenciais Google/Drive e origem HTTPS de produção próprias;
- environments/secrets de deploy de produção isolados;
- artifact de produção construído com configuração de produção, nunca com secrets/URL de staging;
- plano explícito de backup, migração, rollback e billing.

Até essa infraestrutura existir, o pipeline deve permanecer staging-only. Uma ausência de defeitos conhecidos em staging não autoriza reaproveitar o backend de staging como produção.
