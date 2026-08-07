# Checkpoint — recuperação distribuída e staging paginado de PDFs grandes

_Data: 2026-08-07_

## Objetivo

Fortalecer o fluxo de PDFs grandes selecionados pelo Google Picker sem reintroduzir um teto lógico de tamanho e sem ampliar o escopo OAuth além de `drive.file`.

O trabalho deste checkpoint cobre duas classes diferentes de risco:

1. janelas distribuídas entre Google Drive e PostgreSQL;
2. crescimento do payload HTTP de finalização quando o PDF possui muitas páginas e muito texto nativo.

## Recuperação distribuída já integrada

### Cópia criada antes do staging

A cópia controlada do PDF recebe, no próprio `files.copy`, propriedades privadas do app:

- `ficharioPurpose=oversized_pdf_reference`;
- `ficharioDocumentId=<UUID do documento>`.

O UUID é criado antes da chamada ao Drive. Assim, se o navegador morrer depois da cópia e antes de `stage_drive_pdf_reference`, a cópia continua identificável sem listar arquivos fora do conjunto permitido por `drive.file`.

A rota de importação executa reconciliação silenciosa e não bloqueante. Somente cópias gerenciadas com idade mínima de uma hora entram na análise. O banco é consultado antes de qualquer `DELETE`:

- documento existente: preservar a cópia e remover o marcador privado em best-effort;
- documento comprovadamente ausente: remover a cópia órfã;
- erro ou resposta ambígua do banco: não remover nada.

Falha em uma exclusão individual não impede a análise das demais cópias.

### Staging commitado com resposta perdida

`stageDrivePdfReference` não interpreta mais qualquer erro de RPC como autorização para apagar a cópia no Drive.

Depois de uma falha ou de uma resposta de sucesso malformada, o cliente consulta `get_drive_pdf_reference_identity` e compara a identidade física completa esperada:

- document id;
- Drive file id;
- parent folder id;
- MIME PDF;
- modified time;
- Drive version;
- MD5 quando disponível;
- tamanho original.

Se a identidade durável coincide, o staging é recuperado e a cópia permanece.

Se a identidade não pode ser consultada com segurança, a operação falha fechada e informa que a cópia foi preservada.

### SQLSTATE `55000` e corrida entre abas

`55000` isoladamente não significa que a cópia pode ser apagada. Outra aba pode ter finalizado o documento e removido a linha de staging antes da consulta de recuperação.

Por isso, após `55000`, o cliente consulta `documents.id` sob RLS:

- `documents.id` ausente e consulta bem-sucedida: ausência durável comprovada; cleanup da cópia é permitido;
- documento presente: preservar;
- erro ou payload malformado: preservar.

### Marcadores privados após staging

Depois de staging normal ou recuperado, o marcador privado usado para recuperação é removido com `files.update` em best-effort.

Falha nessa limpeza nunca transforma um staging válido em erro. A reconciliação posterior também remove marcadores antigos de documentos que o banco reconhece como duráveis.

## OCR de PDFs grandes

O caminho por ranges reutiliza agora o mesmo planner adaptativo de OCR usado pelos PDFs locais:

- o tamanho real de cada derivado renderizado alimenta o planner;
- páginas compatíveis são enviadas em lotes;
- split/retry continua seletivo;
- progresso permanece por página;
- dependências legadas sem batch mantêm fallback página-a-página apenas para compatibilidade de testes/integrações.

Isso evita transformar um PDF de muitas páginas em uma chamada Gemini por página quando os limites do provedor permitem agrupamento.

## Staging paginado de descritores — implementado, ainda não conectado ao caminho ativo

O finalizador ativo ainda recebe o plano completo de páginas em um único argumento JSONB. Para remover esse payload HTTP potencialmente muito grande, foi introduzida uma nova infraestrutura de staging de descritores.

### Browser

`stageDrivePdfReferencePageDescriptors`:

