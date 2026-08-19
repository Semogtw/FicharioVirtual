# Build, release, testes e operação do app nativo

> Targets: Android, Linux e Windows

## 1. Objetivo

Definir tudo que precisa existir para que o app local-first seja leve, instalável, atualizável, testável e seguro em produção. Este documento complementa `ARCHITECTURE.md` e `IMPLEMENTATION_ROADMAP.md`.

## 2. Toolchain

### Compartilhado

- Node compatível com o projeto (`>=22.12.0` enquanto `package.json` mantiver esse requisito);
- pnpm `>=10`;
- Rust stable via rustup;
- Tauri CLI 2.x alinhada com as crates/plugins;
- toolchain Rust pinada quando a branch sair de protótipo para release reproduzível.

### Linux

Instalar as dependências Tauri/WebKitGTK exigidas pela distribuição usada no build. Manter script/documentação por família de distro, evitando comandos mágicos espalhados em workflows.

Targets prioritários:

- x86_64 Linux desktop;
- avaliar aarch64 apenas se houver uso real.

### Windows

- Microsoft C++ Build Tools com workload desktop C++;
- WebView2 runtime no ambiente de teste/build quando necessário;
- Rust MSVC toolchain;
- NSIS como primeiro instalador;
- MSI opcional.

### Android

- Android Studio/SDK command-line tools;
- Android SDK Platform + Build Tools;
- Platform Tools;
- NDK side-by-side compatível;
- JDK fornecido/recomendado pelo Android Studio;
- variáveis `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME` no ambiente de desenvolvimento/CI;
- Rust targets Android necessários.

Arquiteturas:

- `aarch64-linux-android`: obrigatória para produção;
- `x86_64-linux-android`: útil para emuladores;
- demais somente se houver requisito real.

## 3. Scripts esperados no `package.json`

Quando a implementação começar, padronizar comandos como:

```json
{
  "scripts": {
    "native:dev": "tauri dev",
    "native:build": "tauri build",
    "android:dev": "tauri android dev",
    "android:build": "tauri android build",
    "verify:native": "..."
  }
}
```

Não substituir os scripts web atuais. O PWA continua tendo gates independentes.

## 4. Configuração Tauri

`src-tauri/tauri.conf.json` deve conter, no mínimo:

- identificador de pacote estável e único;
- `frontendDist` apontando para build estático;
- comandos de build/dev usando pnpm;
- ícones por plataforma;
- configuração de bundle;
- CSP compatível com os serviços necessários;
- sem permissões globais desnecessárias.

Capabilities ficam em arquivos versionados e revisáveis, por exemplo:

```text
src-tauri/capabilities/
  core.json
  desktop.json
  android.json
```

Separar permissões específicas de plataforma evita conceder no Android algo necessário apenas no desktop.

## 5. Identidade e versionamento

Definir uma única versão de produto e mapear para cada plataforma.

### SemVer

Usar `MAJOR.MINOR.PATCH` como versão pública.

### Android

- `versionName`: SemVer visível;
- `versionCode`: inteiro monotônico, nunca reutilizado em release publicada.

### Desktop

Tauri/package metadata deve permanecer sincronizada. Automatizar validação para impedir release com versões divergentes.

## 6. Artefatos alvo

### Android

- debug APK para desenvolvimento;
- release APK assinado para testes/sideload;
- release AAB assinado para Play Store.

### Linux

P0:

- AppImage;
- `.deb`.

P1/P2:

- RPM;
- AUR/Flatpak somente se houver benefício real.

### Windows

P0:

- NSIS `.exe`.

P1:

- MSI;
- Microsoft Store se fizer sentido depois.

## 7. Signing e segredos de release

Nunca versionar:

- Android keystore;
- senha do keystore;
- chave privada do updater;
- certificado privado de assinatura Windows;
- tokens de publicação;
- refresh tokens de teste real.

No CI, usar secrets protegidos e minimizar a etapa em que material sensível fica disponível.

### Android

- keystore de release separado do debug;
- backup seguro do keystore e senhas;
- documentar alias e procedimento de rotação/recuperação sem registrar segredo.

Perder a chave pode impedir continuidade de atualização fora de mecanismos de assinatura gerenciada da loja.

### Desktop updater

Se `@tauri-apps/plugin-updater` for adotado:

- chave privada só no ambiente de release;
- chave pública embutida/configurada no app;
- artefatos de atualização assinados;
- manifesto servido por HTTPS;
- app rejeita assinatura inválida.

### Windows

Code signing público pode ser adicionado quando necessário para confiança/SmartScreen/distribuição. A ausência inicial de certificado não deve impedir builds internos, mas releases públicas devem ter estratégia definida.

## 8. Canais de release

Planejamento recomendado:

- `dev`: builds locais/CI, sem promessa de estabilidade;
- `beta`: testes reais com migrations e sync próximos de produção;
- `stable`: usuários finais.

Evitar que `dev` e `stable` compartilhem banco/diretório de dados por acidente. Usar identificadores distintos quando builds de teste puderem coexistir.

## 9. CI/CD

O CI não deve depender de um único runner para todos os targets.

### Jobs sugeridos

#### `web-gates`

- install lockfile estrito;
- lint;
- type/check;
- unit tests;
- build PWA.

#### `native-core-gates`

- `cargo fmt --check`;
- `cargo clippy` com warnings tratados;
- testes Rust;
- testes de contrato dos providers nativos.

#### `linux-build`

- build Tauri release;
- smoke do binário quando runner permitir;
- produzir AppImage/deb em release/tag.

#### `windows-build`

- build Tauri release em runner Windows;
- produzir NSIS/MSI conforme configuração.

#### `android-build`

- inicializar SDK/NDK;
- build debug em PR;
- build assinado somente em release protegida.

### Política

PRs não precisam publicar artefatos assinados. Assinatura deve ficar restrita a workflows de release/tag protegidos.

## 10. Reprodutibilidade

- `pnpm-lock.yaml` obrigatório e `--frozen-lockfile` no CI;
- `Cargo.lock` versionado para aplicativo;
- versões Android/NDK documentadas/pinadas após estabilização;
- não usar `latest` em componentes críticos do release;
- registrar versão do Rust/Tauri usada em release;
- checksums dos artefatos finais.

## 11. Matriz de testes

### Unitários TypeScript

Cobrir:

- seleção de provider;
- estado local/remoto;
- resolvedor de documento;
- decisões de retry;
- backoff/jitter com relógio controlado;
- conflito/tombstone;
- política de eviction;
- erros offline.

### Unitários Rust

Cobrir:

- normalização/validação de paths;
- resolução segura dentro de app data;
- hashing;
- staging/promote;
- validação de arquivo;
- comandos que recebem IDs em vez de caminhos arbitrários.

### Integração SQLite

Cobrir:

- migration do zero;
- migration entre versões suportadas;
- transação interrompida;
- lease expirado;
- retomada de jobs;
- constraints de duplicidade;
- concorrência de fila.

### Integração filesystem

Cobrir:

- import bem-sucedido;
- arquivo de 0 bytes;
- arquivo grande;
- nome unicode;
- nome malicioso/traversal;
- falta de espaço;
- permissão negada;
- arquivo removido externamente quando aplicável;
- crash simulado antes/depois de promote.

### Integração sync

Usar servidor/mock controlável para reproduzir:

- 200/201;
- 401/403;
- 404;
- 409;
- 429;
- 5xx;
- timeout;
- conexão encerrada;
- resposta inválida;
- upload parcialmente concluído.

### E2E UI

Fluxos obrigatórios:

1. login;
2. import;
3. documento aparece imediatamente;
4. abrir local;
5. fechar/reabrir;
6. abrir offline;
7. voltar online e sync completar;
8. busca retorna documento;
9. abrir resultado com destaque/marcação;
10. exclusão e sync.

## 12. Testes reais por plataforma

Emulador/CI não substitui testes reais.

### Android físico

Testar:

- seletor de arquivos;
- importação pela galeria/document picker;
- kill pelo sistema;
- background/foreground repetido;
- sem rede;
- rede lenta;
- armazenamento quase cheio;
- arquivos grandes;
- rotação/troca de tamanho de tela;
- atualização de uma versão anterior com banco já populado.

### Linux

Testar pelo menos:

- CachyOS/Arch real;
- Ubuntu/Debian real ou VM;
- Wayland;
- X11 quando possível;
- AppImage em máquina sem checkout do projeto;
- `.deb` instalação/upgrade/remove.

### Windows

Testar:

- instalação limpa;
- upgrade por cima da versão anterior;
- desinstalação preservando/removendo dados conforme política explícita;
- caminhos unicode;
- WebView2 disponível/recuperação quando ausente;
- Windows Defender/SmartScreen em builds de distribuição;
- NSIS em usuário sem privilégios administrativos quando suportado.

## 13. Testes de interrupção obrigatórios

Automatizar ou executar de forma reproduzível:

- matar app durante importação;
- matar app durante upload;
- matar app durante download;
- matar app durante geração de preview;
- perder rede durante cada operação;
- expirar OAuth no meio da fila;
- reiniciar após migration;
- encher disco durante escrita.

Resultado esperado: nenhuma corrupção silenciosa e estado recuperável na próxima inicialização.

## 14. Performance benchmarks

Criar benchmark dedicado, não depender apenas de percepção manual.

### Métricas

