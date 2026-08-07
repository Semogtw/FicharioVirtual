# Estado atual do Fichário Virtual

_Atualizado: 2026-08-07_  
_Branch ativa: `main`_  
_Estado: Drive-first, OCR seletivo por lotes e importação de PDFs grandes por ranges implementados e validados no CI; release ainda depende de staging externo, serviços reais e dispositivos reais._

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
- verificação da identidade física da cópia no Drive antes da primeira leitura por range;
- finalização atômica de documento, páginas e jobs OCR;
- validação estrita dos descritores antes de qualquer mutação;
- retomada após reload sem reabrir Picker ou copiar novamente;
- recuperação quando o finalizador efetivamente commitou mas a resposta foi perdida;
- cleanup fail-closed: derivados só são removidos após falha quando o banco confirma que a referência ainda está finalizável;
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
- migrations, pgTAP, contratos TypeScript, testes unitários e gates Deno.

A existência do código não substitui validação com uma conta Google real. OAuth, Picker, ranges, uploads, mudanças, conflitos e migração ainda precisam ser executados no ambiente final.

## Estado de validação

### Recibo completo de CI

O workflow `Validate current head` no SHA `50897346272269642d95d75aa249f6a96b9479f6` terminou com **success** em 2026-08-07.

No mesmo SHA passaram:

- Prettier e ESLint;
- `svelte-check` com 0 erros e 0 warnings;
- 212 arquivos de testes unitários, totalizando 834 testes;
- build de produção;
- gates offline/source;
- instalação do Chromium e E2E;
- type-check das Edge Functions com Deno;
- Supabase CLI e gates locais de banco/pgTAP.

Esse recibo valida o código naquele SHA. Commits posteriores precisam de um novo recibo completo antes de uma afirmação de release pronta.

### Gates obrigatórios

```bash
pnpm format:check
pnpm check
pnpm lint
pnpm test:unit
pnpm check:edge
pnpm check:offline
pnpm test:db
pnpm build
pnpm test:e2e
```

## Pendências reais

### Staging e serviços externos

Ainda são obrigatórios antes de release:

- aplicar migrations em um projeto Supabase limpo/staging e verificar drift;
- regenerar os tipos TypeScript a partir do schema efetivamente implantado;
- executar OAuth e Google Drive com conta real;
- executar smoke Gemini real e lote multipágina;
- testar PDFs grandes reais, incluindo arquivos acima de 50 MiB e documentos extensos;
- validar hash/identidade do original antes/depois;
- testar cancelamento/retomada em computador, tablet e celular;
- validar Cloudflare Pages e headers no domínio final;
- confirmar administrativamente ausência de billing/fallback pago.

### Janela copy → stage de PDF grande

O fluxo já remove a cópia do Drive quando o RPC de staging retorna erro. Resta uma janela impossível de capturar com `try/catch`: o navegador pode morrer depois de `files.copy` e antes de `stage_drive_pdf_reference`. Nesse caso a cópia pode ficar órfã no Drive sem registro correspondente no banco.

A próxima camada de resiliência deve identificar cópias gerenciadas pelo app de forma privada e reconciliá-las com o banco sem ampliar o escopo além de `drive.file`. `appProperties` do Drive é uma candidata apropriada porque pode ser gravada no recurso copiado e pesquisada posteriormente pelo mesmo app.

### Worker desktop

A arquitetura está documentada, mas o worker local ainda não foi implementado. Permanecem pendentes pareamento, credenciais por dispositivo, claim, lease, heartbeat, spool, backend CPU, modelos verificados, serviço systemd e benchmark da GPU local.

## Pendências imediatas

1. manter CI completo verde nos novos SHAs;
2. fechar a janela crash entre cópia Drive e staging de PDF grande;
3. aplicar e validar o schema em Supabase staging limpo;
4. regenerar tipos pelo schema real;
5. executar staging Google Drive + Gemini;
6. validar PDFs grandes reais e dispositivos móveis/tablet;
7. implantar e verificar Cloudflare;
8. implementar o worker desktop em etapa separada.

## Regras de continuidade

- não reinserir teto diário interno;
- não apresentar contador local como quota restante;
- não comprimir nem substituir o original;
- não repetir páginas já aceitas;
- não apagar temporário necessário para retry;
- não ampliar além de `drive.file` no MVP;
- não persistir access/refresh tokens no navegador;
- não colocar conteúdo privado na Cloudflare;
- não ativar R2, billing ou fallback pago automaticamente;
- não conceder push automático a workflows temporários;
- não declarar release pronta sem gates, staging e dispositivos no mesmo SHA.
