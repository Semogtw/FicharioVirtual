# Checkpoint de hardening de contratos — 2026-08-03

## Identidade do checkpoint

- Branch: `main`
- Base analisada no início da sessão: `745ce1f595824e75bac992b00dfb4fe0cd47d984`
- HEAD de código antes deste documento: `2bf204cd52fd8ffd38ac54ede8f76bb66f59f84c`
- Relação com a base: 44 commits à frente, 0 atrás
- Escopo do diff: 22 arquivos
- Status de commit publicado pelo GitHub no HEAD de código: nenhum

Este documento não declara um novo checkpoint verde. O último `PASS` integral continua sendo o SHA explicitamente registrado em `docs/CURRENT_STATUS.md` até que todos os gates sejam executados sobre um HEAD posterior.

## Objetivo

Continuar a branch mais avançada sem interromper o desenvolvimento diante da indisponibilidade do workspace local. O trabalho priorizou falhas que poderiam:

- perder o estado `needs_review` em corridas concorrentes;
- abandonar páginas diante de falhas temporárias de rede;
- aceitar respostas de RPC ou Edge Function fora do contrato;
- deixar Promises penduradas após mensagens malformadas de workers;
- associar uploads a identificadores diferentes dos gerados pelo cliente;
- deixar arquivos temporários órfãos após conclusão concorrente.

## Mudanças entregues

### Concorrência e idempotência OCR

- A Edge Function limpa a imagem temporária quando outra execução conclui a página entre a leitura inicial e o `claim_ocr_job`.
- O ramo `already_complete` anterior ao claim inclui `needsReview`.
- O ramo `already_complete` posterior ao claim relê o status terminal da página em vez de assumir `ready`.
- A fila de imagem, o importador de PDF e a retomada preservam `needs_review` quando outra execução venceu a corrida.

Principais pares teste/implementação:

- `57ea58a` / `d1c1679` — cleanup depois da corrida de claim;
- `2c58820` / `dceeb17` — contrato cliente para revisão já concluída;
- `349909f` / `52ba7f4` — releitura do status terminal na Edge Function;
- `7eeb4ac` / `b6011af` — contagem de revisão no PDF;
- `0a0c647` / `204ad54` — revisão durante retomada;
- `8ba11f9` / `b5ce361` — revisão na fila de importação.

### Classificação de falhas e retomada

- Falhas sem resposta HTTP são classificadas como `ocr_transport_failed` e permanecem retryable.
- Erros `OcrProcessingError` retryable são contabilizados como pendentes durante retomada, não como falhas terminais.
- Linhas retornadas por `list_resumable_ocr_pages` agora exigem chaves exatas, UUID, página positiva e ausência de duplicatas.
- Estados de rejeição do claim são convertidos em erros de domínio somente quando o status HTTP corresponde ao contrato.

Principais pares:

- `8b0c428` / `a204825` — transporte retryable;
- `a1e19f0` / `6455e9a` — retomada mantém pendência;
- `cca297a` / `257bc64` — parser de páginas retomáveis;
- `685d317` / `e0e9cc1` — estados de rejeição do claim;
- `a83aed1` / `236853e` — correspondência entre estado e status HTTP.

### Contratos HTTP fail-closed

- O cliente OCR exige formas exatas para `complete`, `already_complete`, `busy`, `retry_later` e `quota_exhausted`.
- `warningCount` deve ser inteiro entre 0 e 100.
- Envelopes de erro com campos extras ou códigos inválidos não controlam a política de retry.
- Códigos públicos precisam corresponder ao padrão seguro definido no cliente.

Principais pares:

- `68934dd` / `8489f00` — formas exatas da resposta;
- `cbf05bb` / `9364ae9` — envelopes de erro estritos.

### Publicação de PDF

- A resposta de `create_pdf_import` exige chaves exatas.
- O `documentId` precisa ser UUID e igual ao identificador solicitado.
- Contagens precisam ser inteiras, não negativas e coerentes com `pageCount`.
- O status precisa corresponder à mesma regra determinística usada pela migration SQL.
- Respostas inválidas são convertidas em `metadata_failed`.

Principais commits:

- `e19309b` / `ebcf68a` — parser inicial do contrato;
- `25fd394` — correção de fronteira do teste de contagens;
- `922ed82` / `b803a8d` — identidade exata do documento.