- cold start;
- warm start;
- biblioteca -> first document frame;
- abertura de imagem 1 MB / 10 MB / 50 MB;
- PDF 10 / 100 / 500 páginas;
- geração de thumbnail;
- import throughput;
- uso de memória no PDF longo;
- tempo para biblioteca utilizável após login em dispositivo novo;
- duração de sync sem afetar interação.

### Assertion crítica

Para documento `local_state = present`, instrumentar rede e provar:

```text
Drive requests during open = 0
```

A regressão desse contrato deve quebrar teste/gate.

## 15. Budgets de peso e memória

Não fixar números irreais antes dos primeiros builds, mas manter budgets versionados depois da baseline.

Medir separadamente:

- tamanho do instalador;
- tamanho instalado;
- tamanho do bundle JS/CSS;
- tamanho das dependências Rust;
- memória idle;
- memória com imagem grande;
- memória com PDF longo.

Toda dependência/plugin novo relevante deve justificar impacto.

### Regras de leveza

- não incluir Chromium/Electron;
- não embutir modelo OCR pesado no app principal sem decisão explícita;
- desktop OCR worker permanece opcional/separado se for grande;
- não duplicar originais em múltiplos caches;
- previews são compactos e sujeitos a LRU;
- lazy-load de código pesado da UI quando possível;
- evitar Base64 de arquivos grandes.

## 16. Segurança de CI e supply chain

- Dependabot/renovação existente continua cobrindo npm/GitHub Actions;
- adicionar revisão equivalente para crates Rust;
- `cargo audit`/ferramenta equivalente pode ser gate periódico;
- builds de release partem de commit/tag conhecido;
- não executar binário de origem não confiável com secrets disponíveis;
- permissions do GitHub Actions no menor nível possível;
- actions pinadas conforme política do repo.

## 17. Política de dados na desinstalação/logout

### Logout

Por padrão:

- remover sessão/segredos;
- parar sync;
- manter arquivos locais sem associá-los automaticamente a outro usuário;
- exigir decisão explícita para apagar biblioteca local.

Antes de implementar, garantir isolamento por `user_id` para impedir que uma conta veja documentos de outra após troca de login.

### Desinstalação

O SO normalmente controla remoção de app data. Se houver opção de pasta externa/exportada, documentar claramente o que permanece.

## 18. Backup e recuperação

A nuvem continua sendo recuperação principal de documentos sincronizados.

Casos a suportar:

- banco local perdido, arquivos locais presentes;
- banco presente, arquivo ausente;
- Drive presente, dispositivo vazio;
- metadado remoto presente sem blob remoto esperado;
- arquivo local com hash divergente.

Planejar comando interno de `library doctor`/reconciliation para desenvolvimento e suporte, sem expor complexidade desnecessária na UI comum.

## 19. Atualização de schema

Toda release que alterar SQLite deve:

- possuir migration forward;
- ter fixture do schema anterior;
- testar upgrade real;
- evitar migration destrutiva sem backup/estratégia;
- nunca depender de downgrade automático de banco.

Se uma release precisar rollback, o binário anterior deve continuar sabendo lidar com o schema ou a rollout deve ser interrompida antes da migration incompatível.

## 20. Checklist de release

Antes de marcar stable:

- [ ] web gates verdes
- [ ] Rust/native gates verdes
- [ ] migration testada a partir da stable anterior
- [ ] Android físico testado
- [ ] Linux instalado a partir do artefato final
- [ ] Windows instalado a partir do artefato final
- [ ] import real testado
- [ ] abertura offline testada
- [ ] zero Drive requests no fast path local confirmado
- [ ] sync interrompido/retomado testado
- [ ] auth expirada testada
- [ ] assinatura dos artefatos validada quando habilitada
- [ ] checksums publicados/registrados
- [ ] release notes atualizadas
- [ ] documentação de blockers conhecida atualizada

## 21. Critérios para merge futuro na `main`

A branch de implementação não deve ser considerada pronta apenas porque compila em uma plataforma.

Mínimo para merge da fundação:

- PWA sem regressão;
- Linux build + smoke;
- Windows build + smoke;
- Android build + smoke em device/emulador;
- abstração web/native coberta por teste;
- filesystem local com capability restrita;
- migrations SQLite testadas;
- documentação atualizada com o que foi realmente implementado, diferenciando claramente plano de estado real.

## 22. Referências oficiais

- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Tauri + SvelteKit: https://v2.tauri.app/start/frontend/sveltekit/
- Tauri plugins: https://v2.tauri.app/plugin/
- Tauri filesystem: https://v2.tauri.app/plugin/file-system/
- Tauri updater: https://v2.tauri.app/plugin/updater/
- Tauri distribution: https://v2.tauri.app/distribute/
