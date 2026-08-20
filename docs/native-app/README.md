# Fichário — aplicativo nativo

Esta pasta é a fonte de verdade para o trabalho da branch `feat/native-app-android-linux-windows` enquanto o app nativo ainda estiver em desenvolvimento.

## Escopo

Criar uma única aplicação baseada no frontend atual para:

- Android;
- Linux;
- Windows;

mantendo a versão web/PWA existente.

A arquitetura é **local-first**: documentos presentes no dispositivo abrem do armazenamento local; Google Drive/Supabase ficam fora do caminho crítico de visualização e atuam como sincronização, metadados e recuperação conforme o serviço.

## Decisão principal

Shell: **Tauri 2**.

Motivos:

- reutiliza SvelteKit/Svelte atual;
- suporta desktop e Android;
- usa WebView do sistema em vez de empacotar Chromium completo;
- permite filesystem, SQLite e integrações nativas com uma superfície Rust pequena;
- favorece um aplicativo leve sem criar três frontends independentes.

## Documentos

### [ARCHITECTURE.md](./ARCHITECTURE.md)

Arquitetura alvo e invariantes do aplicativo:

- local-first;
- filesystem;
- SQLite;
- sync;
- cache;
- segurança;
- auth;
- diferenças Android/Linux/Windows;
- compatibilidade web;
- metas de performance.

### [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md)

Ordem incremental de implementação e trabalho restante.

### [BUILD_RELEASE_TESTING.md](./BUILD_RELEASE_TESTING.md)

Requisitos para produção, toolchains, artefatos, signing, CI/CD, testes, benchmarks, budgets e checklist de release.

## Estado implementado

A branch já deixou de ser apenas planejamento. O núcleo abaixo existe em código:

### Shell e compatibilidade web

- Tauri 2 em `src-tauri/`;
- um único frontend SvelteKit continua servindo web/PWA e app;
- bridge nativa usa o `invoke` global injetado pelo Tauri, sem adicionar runtime Tauri ao bundle JavaScript web;
- capabilities mínimas: o frontend não recebe acesso genérico ao filesystem; operações passam por comandos próprios validados;
- configs específicas para Android, Linux e Windows;
- Linux alvo: `.deb` + AppImage;
- Windows alvo: NSIS;
- Android alvo mínimo: API 24;
- ícones nativos derivados da identidade visual existente.

### Storage local

- diretório privado `native-v1` dentro dos dados do aplicativo;
- catálogo SQLite local com WAL e foreign keys;
- staging para importações interrompíveis;
- cópia em chunks IPC limitados a 512 KiB;
- original permanente endereçado por SHA-256;
- limite atual de 2 GiB por documento;
- validação estrita de `document_id` e caminhos relativos;
- verificação rápida por tamanho e verificação completa opcional por SHA-256;
- estados `present`, `missing` e `corrupt`;
- metadados locais/Drive vinculados por `document_id` e `drive_file_id`.

### Abertura local-first

- `driveFileId` é resolvido primeiro no catálogo local;
- arquivo completo local evita `drive-media`;
- leitura por faixa local evita `drive-media`;
- PDF.js recebe faixas do arquivo nativo por `PDFDataRangeTransport`, sem exigir carregar PDFs grandes inteiros na memória;
- testes unitários provam que o fast path local não chama a função remota;
- se o original não existe localmente, o fluxo web/Drive continua funcionando como fallback;
- downloads remotos completos compatíveis aquecem o cache nativo em best effort.

### Importação

- PDF novo é salvo localmente antes da etapa de upload remoto, depois de autenticação/hash/duplicate check;
- imagem nova segue o mesmo princípio;
- após publicação remota, `drive_file_id` e estado remoto são reconciliados no catálogo local;
- falha do cache nativo nunca bloqueia a versão web quando o runtime nativo não existe;
- staging abandonado é limpo no próximo boot.

### Fila e recuperação

- `sync_jobs` persistente em SQLite;
- estados `pending`, `running`, `retry`, `completed` e `cancelled`;
- lease para recuperar jobs abandonados após crash;
- contador de tentativas, próximo retry e último erro;
- importações locais pendentes criam job de upload;
- confirmação remota conclui o job ativo correspondente.

**Limitação atual:** a fila persistente existe, mas ainda não contém todo o payload necessário para reconstruir e publicar automaticamente uma importação complexa após um início totalmente offline. Portanto ela não deve ser descrita como um worker de sync offline completo ainda.

### Gestão de espaço

- cálculo de uso local;
- eviction manual somente quando `remote_state = synced`;
- trim LRU seguro;
- arquivos sem backup remoto confirmado são protegidos da limpeza;
- tela `Configurações → Armazenamento` no runtime nativo mostra uso, quantidade local, sync pendente e plataforma, além de permitir aplicar um alvo de cache.

## Validação

Existe workflow dedicado `.github/workflows/validate-native-app.yml` com:

- testes unitários do bridge/storage;
- prova de fast path sem rede;
- `pnpm verify` completo;
- `cargo fmt --check`;
- `cargo check --locked` em Linux e Windows;
- smoke build Android aarch64 com geração de APK de debug;
- preservação temporária do `Cargo.lock` gerado e do APK como artifacts.

Já houve ciclo com frontend completo verde e compilação Rust/Linux do núcleo verde. O gate multiplataforma continua sendo tratado como fonte de verdade: uma plataforma só passa para **validada em CI** quando o workflow do head correspondente termina verde.

Ainda não há alegação de validação em hardware Android/Windows/Linux real nesta branch.

## Trabalho importante restante

Prioridade alta antes de considerar o app pronto:

1. completar payload + worker da fila para importação realmente offline desde o primeiro clique;
2. migration/versionamento robusto do schema SQLite para upgrades futuros;
3. eliminar limites de consulta que possam prejudicar bibliotecas muito grandes;
4. validar bundle instalável real Linux/Windows além de `cargo check`;
5. instalar e executar APK em dispositivo Android real;
6. tratar OAuth/deep link especificamente no shell nativo;
7. definir CSP nativa em vez de `csp: null` antes de release;
8. signing de Android e Windows, política de update e checksums;
9. validar suspensão/reabertura, falta de espaço, crash durante cópia e perda de rede;
10. medir abertura local em hardware real e registrar p50/p95.

## Invariantes que não podem regredir

- documento local não depende de Drive para abrir;
- original não sincronizado não pode ser removido automaticamente;
- caminhos fornecidos pelo frontend não podem escapar da raiz privada;
- cache é otimização; catálogo e original pendente são dados duráveis;
- PWA deve continuar funcional sem `__TAURI__`;
- uma falha nativa de cache não pode destruir o fallback remoto;
- jobs precisam sobreviver a encerramento/crash sem duplicar trabalho ativo.

## Regra de documentação

À medida que código for implementado, manter explícita a diferença entre:

- planejado;
- implementado;
- validado em CI;
- validado em hardware real;
- bloqueado externamente.

Não marcar uma fase como concluída apenas porque existe código sem fluxo real validado.
