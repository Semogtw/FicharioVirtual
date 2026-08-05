# Runbook de configuração externa

_Atualizado: 2026-08-05_

Este documento concentra, em ordem operacional, o trabalho que não pode ser concluído apenas pelo código do repositório: projeto Supabase remoto, credenciais de teste, Edge Functions, provedor OCR, host HTTPS, dispositivos físicos e controles de operação.

## Resultado esperado

Ao final, deve existir:

- um projeto Supabase exclusivo de staging, sem dados pessoais;
- duas contas Auth reservadas aos gates, somente uma na allowlist;
- migrations, RLS, Storage privado e Edge Functions implantados;
- OCR configurado somente no ambiente da Edge Function;
- frontend estático publicado em HTTPS;
- environments protegidos no GitHub sem service-role key nem chave Gemini;
- recibos verdes dos workflows `Verify Supabase staging`, `Verify OCR staging` e `Verify deployed Fichário`;
- checklist manual concluído em celular e tablet;
- decisão registrada sobre billing, backup, rollback e destino da release.

## 0. Regras de segurança

- Não use o projeto Supabase de produção nem a conta pessoal nos gates.
- Não copie documentos reais para staging.
- Não grave senhas, tokens ou chaves em commits, artifacts, issues ou logs.
- Não coloque `GEMINI_API_KEY` ou service-role key no GitHub Actions.
- Não use `--no-verify-jwt` ao implantar Edge Functions.
- Não torne o bucket `documents` público.
- Não habilite billing, fallback pago ou troca silenciosa de modelo.
- Use valores diferentes entre staging e produção.

## 1. Criar o projeto Supabase de staging

No painel Supabase:

1. crie um projeto dedicado ao Fichário de staging;
2. mantenha billing pago desativado enquanto o comportamento gratuito estiver sendo validado;
3. anote somente em um gerenciador de secrets:
   - project ref;
   - Project URL;
   - publishable key com prefixo `sb_publishable_`;
   - senha do banco, quando necessária à CLI;
4. não exporte a service-role key para o frontend ou para os workflows de validação.

A partir de um checkout do SHA que será validado:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
supabase test db
supabase gen types typescript --linked > src/lib/types/database.ts
pnpm format src/lib/types/database.ts
```

Revise qualquer alteração em `src/lib/types/database.ts`. Migrations já aplicadas são imutáveis; correções futuras devem usar uma migration nova.

## 2. Criar as duas contas de teste

No Supabase Auth, crie duas contas exclusivas:

- conta autorizada, usada pelos gates e pelo smoke test OCR;
- conta não autorizada, usada para comprovar o bloqueio fail-closed.

As contas devem ter UUIDs diferentes e não devem ser usadas como contas pessoais.

Adicione somente a conta autorizada à allowlist:

```sql
insert into public.app_users (user_id, is_active)
values ('<uuid-da-conta-autorizada>', true);
```

Confirme:

- a conta autorizada possui uma linha ativa em `public.app_users`;
- a segunda conta não possui linha ativa;
- o bucket `documents` existe e está privado;
- os caminhos de Storage são prefixados pelo `auth.uid()`.

## 3. Criar o environment `staging` no GitHub

Em `Settings > Environments`, crie `staging`. Quando a conta permitir, habilite aprovação obrigatória e limite a execução à branch pretendida.

Cadastre os secrets públicos e as contas de teste:

```text
STAGING_SUPABASE_URL
STAGING_SUPABASE_PUBLISHABLE_KEY
STAGING_AUTHORIZED_EMAIL
STAGING_AUTHORIZED_PASSWORD
STAGING_UNAUTHORIZED_EMAIL
STAGING_UNAUTHORIZED_PASSWORD
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Para staging, `PUBLIC_SUPABASE_URL` e `STAGING_SUPABASE_URL` normalmente apontam para a mesma origem. As duas publishable keys também podem ser o mesmo valor, mas permanecem com nomes separados porque alimentam workflows diferentes.

Não cadastre neste environment:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_PASSWORD
```

## 4. Executar o gate remoto do Supabase

No GitHub Actions:

1. abra `Verify Supabase staging`;
2. selecione a branch ou SHA validado;
3. execute e aprove o environment `staging` quando solicitado;
4. exija resultado verde do job `verify`.

O gate autentica as duas contas, comprova allowlist, isolamento RLS, Storage privado, upload/download por proprietário, negação ao segundo usuário e expiração real de URL assinada. Ele usa somente dados sintéticos e remove as sentinelas ao terminar.

Em caso de interrupção, remova manualmente apenas cadernos e pastas com prefixo `__staging_probe_`.

## 5. Configurar as Edge Functions e o OCR

Defina primeiro a origem HTTPS que hospedará o frontend de staging. `APP_ORIGIN` deve ser somente a origem, sem caminho, query, fragmento ou credenciais.

Na CLI ligada ao projeto de staging:

```bash
supabase secrets set \
  APP_ORIGIN=https://staging.seu-dominio.example \
  GEMINI_API_KEY=<secret> \
  OCR_MODEL_PRIMARY=<model-id-validado> \
  OCR_PROMPT_VERSION=1 \
  OCR_DAILY_HARD_LIMIT=100
