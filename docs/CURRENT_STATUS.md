# Estado atual do Fichário Virtual

_Atualizado: 2026-08-17_<br>
_Branch ativa: `main`_<br>
_Estado: Drive-first e OCR seletivo por lotes seguem integrados. A auditoria autenticada reproduziu e corrigiu a perda de recall semântico causada por uma trava lexical ampla, alinhou os verificadores reais aos contratos atuais da interface e tornou suas dependências reproduzíveis no projeto. Os gates locais estão verdes; o runtime publicado precisa concluir o próximo deploy para receber essa correção. Os gates externos de Drive OAuth, worker desktop, provedor real e dispositivos físicos continuam pendentes. O relatório completo está em [docs/reports/2026-08-17-authenticated-site-audit.md](reports/2026-08-17-authenticated-site-audit.md)._

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

A correção agora mantém recall para consultas em linguagem natural, restringe somente tokens opacos de identificador quando há evidência lexical forte e eleva o piso de candidatos semânticos isolados para `0.72`, acima do máximo negativo observado no corpus de staging (`0.7108`). O verificador aceita a posição semântica no top 3 quando o corpus compartilhado já contém uma fonte relevante, mas mantém Recall@1 para marcadores opacos exatos e exige taxa de falso positivo negativa zero. Os testes de URL visual passaram a validar o helper de apresentação, e os verificadores autenticados usam os textos atuais da fila e da rota de leitura. `pdf-lib` e `playwright` também passaram a ser dependências de desenvolvimento declaradas, removendo a necessidade de instalação ad hoc para executar os scripts locais.

Validação local desta correção: `pnpm verify` passou com 324 arquivos e 1.387 testes; `pnpm test:e2e` passou com 8/8; gates source/offline e benchmark visual-semântico passaram. A validação autenticada contra o domínio publicado antes do deploy desta correção ainda reproduz a falha semântica no runtime antigo; ela deve ser repetida após o deploy do novo commit.

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
- executar smoke Gemini real e lote multipágina;
- testar PDFs grandes reais, incluindo arquivos acima de 50 MiB, documentos extensos e páginas com muito texto nativo;
- validar expiração/takeover do lease em duas sessões reais e confirmar que uma tentativa stale nunca remove nem sobrescreve derivados da nova proprietária;
- validar hash/identidade do original antes/depois;
- testar cancelamento/retomada em computador, tablet e celular;
- validar Cloudflare Pages e headers no domínio final;
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

1. executar o fluxo OCR normal em staging com página/job e persistência, além da sonda sintética já aprovada;
2. executar OAuth e Google Drive com conta real, incluindo crash/recovery, ranges e duas sessões concorrentes;
3. regenerar `src/lib/types/database.ts` pelo schema efetivamente implantado;
4. validar PDFs grandes reais e dispositivos móveis/tablet;
5. implantar e verificar Cloudflare Pages e headers no domínio final;
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
