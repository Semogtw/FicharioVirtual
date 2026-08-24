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
- a migration 3 acrescenta título, caderno, status e contagem de páginas ao catálogo e mantém um snapshot owner-scoped de metadados por página, substituído atomicamente a cada inspeção;
- a migration 5 acrescenta texto OCR bruto/corrigido, fonte de extração, geometria por palavra, warnings e revisão manual, com validação de limites e JSON; migrations v1–v4 continuam atualizáveis sem perder documentos, páginas ou jobs;
- o detalhe local lê esse snapshot para reconstruir status, texto e análise de páginas após reinício; páginas sem texto permanecem `processing`/`needs_review`, sem serem tratadas como OCR concluído;
- a abertura de uma página local usa uma consulta nativa owner-scoped da página solicitada, sem reler o snapshot completo de análise a cada navegação; a lista completa continua reservada ao índice leve do documento;
- a busca textual usa o índice FTS5 local sobre o texto efetivo (corrigido, nativo ou OCR bruto) como fallback offline, com filtro de caderno, paginação e excerpt limitado; semântica continua dependente do próximo slice;
- páginas abertas pela fonte remota são hidratadas no catálogo nativo em best effort, preservando o remoto como fonte imediata e mantendo o fallback quando o cache falhar;
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
- `schema_migrations` registra os schemas 1–5: a migration 2 adiciona `payload_json`, a migration 3 adiciona metadados/páginas locais, a migration 4 cria/reconstrói o FTS5 nativo e a migration 5 adiciona a análise completa de página sem perder documentos, páginas ou jobs existentes;
- o payload durável preserva documento, proprietário, título, caderno, MIME, hash, tamanho e versão de OCR;
- o bridge TypeScript lista, reserva, conclui, cancela e reagenda jobs nativos com validação do contrato IPC;
- o bridge limita identificadores, erros persistidos e payloads de jobs antes de entregá-los ao worker;
- `runNativeSyncWorker` é iniciado no shell nativo ao abrir, voltar ao foco, ficar visível, recuperar a rede e a cada 60 segundos;
- o worker reconstrói o original local e reutiliza os fluxos existentes de publicação de PDF e imagem, confirma `remote_state`/`drive_file_id` e usa backoff determinístico em falhas transitórias;
- payload inválido ou operação desconhecida é cancelado com erro persistido, evitando retry infinito;
- duplicatas remotas conhecidas são reconciliadas no catálogo e concluem o job, evitando repetir upload indefinidamente após uma interrupção;
- a inicialização reconcilia todos os documentos marcados como presentes por tamanho/tipo de arquivo, marcando ausentes e corrompidos sem promover arquivos não catalogados;
- o comando `reconcile_native_documents` permite uma verificação opcional por SHA-256 para diagnóstico local;
- `list_native_documents_page` oferece paginação por cursor estável, sem limitar a biblioteca inteira a 1000 documentos; o comando legado continua disponível para compatibilidade;

### Sincronização Linux fora do shell

- o binário desktop aceita `--sync-once`: o runtime abre a sessão nativa em janela oculta, executa uma rodada limitada do worker e encerra com status controlado;
- `packaging/systemd/fichario-native-sync.service` e `.timer` fornecem um timer de usuário opcional para executar a sincronização cinco minutos após o boot e a cada 15 minutos;
- o runner é montado também na rota de login, para que uma sessão expirada não deixe um processo agendado oculto aberto indefinidamente;
- após instalar o `.deb`, o timer pode ser habilitado no usuário com `systemctl --user enable --now fichario-native-sync.timer`; o serviço precisa da sessão gráfica, do Secret Service e da rede disponíveis;

**Limitação atual:** fora do timer opcional Linux, o worker continua dependente do shell; ainda não há um scheduler nativo equivalente a WorkManager no Android nem execução garantida durante suspensão/encerramento forçado. O fluxo de publicação também precisa de validação em hardware e de cobertura operacional de rede/autenticação.

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
- no runtime Android, o mesmo contrato IPC usa `tauri-plugin-keyring-store` com Android Keystore + SharedPreferences, sob o namespace fixo `br.com.semog.fichario`, sem persistência em `localStorage`;
- chaves e valores são validados nos boundaries Rust e TypeScript, e o runtime web continua usando o armazenamento web existente;
- o retorno do OAuth nativo usa o `tauri-plugin-deep-link`: callbacks para `https://fichario-virtual.pages.dev/settings/?drive=...` são filtrados por origem, caminho e resultado antes de navegar para a tela de Drive;
- o início do OAuth, quando chamado pelo runtime Tauri, grava no `state` a origem HTTPS canônica em vez de `http://tauri.localhost`/`tauri://localhost`, permitindo que o Android encaminhe o callback pelo App Link;
- a implementação Android foi compilada em build mobile e instalada em hardware real neste ciclo; o ciclo autenticado Supabase e o exercício real do secure store ainda permanecem pendentes.

O plugin e o tratamento do callback estão versionados, mas a associação Android ainda depende de operação externa: o domínio canônico precisa servir `/.well-known/assetlinks.json` com o pacote `br.com.semog.fichario` e as fingerprints das chaves de distribuição. O APK de debug usado neste ciclo não fecha essa associação nem prova o login OAuth.

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

