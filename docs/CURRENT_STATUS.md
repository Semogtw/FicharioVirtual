# Estado atual do Fichário Virtual

_Atualizado: 2026-08-18_<br>
_Branch ativa: `main`_<br>
_Estado: Drive-first e OCR seletivo por lotes seguem integrados. A auditoria autenticada corrigiu o recall e a precisão semântica, a marcação visual, o aceite assíncrono falso e os verificadores de estado terminal. A calibração real elevou o circuit breaker do Gemini para 190 RPD por modelo e reabriu jobs que ainda carregavam o agendamento obsoleto do limite anterior de 15 RPD. Um PDF manuscrito real de cinco páginas comprovou OCR persistido em todas as páginas, com revisão necessária e sem jobs pendentes. O fluxo de retomada no navegador também foi corrigido para não transformar páginas sem metadados de tamanho em um lote artificial que pode expirar; batching permanece disponível somente quando o caller fornece metadados e controle explícitos. O frontend foi publicado no domínio Pages e os gates locais e remotos de validação, deploy Supabase, busca semântica, fluxos reais, importação escaneada e ranking visual adaptativo passaram no SHA `e89a870`; os workflows reais também evitam a instalação de pacotes do sistema que havia travado a etapa de Chromium. Os gates externos de Drive OAuth, worker desktop e dispositivos físicos continuam pendentes. O relatório completo está em
[docs/reports/2026-08-17-authenticated-site-audit.md](reports/2026-08-17-authenticated-site-audit.md)._

## Resumo executivo

O Fichário Virtual é uma PWA privada para organizar imagens e PDFs, preservar originais no Google Drive, extrair texto nativo, executar OCR seletivo, pesquisar, revisar e exportar metadados.

As autoridades permanecem separadas:

- **Google Drive:** armazenamento permanente dos originais;
- **Supabase:** Auth, PostgreSQL, RLS, filas, resultados, sincronização e derivados temporários;
- **Cloudflare Pages:** frontend estático e artefatos públicos, sem documentos privados;
- **computador confiável:** rota local outbound-only para OCR difícil, implementada em código e ainda pendente de validação operacional no hardware alvo.

O aplicativo não possui franquia diária própria de OCR. `blocked_quota` só representa uma resposta real de quota do provedor.

## Implementado em código

### Produto, segurança e interface

- conta única com allowlist fail-closed;
- interface responsiva para desktop, tablet e celular;
- biblioteca, cadernos, tags, busca, revisão e exportação;
- RLS e Storage privado;
- PWA sem cache de conteúdo autenticado;
- URLs assinadas curtas;
- Edge Functions com política JWT explícita;
- CORS fail-closed compartilhado;
- OAuth Google com `state` de uso único, PKCE e refresh token privado no backend;
- workflows sem capacidade automática de push;
- scanner de secrets e gates de segurança;
- componentes visuais compartilhados e melhorias retroativas de acessibilidade.

### Importação e PDFs

- importação cancelável e retomável de imagens e PDFs locais;
- preparação local, miniaturas, SHA-256 e deduplicação;
- texto nativo preservado sem OCR;
- PDF misto envia somente páginas que realmente precisam de OCR;
- upload retomável do original diretamente ao Drive;
- original nunca é recomprimido nem substituído;
- Google Picker explícito;
- download direto pelo navegador limitado a 50 MiB apenas como limite técnico desse caminho;
- arquivos PDF maiores que 50 MiB selecionados no Picker seguem por referência durável no Drive, sem download integral;
- leitura remota estrita por `Range` com validação de `206`, `Content-Range`, comprimento e tamanho final;
- PDF.js com `PDFDataRangeTransport`, streaming/prefetch desabilitados e lifecycle explícito do loading task;
- lease de access token efêmero em memória para evitar renovar token a cada range;
- inspeção sequencial por página com extração de texto nativo;
- renderização somente das páginas que precisam de OCR;
- derivado preferencial WebP com fallback JPEG;
- segunda renderização conservadora quando um derivado ultrapassa 12 MiB;
- rejeição final de derivado acima de 12 MiB;
- staging persistente de referências grandes;
- marcação privada da cópia gerenciada via `appProperties` e reconciliação distribuída para recuperar a janela em que o navegador morre depois de `files.copy` e antes do staging no banco;
- verificação da identidade física da cópia no Drive antes da primeira leitura por range;
- plano de páginas convertido em descritores paginados persistentes, sem enviar o documento lógico inteiro em um único RPC;
- lotes de descritores limitados simultaneamente por quantidade e por bytes; o cliente usa margem de 3 MiB e o banco rejeita JSONB acima de 4 MiB;
- lease renovável por tentativa para impedir dois navegadores de publicar ou limpar o mesmo PDF grande ao mesmo tempo;
- renovação forte do lease imediatamente antes de cada upload de derivado, além de renovações preventivas durante trabalho longo;
- takeover de lease expirado limpa somente o staging pertencente à tentativa anterior;
- abandono retorna ownership explícito; derivados só são removidos quando a tentativa falha e o banco confirma que ela ainda era a proprietária do lease;
- RPCs legados capazes de contornar o lease de publicação foram removidos da superfície `authenticated`;
- finalização atômica de documento, páginas e jobs OCR;
- validação estrita dos descritores antes de qualquer mutação;
- retomada após reload sem reabrir Picker ou copiar novamente;
- recuperação quando o finalizador efetivamente commitou mas a resposta foi perdida;
- upload idempotente dos derivados temporários;
- progresso por fase e por página;
- `AbortController` na UI para parar processamento ativo sem confundir isso com a ação destrutiva de excluir a cópia;
- exclusão Drive-first remove o original controlado antes de remover metadados locais.

