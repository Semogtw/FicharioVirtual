# Arquitetura do aplicativo nativo

> Status: planejamento técnico inicial
> Alvos: Android, Linux e Windows
> Base: `main` em 2026-08-19
> Branch: `feat/native-app-android-linux-windows`

## 1. Objetivo

Transformar o Fichário Virtual em um aplicativo local-first sem reescrever o frontend existente. O aplicativo deve manter a mesma experiência e backend do produto web, mas remover Google Drive/rede do caminho crítico de abertura de documentos.

O resultado esperado é uma única base de código SvelteKit/Svelte 5 empacotada com Tauri 2 para Android, Linux e Windows, mantendo a versão web/PWA funcionando em paralelo.

### Metas principais

- documentos já importados devem abrir a partir do armazenamento local;
- funcionamento offline para biblioteca, visualização e metadados já sincronizados;
- Drive passa a ser sincronização/backup, não fonte primária de leitura;
- manter Supabase, OCR, embeddings, busca e demais serviços existentes;
- evitar Electron e runtimes duplicados para manter o aplicativo pequeno;
- compartilhar o máximo possível de código entre web, Android, Linux e Windows;
- permitir recuperação transparente em dispositivo novo;
- uploads, OCR, embeddings e sync não devem bloquear a abertura do documento;
- nenhuma credencial sensível deve ser armazenada em texto puro.

## 2. Decisão de tecnologia

### Tauri 2

Tauri 2 é a opção preferida para o shell nativo porque suporta desktop e mobile e aceita frontend compilado para HTML/CSS/JS. O Fichário já usa SvelteKit + `@sveltejs/adapter-static`, portanto a integração é compatível com a arquitetura atual.

O Tauri usa o WebView do sistema em vez de empacotar Chromium completo. Isso reduz tamanho de distribuição e consumo de memória em comparação a Electron, sem exigir uma reescrita da interface.

Integração proposta:

```text
src/                     frontend compartilhado atual
src/lib/platform/        abstrações web/native
src-tauri/               shell Tauri + comandos Rust
  src/
  capabilities/
  gen/android/           projeto Android gerado pelo Tauri
```

A configuração deve usar `build/` como `frontendDist`, preservando o adapter estático existente.

## 3. Visão de arquitetura

```text
                       UI SvelteKit
                           |
                  Platform Services
             +-------------+-------------+
             |                           |
          Web/PWA                      Tauri
             |                           |
       OPFS/IndexedDB              Native Storage
                                         |
                              +----------+----------+
                              |                     |
                           SQLite              Filesystem
                              |                     |
                              +----------+----------+
                                         |
                                 Local Repository
                                         |
                              Background Sync Engine
                      +------------------+------------------+
                      |                  |                  |
                  Supabase           Google Drive       OCR/Embedding
```

A UI nunca deve saber se um documento veio de OPFS, filesystem nativo ou Drive. Ela deve pedir um `DocumentSource` à camada de plataforma.

## 4. Contratos de plataforma

Criar interfaces independentes do Tauri para impedir que chamadas nativas vazem pela aplicação inteira.

```ts
interface LocalDocumentStore {
	import(input: ImportInput): Promise<LocalDocument>;
	open(documentId: string): Promise<DocumentHandle>;
	exists(documentId: string): Promise<boolean>;
	remove(documentId: string): Promise<void>;
	getUsage(): Promise<StorageUsage>;
}

interface SecureCredentialStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}

interface SyncQueue {
	enqueue(job: SyncJob): Promise<void>;
	retryDue(): Promise<void>;
	status(documentId: string): Promise<SyncStatus>;
}
```

Implementações:

- `web`: OPFS/IndexedDB + mecanismos web existentes;
- `native`: filesystem/SQLite/secure store do Tauri;
- testes: adapters em memória.

## 5. Modelo local-first

### Regra central

O arquivo local é a fonte de leitura. A nuvem é a fonte de sincronização e recuperação.

Abrir documento:

```text
1. procurar localmente
2. se existe -> abrir imediatamente
3. se não existe e está online -> baixar uma vez
4. salvar localmente de forma atômica
5. abrir local
6. se não existe e está offline -> informar indisponibilidade local
```

