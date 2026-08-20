# Roadmap de implementação do app nativo

> Documento operacional para transformar o Fichário em app Android, Linux e Windows sem quebrar o PWA.

## 1. Estratégia de entrega

A migração deve ser incremental. O app nativo não nasce como uma segunda aplicação: ele reaproveita a UI e o domínio atuais e substitui gradualmente dependências web por providers locais.

Cada fase precisa terminar com código utilizável e testável. Features web existentes não devem ser removidas até que o equivalente nativo esteja comprovado.

## 2. Critério de pronto global

O app será considerado funcionalmente completo quando, nos três targets:

- instalar e iniciar sem configuração manual de desenvolvimento;
- autenticar o usuário;
- importar foto/PDF;
- registrar imediatamente o documento na biblioteca local;
- abrir um documento local sem request ao Drive;
- fechar e reabrir o app preservando biblioteca e fila;
- sincronizar arquivo e metadados com backend/Drive;
- baixar documento ausente sob demanda em dispositivo novo;
- funcionar offline para documentos locais;
- manter busca sintática/semântica conforme disponibilidade dos serviços;
- exibir documento real e marcações de busca;
- sobreviver a interrupção durante upload/download;
- atualizar o app desktop de forma assinada quando updater for habilitado;
- produzir APK/AAB, AppImage/deb e instalador Windows em release reproduzível.

## 3. Fase 0 — inventário e contratos

### Objetivo

Mapear toda dependência atual de APIs do navegador e de URLs remotas antes de adicionar Tauri.

### Tarefas

- localizar usos de `window`, `document`, service worker, Cache API, IndexedDB e OPFS;
- localizar todos os caminhos que geram URLs do Drive/Supabase para abrir documentos;
- mapear importação atual, fila, OCR, embedding e busca;
- separar leitura do documento de leitura de metadados;
- identificar auth que depende de redirect web;
- definir `PlatformServices` e interfaces de storage/sync;
- criar testes de contrato para providers.

### Saída

- mapa de dependências web;
- providers web existentes encapsulados;
- nenhuma mudança de comportamento para usuário web.

## 4. Fase 1 — bootstrap Tauri

### Objetivo

Executar a aplicação atual dentro de Tauri em desktop e Android sem ainda alterar storage.

### Tarefas

- adicionar Tauri 2 e CLI compatíveis;
- inicializar `src-tauri/`;
- configurar `frontendDist` para `build/`;
- confirmar SPA/static adapter e fallback;
- adicionar detecção de plataforma;
- configurar capability mínima, sem permissões abertas;
- adicionar ícones e identificador de pacote estável;
- fazer dev/build em Linux;
- fazer dev/build em Windows;
- inicializar target Android e executar em device/emulador.

### Gate

A UI atual precisa abrir e navegar nos três targets antes de iniciar a migração de dados.

## 5. Fase 2 — catálogo local SQLite

### Objetivo

Introduzir banco local sem mudar a origem dos arquivos.

### Tarefas

- adicionar plugin SQL/SQLite;
- criar migration `0001`;
- implementar `LocalCatalogRepository`;
- registrar documentos conhecidos localmente;
- persistir estado de sync;
- migrations transacionais e testadas;
- mecanismo de recovery para migration interrompida;
- backup lógico do schema antes de migrations destrutivas futuras.

### Gate

Reiniciar o app não pode perder catálogo, fila ou estado de documento.

## 6. Fase 3 — filesystem local

### Objetivo

Fazer importações novas serem locais primeiro.

### Tarefas

- implementar `NativeLocalDocumentStore`;
- file picker por dialog nativo;
- Android via URI/document picker;
- cópia em streaming para staging;
- validação de MIME/tamanho;
- SHA-256 durante importação;
- rename atômico para destino;
- geração de thumbnail desacoplada;
- cleanup de staging na inicialização;
- teste com fotos, PDFs pequenos e PDFs grandes.

### Gate

Após importar e colocar o dispositivo offline, o documento precisa abrir normalmente.

## 7. Fase 4 — fast path de abertura

### Objetivo

Remover completamente rede do caminho crítico para documentos presentes localmente.

### Implementação

Criar resolvedor único:

```text
resolveDocument(documentId)
  -> local present? return local handle
  -> download already running? await/stream current operation
  -> online? enqueue priority download and resolve local
  -> offline? LocalDocumentUnavailable
```

### Tarefas

- substituir loaders que pedem URL remota diretamente;
- protocolo/handler local seguro se necessário;
- integração com viewer de imagem;
- integração com PDF.js;
- prefetch de páginas vizinhas;
- cancelamento de renders antigos;
- métricas de click-to-visible;
- teste que falha se abrir documento local causar request ao Drive.

### Gate

Teste automatizado comprova zero chamadas de rede para abertura de documento `present`.

## 8. Fase 5 — sync persistente

### Objetivo

Transformar Drive/backend em sincronização assíncrona confiável.

### Tarefas

- worker de sync;
- leases no SQLite;
- backoff + jitter;
- retry classification;
- concorrência limitada;
- prioridade para download solicitado pelo usuário;
- upload de novos originais;
- sync de metadados;
- tombstones para exclusão;
- detecção de revisão/conflito;
- retomada após kill/crash;
- botão/status simples de sync, sem expor detalhes internos demais ao usuário.

### Cenários obrigatórios

- internet cai no meio do upload;
- app fecha no meio do download;
- arquivo remoto já existe;
- dispositivo novo possui metadado mas não original;
- arquivo local está corrompido;
- usuário apaga documento durante upload;
- sync recebe 429/5xx;
- Drive/Auth expira.

## 9. Fase 6 — auth nativa

### Objetivo

Remover dependências frágeis de redirect dentro do webview.

### Tarefas

- browser externo para OAuth quando aplicável;
- deep link de callback;
- sessão Supabase persistida em secure store;
- refresh token seguro;
- logout confiável;
- reautenticação do Drive sem apagar biblioteca local;
- garantir que ausência de Drive não impeça acesso aos arquivos locais.

## 10. Fase 7 — Android production-ready

### Tarefas

- revisar scoped storage;
- document picker real em Android físico;
- compartilhar/importar para Fichário via intent, se útil;
- testar câmera/galeria sem pedir permissões amplas desnecessárias;
- comportamento com app em background;
- avaliar WorkManager somente para jobs que realmente precisem sobreviver ao processo;
- notificações discretas apenas para operações relevantes;
- testar low-storage;
- testar battery saver;
- release signing;
- AAB Play Store;
- APK assinado para sideload/testes.

### Dispositivos mínimos de teste

- Android moderno principal;
- pelo menos um aparelho/AVD com memória reduzida;
- arm64 como target obrigatório;
- x86_64 apenas para emulador quando necessário.

## 11. Fase 8 — Linux production-ready

### Tarefas

- AppImage;
- `.deb`;
- testar Wayland e X11 quando possível;
- testar WebKitGTK em distro suportada;
- associação de arquivos opcional;
- single instance;
- persistência de estado de janela;
- integração controlada com desktop OCR worker existente;
- garantir que ausência do worker OCR não impeça abertura/importação.

### Distros de referência

- CachyOS/Arch para uso real principal;
- Ubuntu/Debian para pacote `.deb` e compatibilidade ampla.

## 12. Fase 9 — Windows production-ready

### Tarefas

- validar WebView2;
- instalador NSIS;
- MSI opcional;
- single instance;
- caminhos longos/unicode;
- file picker;
- deep links;
- assinatura de código quando release público exigir;
- updater desktop;
- testar Windows 11 e, se mantido como requisito, Windows 10 compatível.

## 13. Fase 10 — migração dos usuários web/PWA

### Problema

Documentos existentes podem estar apenas no Drive. O primeiro app nativo não deve tentar baixar toda a biblioteca sem necessidade.

### Estratégia

1. após login, sincronizar somente metadados;
2. marcar originais como `missing` localmente;
3. baixar sob demanda quando usuário abrir;
4. manter local depois do primeiro acesso;
5. oferecer opcionalmente "manter toda a biblioteca neste dispositivo";
6. mostrar progresso agregado simples;
7. permitir pausar downloads em massa.

### Benefício

Primeira inicialização continua rápida mesmo com biblioteca grande.

## 14. Fase 11 — gestão de espaço

### Primeira versão