O `supabase/config.toml` ainda mantém `file_size_limit = "20MiB"` no ambiente local. A migration de compatibilidade eleva o bucket remoto `documents` para pelo menos 50 MiB, mas no fluxo Drive-first normal o original não permanece no Supabase. Esses valores não são limites arquiteturais do documento lógico.

### OCR por lotes e quota real

A implementação inclui:

- `ocr_batches` com páginas, números originais, rota, bytes, modelo, tentativas e chamadas;
- vínculo ordenado e imutável em `ocr_jobs`;
- métricas de páginas, lotes, chamadas e tentativas;
- RLS e escrita de manifestos somente por contratos validados;
- registro atômico somente quando todas as páginas possuem jobs vinculáveis;
- validação ordinal dos pares `pageId` e número original;
- referências históricas protegidas com `ON DELETE RESTRICT`;
- recuperação de jobs/páginas/lotes interrompidos;
- transições terminais idempotentes;
- planejamento adaptativo de páginas e bytes;
- uma chamada Gemini para múltiplas imagens;
- persistência independente de páginas válidas;
- omissões, duplicações e respostas truncadas convertidas em divisão seletiva;
- distinção entre rate limit temporário e quota diária real;
- retomada após reload;
- limpeza do derivado temporário após OCR terminal bem-sucedido, preservando-o quando uma nova tentativa ainda é necessária.
- retomada foreground sem metadados de tamanho usa páginas individuais, com no máximo duas requisições concorrentes; batching explícito continua disponível para ingestões que possuem planejamento de bytes confiável;
- jobs diferidos pelo antigo guard de 15 RPD são despertados pela migration `20260818022127_reopen_ocr_jobs_after_rpd_raise` após a elevação para 190 RPD.

### Google Drive-first

Já estão implementados:

- OAuth start/callback e refresh token privado;
- access token efêmero;
- escopo `drive.file`;
- pasta raiz `Fichário Digital` e pastas aninhadas;
- upload retomável;
- Google Picker;
- feed paginado de mudanças;
- checkpoint somente depois da persistência;
- identidade por IDs e metadados remotos;
- ausência/reconexão sem perda de OCR;
- fila idempotente, lease, retry e conflitos;
- criação, atualização, movimento e exclusão;
- telas de conexão, jobs, conflitos e migração;
- migração de originais legados com rollback;
- cópia controlada e importação por ranges de PDFs grandes;
- reconciliação de cópias gerenciadas após crash sem ampliar o escopo além de `drive.file`;
- migrations, pgTAP, contratos TypeScript, testes unitários e gates Deno.

A existência do código não substitui validação com uma conta Google real. OAuth, Picker, ranges, uploads, mudanças, conflitos, recuperação distribuída e migração ainda precisam ser executados no ambiente final.

### Desktop OCR local

A rota desktop já deixou de ser apenas arquitetura e possui implementação local integrada ao plano de controle remoto:

- dispositivos com credencial própria, autenticação por digest e revogação;
- claim/source/renew/complete protegidos por lease e conclusão idempotente;
- configuração local fail-closed e diretórios XDG privados;
- SQLite de spool transacional, dead letter e reenvio antes de buscar trabalho novo;
- download HTTPS de fonte com MIME, tamanho e SHA-256 vinculados ao lease;
- renovação de lease durante inferências longas;
- polling/backoff e shutdown por sinal;
- credencial no Secret Service via `secret-tool`, sem `.env`, argv ou unit file;
- lock imutável de modelo e verificação de digest;
- backend `OllamaOcrEngine` restrito a loopback e modelo de visão já presente localmente;
- instalador de desenvolvimento e unidade `systemd --user` sem root;
- comandos de configuração, modelo, pareamento, status e despareamento;
- tela **Configurações > Computadores** para listar, atualizar, revogar e renomear dispositivos ativos;
- RPC de rename user-scoped, com validação de owner/status/label e testes unitários + pgTAP versionados.

O estado local `readyToRun` não é selo de benchmark. Ainda não existe modelo padrão aprovado nem backend CPU/Vulkan/ROCm declarado validado em hardware real.

## Estado de validação

### Correção da auditoria autenticada de 2026-08-17

O fluxo real de busca foi exercitado com login, importação de PDF sintético, indexação Gemini, consultas exata, semântica e negativas, seguido de limpeza dos documentos criados. A regressão encontrada era de política: uma frase exata em qualquer documento ativava uma restrição lexical global e escondia o documento semanticamente relevante; consultas negativas também mostravam candidatos abaixo do limite de confiança.

A correção agora mantém recall para consultas em linguagem natural, restringe somente tokens opacos de identificador quando há evidência lexical forte e eleva o piso de candidatos semânticos isolados para `0.72`, acima do máximo negativo observado no corpus de staging (`0.7108`). O verificador aceita a posição semântica no top 3 quando o corpus compartilhado já contém uma fonte relevante, mas mantém Recall@1 para marcadores opacos exatos e exige taxa de falso positivo negativa zero. O cleanup visual também descobre documentos criados antes da persistência do estado do teste e confirma que nenhum documento ainda referencia o caderno antes de removê-lo. Os testes de URL visual passaram a validar o helper de apresentação, e os verificadores autenticados usam os textos atuais da fila e da rota de leitura. `pdf-lib` e `playwright` também passaram a ser dependências de desenvolvimento declaradas, removendo a necessidade de instalação ad hoc para executar os scripts locais.

Validação local do checkpoint `e89a870`: `pnpm test` passou com 327 arquivos e 1.409 testes; `pnpm lint`, `pnpm check`, `pnpm build`, `pnpm test:e2e`, gates source/offline, Edge Functions e banco local + pgTAP passaram. A sonda pessoal autenticada contra o domínio publicado importou um PDF manuscrito real de cinco páginas, aguardou OCR persistido em todas as páginas e confirmou a limpeza do documento de teste. A busca semântica oficial passou com positivo relevante e negativo sem falsos positivos. Os workflows remotos [`32095431312`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32095431312), [`32095971846`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32095971846), [`32095971867`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32095971867) e [`32096263350`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32096263350) terminaram com **success**, incluindo fluxos reais, PDF escaneado, busca e ranking visual adaptativo.

### Checkpoint OCR corrigido

O workflow [`Validate current head`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333367357) no SHA `f87e1edc47268b4e0d2ea0742dac690c96d93646` terminou com **success** em 2026-08-09. No mesmo SHA passaram frontend/`pnpm verify`, gates source/offline, Chromium E2E, Deno/Edge Functions e Supabase local + pgTAP.

O deploy [`31333367356`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333367356) do mesmo SHA terminou com **success**. A sonda protegida [`31333418948`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333418948) também terminou com **success**: validou `STAGING_SERVICE_ROLE_KEY` como não vazio sem expor seu valor, rejeitou a chamada anônima com HTTP 401 e registrou somente o envelope sanitizado:

```json
{
	"direct": {
		"httpStatus": 429,
		"category": "provider",
		"code": "gemini_daily_quota",
		"success": false
	},
	"process": { "httpStatus": 200, "category": "provider", "code": "provider_ok", "success": true }
}
```

A sequência anterior de sondas mostrou que `responseFormat` e os campos de schema enviados em `generationConfig` eram rejeitados pelo endpoint/modelo real com HTTP 400. O cliente de produção agora envia `responseMimeType: application/json` sem schema de provedor, mantém o contrato JSON explícito no prompt e preserva os parsers locais fail-closed. O `process-ocr` da sonda recebeu e validou uma resposta Gemini real com HTTP 200; a tentativa direta separada atingiu quota do provedor e não foi convertida em sucesso.

### Diagnóstico do fallback OCR em 2026-08-17

