# Estado de desenvolvimento nativo — 2026-08-29

Checkpoint operacional da branch `feat/native-app-android-linux-windows` / PR #77.

Este documento consolida o que **existe em código**, o que foi **testado de forma observável** e o que **continua pendente de validação real**. Ele não substitui os documentos de arquitetura em `docs/native-app/` nem o estado integrado da PWA em `main`.

## Identidade do trabalho

- **Base:** `main`.
- **Branch:** `feat/native-app-android-linux-windows`.
- **PR:** #77, draft.
- **Head observado antes deste checkpoint:** `7a2a59f9b3d0561b764c830a19b452c419196688`.
- **Escopo:** aplicativo nativo Android/Linux/Windows construído sobre o frontend SvelteKit existente, mantendo compatibilidade com a PWA.
- **Política:** a branch não deve ser tratada como pronta para merge/release até os gates multiplataforma e fluxos reais restantes serem observados.

## Relação com a `main`

A `main` continua sendo a fonte de verdade do produto PWA integrado, Drive-first, OCR seletivo, busca híbrida/semântica e backend atual.

A branch nativa adiciona um runtime local-first sem redefinir essas autoridades:

- Google Drive continua sendo armazenamento permanente dos originais no fluxo remoto;
- Supabase continua responsável pelas superfícies remotas já documentadas;
- a PWA precisa continuar funcionando quando `__TAURI__` não existe;
- o runtime nativo pode manter cópias/originais locais e filas próprias, mas não pode introduzir divergência silenciosa de identidade ou perda de dados.

## Implementado na branch

### Shell e runtime

- Tauri 2 compartilhado entre Android, Linux e Windows;
- detecção explícita do runtime nativo;
- caminhos web permanecem inertes quando executados fora de Tauri;
- configurações de bundle para Linux, Windows e Android.

### Storage local-first

- storage privado local;
- staging crash-safe;
- catálogo SQLite em WAL;
- hashes SHA-256 para integridade/identidade física quando aplicável;
- estados local/remoto explícitos;
- persistência do original antes de fluxos que dependem de disponibilidade remota;
- IDs pendentes determinísticos para retries idempotentes;
- leitura por faixa para PDFs grandes;
- fast path por `driveFileId` para evitar rede quando o original local está disponível;
- fallback remoto compatível com a PWA e aquecimento do cache nativo.

### Fila persistente

- fila SQLite durável;
- leases;
- retry;
- recuperação após crash;
- operações projetadas para não duplicar originais durante retomada.

### Eviction e armazenamento

- política LRU conservadora;
- originais ainda não confirmados remotamente não são elegíveis à remoção automática;
- somente cópias que já satisfazem o contrato remoto podem ser descartadas sob a política de espaço;
- métricas SQLite agregadas;
- limpeza em lotes;
- implementação não assume teto operacional de 1.000 documentos;
- superfície **Configurações → Armazenamento** implementada.

### Packaging

Configurações existentes:

- Linux: `deb` e AppImage;
- Windows: NSIS;
- Android: API 24+;
- workflow read-only de testes/compilação para Linux, Windows e APK Android aarch64;
- workflow separado para bundles instaláveis Linux/Windows.

## Invariantes já cobertos por testes

A PR registra evidência para os seguintes contratos:

1. leitura completa local não chama rede;
2. leitura parcial local não chama rede quando a faixa está disponível localmente;
3. runtime web permanece inerte quando `__TAURI__` não existe;
4. original ainda pendente de publicação/garantia remota não entra em eviction automática.

Esses testes são importantes, mas não equivalem a certificação em hardware físico.

## O que ainda NÃO está declarado pronto

### Importação 100% offline

Ainda falta fechar um worker capaz de reconstruir/publicar todos os metadados e derivados necessários para uma importação iniciada totalmente offline, preservando idempotência e recuperação após reinício.

O objetivo não é apenas “subir o arquivo depois”; é garantir que o estado lógico completo possa convergir sem:

- duplicar documentos;
- perder páginas/OCR;
- publicar metadata incompleta como terminal;
- quebrar referências entre original, páginas, jobs e índices.

### OAuth e deep links nativos

O fluxo precisa ser validado como produto nativo, incluindo:

- abertura do provedor;
- callback/deep link;
- retomada do app;
- armazenamento de estado/PKCE apropriado;
- cancelamento;
- falha/retry;
- diferenças Android/Linux/Windows.

Não inferir prontidão a partir do OAuth web já existente.

### CSP de release

A CSP final do runtime nativo ainda precisa ser fechada e validada com o conjunto real de recursos, protocolos, iframes/webviews e endpoints necessários. O objetivo é manter o mínimo necessário sem abrir exceções genéricas para “fazer funcionar”.

### Signing e update

Ainda pendentes:

- assinatura Android;
- assinatura/fluxo de distribuição Windows;
- política de update nativo;
- rollback e compatibilidade entre versões;
- confirmação de que nenhum segredo de signing entra no repositório.

