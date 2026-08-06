# Estado atual do Fichário Virtual

_Atualizado: 2026-08-06_  
_Branch ativa: `main`_  
_Estado: integração Google Drive obrigatória em implementação; Cloudflare Pages, OCR desktop e processamento automático de PDFs grandes aprovados, mas ainda não implementados; release bloqueada._

## Resumo executivo

O Fichário Virtual já possui uma PWA SvelteKit avançada para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo, pesquisar, revisar e exportar metadados.

A arquitetura canônica agora possui quatro autoridades ou superfícies distintas:

- **Google Drive:** armazenamento permanente dos originais;
- **Supabase:** Auth, PostgreSQL, RLS, filas, resultados, busca, sincronização e artefatos temporários;
- **Cloudflare Pages:** host estático e artefatos públicos de modelos, sem dados privados;
- **computador confiável:** processamento opcional de manuscritos e páginas difíceis por um worker local.

Gemini continua sendo o mecanismo de OCR geral e imediato. A arquitetura aprovada permite que páginas manuscritas, mistas ou incertas aguardem o computador e sejam processadas por um modelo local mais pesado. O worker consulta a fila por HTTPS de saída; não existe push direto do navegador, porta pública ou Cloudflare Tunnel.

PDFs maiores que o limite de uma única chamada continuam sendo um único documento lógico no Drive. O aplicativo deverá inspecionar, dividir e, quando seguro, comprimir somente cópias temporárias, preservando numeração original e reunindo os resultados por página.

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

Essas capacidades permanecem válidas, mas algumas rotas de importação ainda gravam o original no Supabase e precisam ser migradas para Drive. O OCR atual ainda está acoplado ao Gemini, mantém um único resultado efetivo por página, processa uma página por chamada, exige limite diário interno e restringe PDFs a 20 MB no fluxo existente.

## Trabalho Drive incorporado

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
- ciclos ou repetição de tokens são rejeitados.

### Banco de dados

As migrations novas adicionam:

- `drive_connections`;
- hierarquia `parent_notebook_id`;
- `drive_folder_id` em cadernos;
- `drive_file_id` e estado físico em documentos;
- `storage_path` opcional para temporário ou fallback;
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

## Decisão Cloudflare e OCR desktop incorporada

A decisão está documentada em:

- `docs/superpowers/specs/2026-08-06-cloudflare-pages-and-desktop-ocr-design.md`;
- `docs/CLOUDFLARE_SETUP.md`;
- `docs/DESKTOP_OCR_WORKER.md`.

### Cloudflare

- Cloudflare Pages é o host estático preferencial;
- o projeto continua usando `@sveltejs/adapter-static` e output `build/`;
- um segundo projeto Pages por Direct Upload pode distribuir modelos fragmentados em partes de até 20 MiB;
- nenhum documento privado, resultado, token ou secret passa pela Cloudflare;
- R2 é opcional e não integra o MVP por padrão, pois envolve assinatura e cobrança por uso;
- o tablet não baixa modelos do worker ao instalar ou abrir a PWA.

### OCR híbrido

- texto nativo continua tendo prioridade e não chama OCR;
- cadernos e páginas poderão declarar `automatic`, `printed`, `handwritten` ou `mixed`;
- Gemini processa conteúdo geral e pode classificar o tipo na mesma resposta;
- caderno explicitamente manuscrito pula Gemini por padrão;
- manuscrito, conteúdo misto, classificação desconhecida ou baixa qualidade entram na fila desktop;
- resultados Gemini e desktop serão preservados separadamente;
- correção manual permanece a autoridade final.

### Worker local

- opera como serviço systemd do usuário no CachyOS;
- inicia apenas conexões HTTPS de saída;
- usa pareamento de uso único e credencial de dispositivo revogável;
- nunca recebe `service_role`, chave Gemini ou refresh token do Drive;
- reivindica um trabalho com lease e heartbeat;
- baixa página temporária privada por URL curta;
- valida SHA-256 da origem;
- envia texto, avisos, modelo, versão e hash;
- guarda spool local de resultados ainda não transmitidos;
- usa CPU como fallback obrigatório;
- trata Vulkan como candidato e ROCm na RX 6600 como experimental até benchmark.

## Decisão de PDFs grandes incorporada

A decisão está documentada em:

- `docs/superpowers/specs/2026-08-06-oversized-pdf-splitting-and-compression-design.md`;
- `docs/superpowers/specs/2026-08-06-provider-only-ocr-quota-and-adaptive-batching-design.md`.

### Limites e documento lógico

Na verificação de 6 de agosto de 2026, a Gemini informava limite de 50 MB ou 1.000 páginas por PDF enviado. Esse limite pertence ao artefato de uma chamada, não ao PDF original da biblioteca.

- original permanece único e intacto no Drive;
- o usuário não divide o arquivo manualmente;
- texto nativo é extraído antes de qualquer OCR;
- somente páginas necessárias formam lotes temporários;
- lotes iniciais densos ficam em torno de 20 a 40 páginas;
- Files API não remove o limite por PDF;
- o limite de saída pode exigir lotes menores mesmo quando o arquivo cabe na entrada.