Não fazer:

```text
UI -> pedir signed URL -> Drive -> baixar -> Blob -> renderizar
```

para documentos que já estão na biblioteca local.

### Importação

```text
Selecionar arquivo
      |
      v
Copiar/mover para staging local
      |
      v
Hash + MIME + tamanho
      |
      v
Registro SQLite
      |
      +----> UI já pode abrir
      |
      +----> fila de thumbnail
      +----> fila de upload
      +----> fila de OCR
      +----> fila de embedding
```

O usuário não deve esperar upload, OCR ou embedding para que o documento apareça e possa ser aberto.

## 6. Layout do armazenamento

Usar diretório de dados privado do aplicativo por padrão.

```text
app-data/
  db/
    fichario.sqlite
  documents/
    <document-id>/
      original.<ext>
      metadata.json          # opcional; SQLite é autoridade
  thumbnails/
    <document-id>.webp
  previews/
    <document-id>/
      page-0001.webp
  staging/
  sync/
  logs/
```

### Regras

- nomes físicos baseados em UUID, nunca no nome fornecido pelo usuário;
- extensão derivada de MIME validado;
- escrita atômica: staging -> fsync quando aplicável -> rename;
- hash SHA-256 calculado durante a cópia, sem segunda leitura completa quando possível;
- original não deve ser convertido/destruído para gerar preview;
- thumbnails/previews são descartáveis e podem ser reconstruídos;
- arquivos incompletos em `staging/` devem ser recuperados/removidos na inicialização.

## 7. SQLite local

Usar SQLite como catálogo local, não como armazenamento dos blobs grandes.

Tabelas mínimas planejadas:

### `local_documents`

- `document_id` UUID, PK;
- `user_id`;
- `local_rel_path`;
- `mime_type`;
- `size_bytes`;
- `sha256`;
- `created_at`;
- `updated_at`;
- `last_opened_at`;
- `local_state`: `present | downloading | missing | corrupted`;
- `remote_state`: `pending | synced | failed | deleted`;
- `remote_revision`;
- `drive_file_id` nullable.

### `sync_jobs`

- `id`;
- `document_id`;
- `kind`;
- `state`;
- `attempts`;
- `next_attempt_at`;
- `lease_until`;
- `last_error_code`;
- `created_at`;
- `updated_at`.

### `local_settings`

Somente preferências não sensíveis. Tokens/chaves ficam no secure store.

### `schema_migrations`

Migrations explícitas e versionadas. Nunca alterar schema local implicitamente na inicialização.

## 8. Sincronização

A sincronização precisa ser idempotente e tolerante a interrupções.

### Estados de documento

```text
LOCAL_ONLY
   -> UPLOAD_PENDING
   -> UPLOADING
   -> SYNCED

SYNCED
   -> REMOTE_CHANGED
   -> DOWNLOADING
   -> SYNCED

qualquer operação
   -> RETRY_WAIT
   -> estado anterior
```

### Requisitos

- fila persistente em SQLite;
- backoff exponencial com jitter;
- tentativas classificadas em transitórias e permanentes;
- limite de concorrência por tipo de job;
- leases para impedir dois workers processando o mesmo job;
- upload resumível para arquivos grandes quando o provedor permitir;
- hash/revisão usados para detectar arquivo já sincronizado;
- ações remotas devem ser idempotentes;
- o app deve poder ser encerrado durante qualquer etapa sem corromper a biblioteca.

### Conflitos

O Fichário é majoritariamente um acervo de documentos, então conflitos de conteúdo devem ser raros. Política inicial:

1. original é imutável depois da importação;
2. metadados usam `updated_at`/revisão e operações determinísticas;
3. exclusão usa tombstone em vez de apagar imediatamente o registro de sync;
4. nunca sobrescrever silenciosamente dois originais diferentes com o mesmo `document_id`;
5. em caso de divergência impossível de resolver, preservar as duas cópias e marcar conflito.

## 9. Cache e política de espaço

Distinguir conteúdo durável de cache:

### Durável

- original importado;
- banco local;
- estado da fila;
- credenciais seguras.

### Reconstruível