### Publicação de imagem

- `create_image_import` deve retornar exatamente uma linha.
- A linha deve conter apenas `document_id`, `page_id` e `ocr_job_id`.
- Os três campos devem ser UUIDs e iguais aos IDs gerados localmente.
- Resposta ou erro inconsistente causa cleanup dos dois objetos enviados e `metadata_failed`.

Principais commits:

- `b9aecc3` / `ed6a5bf` — contrato de publicação da imagem.

### Deduplicação

- Imagem e PDF usam o mesmo parser fail-closed para a consulta por SHA-256.
- Ausência de duplicata só é representada por `null`.
- Uma duplicata precisa ser `{ id: <UUID> }`, sem campos extras.
- Resposta malformada vira `duplicate_check_failed`, não um redirecionamento para ID arbitrário.

Principais commits:

- `edd7eb6` / `7754f73` — parser compartilhado;
- `5b3634e`, `a95cf5e` e `fcf9e52` — adoção pelos dois importadores.

### Workers locais

#### Preparação de imagem

O cliente agora valida antes de resolver a tarefa:

- forma exata de sucesso ou falha;
- ID igual ao da tarefa;
- código de falha documentado;
- blobs não vazios em JPEG ou WebP;
- `format` coerente com a imagem preparada;
- dimensões inteiras, positivas e dentro do perfil solicitado.

Mensagem nula, divergente ou malformada termina em `worker_failed` em vez de poder lançar dentro do callback e deixar a Promise pendurada.

Principais commits:

- `b96e460`, `0c42e08` e `11e2a80`.

#### Inspeção de PDF

O cliente agora valida profundamente:

- envelope e ID da tarefa;
- códigos de falha documentados;
- tipo e contagem de páginas;
- páginas nativas e páginas destinadas a OCR sem sobreposição;
- intervalos e duplicatas de páginas;
- razões de OCR;
- confiança, duração, título, Markdown e flags;
- layout, tabelas e colunas.

Mensagem inválida termina em `inspection_failed` e sempre libera o worker e a vaga da fila.

Principais commits:

- `7ae4319` / `2bf204c`.

## Evidência disponível nesta sessão

### Confirmado

- Todos os commits acima foram criados diretamente na `main` e publicados pelo conector GitHub.
- A comparação `745ce1f..2bf204c` retornou `ahead_by: 44` e `behind_by: 0`.
- O GitHub não publicou status de CI para `2bf204c` no momento da consulta.
- Uma verificação isolada do contrato de publicação de PDF executou 12 casos e retornou `12/12`.
- As migrations de imagem e PDF foram lidas para alinhar os parsers ao contrato SQL real.

### Não executado

O ambiente local da sessão tinha Node.js e TypeScript, mas não resolvia `github.com` nem `registry.npmjs.org`. O checkout e as dependências do projeto não estavam disponíveis; Deno também não estava instalado.

Portanto, permanecem explicitamente `NOT RUN` neste checkpoint:

```text
pnpm verify:full
pnpm test:e2e
pnpm test:functions:check
pnpm test:db:local
```

Inspeção estática e testes adicionados ao repositório não substituem a execução desses gates.

## Próxima execução recomendada

1. Restaurar o workspace pelo bundle offline ou por checkout com rede funcional.
2. Executar `pnpm install --offline --frozen-lockfile` quando o store correspondente estiver disponível.
3. Executar `pnpm verify:full` no HEAD atual.
4. Corrigir primeiro qualquer erro de TypeScript ou formatação nos parsers novos.
5. Executar os gates Deno e Supabase locais.
6. Somente depois registrar um novo SHA verde em `docs/CURRENT_STATUS.md`.
7. Prosseguir para Supabase staging, OCR real e host HTTPS conforme `docs/CURRENT_STATUS.md` e `docs/TESTING.md`.

## Regras preservadas

- Nenhum segredo foi adicionado ao frontend, aos testes ou à documentação.
- Nenhum endpoint de fault injection foi adicionado à função implantável.
- Falhas temporárias continuam sem exigir reupload.
- Páginas com texto nativo continuam fora do OCR.
- Nenhum `PASS` foi atribuído sem execução real do gate.
