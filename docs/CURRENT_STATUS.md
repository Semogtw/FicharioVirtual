# Estado atual do Fichário Virtual

_Atualizado: 2026-08-06_  
_Branch ativa: `main`_  
_Estado: integração Google Drive obrigatória em implementação; release do plano original bloqueada._

## Resumo executivo

O Fichário Virtual já possui uma PWA SvelteKit avançada para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo, pesquisar, revisar e exportar metadados. A arquitetura anterior mantinha os originais permanentemente no Supabase Storage e chegou a ser documentada incorretamente como escopo codificável concluído.

A decisão original foi restaurada: **Google Drive é o armazenamento permanente dos arquivos originais**. Supabase continua responsável por Auth, PostgreSQL, RLS, OCR, busca, filas, conflitos e artefatos temporários. A documentação canônica e a prontidão foram corrigidas para impedir uma release falsa.

## Base anterior implementada

- conta única com allowlist fail-closed;
- interface editorial responsiva para desktop, tablet e celular;
- biblioteca, cadernos, tags e organização em lote;
- importação cancelável/retomável de imagens e PDFs;
- preparação local de imagens, miniaturas, hash e deduplicação;
- inspeção local de PDFs e preservação de texto nativo;
- OCR seletivo, persistente, concorrente, idempotente e com backoff;
- busca textual ranqueada, leitor lado a lado e revisão manual;
- rascunhos locais recuperáveis;
- exportação JSON portátil sem tokens;
- RLS, Storage privado, Edge Functions e URLs assinadas;
- PWA sem cache de conteúdo autenticado;
- testes unitários, E2E, pgTAP e gates de deployment;
- coordenação real entre duas abas.

Essas capacidades permanecem válidas, mas algumas rotas de importação ainda gravam o original no Supabase e precisam ser migradas para Drive.

## Trabalho Drive incorporado nesta continuação

### Documentação e escopo

- design consolidado em `docs/superpowers/specs/2026-08-06-google-drive-primary-storage-design.md`;
- plano executável em `docs/superpowers/plans/2026-08-06-google-drive-primary-storage.md`;
- especificação canônica alterada para Drive permanente;
- runbook externo em `docs/GOOGLE_DRIVE_SETUP.md`;
- README e prontidão corrigidos;
- percentuais antigos removidos.

### Contratos TypeScript

- tipos de arquivo, mudança, página, estado físico e conflito;
- parsers Zod estritos para respostas Google;
- rejeição de campos extras, tokens acidentais, IDs duplicados e timestamps inválidos;
- escopo exato `https://www.googleapis.com/auth/drive.file`;
- criação segura de queries para pastas;
- valores parseados congelados.

### Reconciliação e sincronização

- remoção remota vira `missing` sem apagar OCR, correções, título, caderno ou tags;
- mesmo ID remoto reconecta o item;
- identidade divergente cria conflito isolado;
- sincronizador pagina o feed;
- checkpoint só é salvo depois de aplicar todos os itens da página;
- falha de persistência impede avanço do token;
- conflito de um item não impede aplicação dos demais;
- ciclos/repetição de tokens são rejeitados.

### Banco de dados

As migrations novas adicionam:

- `drive_connections`;
- hierarquia `parent_notebook_id`;
- `drive_folder_id` em cadernos;
- `drive_file_id` e estado físico em documentos;
- `storage_path` opcional para temporário/fallback;
- `drive_sync_jobs` com idempotência, tentativa, lease e backoff;
- `drive_conflicts` isolados;
- enums de conexão, operação, sincronização e conflito;
- RLS e políticas por proprietário;
- RPCs `mark_drive_file_missing`, `reconnect_drive_file` e `claim_drive_sync_job`;
- testes pgTAP para isolamento, hierarquia, IDs únicos, ausência, reconexão e idempotência.

### Estado público de conexão

- projeção pública estrita sem tokens;
- estados “não configurado”, “desconectado”, “conectando”, “sincronizando”, “conectado”, “erro” e “revogado”;
- rejeição de qualquer refresh token, access token ou campo extra;
- mensagens que preservam metadados quando o acesso é revogado.

## Pendências imediatas de código

1. tornar o novo head integralmente verde no workflow;
2. gerar os tipos TypeScript do schema Drive;
3. criar serviço Supabase para ler a conexão e acionar sync;
4. integrar cartão Drive à tela de Configurações;
5. implementar Edge Functions de OAuth;
6. implementar cliente Drive backend/browser com token efêmero;
7. criar/reconectar a raiz e pastas de cadernos;
8. implementar upload retomável e Picker;
9. conectar filas de imagens/PDFs ao Drive;
10. implementar gateway real do feed e runner de jobs;
11. criar UI de ausentes/conflitos;
12. migrar originais existentes com rollback.

## Pendências externas

- Google Cloud e Drive API;
- tela de consentimento;
- cliente OAuth Web e redirect URI;
- secrets no Supabase;
- migrations novas aplicadas ao staging;
- OAuth real, upload e feed validados;
- host HTTPS e APP_ORIGIN final;
- contas de teste Supabase;
- OCR staging;
- celular/tablet;
- billing, backup e rollback.

## Regras de continuidade

- não ampliar além de `drive.file` no MVP;
- não persistir tokens no navegador ou em tabelas expostas;
- não remover originais do Supabase antes de confirmação e rollback do Drive;
- não usar nome/caminho como identidade;
- não apagar OCR/metadados quando o arquivo desaparece;
- não avançar page token antes da persistência completa;
- não deixar um conflito bloquear a fila inteira;
- não ativar billing ou fallback pago;
- manter commits pequenos e atribuir `PASS` somente ao SHA realmente validado.
