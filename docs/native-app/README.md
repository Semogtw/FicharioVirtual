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

Fonte de verdade da arquitetura planejada:

- local-first;
- filesystem;
- SQLite;
- sync;
- cache;
- segurança;
- auth;
- diferenças Android/Linux/Windows;
- compatibilidade web;
- metas de performance;
- plugins Tauri previstos.

### [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md)

Ordem incremental de implementação:

- inventário e abstrações;
- bootstrap Tauri;
- catálogo SQLite;
- filesystem;
- fast path local;
- sync;
- auth;
- hardening por plataforma;
- migração dos documentos existentes;
- gestão de espaço;
- release/updater.

### [BUILD_RELEASE_TESTING.md](./BUILD_RELEASE_TESTING.md)

Requisitos para produção:

- toolchains;
- artefatos;
- signing;
- CI/CD;
- testes unitários, integração e E2E;
- testes reais por plataforma;
- testes de interrupção;
- benchmarks;
- budgets de peso/memória;
- migrations;
- checklist de release.

## Estado atual

Neste checkpoint a branch contém **planejamento técnico**, não uma alegação de que Tauri ou o storage nativo já estejam implementados.

Base utilizada: `main` de 2026-08-19. A antiga `feat/local-first-media-cache` já está atrás da `main`, portanto esta branch parte da linha mais recente e deve reaproveitar as otimizações web que já chegaram ao produto.

## Próximo passo de implementação

Começar pela Fase 0/1 do roadmap:

1. inventariar boundaries web atuais;
2. criar `PlatformServices` sem mudar comportamento;
3. inicializar Tauri 2;
4. obter smoke build Linux + Windows + Android;
5. somente depois trocar o caminho de leitura por filesystem local.

Essa ordem reduz risco de uma reescrita grande e mantém o PWA funcional durante toda a migração.

## Regra de documentação

À medida que código for implementado, atualizar estes documentos para distinguir explicitamente:

- planejado;
- implementado;
- validado em CI;
- validado em hardware real;
- bloqueado externamente.

Não marcar uma fase como concluída apenas porque existe código sem fluxo real validado.