### Hardware físico

Ainda não declarar sucesso real para:

- Android físico;
- Linux físico alvo;
- Windows físico alvo;
- comportamento após suspensão/reabertura;
- process death/restart;
- pressão de armazenamento;
- PDFs grandes em condições reais;
- cold/warm start.

### Benchmarks

Ainda faltam medições p50/p95 de abertura e leitura em hardware real.

Métricas úteis:

- cold open de documento local;
- warm open;
- primeiro range de PDF grande;
- fallback remoto;
- tempo para aquecer cache;
- recuperação após crash;
- overhead SQLite/fila;
- impacto de eviction sob pressão de espaço.

## Definição de autoridade local e remota

Para evitar bugs de convergência, cada operação deve responder claramente:

1. qual cópia é o original autoritativo neste instante?;
2. existe confirmação remota suficiente para permitir eviction?;
3. qual ID é estável durante retry?;
4. qual operação pode ser repetida sem criar duplicata?;
5. como detectar resposta perdida após commit?;
6. o que acontece se o processo morrer entre staging e finalização?;
7. qual parte pode ser reconstruída a partir do catálogo local?;
8. qual parte exige backend remoto?

Se a resposta não estiver explícita, o fluxo ainda não está pronto para ser tratado como terminal.

## Compatibilidade com a PWA

Invariantes obrigatórios:

- nenhum import de API Tauri pode quebrar SSR/build web;
- `__TAURI__` ausente deve preservar o comportamento web atual;
- leitura remota existente continua sendo fallback válido;
- identidade de documento não deve mudar só porque existe cópia local;
- recursos nativos devem degradar de forma explícita quando não disponíveis;
- código compartilhado não pode presumir filesystem nativo no navegador.

## Segurança

Preservar:

- storage privado por plataforma;
- nenhuma credencial em logs;
- nenhum token em path/alias;
- hashes usados como integridade, não como segredo;
- symlinks/path traversal tratados de forma fail-closed nas operações de arquivo;
- staging e temp files com lifecycle controlado;
- CSP restritiva em release;
- signing fora do repositório;
- nenhuma sincronização que transforme erro em sucesso aparente.

## Gates recomendados antes de merge

### Código compartilhado

- testes unitários/integrados do frontend e domínio;
- lint/typecheck/build web;
- confirmação de que a PWA continua inerte às APIs nativas.

### Rust/Tauri

- testes das regiões de storage/fila/catalog;
- build release de cada target suportado;
- validação de packaging real, não só geração de configuração.

### Linux

- build `deb`;
- build AppImage;
- instalação limpa;
- abertura/importação/leitura;
- atualização/rollback quando o mecanismo existir;
- teste em filesystem real e sessão desktop alvo.

### Windows

- build NSIS;
- instalação/desinstalação;
- paths com espaços/Unicode;
- permissões e atualização;
- leitura de PDFs grandes e recuperação após reinício.

### Android

- APK/AAB conforme estratégia final;
- instalação em aparelho físico;
- deep link/OAuth;
- process death;
- permissões/SAF quando aplicável;
- pressão de armazenamento;
- background/foreground;
- retomada de fila.

## Próxima ordem de trabalho recomendada

1. fechar o worker de convergência para importação iniciada 100% offline;
2. executar gates compartilhados e eliminar regressões web;
3. fechar OAuth/deep-link nativo;
4. fechar CSP de release;
5. produzir e instalar bundles reais em Linux e Windows;
6. instalar e exercitar Android físico;
7. testar crash/process death e retomada em cada plataforma;
8. medir p50/p95 em hardware real;
9. somente então preparar signing/update/release final.

## Documentos canônicos relacionados

Ler junto deste snapshot:

- `docs/CURRENT_STATUS.md` — estado integrado da PWA; na branch nativa, partes do cabeçalho podem refletir o snapshot anterior da `main` e não devem substituir este documento para o runtime Tauri;
- `docs/READINESS.md` — critérios globais de prontidão;
- `docs/PROJECT_SPEC.md` — escopo do produto;
- `docs/SEARCH_OCR_MATCHING.md` — busca/OCR;
- `docs/SEMANTIC_COVERAGE.md` — semântica;
- `docs/native-app/` — arquitetura e decisões específicas do runtime nativo;
- PR #77 — resumo e evidência da linha de implementação.

## Critério de conclusão desta branch

A branch só deve deixar de ser tratada como experimental/draft quando houver evidência observada de que:

- PWA não regrediu;
- bundles reais são instaláveis;
- leitura local-first funciona em hardware real;
- importação offline converge corretamente;
- OAuth/deep links fecham nas plataformas alvo;
- crash/restart preserva filas e identidade;
- eviction não remove o único original útil;
- CSP/signing/update estão definidos de forma segura;
- benchmarks básicos foram coletados;
- documentação e PR distinguem claramente código existente de comportamento realmente validado.
