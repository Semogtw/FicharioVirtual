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
- `schema_migrations` registra o schema 1 e a migration 2, que adiciona `payload_json` sem perder documentos ou jobs existentes;
- o payload durável preserva documento, proprietário, título, caderno, MIME, hash, tamanho e versão de OCR;
- o bridge TypeScript lista, reserva, conclui, cancela e reagenda jobs nativos com validação do contrato IPC;
- `runNativeSyncWorker` é iniciado no shell nativo ao abrir, voltar ao foco, ficar visível e a cada 60 segundos;
- o worker reconstrói o original local e reutiliza os fluxos existentes de publicação de PDF e imagem, confirma `remote_state`/`drive_file_id` e usa backoff determinístico em falhas transitórias;
- payload inválido ou operação desconhecida é cancelado com erro persistido, evitando retry infinito;

**Limitação atual:** o worker é executado enquanto o shell está vivo; ainda não há um scheduler nativo equivalente a WorkManager no Android nem execução garantida depois de suspensão/encerramento forçado. O fluxo de publicação também precisa de validação em hardware e de cobertura operacional de rede/autenticação.

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
- instalação do `.deb`, validação do `.desktop` e extração do AppImage em runner Linux;
- preservação temporária do `Cargo.lock` gerado e do APK como artifacts.

Já houve ciclo com frontend completo verde e compilação Rust/Linux do núcleo verde. O gate multiplataforma continua sendo tratado como fonte de verdade: uma plataforma só passa para **validada em CI** quando o workflow do head correspondente termina verde.

No head `bac7ce2`, a validação nativa passou para frontend, Rust Ubuntu/Windows e Android aarch64; os bundles Linux e Windows também foram publicados como artifacts pelos workflows. Essa é uma evidência histórica do gate multiplataforma, não uma validação de hardware.

No head validado `ce00482`, o job Linux do workflow de bundles (`32628886922`, job `97168460730`) terminou verde: compilou o Tauri, validou o `.desktop` com `desktop-file-validate`, instalou o `.deb` por caminho absoluto com `apt-get`/`dpkg-query` e extraiu o AppImage. O caminho crítico deste ciclo permanece Linux; Windows fica secundário e a validação mobile em dispositivo foi adiada.

O artifact Linux desse head também foi inspecionado localmente sem instalação: o pacote `fichario-virtual` `0.1.0` `amd64`, o `.desktop` e o ELF foram validados, e o binário permaneceu executando por 10 segundos em diretórios XDG temporários antes de ser encerrado pelo timeout (`124`). Isso é smoke de inicialização Linux, não validação de sessão em hardware adicional.

Não há alegação de validação em hardware Android/Windows/Linux real nesta branch. Após a decisão de focar Linux, não foi usado `adb` nem houve instalação/execução de APK em dispositivo.

## Trabalho importante restante

Prioridade alta antes de considerar o app pronto:

1. adicionar scheduler nativo para retomada após suspensão/encerramento no Android e desktop;
2. ampliar migrations versionadas para futuras mudanças de catálogo e testar upgrades de várias versões;
3. eliminar limites de consulta que possam prejudicar bibliotecas muito grandes;
4. validar instalação/execução do bundle Linux em uma máquina desktop real além do runner;
5. instalar e executar APK em dispositivo Android real;
6. tratar OAuth/deep link e armazenamento seguro de credenciais especificamente no shell nativo;
7. signing de Android e Windows, política de update e checksums;
8. validar falta de espaço, crash durante cópia, perda de rede e expiração de autenticação;
9. medir abertura local em hardware real e registrar p50/p95;
10. validar atualizações/rollback com artefatos assinados.

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