- originais locais são permanentes;
- cache derivado possui limite;
- usuário vê uso total;
- cleanup automático afeta somente cache reconstruível.

### Versão posterior

Adicionar modo opcional de economia de espaço:

- remover original apenas se `remote_state = synced` e hash/revisão confirmados;
- mudar para `local_state = missing`;
- rebaixar sob demanda;
- permitir pin/manual keep-local.

## 15. Fase 12 — updater e release channel

### Desktop

- `stable` e opcionalmente `beta`;
- manifest de atualização assinado;
- updater nunca deve instalar artefato sem assinatura válida;
- rollback operacional por release anterior, não migration destrutiva irreversível.

### Android

- Play Store como atualização principal;
- APK de teste separado por canal/assinatura para não conflitar com produção.

## 16. Organização de código alvo

```text
src/lib/platform/
  index.ts
  types.ts
  detect.ts
  web/
    document-store.ts
    credentials.ts
    sync.ts
  native/
    document-store.ts
    credentials.ts
    sync.ts

src/lib/data/local/
  catalog.ts
  migrations.ts
  sync-queue.ts

src/lib/documents/
  resolver.ts
  import.ts
  previews.ts

src-tauri/
  Cargo.toml
  tauri.conf.json
  capabilities/
  src/
    lib.rs
    commands/
      files.rs
      hash.rs
      storage.rs
      sync.rs
```

Rust deve ser usado onde traz valor: boundaries com SO, streaming/hash eficiente, segurança e operações que não devem expor caminho arbitrário ao JS. Regras de negócio continuam em TypeScript quando compartilháveis.

## 17. Ordem de prioridade de implementação

### P0 — necessário para existir

- Tauri bootstrap;
- filesystem local;
- SQLite;
- import local-first;
- fast open local;
- sync básico;
- auth;
- builds dos três targets.

### P1 — necessário para qualidade de produção

- recovery completo;
- deep links;
- secure credentials;
- updater desktop;
- signing;
- budgets de performance;
- testes reais de interrupção;
- low-storage handling.

### P2 — refinamentos

- share target Android;
- associações de arquivo;
- download da biblioteca inteira;
- pin/eviction de originais;
- notificações avançadas;
- Store/Play packaging adicional.

## 18. Riscos e mitigação

### Diferenças de WebView

**Risco:** comportamento CSS/JS diferente entre WebView2 e WebKit.

**Mitigação:** smoke/E2E por plataforma e evitar APIs browser não suportadas sem provider.

### Android background

**Risco:** processo morto durante sync.

**Mitigação:** fila persistente e jobs idempotentes; WorkManager apenas onde necessário.

### Corrupção local

**Risco:** queda durante escrita.

**Mitigação:** staging + rename atômico + hashes + migrations transacionais.

### Duplicação local/Drive

**Risco:** uso de disco maior.

**Mitigação:** inicialmente priorizar segurança/velocidade; depois oferecer eviction somente após sync confirmado.

### Autenticação OAuth

**Risco:** callbacks de web não funcionarem bem em webview.

**Mitigação:** browser do sistema + deep link.

### App aumentar de tamanho

**Risco:** plugins/dependências desnecessárias.

**Mitigação:** Tauri sem Chromium embarcado e revisão de cada plugin antes de adicionar.

## 19. Checklist por feature durante migração

Cada feature alterada deve responder:

- funciona web?
- funciona Android?
- funciona Linux?
- funciona Windows?
- funciona offline quando aplicável?
- usa arquivo local quando disponível?
- trata app encerrado no meio?
- trata falta de espaço?
- trata auth expirada?
- possui teste unitário/integração?
- possui fluxo real validado?
- expõe detalhe técnico desnecessário ao usuário?

## 20. Política de commits e integração

- commits pequenos por unidade funcional;
- não misturar refactor amplo com mudança de storage;
- manter branch atualizada com `main` para reduzir divergência;
- gates locais antes do push sempre que o ambiente permitir;
- limitações externas documentadas, mas não usadas como motivo para parar desenvolvimento de partes independentes;
- não fazer merge na `main` enquanto Android/Linux/Windows não tiverem ao menos smoke build e o PWA continuar passando seus gates.
