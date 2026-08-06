# Google Drive como armazenamento principal — design

_Data: 6 de agosto de 2026_  
_Status: decisões anteriores consolidadas e aprovadas para implementação_

## Objetivo

Restaurar o plano original do Fichário Virtual: o Google Drive é a fonte permanente dos arquivos originais, enquanto o Supabase mantém autenticação, metadados, OCR, busca, filas e estado de sincronização. O produto continua privado, limitado a uma conta autorizada e sem ativação automática de cobrança.

## Decisões obrigatórias

- O Drive é a autoridade física para imagens e PDFs permanentes.
- O Supabase Storage deixa de ser a cópia permanente obrigatória e passa a servir somente para processamento temporário, fallback explícito, migração e miniaturas quando necessário.
- O acesso inicial usa OAuth com o escopo mínimo `https://www.googleapis.com/auth/drive.file`.
- O aplicativo cria ou reconecta uma pasta raiz chamada `Fichário Digital`.
- Cadernos correspondem a pastas dentro da raiz; subcadernos correspondem a subpastas aninhadas.
- `drive_file_id` e `drive_folder_id` são as identidades físicas estáveis. Nome e caminho nunca são usados como identidade.
- Arquivos externos entram por seleção explícita em “Importar do Drive” e são copiados para a pasta controlada pelo aplicativo. Autoimportação ampla e escopos de leitura integral ficam fora do MVP.
- A sincronização é bidirecional e idempotente. Alterações locais e remotas alimentam uma fila retomável.
- O token do feed de mudanças é persistido. Ao abrir o aplicativo, uma reconciliação é executada mesmo que nenhuma notificação tenha sido recebida.
- Notificações futuras apenas acordam o sincronizador; o estado real sempre é obtido consultando o feed de mudanças.
- Uploads grandes usam sessões retomáveis.
- Quando a ordem das mudanças é confiável, a alteração mais recente vence. Quando não é possível ordenar com segurança, o item entra em conflito manual sem bloquear o restante da fila.
- O Drive é autoridade sobre existência e conteúdo físico. O Supabase é autoridade sobre OCR, correções, tags, busca e estado do domínio.
- Arquivo apagado no Drive vira `missing`; título, caderno, tags, OCR, correções e índice permanecem indefinidamente.
- O usuário pode reconectar um arquivo ausente ou excluir definitivamente o registro. O reaparecimento do mesmo `drive_file_id` reconecta automaticamente.
- Nenhum token OAuth, segredo de cliente ou URL temporária entra em logs, exportações, commits ou cache da PWA.
- Nenhum fallback pode ampliar escopos, ativar billing ou mover a biblioteca silenciosamente para outro provedor.

## Arquitetura

```text
PWA SvelteKit
├── seleção/captura e preparação local
├── cliente Google Drive com token efêmero
├── fila local retomável
├── reconciliação ao abrir e sob demanda
└── interface de conflitos/arquivos ausentes

Google Drive
├── Fichário Digital/                 (pasta raiz)
│   ├── Caderno/                      (drive_folder_id)
│   │   ├── Subcaderno/               (drive_folder_id)
│   │   └── arquivo.pdf               (drive_file_id)
│   └── arquivo.jpg
└── feed de mudanças

Supabase
├── Auth + allowlist
├── PostgreSQL
│   ├── metadados e OCR
│   ├── ligações Drive
│   ├── cursores do feed
│   ├── fila idempotente
│   └── conflitos e arquivos ausentes
├── Edge Functions para operações privilegiadas
└── Storage privado temporário
```

## Modelo de dados

### Conexão

`drive_connections` possui uma linha por usuário:

- estado da conexão;
- conta Google identificada sem expor token;
- `root_folder_id`;
- `start_page_token`/`next_page_token`;
- último início e conclusão de sincronização;
- erro sanitizado;
- timestamps.

Tokens de longa duração não são campos públicos da tabela. Quando a implementação backend de refresh token for ativada, o valor deverá permanecer em armazenamento secreto acessível somente por função privilegiada.

### Pastas e cadernos

`notebooks` recebe:

- `parent_notebook_id` para hierarquia;
- `drive_folder_id` único por usuário;
- `drive_modified_time` e `drive_version`;
- estado de sincronização e marca de ausência.

Mover ou renomear um caderno atualiza a pasta correspondente. Uma mudança remota atualiza o caderno após reconciliação.

### Documentos

`documents` recebe:

- `drive_file_id` único por usuário;
- `drive_parent_folder_id`;
- `drive_mime_type`;
- `drive_modified_time`, `drive_version` e checksum remoto quando disponível;
- `physical_state` (`available`, `missing`, `reconnecting`);
- estado de sincronização e conflito;
- `storage_path` passa a representar somente cópia temporária/fallback e torna-se opcional em uma migration compatível.

### Fila

`drive_sync_jobs` contém operações como:

- criar pasta;
- renomear/mover pasta;
- enviar arquivo;
- atualizar arquivo;
- copiar arquivo selecionado;
- aplicar mudança remota;
- marcar ausente;
- reconectar;
- excluir definitivamente.

Cada job possui chave idempotente, tentativas, lease, backoff, erro sanitizado e timestamps. Um conflito afeta somente o item relacionado.

## Fluxos

### Conectar

1. Usuário autenticado inicia OAuth.
2. O aplicativo exige exatamente `drive.file` e identidade básica necessária ao consentimento.
3. O sincronizador procura uma pasta criada anteriormente pelo aplicativo.
4. Se não encontrar, cria `Fichário Digital`.
5. Persiste `root_folder_id` e obtém o primeiro token do feed.
6. Executa reconciliação inicial.

### Importar arquivo novo

1. Preparação local produz o arquivo persistente e a miniatura/artefato de OCR necessário.
2. O arquivo persistente é enviado por sessão retomável ao Drive.
3. O `drive_file_id` é persistido no documento.
4. Somente artefatos temporários necessários ao OCR são enviados ao Supabase Storage.
5. Falha posterior de OCR não exige novo upload do original.

### Importar do Drive

1. O usuário escolhe explicitamente um arquivo pelo Picker/selector.
2. O aplicativo copia o arquivo para `Fichário Digital` ou para o caderno selecionado.
3. A cópia criada pelo aplicativo passa a estar coberta por `drive.file`.
4. O documento é indexado e ligado ao novo `drive_file_id`.

### Mudanças remotas

1. O sincronizador consulta `changes.list` com o token persistido.
2. Valida estritamente cada resposta e pagina até `newStartPageToken`.
3. Aplica mudanças idempotentemente.
4. Só avança o token depois que a página foi persistida com sucesso.
5. Arquivos removidos são marcados como ausentes; metadados e OCR não são apagados.

### Conflitos

- Versões ordenáveis usam `modifiedTime`/versão e a mudança mais recente vence.
- Alterações concorrentes sem ordem segura produzem um conflito com snapshots sanitizados.
- A fila continua processando outros itens.
- A resolução escolhida gera uma nova operação idempotente.

## Segurança e privacidade

- Escopo amplo `drive`, leitura integral e autoimportação global são proibidos no MVP.
- Tokens ficam fora de `localStorage`, exportações, service worker e logs.
- Respostas da API Google são validadas por schemas fail-closed.
- RLS e allowlist protegem todas as tabelas de estado.
- Operações que exigirem refresh token usam Edge Function e segredo backend; o navegador recebe no máximo token de acesso efêmero.
- CSP deve permitir apenas os hosts Google estritamente necessários quando a integração for ativada.
- Desconectar revoga o token e preserva os metadados locais em estado desconectado; não apaga silenciosamente arquivos do Drive.

## Entregas incrementais

1. Corrigir documentação canônica e prontidão.
2. Adicionar contratos puros de domínio e validação das respostas Google.
3. Adicionar migration com estado, hierarquia, fila, conflitos e RLS.
4. Adicionar serviço de conexão e sincronização baseado em interfaces testáveis.
5. Adicionar UI de conexão, estado e importação explícita.
6. Adicionar OAuth/backend e chamadas reais após configuração externa do Google Cloud.
7. Validar reconciliação, uploads retomáveis, exclusão, restauração e conflitos em staging.

## Critério de conclusão

O plano original só pode ser declarado concluído quando houver evidência para:

- conexão OAuth `drive.file`;
- criação/reconexão da raiz;
- cadernos e subcadernos refletidos em pastas;
- upload persistente no Drive;
- importação explícita de arquivo externo;
- reconciliação por feed;
- arquivo ausente preservando OCR/metadados;
- reconexão pelo mesmo ID;
- conflito isolado;
- upload grande retomável;
- tokens ausentes de frontend persistente, logs, exportações e cache;
- operação dentro dos níveis gratuitos, sem billing automático.
