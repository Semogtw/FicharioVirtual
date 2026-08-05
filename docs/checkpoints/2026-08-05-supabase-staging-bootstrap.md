# Checkpoint: bootstrap do Supabase de staging

_Data: 2026-08-05_

## Ambiente criado

- organização: `Semogtw's Org`;
- plano confirmado: `free`;
- projeto: `fichario-staging`;
- project ref: `exgggshcdzjaxmfcoasm`;
- região: `sa-east-1`;
- estado observado após criação: `ACTIVE_HEALTHY`;
- PostgreSQL: 17, canal GA.

Nenhum recurso pago, branch computacional ou billing adicional foi habilitado.

## Banco remoto

As 31 migrations existentes no checkpoint `3e628d3abe36cec02636ee898d9ec814e0d068f1` foram aplicadas em ordem. O histórico remoto foi normalizado para usar as versões e nomes dos arquivos locais, evitando que uma execução futura de `supabase db push` interprete migrations já aplicadas como pendentes.

O advisor de performance detectou cinco chaves estrangeiras sem índices cobridores. A migration `202608050001_cover_foreign_keys.sql` adicionou índices para:

- `document_tags (document_id, user_id)`;
- `document_tags (tag_id, user_id)`;
- `documents (notebook_id, user_id)`;
- `ocr_jobs (page_id, user_id)`;
- `pages (document_id, user_id)`.

Ela foi aplicada ao staging e removeu todos os avisos de foreign key sem índice. Os avisos restantes são somente índices ainda não utilizados, esperado em um banco novo e vazio.

## Verificações de segurança

O estado remoto observado contém:

- 9 tabelas públicas;
- RLS habilitada e forçada nas 9 tabelas;
- 9 policies públicas;
- bucket `documents` privado;
- 4 policies de Storage por proprietário;
- limite de 20 MiB por objeto;
- allowlist `app_users` vazia, mantendo acesso fail-closed até a criação da conta autorizada.

O advisor de segurança lista como avisos as RPCs `SECURITY DEFINER` intencionalmente expostas ao papel `authenticated`. Essas funções validam `auth.uid()`, propriedade dos registros e/ou allowlist. O aviso foi registrado para revisão arquitetural, mas não foi suprimido nem contornado.

## Edge Functions

Foram implantadas com verificação JWT obrigatória:

- `delete-document`, versão 1, estado `ACTIVE`;
- `process-ocr`, versão 1, estado `ACTIVE`.

As funções permanecem fail-closed enquanto `APP_ORIGIN` e os secrets de OCR não forem configurados no painel/CLI do Supabase. Nenhuma chave privada foi adicionada ao GitHub, ao frontend ou a este documento.

## Tipos

A geração remota de tipos TypeScript concluiu com sucesso e confirmou as 9 tabelas, enums e RPCs esperadas. A migration de índices não altera o contrato TypeScript versionado.

## Pendências que exigem superfície não exposta pelos conectores

- criar duas contas Supabase Auth, uma autorizada e uma não autorizada;
- inserir somente o UUID autorizado em `public.app_users`;
- definir `APP_ORIGIN`, `GEMINI_API_KEY`, `OCR_MODEL_PRIMARY`, `OCR_PROMPT_VERSION` e `OCR_DAILY_HARD_LIMIT` nos secrets das Edge Functions;
- cadastrar as variáveis públicas e credenciais de teste no environment `staging` do GitHub;
- publicar o frontend em host HTTPS e executar os gates externos.

O conector atual não fornece criação de usuários Auth, escrita de secrets do Supabase/GitHub ou um contrato utilizável para enviar o diretório do projeto à Vercel.
