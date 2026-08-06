# Prontidão do Fichário Virtual

_Atualizado em 6 de agosto de 2026._

Os percentuais antigos de `100%` do escopo codificável e `96%` do MVP foram retirados porque não incluíam o requisito original de Google Drive como armazenamento permanente. Esta página só volta a publicar uma porcentagem global quando o novo escopo possuir evidência suficiente para que o número não esconda uma lacuna arquitetural.

## Situação atual

| Dimensão | Estado | Interpretação |
| --- | --- | --- |
| Produto sem Drive | Avançado | Interface, busca, OCR, importação, revisão, PWA, segurança e testes locais já possuem ampla implementação. |
| Fundação Drive em código | Em desenvolvimento | Design, plano, contratos, reconciliação, sincronizador e modelo de banco estão sendo implementados. |
| Drive real | Não validado | OAuth, API implantada, upload, Picker, feed remoto e migração ainda não foram comprovados. |
| Release privada de uma pessoa | Bloqueada | Não deve ser promovida como plano original enquanto os originais permanentes continuarem dependentes do Supabase Storage. |

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

Essa evidência continua útil, mas não prova o novo requisito Drive.

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
- estado público de conexão que rejeita tokens/secrets;
- runbook externo de Google Cloud e OAuth.

## O que falta em código

### OAuth e credenciais

- Edge Functions `drive-oauth-start`, `drive-oauth-callback` e `drive-access-token`;
- state de uso único e expiração;
- troca de código e armazenamento backend do refresh token;
- revogação e reconexão;
- cliente Drive estrito usando access token efêmero.

### Arquivos e pastas

- criar/reconectar `Fichário Digital` pela API real;
- criar, renomear e mover pastas de cadernos/subcadernos;
- integrar `drive_file_id` e `drive_folder_id` aos serviços atuais;
- upload retomável conectado às filas de imagem e PDF;
- Google Picker e cópia explícita para a pasta controlada;
- tela de arquivos ausentes e conflitos.

### Sincronização

- gateway real para `changes.getStartPageToken` e `changes.list`;
- worker/runner de jobs com lease, retry e cleanup;
- aplicação remota de rename/move/delete/reconnect;
- reconciliação automática ao abrir o aplicativo;
- migração idempotente dos originais existentes no Supabase Storage.

### Tipos e compatibilidade

- gerar `src/lib/types/database.ts` a partir do schema final;
- adaptar serviços legados para `storage_path` opcional;
- preservar fallback até confirmação do Drive e rollback.

## O que falta externamente

- criar/configurar projeto Google Cloud;
- habilitar Google Drive API;
- configurar consentimento e cliente OAuth Web;
- cadastrar redirect URI exata da Edge Function;
- definir secrets somente no Supabase;
- executar OAuth com a conta autorizada;
- validar pasta raiz, upload, feed, remoção, reconexão e Picker;
- aplicar as novas migrations no staging;
- concluir gates remotos de Supabase, OCR e host HTTPS;
- testar em celular e tablet;
- confirmar billing desativado, backup e rollback.

## Ordem recomendada

1. tornar a nova base Drive integralmente verde no CI;
2. aplicar migrations no staging e gerar tipos;
3. concluir Edge Functions OAuth e cliente Drive;
4. integrar pastas e upload retomável;
5. integrar feed de mudanças e UI de conflitos/ausentes;
6. migrar originais existentes com fallback preservado;
7. executar todos os gates remotos e físicos;
8. somente então decidir release privada ou produção.

## Critério para declarar o plano original pronto

```text
Validate current head: PASS
Drive schema local/remoto: PASS
OAuth drive.file: PASS
Pasta Fichário Digital: PASS
Cadernos/subcadernos no Drive: PASS
Upload retomável: PASS
Importar do Drive: PASS
Feed de mudanças: PASS
Missing/reconnect: PASS
Conflitos isolados: PASS
Migração de originais: PASS
Verify Supabase staging: PASS
Verify deployed Fichário: PASS
Verify OCR staging: PASS
Celular/tablet: PASS ou riscos registrados
Billing, backup e rollback: PASS
```

A ausência de defeitos conhecidos não substitui esses recibos.