```

`OCR_MODEL_QUALITY` é opcional. Não o configure como fallback automático nem use um modelo pago sem decisão explícita.

Implante:

```bash
supabase functions deploy process-ocr
supabase functions deploy delete-document
```

Não use `--no-verify-jwt`. A chave Gemini deve existir somente nos secrets do Supabase.

## 6. Construir o artifact estático

No GitHub Actions:

1. abra `Build deployable Fichário artifact`;
2. escolha `staging`;
3. selecione o SHA integralmente validado;
4. aprove o environment;
5. baixe `fichario-static-<commit>-staging`.

Depois de extrair:

```bash
cd fichario-deploy
sha256sum -c SHA256SUMS
cat DEPLOYMENT-MANIFEST.txt
```

No checkout da mesma versão:

```bash
pnpm test:deployment:artifact -- /caminho/para/fichario-deploy
```

Sirva publicamente somente `fichario-deploy/site/`. O manifest, checksums e snapshots de source ficam fora da raiz pública.

## 7. Publicar o host HTTPS

O host pode ser Cloudflare Pages, Netlify, Vercel estático, GitHub Pages adequadamente configurado ou um servidor privado. Ele precisa:

- servir `site/` como raiz;
- usar `200.html` como fallback de SPA;
- preservar `_headers` ou configurar headers equivalentes;
- redirecionar HTTP para a mesma origem HTTPS;
- não reescrever `/assets/*` para `200.html`;
- servir `sw.js`, `registerSW.js` e o web manifest com MIME correto;
- não cachear respostas autenticadas ou endpoints Supabase.

Depois da publicação, confirme que a URL final coincide exatamente com `APP_ORIGIN`. Quando a origem mudar, atualize o secret e reimplante as funções.

## 8. Executar o gate do host

No GitHub Actions, abra `Verify deployed Fichário`, informe a origem HTTPS sem caminho e execute.

Localmente, o equivalente é:

```bash
pnpm test:deployment -- https://staging.seu-dominio.example
```

O gate verifica redirect HTTP, CSP, HSTS, framing, MIME, Permissions Policy, manifesto, fallback SPA, service worker e regras de cache.

## 9. Executar o OCR real de staging

Somente depois de Supabase, Edge Functions e host estarem verdes:

1. abra `Verify OCR staging`;
2. selecione o mesmo SHA;
3. marque `confirm_external_ocr`;
4. aprove o environment `staging`;
5. exija resultado verde e examine o artifact sanitizado `ocr-staging-report-<run-id>`.

O workflow gera uma imagem sintética, faz uma única leitura real, exige os tokens `FICHARIO OCR 2718`, valida os estados persistidos e remove o documento pela Edge Function.

Falhas com `ocr_not_configured` indicam secret ausente ou inválido. Falhas do provedor devem ser investigadas pelos estados persistidos, sem troca automática de modelo ou plano.

## 10. Matriz manual em dispositivos físicos

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

## 11. Billing, backup e rollback

Antes de promover a release:

- confirme no painel que billing pago e limites expansíveis estão desativados;
- anote os limites gratuitos observados para banco, Storage, Functions e provedor OCR;
- execute e registre um backup do banco conforme o plano disponível;
- preserve o artifact estático e o commit anterior;
- valide que o frontend pode voltar ao artifact anterior sem alterar o banco;
- trate migrations como forward-only;
- preserve uma versão anterior das Edge Functions;
- registre quem pode aprovar environments e alterar secrets.

## 12. Critério de conclusão

A configuração externa está concluída somente quando houver evidência para o mesmo conjunto de versões:

```text
Validate current head: PASS
Verify Supabase staging: PASS
Verify deployed Fichário: PASS
Verify OCR staging: PASS
Matriz em celular: PASS ou riscos registrados
Matriz em tablet: PASS ou riscos registrados
Billing gratuito confirmado: PASS
Backup executado: PASS
Rollback documentado e ensaiado: PASS
```

Depois disso, registre a decisão final: staging prolongado, release privada ou produção. Uma ausência de defeitos conhecidos não substitui esses recibos.