- thumbnails;
- previews renderizados;
- blobs temporários;
- respostas derivadas.

Implementar orçamento configurável para cache reconstruível e limpeza LRU. Nunca remover automaticamente um original local se ele ainda não estiver confirmado na nuvem.

Uma futura opção "economizar espaço" poderá remover originais sincronizados pouco usados, mas somente como recurso explícito e reversível por download.

## 10. Visualização de documentos

### Imagens

- carregar por URI/protocolo local seguro;
- thumbnail WebP/AVIF quando apropriado;
- original apenas quando necessário;
- decodificação assíncrona;
- evitar Base64 para arquivos grandes.

### PDFs

- manter `pdfjs-dist` existente;
- leitura local via stream/ArrayBuffer/protocolo controlado;
- renderização somente das páginas visíveis + pequena janela de prefetch;
- cancelar renderização de páginas que saíram da viewport;
- thumbnails persistentes da capa/páginas mais acessadas;
- evitar carregar o PDF inteiro em memória quando APIs de range/stream forem viáveis.

### Busca com marcação

O resultado da busca deve continuar abrindo o documento real. Geometria OCR/posição de página permanece metadado; a transcrição nunca substitui a visualização do original.

## 11. Android

### Armazenamento

Por padrão, copiar arquivos importados para o diretório privado do app. Isso oferece comportamento previsível e acesso rápido sem depender permanentemente de permissões a caminhos externos.

Para importar arquivos externos:

- usar seletor de documentos do sistema;
- ler via URI concedida pelo Android;
- copiar para a biblioteca privada;
- não solicitar acesso irrestrito a todo o armazenamento;
- câmera/share intent podem ser adicionados depois do fluxo base.

### Background

Android pode suspender/processar o app de forma agressiva. Portanto:

- fila sempre persistida antes de iniciar rede;
- foreground-only não pode ser pressuposto;
- tarefas grandes devem poder retomar;
- processamento em background deve respeitar restrições de bateria/rede;
- se integração específica com WorkManager for necessária, encapsular em plugin/comando nativo sem contaminar o domínio compartilhado.

### Distribuição

- debug APK para desenvolvimento;
- release AAB para Google Play;
- APK assinado opcional para sideload;
- keystore fora do repositório;
- `versionCode` monotônico.

## 12. Linux

### Distribuição inicial

Prioridade:

1. AppImage para instalação simples;
2. `.deb` para Debian/Ubuntu;
3. RPM se houver demanda;
4. AUR/Flatpak podem vir depois.

### Integração

- diretório XDG de dados/config/cache por meio das APIs de path do Tauri;
- file picker nativo;
- single instance;
- abrir arquivos enviados ao app por associação de extensão em fase posterior;
- integração opcional com desktop OCR worker existente deve permanecer desacoplada.

## 13. Windows

### Distribuição inicial

- NSIS `.exe` como instalador padrão;
- MSI opcional para cenários administrativos;
- Microsoft Store somente depois que fluxo direto estiver estável.

### Integração

- usar WebView2 do sistema;
- dados em diretório de aplicação do usuário;
- file picker nativo;
- single instance;
- protocolo/deep link para callbacks de autenticação se necessário;
- assinatura de código para releases públicos quando infraestrutura estiver pronta.

## 14. Segurança

### Capabilities Tauri

Aplicar menor privilégio:

- filesystem somente nos diretórios realmente necessários;
- nenhuma permissão genérica de shell para o frontend;
- comandos Rust com allowlist explícita;
- URLs externas abertas apenas por API controlada;
- CSP mantida/ajustada para o contexto Tauri;
- validar MIME, extensão e tamanho no boundary nativo.

### Segredos

Tokens de OAuth, refresh tokens e outros segredos não devem ficar em `localStorage`, IndexedDB ou arquivo JSON em texto puro no aplicativo nativo.

Preferência:

1. armazenamento seguro do SO quando disponível/adequado;
2. Tauri Stronghold ou integração equivalente para material que precise de vault local;
3. somente identificadores não sensíveis no SQLite.

### Arquivos locais