A sonda protegida [`32078967959`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32078967959) criou o documento sintético, autenticou e chamou o `process-ocr`, mas terminou com o job pendente por `ocr_provider_rate_queue_full`. O relatório sanitizado registrou o modelo primário `gemini-3.1-flash-lite` e esse erro no limitador local; a ausência de uma segunda linha de telemetria não significava que o fallback não havia sido tentado: o evento primário só é escrito quando o roteador entra no fallback, e a falha final do segundo `reserveProviderSlot` não era registrada.

O checkpoint [`ce34d69`](https://github.com/Semogtw/FicharioVirtual/commit/ce34d69fd2134a4e17c09c9339a09d4bb1ae8db6) corrigiu essa observabilidade nos caminhos síncrono e worker: cada modelo agora registra sua própria falha, rota e código sanitizado. O deploy de staging [`32079625356`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32079625356) aplicou migrations e publicou as Edge Functions com sucesso. A confirmação posterior [`32080815025`](https://github.com/Semogtw/FicharioVirtual/actions/runs/32080815025) comprovou o roteamento: `gemini-3.1-flash-lite` falhou em `primary_gemini` e `gemini-3.5-flash-lite` falhou em `fallback_gemini_rate_limit`, ambos com `ocr_provider_rate_queue_full` e sem HTTP status. Isso resolve a classificação do fallback, não cria quota: os dois limitadores locais estão sem capacidade, portanto nenhuma chamada Gemini foi feita e o retry permanece agendado para o reset seguro.

### Calibração real de quota e PDF manuscrito em 2026-08-18

O teste autenticado com um PDF manuscrito real de cinco páginas separou dois
problemas que pareciam ser a mesma falha. Primeiro, os jobs criados sob o
limite antigo de 15 RPD continuavam com `next_retry_at` apontando para o reset
do Pacífico, mesmo depois de o guard ter sido elevado para 190 RPD. A migration
`20260818022127_reopen_ocr_jobs_after_rpd_raise` tornou esses jobs elegíveis
imediatamente; a retomada real os moveu de `retryable` para `processing`.

Depois, a telemetria mostrou uma única requisição primária com timeout de 90 s
para as cinco páginas. A causa estava no fluxo foreground: ao retomar, ele
inventava `derivedBytes = 1` e `density = normal`, fazendo o planner agrupar
todo o manuscrito em um lote sem possuir metadados confiáveis. O código agora
usa `processPageOcr` por página quando nenhum batching explícito é injetado,
limitando a concorrência a duas páginas e preservando o batching calibrado dos
demais caminhos. Na repetição posterior pelo worker, as cinco páginas foram
persistidas em estado `ready`, com revisão necessária e texto OCR não vazio.
Depois do deploy, a retomada manual com três páginas elegíveis produziu uma
chamada primária de 7,108 ms para essas três páginas, sem o timeout de 90 s.
Um segundo cenário controlado deixou geometria histórica artificial na página 2,
provocou a proteção correta `ocr_persistence_failed` e foi removido
integralmente; o documento de teste não ficou na conta e a consulta final
encontrou zero jobs ou páginas OCR ativos.

### Cleanup e runtime remoto

O cleanup [`31333977753`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333977753) terminou com **success**. Ele redeployou o runtime limpo e executou exclusivamente `supabase functions delete ocr-boundary-probe --project-ref ... --yes`. A consulta posterior ao projeto confirma `process-ocr` **ACTIVE v19** com JWT e ausência de `ocr-boundary-probe`; funções Drive/desktop não relacionadas permaneceram presentes.

O workflow administrativo foi restaurado no commit `9ff4975bc046004628635834bdedadce8bb5e264`: apenas `workflow_dispatch`, `cancel-in-progress: false`, sem comando temporário de exclusão. O deploy mantém `supabase db push --linked --dry-run --include-all` e `supabase db push --linked --include-all` para reconciliar migrations locais pendentes inclusive fora de ordem.

### Housekeeping final dos gates

Depois da remoção da instrumentação temporária, os testes estáticos foram alinhados ao lifecycle provider-only atual. O checkpoint `0f71737f9fb1c0bdf62b5d3eaf6b88e0b5c69a55` terminou com **success** no `Validate current head` `31340782404` e no `Validate documentation` `31340782422`. Esse checkpoint fecha a consistência do repositório após o cleanup; a evidência funcional completa com Chromium do fix OCR continua sendo `f87e1edc` / `31333367357`.

### Gates obrigatórios

```bash
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:e2e
pnpm test:source:offline
pnpm test:functions:check
pnpm test:db:local
```

`pnpm verify` cobre lint, check, unit tests e build; `pnpm verify:full` acrescenta E2E, source/offline, Edge Functions e banco local. Um gate cancelado por um push mais novo não deve ser contado como falha nem como PASS; o recibo terminal verde deve corresponder ao SHA citado.

## Pendências reais

### Staging e serviços externos

O defeito HTTP 400 da fronteira Gemini está resolvido no runtime de staging. O deploy de cleanup `31333977753` deixou `process-ocr` `ACTIVE v19` e removeu a função temporária. A sonda protegida comprovou o caminho provider + parser do `process-ocr` com HTTP 200 usando fixture sintética e sem persistência. Isso não substitui um fluxo normal de página/job com Storage e persistência real nem valida Google Drive ou Cloudflare.

Ainda são obrigatórios antes de release:

- aplicar todas as migrations, inclusive o lease de descritores e a gestão de dispositivos desktop, em um projeto Supabase limpo/staging e verificar drift;
- executar pgTAP completo, incluindo ownership, takeover, idempotência, privilégios do lease e gestão de dispositivos;
- regenerar `src/lib/types/database.ts` a partir do schema efetivamente implantado;
- executar OAuth e Google Drive com conta real;
- validar `appProperties` e a reconciliação de cópia após interrupção real do navegador;
- manter smoke Gemini real e lote multipágina no workflow pós-deploy;
- testar PDFs grandes reais, incluindo arquivos acima de 50 MiB, documentos extensos e páginas com muito texto nativo;
- validar expiração/takeover do lease em duas sessões reais e confirmar que uma tentativa stale nunca remove nem sobrescreve derivados da nova proprietária;
- validar hash/identidade do original antes/depois;
- testar cancelamento/retomada em computador, tablet e celular;
- repetir a verificação de Cloudflare Pages e headers a cada publicação relevante;
- confirmar administrativamente ausência de billing/fallback pago.

### Contratos gerados do banco

`src/lib/types/database.ts` continua sendo um espelho provisório por decisão já documentada no próprio arquivo. As RPCs desktop novas são usadas por interfaces estruturais locais para não fingir que os tipos foram regenerados. O contrato canônico deve ser regenerado somente a partir do schema limpo realmente aplicado, dentro do gate Supabase.

### Worker desktop

A fronteira backend e o runtime local estão implementados em código, incluindo pareamento CLI, credencial por dispositivo, Secret Service, claim/source/renew/complete, lease, spool, loop contínuo, lock de modelo, backend Ollama loopback, systemd user service, status/unpair e gestão web de dispositivos. As pendências reais são operacionais e de UX:

- substituir o bootstrap manual de access token do CLI por pareamento iniciado no worker e aprovado no site com código curto/uso único;
- exercitar o Secret Service real em uma sessão CachyOS;
- escolher e validar um modelo de visão com licença/proveniência adequadas;
- executar inferência real e benchmark CPU no hardware alvo;
- validar separadamente qualquer caminho Vulkan/ROCm pretendido, sem promovê-lo antes do benchmark;
- executar end-to-end contra staging com documento privado controlado;
- completar a UI da fila/estado de processamento desktop e o fluxo web de aprovação de pareamento;
- registrar memória, latência, estabilidade, temperatura e qualidade antes de declarar prontidão operacional.

## Pendências imediatas

1. manter o fluxo OCR normal em staging com página/job e persistência coberto pelo workflow real;
2. executar OAuth e Google Drive com conta real, incluindo crash/recovery, ranges e duas sessões concorrentes;
3. regenerar `src/lib/types/database.ts` pelo schema efetivamente implantado;
4. validar PDFs grandes reais e dispositivos móveis/tablet;
5. repetir a verificação de Cloudflare Pages e headers em novas publicações;
6. concluir o pareamento web do Desktop OCR Worker e depois validar runtime/modelo/hardware em staging + CachyOS real.

## Regras de continuidade

- não reinserir teto diário interno;
- não apresentar contador local como quota restante;
- não comprimir nem substituir o original;
- não repetir páginas já aceitas;
- não apagar temporário necessário para retry;
- não apagar derivados de uma tentativa quando ownership do lease estiver ausente ou ambígua;
- não ampliar além de `drive.file` no MVP;
- não persistir access/refresh tokens no navegador;
- não colocar conteúdo privado na Cloudflare;
- não ativar R2, billing ou fallback pago automaticamente;
- não conceder push automático a workflows temporários;
- não declarar release pronta sem gates, staging e dispositivos no mesmo SHA.