No head `50c1720`, o build de produção do frontend passou com `vite build`, a compilação Tauri Linux release passou com `cargo tauri build --no-bundle` usando o `beforeBuildCommand` desativado apenas para reutilizar o frontend já construído, e o smoke do binário permaneceu vivo por 10 segundos em diretórios XDG temporários (`124` pelo timeout esperado). O `.deb` do mesmo head foi gerado, inspecionado com `dpkg-deb`, extraído, teve o `.desktop` validado com `desktop-file-validate` e o ELF conferido; SHA-256: `5d7e6d7afa4f157fc5c7987b3c1858d5b7aa7363c974e4b4f3e7e3cff08a838`. Isso fecha o gate local Linux do head atual, sem equivaler a instalação global, outra distribuição ou hardware adicional.

No ciclo do timer Linux, o frontend passou por `svelte-check` sem erros/avisos, `vite build` e 343 arquivos Vitest (1470 testes); Rust passou por `cargo fmt --check`, `cargo test --lib` (16 aprovados, 1 ignorado por depender do keyring) e `cargo clippy --lib -- -D warnings`. O release `--sync-once` iniciou com XDG temporário e encerrou com status `0`; o `.deb` correspondente contém `/usr/bin/fichario-native`, teve o `.desktop` validado e tem SHA-256 `1803563d19ff00061094e3203f5b6bd2f2aa895691da0b9ede896a3a4083a731`. O timer também passou por `systemd-analyze verify`; a unidade de serviço foi validada por contrato sem instalação global do pacote.

No ciclo de metadata v5, o Rust passou por `cargo test --lib` com 16 testes aprovados e o contrato do bridge/documento passou por 24 testes unitários direcionados. A validação cobre round-trip de OCR bruto/corrigido, fonte de extração, geometria, warnings, revisão manual, reindexação FTS5 pelo texto corrigido e hidratação best-effort de páginas remotas para o catálogo local. A suíte frontend completa, `svelte-check`, build Linux e clippy ainda precisam ser repetidos para este head antes da publicação do checkpoint.

No head `a8d3505`, esses gates foram repetidos no Linux: 343 arquivos Vitest (1471 testes), `svelte-check` sem erros/avisos, `cargo fmt --check`, `cargo test --lib` (16 aprovados, 1 ignorado), `cargo clippy --lib -- -D warnings`, `vite build` com finalização CSP/PWA, Tauri release `--sync-once` com status `0` e `.deb` inspecionado. O pacote contém o ELF x86-64 e um `.desktop` válido; o SHA-256 do `.deb` local é `acbeb7a018a3d7ad05046f0d5f11d807347a5656629720efde16068b2af22e9d`.

No ciclo seguinte, o adapter Android de armazenamento seguro foi integrado com `tauri-plugin-keyring-store` e o fixture de upgrade v4→v5 foi adicionado. No Linux, Rust passou por `cargo check`, 17 testes aprovados e 1 ignorado, clippy sem warnings, e o binário release atualizado voltou a passar pelo `--sync-once`.

No head `8fe3d0b`, o projeto Android foi inicializado com o SDK/NDK local, o frontend foi empacotado, e `cargo tauri android build --apk` terminou verde para os quatro ABIs. O APK universal unsigned tem 68.822.684 bytes e SHA-256 `c86091a9b5ce390c5e175bc80816f4b276f5bcc500b5f6aa1abccb42cee62a51`. Para smoke físico, ele foi assinado somente com a debug keystore local, verificado pelas assinaturas v2/v3, instalado via `adb` no Samsung SM-A715F (Android 13) e aberto com `MainActivity` em primeiro plano; a tela de login carregou sem crash. Esse teste prova empacotamento, instalação e inicialização, mas não prova publicação, assinatura de release, login Supabase, OAuth/deep link ou o ciclo `set/get/remove` do secure store em produção.

No checkpoint seguinte, o retorno OAuth nativo passou a registrar o plugin oficial de deep link, validar URLs recebidas e encaminhar a sessão ao caminho HTTPS canônico. O build Android posterior terminou verde para os quatro ABIs; o APK universal unsigned tem 69.676.604 bytes e SHA-256 `934f2b4bce322188b3d17e89ecc4eddc855a2403334cfdb5e9121ab7d86761cc`. Ele foi assinado somente com debug keystore, instalado no SM-A715F e recebeu um App Link explícito via `adb` sem crash; a validação automatizada cobre origem, caminho, query única e resultados permitidos. A associação física do domínio, OAuth autenticado e assinatura de distribuição continuam pendentes até a configuração das chaves reais.

## Trabalho importante restante

Prioridade alta antes de considerar o app pronto:

1. adicionar scheduler nativo equivalente a WorkManager no Android e retomar sincronização de desktop após suspensão/encerramento sem depender da ativação manual do timer Linux;
2. manter migrations versionadas para futuras mudanças de catálogo; o caminho v1→v5 já está coberto por fixtures de upgrade;
3. ampliar a validação de acervos muito grandes; os consumidores atuais já usam `list_native_documents_page`, o cursor está coberto por fixture de paginação e a abertura de página usa consulta individual owner-scoped, mas ainda falta benchmark em catálogo volumoso;
4. integrar a apresentação de destaques/edição offline ao snapshot de análise já persistido; o catálogo agora cobre título, caderno, status, contagem, texto nativo, OCR bruto/corrigido, fonte, geometria, warnings, revisão manual e busca FTS5, sem inventar OCR remoto;
5. validar instalação/execução do bundle Linux em uma máquina desktop real além do runner;
6. repetir o smoke com artefato Android assinado para distribuição e completar os cenários do checklist físico;
7. publicar/verificar `assetlinks.json`, exercitar OAuth/deep link em hardware com artefato de distribuição, validar o ciclo operacional do adapter de armazenamento seguro Android e o login/refresh Supabase completo; o adapter Linux já está implementado e teve o ciclo operacional `keyring` validado em sessão desktop;
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
