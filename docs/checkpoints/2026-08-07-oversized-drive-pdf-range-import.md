# Checkpoint — PDFs grandes do Google Drive por referência e ranges

Data: 2026-08-07

## Objetivo

Fechar o principal buraco do fluxo Drive-first: PDFs externos maiores que o teto de download direto do navegador não devem exigir download integral, não devem duplicar o original no Supabase Storage e precisam sobreviver a reload/reset do navegador.

## Estado entregue

### Seleção e preservação

- O Google Picker continua aceitando os tipos explícitos suportados.
- O teto de **50 MiB** agora é apenas do caminho de download direto no navegador.
- PDFs maiores são copiados primeiro para a pasta controlada do aplicativo usando `drive.file`.
- A cópia recebe um `documents` placeholder e uma entrada durável em `drive_pdf_reference_imports` antes da inspeção pesada.
- Falha ao persistir o staging tenta remover a cópia recém-criada no Drive.
- O navegador não persiste access token ou refresh token.

### Leitura por ranges

- `downloadBrowserDriveRange` exige HTTP `206`.
- `Content-Range` e tamanho retornado precisam corresponder exatamente ao intervalo pedido.
- Uma resposta `200` que ignore `Range` é recusada antes da leitura do corpo, evitando fallback silencioso para o arquivo inteiro.
- O PDF.js usa `PDFDataRangeTransport` com chunks de 256 KiB.
- `disableStream: true` e `disableAutoFetch: true` impedem streaming/prefetch integral fora do transporte controlado.
- O Web Worker do PDF.js é configurado explicitamente antes de abrir o documento remoto.
- O transporte mantém apenas em memória uma lease efêmera de access token, reutilizando-a entre ranges e renovando perto da expiração. Isso evita uma chamada à Edge Function por chunk.

### Identidade física antes da inspeção

O staging guarda a identidade do arquivo copiado. Antes do primeiro range, o cliente compara a referência esperada com os metadados atuais do Drive:

- `fileId`;
- pasta pai controlada;
- MIME `application/pdf`;
- `modifiedTime`;
- `version`;
- MD5 quando disponível;
- tamanho lógico esperado, que também é revalidado pelos `Content-Range` durante a leitura.

Se a cópia tiver sido alterada depois do staging, a importação é recusada antes de abrir o PDF.js. O usuário pode excluir a referência e selecionar o arquivo novamente.

### Inspeção e OCR

- O documento remoto é percorrido sequencialmente.
- Cada `PDFPageProxy` é limpo imediatamente depois da extração de texto.
- Páginas com texto nativo são publicadas como `native_pdf`.
- Somente páginas sem texto extraível são renderizadas para OCR no fluxo remoto atual.
- O mesmo `PDFDocumentProxy` é reutilizado para renderizar páginas OCR; não há `file.arrayBuffer()` no caminho remoto.
- Render inicial: dimensão máxima 2400, qualidade 0,88.
- Se o derivado ultrapassar 12 MiB, há uma segunda tentativa em 1800 / 0,78.
- O resultado reduzido também é validado; se ainda ultrapassar 12 MiB, nada é enviado.
- Derivados usam caminho determinístico `<user>/<document>/pages/<n>.*` com overwrite permitido, tornando crash antes da publicação retomável.

### Publicação atômica

`finalize_drive_pdf_reference_import`:

- bloqueia staging + documento;
- valida descritores contínuos e únicos;
- atualiza `page_count/status` do placeholder;
- insere `pages` e `ocr_jobs` usando o contrato normal de PDFs;
- remove o staging somente depois de toda a publicação ter sido concluída na mesma transação.

O original continua identificado pelo Google Drive; não há `storage_path` integral nem hash local obrigatório para o PDF grande.

### Falhas distribuídas e retomada

O fluxo trata explicitamente os pontos de crash:

1. **Crash depois de um derivado temporário, antes do RPC final:** o retry sobrescreve o caminho determinístico.
2. **RPC final faz rollback:** o staging continua presente e os derivados enviados nessa tentativa podem ser removidos.
3. **RPC final commita, mas a resposta se perde:** o cliente consulta `documents`; se `page_count/status` confirmarem a publicação esperada, reconstrói o resultado e continua OCR.
4. **Estado de commit não pode ser confirmado:** derivados são preservados de forma conservadora; não há cleanup destrutivo sob incerteza.
5. **Crash depois da publicação, antes/depois de OCR:** staging já sumiu e os jobs normais de OCR continuam sendo a fonte de retomada.

A tela `/import/drive` lista referências pendentes após reload e permite `Retomar` sem reabrir o Picker ou reenviar o arquivo.

### Cancelamento e exclusão

A mesma tela permite excluir uma cópia preservada ainda pendente.

`delete-document` foi corrigida para Drive-first:

- só exige configuração Google quando `drive_file_id` existe;
- lê refresh token via RPC backend-only;
- renova access token no backend;
- apaga o arquivo controlado no Drive antes dos metadados;
- `204` e `404` do Drive são tratados como exclusão idempotente;
- credenciais não são devolvidas nem registradas;
- documentos storage-only mantêm o comportamento anterior.

## Testes adicionados/ajustados

Cobertura unitária inclui:

- byte ranges exatos e rejeição de fallback integral;
- lease efêmera compartilhada entre ranges e renovação por expiração;
- worker/configuração do PDF.js;
- inspeção nativa sequencial e cancelamento;
- render a partir de `PDFDocumentProxy` já aberto;
- orchestration de páginas OCR apenas;
- consentimento;
- cleanup pré-publicação;
- commit final ambíguo;
- retry de derivados;
- teto final de 12 MiB;
- identidade física mutada;
- listagem/retomada/cancelamento na rota;
- exclusão Drive-first;
- metadados estritos do Drive.

Cobertura pgTAP inclui:

- staging da referência;
- finalização atômica;
- listagem de referências retomáveis;
- lookup da identidade física esperada e isolamento por usuário.

## Gates e limitações do ambiente desta sessão

O ambiente local disponível nesta sessão não conseguiu instalar/ativar `pnpm` porque o Corepack não alcança `registry.npmjs.org` (`EAI_AGAIN`). Também não há Supabase CLI/PostgreSQL/Docker/Podman local disponível. Por isso, os gates completos de frontend e pgTAP precisam ser confirmados pelo GitHub Actions do head final.

Isso não foi tratado como bloqueio de desenvolvimento: testes e contratos foram adicionados junto ao código, e o CI será usado como gate de integração quando o head parar de receber commits.

## Próximas validações recomendadas

1. Deixar o GitHub Actions concluir no head final e corrigir qualquer incompatibilidade real de lint/tipos/SQL.
2. Executar um smoke test em navegador com PDF real >50 MiB, incluindo páginas nativas e páginas escaneadas.
3. Medir quantidade de requests/ranges em PDFs lineares e não linearizados para ajustar o chunk de 256 KiB se necessário.
4. Comparar a heurística remota `sem texto => OCR` com os critérios de qualidade do inspetor local; ampliar apenas se houver evidência de texto nativo ilegível/garbled em PDFs reais.
5. Regenerar `src/lib/types/database.ts` com `supabase gen types typescript --local` quando o gate Supabase local estiver disponível; o RPC de identidade usa por enquanto um contrato local estrito para não fingir schema gerado.
