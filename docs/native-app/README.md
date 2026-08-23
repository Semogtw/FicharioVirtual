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
- desktop Linux/Windows com single-instance e persistência de tamanho/posição da janela em arquivo de configuração não sensível;
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
- o `DocumentMediaViewer` consulta o catálogo nativo antes de buscar resumos/metadados remotos; PDFs presentes usam `NativePdfDataRangeTransport` e imagens presentes usam o original local antes do fallback Drive/Supabase;
- falhas transitórias do catálogo nativo são tratadas como cache miss, preservando o fallback remoto quando ele existir;
- quando a consulta remota da biblioteca falha no runtime nativo, a lista local filtra pelo proprietário da sessão e pagina os documentos do catálogo; a rota de detalhe reconstrói um índice de páginas local e descobre a contagem real de PDFs por faixas;
- a migration 3 acrescenta título, caderno, status e contagem de páginas ao catálogo e mantém um snapshot owner-scoped de texto nativo por página, substituído atomicamente a cada inspeção;
- o detalhe local lê esse snapshot para reconstruir status/texto nativo de páginas após reinício; páginas sem texto permanecem `processing`/`needs_review`, sem serem tratadas como OCR concluído;
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
- `schema_migrations` registra os schemas 1–3: a migration 2 adiciona `payload_json`, e a migration 3 adiciona metadados/páginas locais sem perder documentos ou jobs existentes;
- o payload durável preserva documento, proprietário, título, caderno, MIME, hash, tamanho e versão de OCR;
- o bridge TypeScript lista, reserva, conclui, cancela e reagenda jobs nativos com validação do contrato IPC;
- o bridge limita identificadores, erros persistidos e payloads de jobs antes de entregá-los ao worker;
- `runNativeSyncWorker` é iniciado no shell nativo ao abrir, voltar ao foco, ficar visível e a cada 60 segundos;
- o worker reconstrói o original local e reutiliza os fluxos existentes de publicação de PDF e imagem, confirma `remote_state`/`drive_file_id` e usa backoff determinístico em falhas transitórias;
- payload inválido ou operação desconhecida é cancelado com erro persistido, evitando retry infinito;
- duplicatas remotas conhecidas são reconciliadas no catálogo e concluem o job, evitando repetir upload indefinidamente após uma interrupção;
- a inicialização reconcilia todos os documentos marcados como presentes por tamanho/tipo de arquivo, marcando ausentes e corrompidos sem promover arquivos não catalogados;
- o comando `reconcile_native_documents` permite uma verificação opcional por SHA-256 para diagnóstico local;
- `list_native_documents_page` oferece paginação por cursor estável, sem limitar a biblioteca inteira a 1000 documentos; o comando legado continua disponível para compatibilidade;

**Limitação atual:** o worker é executado enquanto o shell está vivo; ainda não há um scheduler nativo equivalente a WorkManager no Android nem execução garantida depois de suspensão/encerramento forçado. O fluxo de publicação também precisa de validação em hardware e de cobertura operacional de rede/autenticação.

### Gestão de espaço

- cálculo de uso local;
- eviction manual somente quando `remote_state = synced`;
- trim LRU seguro;
- arquivos sem backup remoto confirmado são protegidos da limpeza;
- tela `Configurações → Armazenamento` no runtime nativo mostra uso, quantidade local, sync pendente e plataforma, além de permitir aplicar um alvo de cache.
- a mesma tela oferece reconciliação manual do catálogo: a verificação rápida confere presença/tamanho/tipo e a opção explícita de SHA-256 valida o conteúdo completo; o resumo distingue arquivos ausentes, corrompidos e inalterados.
- a tela também lista pendências da fila nativa, último erro e tentativas, com ação manual para executar o worker novamente depois que a conexão for recuperada.

### Autenticação nativa

- no runtime Linux, a sessão Supabase usa o armazenamento seguro do sistema via Secret Service/libsecret, sem fallback para `localStorage`;
- o adapter Tauri também está preparado para Credential Manager no Windows, embora esse target permaneça secundário nesta fase;
- chaves e valores são validados nos boundaries Rust e TypeScript, e o runtime web continua usando o armazenamento web existente;
- Android ainda precisa do adapter de armazenamento seguro da plataforma; por isso a sessão nativa Android permanece explicitamente bloqueada até essa implementação e sua validação autorizada.

## Validação

Existe workflow dedicado `.github/workflows/validate-native-app.yml` com:

- testes unitários do bridge/storage;
- prova de fast path sem rede;
- `pnpm verify` completo;
- `cargo fmt --check`;
- `cargo clippy --locked --all-targets -- -D warnings`;
- `cargo check --locked` em Linux e Windows;
- smoke build Android aarch64 com geração de APK de debug, disponível somente em execução manual autorizada;
- instalação do `.deb`, validação do `.desktop` e extração do AppImage em runner Linux;
- preservação temporária do `Cargo.lock` gerado e do APK como artifacts.

Já houve ciclo com frontend completo verde e compilação Rust/Linux do núcleo verde. O gate multiplataforma continua sendo tratado como fonte de verdade: uma plataforma só passa para **validada em CI** quando o workflow do head correspondente termina verde.

No head `bac7ce2`, a validação nativa passou para frontend, Rust Ubuntu/Windows e Android aarch64; os bundles Linux e Windows também foram publicados como artifacts pelos workflows. Essa é uma evidência histórica do gate multiplataforma, não uma validação de hardware.

