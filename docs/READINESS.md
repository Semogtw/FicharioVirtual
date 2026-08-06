# Prontidão do Fichário Virtual

_Atualizado em 6 de agosto de 2026._

Os percentuais antigos de `100%` do escopo codificável e `96%` do MVP foram retirados porque não incluíam Google Drive como armazenamento permanente. A arquitetura aprovada também adiciona Cloudflare Pages e OCR desktop. Esta página só volta a publicar porcentagem global quando todos esses eixos possuírem evidência suficiente.

## Situação atual

| Dimensão | Estado | Interpretação |
| --- | --- | --- |
| Produto sem Drive | Avançado | Interface, busca, OCR, importação, revisão, PWA, segurança e testes locais possuem ampla implementação. |
| Fundação Drive em código | Em desenvolvimento | Design, plano, contratos, reconciliação, sincronizador e modelo de banco estão sendo implementados. |
| Drive real | Não validado | OAuth, API implantada, upload, Picker, feed remoto e migração ainda não foram comprovados. |
| Cloudflare Pages | Documentado | Host alvo e runbook existem, mas nenhum deployment foi validado. |
| Distribuição de modelos | Documentada | Projeto Pages separado, partes e checksums foram definidos, mas empacotador e host não existem. |
| OCR desktop | Documentado | Roteamento, pareamento, lease, worker e segurança foram definidos, mas não implementados. |
| RX 6600 | Não validada | Vulkan, CPU e modelos locais ainda precisam de benchmark real; ROCm permanece experimental. |
| Release privada de uma pessoa | Bloqueada | Drive, host e fluxos OCR aprovados ainda não possuem recibos completos. |

## Evidência anterior preservada

Antes da correção de escopo, o projeto já havia validado:

- aplicação SvelteKit estática e responsiva;
- autenticação fail-closed por allowlist;
- biblioteca, cadernos, tags, organização em lote, busca e revisão;
- importação de imagens e PDFs, preparação local e deduplicação;
- OCR persistente, concorrente, retomável e idempotente;
- cliente Gemini com saída estruturada;
- RLS, Storage privado e Edge Functions;
- PWA com cache restrito ao shell público;
- migrations e testes pgTAP anteriores;
- centenas de testes Vitest e cenários E2E Chromium;
- coordenação real entre duas abas;
- gates de fonte, tipos, lint, build, PWA, Deno e banco;
- scripts de verificação remota para Supabase, host e OCR.

Essa evidência continua útil, mas não prova Drive, Cloudflare ou worker local.

## Implementação Drive já adicionada

- especificação canônica e plano executável;
- escopo obrigatório `drive.file`;
- contratos estritos para arquivos, listagens e páginas de mudanças;
- rejeição de campos extras, IDs duplicados e respostas malformadas;
- reconciliação de arquivo removido sem apagar título, caderno, tags, OCR ou correções;
- reconexão pelo mesmo `drive_file_id`;
- isolamento de conflito de identidade;
- consultas seguras para pasta raiz e pastas-filhas;
- sincronizador paginado que persiste o checkpoint somente após aplicar toda a página;
- conflito isolado sem bloquear mudanças independentes;
- schema PostgreSQL para conexão, pastas aninhadas, documentos, fila idempotente e conflitos;
- RLS e RPCs para ausência, reconexão e claim de jobs;
- estado público de conexão que rejeita tokens e secrets;
- runbook externo de Google Cloud e OAuth.

## Decisões Cloudflare e desktop já documentadas

- design em `docs/superpowers/specs/2026-08-06-cloudflare-pages-and-desktop-ocr-design.md`;
- runbook Cloudflare em `docs/CLOUDFLARE_SETUP.md`;
- runbook do worker em `docs/DESKTOP_OCR_WORKER.md`;
- Cloudflare Pages como host estático preferencial;
- projeto Pages Direct Upload separado para modelos públicos fragmentados;
- R2 desativado por padrão por envolver cobrança por uso;
- nenhum conteúdo privado na Cloudflare;
- Gemini geral com classificação na mesma chamada;
- caderno manuscrito capaz de pular Gemini;
- fila desktop em modelo pull;
- pareamento revogável e sem service-role no computador;
- lease, heartbeat, hash de origem e conclusão idempotente;
- CPU como fallback obrigatório e RX 6600 condicionada a benchmark.

Documentação aprovada não equivale a implementação.

## O que falta em código

### OAuth e credenciais Drive

- Edge Functions `drive-oauth-start`, `drive-oauth-callback` e `drive-access-token`;
- state de uso único e expiração;
- troca de código e armazenamento backend do refresh token;
- revogação e reconexão;
- cliente Drive estrito usando access token efêmero.

### Arquivos, pastas e sincronização

