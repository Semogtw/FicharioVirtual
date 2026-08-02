# Estado atual do Fichário Virtual

_Atualizado: 2026-08-02_  
_Branch ativa: `main`_  
_Estado: MVP implementado e validado localmente; gates externos preparados para staging, sem deployment ou release_

## Resumo executivo

O repositório contém uma aplicação SvelteKit estática funcional com Supabase, autenticação de usuário único, biblioteca privada, cadernos, tags, importação de imagens e PDFs, OCR seletivo, busca textual, leitura/revisão, exportação portátil, painel operacional e PWA.

Estimativa atual:

- **97% do MVP implementado em código**;
- **85% de prontidão operacional para release**;
- **93% de progresso total ponderado do MVP**.

A metodologia e os itens restantes estão em `docs/READINESS.md`.

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
- replay divergente rejeitado sem alterar texto confirmado;
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

### Portabilidade, deployment e operação

- exportação JSON versionada com cadernos, documentos, páginas, tags, fontes e correções;
- nenhuma URL assinada, token ou caminho de Storage no manifesto;
- painel privado de uso/cota sem conteúdo dos documentos;
- configurações com exportação, política operacional e encerramento de sessão;
- documentação de deployment, privacidade, recuperação, limites gratuitos e testes;
- gates offline de segurança/migrations e runners locais de funções/banco;
- verificador do host HTTPS, headers, fallback SPA, manifesto e service worker;
- Action manual `Verify deployed Fichário` com entrada de URL não interpolada no shell;
- verificador Supabase remoto com duas contas, allowlist e sentinela RLS descartável;
- Action manual `Verify Supabase staging`, protegida pelo environment `staging` e sem service-role key;
- workspace offline portátil fabricado pelo repositório `Offline-Toolchains`.

## Validação e evidência

### HEAD funcional integralmente validado

O commit `f961461cf27df2fe6e860e2ac50236ec2eb70a23` recebeu `SUCCESS` no workflow `Validate current head`, run `30772068104`.

A execução comprovou:

```text
pnpm install --frozen-lockfile
Prettier + ESLint
svelte-check: 0 erros, 0 warnings
134 testes unitários
build estático + validação dos artefatos PWA
gates offline de segurança, migrations, RPCs, toolchain e rotas
3 testes E2E no Chromium
Deno check das Edge Functions
Supabase start + db reset
27 migrations aplicadas do zero
54 testes pgTAP
concorrência real de claim OCR
replay OCR idempotente e rejeição de replay divergente
cota e retomada na virada do dia UTC
```

Recibo persistente: issue `#1`, `[CI] Fichário current HEAD validation`.

O mesmo SHA também foi instalado e verificado no workspace offline já publicado, sem acesso ao registry: lint, tipos, 134 unitários, build PWA, cinco gates de fonte e três E2E passaram.

### Gates externos preparados

- `pnpm test:deployment -- https://host.example` valida HTTPS, redirect, CSP, HSTS, Permissions Policy, cache, SPA, manifesto e PWA;
- `Verify deployed Fichário` executa esse contrato manualmente no GitHub Actions;
- `pnpm test:staging:supabase` usa duas contas de teste e chave publicável para validar allowlist e RLS;
- `Verify Supabase staging` lê somente secrets do environment protegido `staging`;
- nenhuma das duas verificações externas foi executada ainda porque o host e o projeto remoto não estão configurados.

### Workspace offline

O primeiro workflow `Build Fichário offline workspace` do repositório `Semogtw/Offline-Toolchains` concluiu com sucesso no run `30769889858` e publicou manifest mais duas partes compactadas.

O bundle comprovou utilidade nesta execução: foi remontado por checksum, instalou o HEAD pelo store local e reproduziu uma falha unitária antes do CI terminar.

A fabricação v2 está fixada no SHA validado `f961461cf27df2fe6e860e2ac50236ec2eb70a23` e adiciona:

- cache Deno com verificação `--cached-only`;
- gates de fonte no smoke test;
- checksum do archive com caminho portátil;
- gate contra material de chave privada rastreado;
- manifest de evidência atualizado.

O gate de banco ainda requer Docker e as imagens Supabase, que não são incluídas no archive.

## Próximas prioridades

1. concluir e publicar a fabricação v2 do workspace offline fixado no SHA verde;
2. criar um projeto Supabase de staging gratuito, sem dados reais;
3. configurar o environment `staging` e executar a verificação com duas contas;
4. ampliar o gate remoto para Storage privado e expiração de URL assinada;
5. implantar Edge Functions e testar OCR real com imagens sintéticas;
6. injetar 429 diário/transitório, 503, timeout e resposta inválida;
7. publicar um host HTTPS e executar `Verify deployed Fichário`;
8. validar PDFs textuais, digitalizados e mistos em tablet/celular;
9. validar limites gratuitos e billing desativado na conta real;
10. somente depois considerar um release.

## Ainda não validado externamente

- migrations em projeto Supabase remoto;
- autenticação e Storage reais;
- isolamento RLS remoto com as duas contas preparadas;
- comportamento e expiração de URLs assinadas;
- resposta e quota reais do modelo configurado;
- falha de rede/process death na infraestrutura implantada;
- PDFs extensos e consumo de memória em dispositivo físico;
- instalação/atualização do PWA no navegador-alvo;
- headers do host final;
- limites gratuitos e billing desativado na conta real.

## Regras de continuidade

- não inserir chaves Gemini/Supabase privadas no frontend;
- não inserir a chave OpenPGP privada no GitHub, em Actions ou artifacts;
- não transformar falha de OCR em perda de arquivo;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