No head validado `ce00482`, o job Linux do workflow de bundles (`32628886922`, job `97168460730`) terminou verde: compilou o Tauri, validou o `.desktop` com `desktop-file-validate`, instalou o `.deb` por caminho absoluto com `apt-get`/`dpkg-query` e extraiu o AppImage. O caminho crítico deste ciclo permanece Linux; Windows fica secundário e a validação mobile em dispositivo foi adiada.

No head `4fc53b9`, o job Linux do workflow de bundles (`32631426195`, job `97174757191`) também terminou verde em 12m30s, incluindo geração e verificação de `SHA256SUMS`. O artifact Linux baixado desse run confirmou localmente os dois hashes, a validade do `.desktop`, os formatos `.deb`/AppImage e um smoke de inicialização do AppImage extraído por 10 segundos sob diretórios XDG temporários (encerrado pelo timeout esperado). Os commits posteriores de endurecimento da fila e da tela de sincronização ainda precisam repetir esse gate.

O artifact Linux do head `ce00482` também foi inspecionado localmente sem instalação: o pacote `fichario-virtual` `0.1.0` `amd64`, o `.desktop` e o ELF foram validados, e o binário permaneceu executando por 10 segundos em diretórios XDG temporários antes de ser encerrado pelo timeout (`124`). Isso é smoke de inicialização Linux, não validação de sessão em hardware adicional.

No head `7e8113b`, a validação local Linux foi repetida após a integração do secure store: `.deb` e AppImage foram gerados, o metadata do pacote e o `.desktop` foram validados, os dois artefatos passaram por `sha256sum --check`, o binário extraído do `.deb` e o AppImage iniciaram por 10 segundos em diretórios XDG temporários (`124` por timeout esperado). O `.deb` local tem SHA-256 `3ed649bb7516c899d5d466ef14f83355869fa6d78d8b5ac25bae56c3e45c9813` e o AppImage `2728a9c174365ad845ba7fa7db708ffbd8a3b210208341640c5776fe0a9a1719`. A versão cacheada do `linuxdeploy` falhou no CachyOS ao usar o `strip` antigo contra ELF com `.relr.dyn`; o AppImage foi então finalizado com o mesmo bundle e o `strip` do sistema, mantendo o bloqueio visível para o gate CI reproduzível.

Também foi executado um smoke operacional Linux fora da suíte obrigatória: o Secret Service/libsecret respondeu ao ciclo `set/get/remove` via `secret-tool`, e o teste opt-in `secure_storage::tests::linux_keyring_round_trip_when_desktop_keyring_is_available`, compilado com `keyring 3.6.3` e as mesmas features/serviço do adapter Rust, confirmou `set/get/remove` sem deixar a chave temporária. Ele pode ser repetido com `CARGO_BUILD_JOBS=1 cargo test --locked --manifest-path src-tauri/Cargo.toml --lib -- --ignored --exact secure_storage::tests::linux_keyring_round_trip_when_desktop_keyring_is_available`. Isso valida a sessão local do keyring; ainda não substitui uma execução autenticada do fluxo completo Supabase dentro do aplicativo.

Na mesma sessão Linux/Wayland sob Hyprland, o binário release foi iniciado com diretórios XDG temporários: uma segunda cópia encerrou com status `0` mantendo a primeira ativa, e o fechamento controlado da janela gerou um `.window-state.json` válido com tamanho/posição/maximização. Isso é validação operacional do desktop Linux atual; X11, outra distribuição e instalação global do `.deb` continuam fora desta evidência.

No head `8edd2bf`, os artefatos foram regenerados depois do endurecimento do ciclo desktop: `.deb` SHA-256 `d9cd8f28da9dff86a2dcbcd4d83485bd430edf9714702fc1718f2cf75ae805cf` e AppImage SHA-256 `0aebafc5f5679c47b937aa258f64cfe86c08716b46c915cbe0c0b78e2547932c`. `sha256sum --check`, `desktop-file-validate`, a extração do `.deb` e o smoke de inicialização dos dois artefatos passaram; cada processo permaneceu vivo por 10 segundos e terminou com status `124` pelo timeout esperado. A criação padrão do AppImage ainda falha no `linuxdeploy` cacheado deste CachyOS; o arquivo foi finalizado com o linuxdeploy extraído e o `strip` do sistema, mantendo esse bloqueio de reprodutibilidade explícito.

Não há alegação de validação em Android/Windows nem de sessão Supabase autenticada nesta branch. Após a decisão de focar Linux, não foi usado `adb` nem houve instalação/execução de APK em dispositivo.

## Trabalho importante restante

Prioridade alta antes de considerar o app pronto:

1. adicionar scheduler nativo para retomada após suspensão/encerramento no Android e desktop;
2. ampliar migrations versionadas para futuras mudanças de catálogo e testar upgrades de várias versões;
3. migrar eventuais consumidores legados para `list_native_documents_page` e validar acervos grandes com fixtures de paginação;
4. completar o armazenamento de OCR, geometria, warnings e índice FTS local para busca/destaques offline após reinício/sem sessão remota; o snapshot atual cobre título, caderno, status, contagem e texto nativo, sem inventar OCR remoto;
5. validar instalação/execução do bundle Linux em uma máquina desktop real além do runner;
6. instalar e executar APK em dispositivo Android real;
7. concluir OAuth/deep link e o adapter de armazenamento seguro Android; o adapter Linux já está implementado e teve o ciclo operacional `keyring` validado em sessão desktop, mas o login/refresh Supabase completo ainda precisa de execução autenticada;
8. signing de Android e Windows, política de update e checksums;
9. validar falta de espaço, crash durante cópia, perda de rede e expiração de autenticação;
10. medir abertura local em hardware real e registrar p50/p95;
11. validar atualizações/rollback com artefatos assinados.

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