- não aceitar traversal em caminhos;
- UI trabalha com `document_id`, não caminho arbitrário;
- comandos nativos resolvem caminhos dentro da raiz permitida;
- downloads são gravados em staging antes de serem promovidos a original;
- hash e tamanho verificados quando conhecidos.

## 15. Autenticação

Manter Supabase como identidade principal.

O fluxo nativo deve suportar:

- sessão persistida de forma segura;
- refresh normal;
- OAuth via navegador do sistema quando necessário;
- callback por deep link/custom protocol;
- logout apagando credenciais locais e estado sensível sem apagar originais locais sem confirmação explícita.

Não embutir client secrets no binário.

## 16. Compatibilidade web

O app nativo não substitui imediatamente o PWA.

A camada de domínio deve permanecer compilável para web. Código Tauri deve ser carregado apenas quando `isNativePlatform()` for verdadeiro/dinâmico.

Objetivo:

```text
mesmo componente de biblioteca
        |
        +-- web provider    -> OPFS/cache/Drive
        +-- native provider -> filesystem/SQLite/sync
```

Isso mantém a versão pública/portfólio separada da otimização local do app.

## 17. Observabilidade

Registrar localmente, sem conteúdo sensível:

- tempo `click -> first visible frame`;
- hit/miss de arquivo local;
- duração de abertura por MIME/tamanho;
- erros de filesystem;
- backlog da fila;
- tentativas/retries de sync;
- tempo de geração de thumbnail;
- uso de disco por categoria.

Logs devem ser rotacionados e limitados. Telemetria remota deve seguir a política já existente do projeto e nunca enviar conteúdo do documento por conveniência.

## 18. Metas de performance

Metas iniciais, a validar em hardware real:

- documento local pequeno: primeira resposta visual percebida < 100 ms quando já há thumbnail/preview;
- navegação biblioteca -> detalhe não pode depender de rede;
- zero requests ao Drive para abrir documento confirmado como `present`;
- thumbnails não devem bloquear thread principal;
- importação deve liberar UI assim que cópia local + registro mínimo forem concluídos;
- memória deve permanecer limitada ao visualizar PDFs longos por virtualização/cancelamento;
- aplicação ociosa deve evitar polling agressivo.

Esses valores são budgets de engenharia, não garantias absolutas. Testes em Android real, Linux e Windows definirão os limites finais.

## 19. Dependências Tauri previstas

Avaliar/adotar somente conforme uso real:

- `@tauri-apps/plugin-fs`;
- `@tauri-apps/plugin-dialog`;
- `@tauri-apps/plugin-sql`;
- `@tauri-apps/plugin-store` para preferências simples;
- `@tauri-apps/plugin-stronghold` ou alternativa segura;
- `@tauri-apps/plugin-log`;
- `@tauri-apps/plugin-os`;
- `@tauri-apps/plugin-single-instance` no desktop;
- `@tauri-apps/plugin-deep-link` quando OAuth/deep links forem implementados;
- `@tauri-apps/plugin-updater` no desktop quando distribuição estiver pronta.

Evitar adicionar plugins por antecipação: cada plugin aumenta superfície de manutenção/permissões.

## 20. Decisões que não devem mudar sem ADR

1. Tauri 2 como shell multiplataforma inicial.
2. Uma base de frontend para web/native.
3. Filesystem local como fonte primária de leitura no app.
4. SQLite guarda metadados e fila, não blobs grandes.
5. Drive/Supabase nunca devem estar no caminho crítico de abertura de arquivo local.
6. Originais locais não são removidos automaticamente antes de sync confirmado.
7. Toda API nativa passa por uma camada de plataforma testável.
8. Operações de sync são persistentes e idempotentes.
9. Segurança Tauri segue menor privilégio.
10. Android, Linux e Windows são targets de primeira classe desde o início.

## 21. Referências oficiais

- Tauri 2 — https://v2.tauri.app/
- Prerequisites — https://v2.tauri.app/start/prerequisites/
- SvelteKit — https://v2.tauri.app/start/frontend/sveltekit/
- Plugins — https://v2.tauri.app/plugin/
- File System — https://v2.tauri.app/plugin/file-system/
- Updater — https://v2.tauri.app/plugin/updater/
- Distribution — https://v2.tauri.app/distribute/
