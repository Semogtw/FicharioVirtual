# Estado atual do Fichário Virtual

_Atualizado: 2026-08-09_<br>
_Branch ativa: `main`_<br>
_Estado: Drive-first, OCR seletivo por lotes, importação de PDFs grandes por ranges, recuperação distribuída da cópia, lease renovável de publicação e a fronteira backend do worker estão integrados em código. O HEAD atual é `86dd393`; o último CI completo conhecido é do SHA `b39e3eb` (run `31296404993`). No HEAD atual, check/lint, 940/940 testes e source/offline passaram; Deno está ausente localmente, E2E permanece `BLOCKED` sem Chromium e OCR não foi aprovado. Release ainda depende de staging externo, serviços reais e dispositivos reais._

## Resumo executivo

O Fichário Virtual é uma PWA privada para organizar imagens e PDFs, preservar originais no Google Drive, extrair texto nativo, executar OCR seletivo, pesquisar, revisar e exportar metadados.

As autoridades permanecem separadas:

- **Google Drive:** armazenamento permanente dos originais;
- **Supabase:** Auth, PostgreSQL, RLS, filas, resultados, sincronização e derivados temporários;
- **Cloudflare Pages:** frontend estático e artefatos públicos, sem documentos privados;
- **computador confiável:** futura rota local para manuscritos e páginas difíceis.

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

## Estado de validação

### Último recibo completo de CI conhecido

O workflow [`Validate current head`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31296404993) no SHA `b39e3eb55caec06a4cd40aa20833634c32a463d3` terminou com **success** em 2026-08-09.

No mesmo SHA passaram:

- Prettier e ESLint;
- `svelte-check` com 0 erros e 0 warnings;
- 236 arquivos de testes unitários, totalizando 938 testes;
- build de produção;
- gates offline/source;
- instalação do Chromium e E2E: 4 testes passaram; 1 teste foi flaky na primeira tentativa e passou no retry;
- type-check das Edge Functions com Deno;
- Supabase CLI e gates locais de banco/pgTAP: 35 arquivos e 434 testes.

Esse recibo valida somente o SHA indicado. O resultado verde não prova deploy Supabase, OAuth Google, interoperabilidade Drive/Gemini, host publicado, billing ou dispositivos físicos. O E2E deve ser tratado como verde com ressalva até a flakiness ser entendida.

### Validação incremental do HEAD `86dd393`

- `pnpm check`: **PASS**, 0 erros e 0 avisos; `pnpm lint`: **PASS**.
- Vitest: **PASS**, 940 testes em 236 arquivos.
- Build/PWA: **PASS**, 131 entradas precache; permanece o aviso de chunks acima de 500 kB.
- Gates source/offline: **PASS**.
- E2E: **BLOCKED** porque Chromium não está disponível; não converter esse bloqueio em falha funcional do produto.
- Deno: **NOT RUN/BLOCKED** localmente porque o executável não está instalado; o resultado não substitui o gate remoto.
- A sonda temporária de fronteira Gemini foi removida neste HEAD, incluindo seu workflow e rota; nenhuma chamada Gemini foi feita.
- O deploy de staging `31299646430` terminou com sucesso e registra `process-ocr` `ACTIVE v11`; isso não é evidência de OCR completo.
- O Verify OCR staging permanece **PENDING/UNKNOWN**, sem evidência de jobs, artifact ou conclusão terminal consultável. Não declarar OCR aprovado.
- O diagnóstico Gemini direto está **BLOCKED**: o environment staging não possui `STAGING_SERVICE_ROLE_KEY` nem equivalente. Os nomes públicos confirmados são `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, `STAGING_AUTHORIZED_EMAIL` e `STAGING_AUTHORIZED_PASSWORD`; nenhum valor foi exposto.
- A instrumentação sanitizada, quando existente, permite somente códigos Gemini de allowlist e corpo limitado a 4 KiB, sem corpo/headers completos, modelo ou tokens em logs/artifacts.
- Google Drive real, Cloudflare publicado e worker desktop local permanecem **NOT RUN/BLOCKED**.

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

`pnpm verify` cobre lint, check, unit tests e build; `pnpm verify:full` acrescenta E2E, source/offline, Edge Functions e banco local.

### Limitação do ambiente local atual

Os gates executáveis do HEAD `86dd393` registram check 0/0, lint, 940/940 testes, build/PWA com 131 entradas e source/offline `PASS`. Deno está ausente localmente (`NOT RUN/BLOCKED`) e E2E está `BLOCKED` sem Chromium. O Verify OCR continua `PENDING/UNKNOWN`, sem evidência terminal; não se deve converter esse estado em `PASS`. A sonda Gemini temporária foi limpa e nenhuma chamada ao provedor foi feita.

## Pendências reais

### Staging e serviços externos

No SHA anterior `b39e3eb`, `Deploy Supabase staging` (`31296564374`) e `Verify Supabase staging` (`31296568886`) terminaram com sucesso; `Verify OCR staging` (`31296573162`) falhou e não aprovou OCR. No HEAD `86dd393`, o deploy `31299646430` registra `process-ocr` `ACTIVE v11`; o Verify OCR permanece `PENDING/UNKNOWN`, sem evidência terminal e sem aprovação.

Ainda são obrigatórios antes de release:

- aplicar todas as migrations, inclusive o lease de descritores, em um projeto Supabase limpo/staging e verificar drift;
- executar pgTAP completo, incluindo ownership, takeover, idempotência e privilégios do lease;
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

`src/lib/types/database.ts` continua sendo um espelho provisório por decisão já documentada no próprio arquivo. As novas RPCs são usadas por uma interface estrutural local para não fingir que os tipos foram regenerados. O contrato canônico deve ser regenerado somente a partir do schema limpo realmente aplicado, dentro do gate Supabase.

### Worker desktop

A fronteira backend está implementada em código: pareamento, credencial por dispositivo, claim/source/renew/complete e proteção por lease possuem contratos, migrations, testes e Edge Functions. O worker local ainda não foi implementado. Permanecem pendentes spool, backend CPU, modelos verificados, serviço systemd, UI de dispositivos, retomada local e benchmark da GPU.

## Pendências imediatas

1. obter execução, jobs, artifact e conclusão terminal do Verify OCR staging, sem tratar ausência de evidência como aprovação;
2. investigar a flakiness E2E e repetir o gate se a política de release exigir execução sem retry;
3. aplicar e validar o schema/runtime do HEAD atual em Supabase staging limpo, incluindo os pgTAPs de OCR/lease;
4. regenerar tipos pelo schema real aplicado;
5. configurar, com autorização, o segredo de serviço ausente e executar staging Google Drive + Gemini, incluindo crash/recovery e duas sessões concorrentes; nenhuma chamada Gemini foi feita neste HEAD;
6. validar PDFs grandes reais e dispositivos móveis/tablet;
7. implantar e verificar Cloudflare;
8. implementar o worker desktop em etapa separada.

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