- valida o plano inteiro antes da primeira RPC;
- exige páginas contínuas em ordem;
- impede IDs de página/job duplicados;
- preserva texto nativo multilinha;
- valida paths de derivados;
- divide o transporte em lotes de 64 por padrão;
- permite lotes menores;
- nunca permite mais de 100 descritores em uma requisição;
- não limita o número total de páginas pelo tamanho do lote;
- para no primeiro erro;
- falhas do observer de progresso não afetam staging.

### PostgreSQL

`drive_pdf_reference_page_descriptors` guarda descritores sob a referência durável com:

- PK `(document_id, page_number)`;
- unicidade de page id e job id por documento;
- shape nativo/OCR mutuamente exclusivo;
- texto nativo limitado ao contrato existente de 120 mil caracteres por página;
- path temporário exato por usuário/documento/página;
- RLS owner-only;
- escrita direta revogada de `authenticated`;
- cascade quando a referência é removida/finalizada.

A RPC interna `stage_drive_pdf_reference_page_batch(uuid,jsonb)` valida no máximo 100 descritores por chamada e possui semântica de retry imutável: repetir o mesmo descritor é idempotente; tentar mudar a mesma página é erro.

### Finalização local ao banco

`finalize_staged_drive_pdf_reference_import(uuid,integer,integer)`:

1. bloqueia a referência do dono;
2. exige exatamente `N` descritores com mínimo 1 e máximo `N`;
3. monta o JSON ordenado dentro do PostgreSQL;
4. delega para o finalizador atômico já endurecido;
5. retorna a publicação como JSONB.

Isso remove a necessidade de transportar o JSON completo pelo navegador, mas reutiliza o finalizador existente em vez de duplicar suas validações.

## Lease de tentativa para retries e concorrência

Antes de conectar o staging paginado ao orquestrador, foi adicionada uma camada de tentativa com lease:

- `descriptor_attempt_id`;
- `descriptor_expected_page_count`;
- `descriptor_attempt_expires_at`.

RPCs expostas ao navegador:

- `begin_drive_pdf_reference_descriptor_attempt`;
- `stage_drive_pdf_reference_page_batch(uuid,uuid,jsonb)`;
- `abandon_drive_pdf_reference_descriptor_attempt`;
- `finalize_staged_drive_pdf_reference_import(uuid,uuid,integer)`.

A função de staging sem `attempt_id` e o finalizador intermediário sem lease deixam de ser executáveis por `authenticated` e permanecem como implementação interna.

Regras do lease:

- mesma tentativa pode renovar;
- tentativa concorrente ativa recebe lock/busy;
- tentativa concorrente expirada pode ser substituída;
- substituição remove descritores antigos antes de iniciar;
- cada lote renova o lease;
- abandono só remove a tentativa que corresponde ao `attempt_id` do chamador;
- finalização exige a tentativa ativa e não expirada.

O cliente `stageAndFinalizeDrivePdfReferenceDescriptors` encapsula begin → batches → finalize e tenta abandonar em erro/abort. Falha no abandono é ignorada para não esconder o erro original; crash real é recuperado pela expiração do lease.

## Estado de integração

A recuperação distribuída, reconciliação de cópias, limpeza de marcadores e OCR em lotes já foram integrados ao fluxo de PDF grande.

O staging paginado de descritores e o lease foram adicionados como infraestrutura separada, mas **ainda não substituem o `finalize` usado pelo orquestrador principal** neste checkpoint. Essa separação é deliberada: a próxima etapa deve tratar também a concorrência sobre os derivados temporários antes de ativar o novo protocolo no caminho de produção.

## Próximos passos

1. obter um recibo completo do CI para as migrations/RPCs novas;
2. adicionar uma sessão/lease utilizável durante a fase de derivados ou garantir isolamento equivalente entre abas;
3. conectar o orquestrador de PDF grande ao staging paginado;
4. manter recuperação de publicação após resposta perdida do finalizador;
5. garantir que cleanup de uma tentativa antiga nunca remova derivados pertencentes a outra tentativa;
6. atualizar `CURRENT_STATUS.md` somente depois do mesmo SHA passar frontend, Chromium, Edge e banco.