- criar ou reconectar `Fichário Digital` pela API real;
- criar, renomear e mover pastas de cadernos e subcadernos;
- integrar `drive_file_id` e `drive_folder_id` aos serviços atuais;
- upload retomável conectado às filas de imagem e PDF;
- Google Picker e cópia explícita para a pasta controlada;
- gateway real para `changes.getStartPageToken` e `changes.list`;
- worker de jobs Drive com lease, retry e cleanup;
- tela de arquivos ausentes e conflitos;
- migração idempotente dos originais existentes no Supabase Storage.

### Cloudflare

- configuração do projeto Pages e variáveis públicas;
- deploy de preview e produção;
- origem canônica e redirect de `pages.dev`;
- validação real de `_headers`, fallback e PWA;
- atualização coordenada de Supabase Auth e `APP_ORIGIN`;
- empacotador de modelo em partes de até 20 MiB;
- schema e verificador de manifesto;
- projeto Pages Direct Upload de modelos;
- rollback ensaiado.

### OCR híbrido

- tabela de múltiplos resultados;
- tipo de conteúdo e override por página ou caderno;
- resposta Gemini com classificação e roteamento;
- precedência entre resultado preliminar, Gemini, desktop e correção manual;
- novos estados de fila desktop;
- retenção de página temporária enquanto a rota local aguarda.

### Worker desktop

- tabelas de dispositivos, pareamento e eventos;
- Edge Functions `desktop-worker-pair`, `desktop-ocr-claim`, `desktop-ocr-source`, `desktop-ocr-heartbeat`, `desktop-ocr-complete` e `desktop-ocr-fail`;
- credencial por hash no servidor e keyring local;
- claim exclusivo, lease e heartbeat;
- serviço systemd do usuário;
- download com tamanho, MIME e hash;
- cache de modelos e validação de licença;
- backend CPU funcional;
- Vulkan validado;
- spool local e retomada;
- UI de dispositivos e fila;
- benchmark na RX 6600.

### Tipos e compatibilidade

- gerar `src/lib/types/database.ts` a partir do schema final;
- adaptar serviços legados para `storage_path` opcional;
- preservar fallback até confirmação do Drive e rollback;
- versionar contratos entre PWA, Edge Functions e worker;
- rejeitar worker incompatível fail-closed.

## O que falta externamente

- criar ou configurar projeto Google Cloud;
- habilitar Google Drive API;
- configurar consentimento e cliente OAuth Web;
- cadastrar redirect URI exata da Edge Function;
- definir secrets somente no Supabase;
- executar OAuth com a conta autorizada;
- validar pasta raiz, upload, feed, remoção, reconexão e Picker;
- aplicar migrations no staging;
- criar conta e domínio Cloudflare;
- criar projeto Pages da PWA;
- criar projeto Pages dos modelos;
- configurar domínio canônico e redirects;
- instalar worker no CachyOS;
- parear e revogar computador real;
- baixar e validar modelo licenciado;
- concluir gates remotos de Supabase, OCR e host HTTPS;
- testar em celular e tablet;
- confirmar billing desativado, backup e rollback.

## Ordem recomendada

1. tornar a base Drive integralmente verde no CI;
2. aplicar migrations no staging e gerar tipos;
3. concluir Edge Functions OAuth e cliente Drive;
4. integrar pastas, upload retomável e feed;
5. migrar originais existentes com fallback preservado;
6. migrar e validar a PWA no Cloudflare Pages;
7. criar distribuição fragmentada de modelos sem R2 obrigatório;
8. separar resultados OCR e adicionar roteamento;
9. implementar pareamento, fila e worker CPU-first;
10. validar Vulkan e modelos de manuscrito;
11. executar benchmark na RX 6600;
12. executar todos os gates remotos e físicos;
13. somente então decidir release privada ou produção.

## Critério para declarar a arquitetura pronta

```text
Validate current head: PASS
Drive schema local e remoto: PASS
OAuth drive.file: PASS
Pasta Fichário Digital: PASS
Cadernos e subcadernos no Drive: PASS
Upload retomável: PASS
Importar do Drive: PASS
Feed de mudanças: PASS
Missing e reconnect: PASS
Conflitos isolados: PASS
Migração de originais: PASS
Cloudflare Pages produção: PASS
Origem canônica e headers: PASS
Distribuição de modelo sem R2 obrigatório: PASS
Roteamento Gemini e desktop: PASS
Pareamento e revogação: PASS
Fila pull sem porta pública: PASS
Lease, heartbeat e retomada: PASS
Resultado desktop idempotente: PASS
CPU local: PASS
RX 6600: PASS ou riscos registrados
Verify Supabase staging: PASS
Verify deployed Fichário: PASS
Verify OCR staging: PASS
Celular e tablet: PASS ou riscos registrados
Nenhum conteúdo privado na Cloudflare: PASS
Billing, backup e rollback: PASS
```

A ausência de defeitos conhecidos não substitui esses recibos.
