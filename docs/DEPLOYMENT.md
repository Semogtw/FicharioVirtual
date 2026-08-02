# Deployment do Fichário Virtual

## Topologia

O frontend é um site estático SvelteKit. Supabase fornece:

- Auth;
- PostgreSQL;
- Row Level Security;
- Storage privado;
- Edge Functions.

A chave Gemini existe somente como secret da função `process-ocr`.

## 1. Preparar o Supabase

Crie um projeto e aplique as migrações em ordem:

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase test db
```

Depois regenere os tipos:

```bash
supabase gen types typescript --linked > src/lib/types/database.ts
pnpm format src/lib/types/database.ts
```

Revise o diff antes de publicar. As casts temporárias dos serviços devem ser removidas quando as RPCs aparecerem nos tipos gerados.

## 2. Configurar usuário autorizado

Crie a conta no Supabase Auth e adicione o UUID correspondente em `public.app_users`:

```sql
insert into public.app_users (user_id, is_active)
values ('<auth-user-uuid>', true);
```

Não use email como chave de autorização nas políticas. `auth.uid()` e a allowlist são a fonte de acesso.

## 3. Configurar Storage

A migration cria o bucket privado `documents` e políticas por prefixo do usuário.

Confirme:

- bucket não público;
- uploads somente em `<auth.uid()>/<document-id>/...`;
- download direto negado sem sessão;
- URL assinada com validade curta;
- remoção recusada para outro usuário.

## 4. Configurar Edge Functions

Secrets obrigatórios:

```bash
supabase secrets set \
  APP_ORIGIN=https://seu-dominio.example \
  GEMINI_API_KEY=<secret> \
  OCR_MODEL_PRIMARY=<model-id-validado> \
  OCR_PROMPT_VERSION=1 \
  OCR_DAILY_HARD_LIMIT=100
```

Opcionalmente configure `OCR_MODEL_QUALITY`, mas não existe fallback automático pago no código atual.

Implante:

```bash
supabase functions deploy process-ocr
supabase functions deploy delete-document
```

Não use `--no-verify-jwt`. As funções validam o usuário e operam com o token recebido; o frontend não recebe service-role key.

## 5. Variáveis públicas do frontend

```text
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

Não prefixe secrets com `PUBLIC_`.

## 6. Construir o frontend

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

O output estático fica em `build/`.

## 7. Hospedar

O host precisa:

- servir `build/`;
- usar `200.html` como fallback de SPA;
- preservar `static/_headers` ou configurar headers equivalentes;
- usar HTTPS;
- redirecionar HTTP para o mesmo host HTTPS;
- não reescrever `/assets/*` para `200.html`;
- servir `sw.js`, `registerSW.js` e manifesto com tipos corretos.

Hosts compatíveis incluem Cloudflare Pages, Netlify, GitHub Pages com configuração própria, Vercel estático ou servidor privado. Não há dependência arquitetural de um host específico.

## 8. Validação automática pós-deployment

Execute contra a origem HTTPS, sem caminho adicional:

```bash
pnpm test:deployment -- https://seu-dominio.example
```

Também é possível usar variável de ambiente:

```bash
STAGING_URL=https://seu-dominio.example pnpm test:deployment
```

O comando falha se encontrar:

- URL sem HTTPS, com credentials, query, fragmento ou subcaminho;
- ausência de redirect HTTP para o mesmo host HTTPS;
- headers de CSP, HSTS, referrer, framing, MIME, permissions ou isolamento inconsistentes;
- HTML raiz ou fallback SPA sem manifesto e registrador externo adiado;
- manifesto sem modo `standalone`, `start_url` raiz ou ícone válido;
- `registerSW.js` ou `sw.js` com cache longo;
- service worker mencionando origem Supabase ou superfícies privadas de API.

Esse gate valida o host e os artefatos públicos. Ele não autentica usuários nem substitui os testes manuais de RLS, Storage, OCR e expiração de URL assinada.

## 9. Validação funcional pós-deployment

### Autenticação

- usuário autorizado entra;
- usuário fora da allowlist recebe bloqueio;
- logout remove acesso;
- refresh em rota privada preserva sessão válida;
- sessão expirada volta ao login.

### Dados privados

- outra conta não lista documentos;
- URL assinada expira;
- caminho de Storage não aparece na UI/exportação;
- PWA offline não revela documentos vistos anteriormente.

### Importação

- imagem preparada e deduplicada;
- PDF textual não chama OCR;
- PDF misto chama OCR apenas para páginas marcadas;
- cancelamento mantém estado coerente;
- reload retoma páginas persistidas sem reupload.

### OCR

- consentimento obrigatório;
- segredo ausente retorna configuração indisponível;
- quota local bloqueia antes da rede;
- quota do provedor entra em `blocked_quota`;
- 503 entra em retry com backoff;
- 403/404 não repetem automaticamente;
- página temporária é apagada após conclusão.

### Busca e revisão

- correção manual substitui texto original na busca;
- realce não interpreta HTML;
- fila de revisão abre a página correta;
- exportação JSON valida o schema v1.

## Rollback

Frontend:

- preserve releases anteriores do diretório `build/`;
- reverta o artifact estático sem modificar o banco.

Banco:

- migrations são forward-only;
- crie nova migration corretiva, não edite uma migration já aplicada;
- antes de mudanças destrutivas, exporte o manifesto portátil e faça backup Supabase.

Edge Functions:

- mantenha o commit/artefato anterior disponível;
- rollback da função não deve reverter tabelas de estado;
- funções antigas precisam tolerar estados já persistidos ou falhar fechado.

## Proibições

- não publicar `GEMINI_API_KEY` ou service-role key;
- não tornar o bucket público;
- não cachear endpoints Supabase;
- não habilitar billing automaticamente;
- não inserir fallback de modelo silencioso;
- não declarar release pronta sem gates locais, banco e validação em dispositivo.
