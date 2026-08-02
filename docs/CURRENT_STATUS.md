# Estado atual do Fichário Virtual

_Atualizado: 2026-08-02_  
_Branch ativa: `main`_  
_Estado: MVP implementado, em endurecimento e validação pré-staging; sem deployment ou release_

## Resumo executivo

O repositório contém uma aplicação SvelteKit estática funcional com Supabase, autenticação de usuário único, biblioteca privada, cadernos, tags, importação de imagens e PDFs, OCR seletivo, busca textual, leitura/revisão, exportação portátil, painel operacional e PWA.

A política central permanece:

- dados privados por padrão;
- nenhum segredo no bundle do navegador;
- nenhuma cobrança ou fallback pago ativado automaticamente;
- OCR somente após consentimento persistido;
- páginas de PDF com texto permanecem locais;
- páginas sem texto são renderizadas individualmente para OCR;
- falhas, quota e encerramento do navegador deixam trabalho retomável sem reupload;
- nenhuma resposta autenticada ou documento privado entra no cache do PWA.

## Implementado

### Fundação e interface

- SvelteKit 5 com adapter estático e fallback `200.html`;
- TypeScript, Vitest, Playwright, ESLint e Prettier;
- sistema visual editorial responsivo para desktop, tablet e celular;
- shell privado com navegação, busca persistente e estados vazios/erro;
- tela de login separada do shell autenticado;
- instalação PWA opcional e cache limitado a shell/ativos públicos.

### Supabase e segurança

- esquema relacional para usuários autorizados, cadernos, documentos, páginas, trabalhos OCR, tags e uso diário;
- RLS e políticas de Storage vinculadas ao usuário autenticado;
- allowlist `app_users` fail-closed;
- bucket privado com prefixo por `auth.uid()`;
- funções SQL autorizadas para biblioteca, busca, revisão, exportação, importação, organização e OCR;
- cabeçalhos estáticos restritivos e CSP sem scripts inline;
- URLs privadas assinadas por 10 minutos para leitura dos originais;
- tipos Supabase regenerados a partir do esquema local aplicado.

### Biblioteca, cadernos e organização

- listagem paginada de documentos;
- filtros por caderno, tipo, estado, período e tag;
- criação e listagem de cadernos;
- remoção de caderno sem apagar documentos;
- renomeação e movimentação de documentos em lote;
- gestão atômica de tags, normalização e tela central de atribuição;
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
- retomada posterior consulta somente páginas elegíveis e cujo retry já venceu.

### OCR e recuperação

- consentimento persistido na allowlist antes do processamento;
- claim transacional e idempotente por página;
- reserva concorrente segura de cota diária antes da chamada externa;
- estados explícitos de processamento, retry, quota, revisão e falha;
- contrato JSON estrito `{ text, warnings }`;
- cliente isolado para separar falha de transporte, HTTP e payload inválido;
- classificação de quota diária, rate limit, autenticação, modelo e indisponibilidade;
- Edge Function privada com segredo somente no backend;
- limpeza de imagem temporária após terminal válido;
- recuperação de claims antigos pela fila de revisão;
- replay idempotente da conclusão após perda de resposta;
- desbloqueio de cota pelo próximo dia UTC;
- rollup automático do estado das páginas para o documento.

### Busca, leitura e revisão

- busca PostgreSQL ranqueada com trigramas e texto efetivo;
- consulta cancelável, debounce e paginação limitada;
- realce sem HTML e tolerante a acentos;
- leitor lado a lado com original privado e texto;
- editor remontado ao trocar de página;
- rascunho local versionado e autosave;
- inventário de rascunhos recuperáveis sem enviar o conteúdo ao banco;
- tela dedicada para localizar e recuperar rascunhos locais;
- texto corrigido prevalece sobre fonte nativa e OCR;
- fila de revisão ordenada por ação necessária;
- retomada individual ou por documento sem reupload.

### Portabilidade e operação

- exportação JSON versionada com cadernos, documentos, páginas, tags, fontes e correções;
- nenhuma URL assinada, token ou caminho de Storage no manifesto;
- painel privado de uso/cota sem conteúdo dos documentos;
- configurações com exportação, política operacional e encerramento de sessão;
- documentação de deployment, privacidade, recuperação, limites gratuitos e testes;
- gates offline de segurança/migrations e runners locais de funções/banco.

## Validação e evidência

### Último checkpoint local completo

O commit `f2b4eb47614daa488118c14aa81ce94cb0d9817d` registrou `PASS` para:

```text
pnpm install --frozen-lockfile --offline
pnpm lint
pnpm check
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
bash tools/checks/run-offline-source-gates.sh
supabase db reset
supabase test db
deno check das Edge Functions
```

Relatório: `docs/reports/2026-08-02-local-validation-checkpoint.md`.

### Mudanças posteriores ao checkpoint

Depois desse SHA foram adicionados:

- organização de documentos em lote;
- testes reais de concorrência de claim OCR;
- replay idempotente de conclusão e virada UTC da cota;
- entrypoints `test:source:offline`, `test:functions:check`, `test:db:local` e `verify:full`;
- documentação atualizada.

Essas mudanças ainda precisam de `pnpm verify:full` no HEAD exato. O ambiente desta sessão não resolve `github.com`, portanto não foi possível obter checkout local e executar os comandos. O conector GitHub foi usado apenas para leitura e commits.

## Próximas prioridades

1. executar `pnpm verify:full` no HEAD atual e registrar saída fresca;
2. corrigir qualquer regressão detectada sem avançar o escopo;
3. implantar um projeto Supabase de staging gratuito, sem dados reais;
4. validar Auth, RLS, Storage e URLs assinadas com duas contas de teste;
5. configurar secrets e testar OCR real com imagens sintéticas;
6. injetar 429 diário/transitório, 503, timeout e resposta inválida;
7. validar PDFs textuais, digitalizados e mistos em tablet/celular;
8. verificar headers, PWA, atualização e expiração de URL no host final;
9. somente depois considerar um release.

## Ainda não validado externamente

- migrações em projeto Supabase remoto;
- autenticação/Storage reais e comportamento de URLs assinadas;
- resposta e quota reais do modelo configurado;
- falha de rede/process death na infraestrutura implantada;
- PDFs extensos e consumo de memória em dispositivo físico;
- instalação/atualização do PWA no navegador-alvo;
- headers do host final;
- limites gratuitos e billing desativado na conta real.

## Regras de continuidade

- não inserir chaves Gemini/Supabase privadas no frontend;
- não transformar falha de OCR em perda de arquivo;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
