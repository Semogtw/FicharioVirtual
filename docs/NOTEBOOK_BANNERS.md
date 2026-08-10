# Banners personalizados de cadernos

## Objetivo

A tela interna de cada caderno pode exibir um banner visual opcional acima do cabeçalho do caderno e antes da grade de documentos. A personalização é puramente visual: não altera a capa textual existente (`cover_style`) nem a organização dos documentos.

## Comportamento

- cadernos sem banner não reservam uma área visual grande; exibem apenas a ação discreta **Adicionar banner**;
- o editor permite escolher uma imagem JPG, PNG ou WebP, visualizar o recorte, ajustar o ponto focal horizontal e vertical, substituir a imagem ou remover o banner;
- o ponto focal é persistido como dois inteiros entre `0` e `100` e aplicado por `object-position`;
- a altura do banner é responsiva e reduzida no celular para não empurrar os documentos para baixo;
- imagens de entrada podem ter até 12 MiB e são reduzidas no navegador para no máximo `2000 x 1200` antes do upload quando isso é vantajoso;
- PNG é convertido para WebP no preparo do banner; JPEG/WebP já compactados são preservados quando a conversão ficaria maior.

## Privacidade e armazenamento

O banner usa o bucket privado existente `documents`. Não existe URL pública permanente.

O caminho persistido segue o namespace:

```text
<user-id>/notebook-banners/<notebook-id>/<asset-id>.<ext>
```

As políticas de Storage já restringem leitura, escrita e remoção pelo primeiro segmento do caminho, que precisa ser o `auth.uid()` do usuário autenticado. A migration do banner acrescenta ainda uma constraint no banco exigindo que `banner_path` corresponda ao `user_id` e ao `id` do próprio caderno.

A UI solicita uma signed URL temporária de 1 hora para renderizar o banner.

Ao substituir uma imagem, a atualização do caderno é a operação autoritativa. A remoção do objeto antigo é best-effort: uma falha de limpeza não desfaz o banner novo nem deixa o banco apontando para um objeto apagado. Se um upload novo falhar antes de virar o banner ativo, esse objeto é removido em rollback best-effort.

## Banco de dados

A migration `202608101955_notebook_banners.sql` adiciona a `public.notebooks`:

- `banner_path text null`;
- `banner_position_x smallint not null default 50`;
- `banner_position_y smallint not null default 50`.

`public.list_notebooks()` passa a retornar os três campos para que a tela do caderno não precise de uma consulta paralela apenas para descobrir a aparência atual.

Até a próxima regeneração real dos tipos Supabase, `src/lib/types/database-notebook-banner-extensions.ts` estende somente a tabela `notebooks` em vez de editar manualmente o espelho provisório `database.ts`.

## Validação

A implementação possui:

- testes unitários para MIME/tamanho, posição focal e namespace de Storage;
- contratos de parsing dos novos campos no serviço de cadernos;
- pgTAP para defaults, constraints de ownership, limites `0..100` e privilégios do RPC;
- Playwright cobrindo **Cadernos → abrir caderno → adicionar banner → ajustar foco → salvar → reposicionar → remover**;
- validação responsiva em viewport desktop `1200 x 800` e mobile `390 x 844`.

O pgTAP deve ser executado pelo gate Supabase/CI quando `psql` estiver disponível. O bundle offline portátil inclui o código e as dependências do frontend, mas não promete `psql` como parte do artefato.