### Divisão e compressão

- divisão automática é a estratégia principal;
- compressão é secundária, conservadora e aplicada somente a derivados temporários;
- cores semanticamente relevantes, fórmulas e detalhes de manuscrito devem ser preservados;
- cada lote registra páginas originais, hashes, transformação, rota e tentativa;
- resposta precisa associar texto ao `page_id`, não apenas à posição;
- truncamento, omissão, duplicação ou timeout relacionado ao tamanho causa bisseção do lote afetado;
- páginas já concluídas não são reprocessadas;
- Gemini e desktop podem processar partes diferentes do mesmo documento;
- temporários são limpos somente após persistência segura.

## Pendências imediatas de código

### Google Drive

1. tornar o novo head integralmente verde no workflow;
2. gerar os tipos TypeScript do schema Drive;
3. criar serviço Supabase para ler a conexão e acionar sync;
4. integrar cartão Drive à tela de Configurações;
5. implementar Edge Functions de OAuth;
6. implementar cliente Drive backend/browser com token efêmero;
7. criar ou reconectar a raiz e pastas de cadernos;
8. implementar upload retomável e Picker;
9. conectar filas de imagens e PDFs ao Drive;
10. implementar gateway real do feed e runner de jobs;
11. criar UI de ausentes e conflitos;
12. migrar originais existentes com rollback.

### Cloudflare

1. configurar Pages com integração Git e output `build/`;
2. validar `_headers`, fallback `200.html`, PWA e origem canônica;
3. atualizar `APP_ORIGIN`, Supabase Auth, CORS e referências externas;
4. criar projeto Pages Direct Upload para modelos;
5. implementar empacotamento fragmentado, manifestos, licenças e checksums;
6. validar rollback do frontend e de versões recomendadas de modelos.

### OCR desktop

1. separar múltiplos resultados OCR por mecanismo;
2. adicionar tipo de conteúdo e política de roteamento;
3. criar tabelas de dispositivo, pareamento, eventos e leases;
4. criar Edge Functions exclusivas do worker;
5. adaptar limpeza de páginas temporárias para aguardar todas as rotas;
6. implementar worker CPU-first e serviço systemd do usuário;
7. implementar cache de modelos, checksums e spool local;
8. integrar UI de dispositivos, fila e overrides;
9. testar classificação Gemini sem chamada extra;
10. executar benchmark de modelos com páginas reais e RX 6600.

### PDFs grandes e lotes adaptativos

1. remover teto diário interno e separar telemetria de bloqueio;
2. remover o teto de 20 MB como limite arquitetural do documento lógico;
3. distinguir limite de importação, limite de processamento e limite do provedor;
4. criar manifesto persistente de páginas e lotes;
5. implementar extração de subconjuntos de páginas;
6. implementar compressão temporária versionada e conservadora;
7. criar planejador adaptativo para Gemini e desktop;
8. implementar bisseção automática de lote problemático;
9. validar correspondência exata de páginas em respostas estruturadas;
10. adaptar progresso, retomada, limpeza e painel;
11. criar fixtures sintéticas acima de 50 MB e de 1.000 páginas;
12. testar que hash e bytes do original permanecem inalterados.

## Pendências externas

- Google Cloud e Drive API;
- tela de consentimento;
- cliente OAuth Web e redirect URI;
- secrets no Supabase;
- migrations novas aplicadas ao staging;
- OAuth real, upload e feed validados;
- conta e domínio Cloudflare;
- projeto Pages da PWA;
- projeto Pages dos modelos;
- origem HTTPS e `APP_ORIGIN` final;
- contas de teste Supabase;
- OCR staging;
- instalação e pareamento do worker no CachyOS;
- benchmark em CPU, Vulkan e RX 6600;
- validação de PDFs grandes no tablet e no computador;
- verificação dos limites oficiais de PDF, entrada e saída na data do deployment;
- celular e tablet;
- billing, backup e rollback.

## Regras de continuidade

- não ampliar além de `drive.file` no MVP;
- não persistir tokens no navegador ou em tabelas expostas;
- não remover originais do Supabase antes de confirmação e rollback do Drive;
- não usar nome ou caminho como identidade;
- não apagar OCR e metadados quando o arquivo desaparece;
- não avançar page token antes da persistência completa;
- não deixar um conflito bloquear a fila inteira;
- não colocar conteúdo privado na Cloudflare;
- não obrigar o tablet a baixar modelos do computador;
- não expor porta doméstica para o worker;
- não tratar ROCm na RX 6600 como suportado sem evidência;
- não ativar R2, billing ou fallback pago automaticamente;
- manter resultados de mecanismos diferentes separados;
- não alterar ou recomprimir o PDF original no Drive;
- não tratar 50 MB ou 1.000 páginas como limite do documento lógico;
- não marcar lote com página omitida, duplicada ou truncada como concluído;
- não reiniciar o documento inteiro por falha de um lote;
- manter commits pequenos e atribuir `PASS` somente ao SHA realmente validado.
