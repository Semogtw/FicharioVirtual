# Estado atual do Fichário Virtual

_Atualizado: 2026-08-02_  
_Branch ativa: `main`_  
_Estado: desenvolvimento contínuo, sem deployment ou release_

## Resumo executivo

O repositório deixou a fase exclusivamente documental e já contém uma aplicação SvelteKit estática com Supabase, autenticação de usuário único, biblioteca privada, cadernos, importação de imagens e PDFs, OCR seletivo, busca textual, revisão, exportação portátil e PWA.

A política central permanece:

- dados privados por padrão;
- nenhum segredo no bundle do navegador;
- nenhuma cobrança ativada automaticamente;
- OCR somente após consentimento persistido;
- páginas de PDF com texto permanecem locais;
- páginas sem texto são renderizadas individualmente para OCR;
- falhas e quota deixam trabalho retomável, sem reupload;
- nenhuma resposta autenticada ou documento privado entra no cache do PWA.

## Implementado

### Fundação e interface

- SvelteKit 5 com adapter estático e fallback `200.html`;
- TypeScript, Vitest, Playwright, ESLint e Prettier configurados;
- sistema visual editorial responsivo para desktop, tablet e celular;
- shell privado com navegação, busca persistente e estados vazios/erro;
- tela de login separada do shell autenticado.

### Supabase e segurança

- esquema relacional para usuários autorizados, cadernos, documentos, páginas, trabalhos OCR, tags e uso diário;
- RLS e políticas de Storage vinculadas ao usuário autenticado;
- allowlist `app_users` fail-closed;
- funções SQL autorizadas para biblioteca, busca, revisão, exportação, importação e OCR;
- cabeçalhos estáticos restritivos e CSP sem scripts inline;
- URLs privadas assinadas por 10 minutos para leitura dos originais.

### Biblioteca e cadernos

- listagem paginada de documentos;
- filtros por caderno, tipo, estado e período;
- criação e listagem de cadernos;
- remoção de caderno sem apagar documentos;
- exclusão composta de documento e objetos associados por Edge Function.

### Imagens

- preparação fora da thread principal com `OffscreenCanvas`;
- limite padrão de 2.560 px e alta definição de 3.200 px;
- miniatura de 480 px;
- WebP preferencial e JPEG como fallback;
- SHA-256 dos bytes preparados;
- deduplicação antes da publicação;
- dois workers de preparação e três uploads de documentos no máximo;
- upload paralelo de original e miniatura;
- criação atômica de documento, página e trabalho OCR;
- fila cancelável e retomável;
- retry OCR reaproveita o `pageId` persistido e não reenvia o arquivo.

### PDFs

- inspeção local em worker com `@firecrawl/pdf-inspector-wasm`;
- inicialização tardia do WASM;
- roteamento contínuo de todas as páginas;
- texto nativo preservado por página;
- renderização PDF.js somente das páginas marcadas para OCR;
- uma página renderizada por vez;
- um PDF pesado preparado por vez;
- publicação atômica do documento e todas as páginas;
- no máximo duas leituras OCR simultâneas depois da publicação;
- retomada posterior consulta apenas páginas `pending`, `retryable` ou `blocked_quota`.

### OCR

- consentimento persistido na allowlist antes do processamento;
- claim transacional e idempotente por página;
- reserva de cota diária antes da chamada externa;
- estados explícitos de processamento, retry, quota, revisão e falha;
- contrato JSON estrito `{ text, warnings }`;
- classificação separada de quota diária, rate limit, autenticação, modelo e indisponibilidade;
- Edge Function privada com segredo somente no backend;
- limpeza de imagem temporária após terminal válido;
- rollup automático do estado das páginas para o estado do documento.

### Busca, leitura e revisão

- busca PostgreSQL ranqueada com trigramas e texto efetivo;
- consulta cancelável, debounce e paginação limitada;
- realce sem HTML e tolerante a acentos;
- leitor lado a lado com original privado e texto;
- editor com rascunho local versionado e autosave;
- texto corrigido prevalece sobre fonte nativa e OCR;
- fila de revisão ordenada por ação necessária;
- retomada individual de páginas sem reupload.

### Portabilidade e PWA

- exportação JSON versionada com cadernos, documentos, páginas, tags, fontes e correções;
- nenhuma URL assinada, token ou caminho de Storage no manifesto;
- instalação PWA opcional;
- cache restrito ao shell e ativos públicos;
- configurações com exportação, política operacional e encerramento de sessão.

## Pendências de código prioritárias

1. substituir a chamada Gemini duplicada em `process-ocr/index.ts` pelo cliente isolado em `_shared/gemini-ocr-client.ts`;
2. garantir remontagem do editor ao trocar a página selecionada;
3. executar TypeScript e ajustar eventuais incompatibilidades das APIs exatas de PDF.js, Supabase e Workbox;
4. regenerar `src/lib/types/database.ts` a partir do esquema aplicado;
5. implementar visão de uso/cota, tags e testes de recuperação após recarga completa;
6. adicionar deployment reproduzível e validar políticas reais no projeto Supabase.

## Gates não executados

Os seguintes comandos não foram executados neste ambiente:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm test:e2e
supabase db reset
supabase test db
```

Motivo: o ambiente local não resolve `github.com` nem o registro de pacotes e não possui checkout/dependências/pnpm em cache. O conector GitHub permanece funcional e foi usado para commits pequenos e frequentes.

Nenhum resultado de teste, build, lint, migração aplicada, navegador real ou deployment é declarado como PASS.

## Deployment e validação externa

Ainda não validados:

- migrações em um projeto Supabase real;
- Auth, RLS e Storage com usuário real da allowlist;
- Edge Functions implantadas e secrets configurados;
- resposta real do modelo configurado;
- limite diário e retomada no dia seguinte;
- comportamento de memória com PDFs extensos em tablet/celular;
- PWA instalado e atualização do service worker;
- cabeçalhos do host estático final;
- exclusão e exportação com dados reais.

## Regras de continuidade

- não inserir chaves Gemini/Supabase privadas no frontend;
- não transformar falha de OCR em perda de arquivo;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- manter commits pequenos e documentação alinhada;
- marcar gates honestamente como `NOT RUN`/`BLOCKED` até existir evidência fresca.
