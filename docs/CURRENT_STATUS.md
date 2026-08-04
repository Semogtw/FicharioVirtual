# Estado atual do Fichário Virtual

_Atualizado: 2026-08-04_  
_Branch ativa: `main`_  
_Último checkpoint de código integralmente validado: `dc939f6c6f7932a767296301263cf79a9bf64666`_  
_Recibo: workflow `Validate current head`, run `30928622139`, issue `Semogtw/FicharioVirtual#1`_  
_Estado: MVP funcional com hardening amplo de contratos, concorrência e recuperação; staging real, OCR externo e host HTTPS continuam pendentes._

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão, organização e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

O MVP está implementado. O checkpoint validado mais recente corrigiu a busca global, preservou o controle de fluxo de redirects do SvelteKit, eliminou novas corridas de teardown em componentes e mutações, fortaleceu o rastreamento de sessão e alinhou o cancelamento da retomada de OCR em PDFs.

A prontidão operacional ainda depende de staging real, host HTTPS, testes em dispositivos e verificação dos limites gratuitos. Percentuais de prontidão, quando necessários, devem ser derivados de `docs/READINESS.md`; este documento registra fatos e evidências.

## Evidência do checkpoint validado

No SHA `dc939f6c6f7932a767296301263cf79a9bf64666`, o workflow `Validate current head` passou integralmente:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS — 0 erros, 0 warnings
Vitest: PASS — 475 testes em 111 arquivos
build estático/PWA: PASS
gates offline de fonte: PASS
Edge Functions com Deno: PASS
Playwright Chromium: PASS — 3/3 E2E
Supabase local: PASS — migrations, RLS, Storage e 54 testes de banco
```

O recibo persistente está em `Semogtw/FicharioVirtual#1`, associado ao run `30928622139`. O workflow também publica o archive exato do source validado e, quando o frontend falha, artifacts de log e reparo de Prettier.

Este documento é posterior ao checkpoint acima. O próprio commit documental deve ser considerado validado somente quando o recibo registrar sucesso para seu SHA.

## Gates externos ainda não executados

```text
Verify Supabase staging: NOT RUN — projeto e credenciais de staging não configurados
Verify OCR staging: NOT RUN — função e secret do provedor não configurados em staging
Verify deployed Fichário: NOT RUN — host HTTPS final não publicado
Testes em tablet e celular físicos: NOT RUN
Verificação operacional de billing, backup e rollback: NOT RUN
```

## Mudanças do checkpoint

### Navegação e busca

- a busca global do `AppShell` navega para `/search/?q=...`, em vez de enviar a consulta para `/library/`, que não consumia o parâmetro;
- o campo superior reflete o `q` da rota de pesquisa atual;
- o guard de `+layout.ts` captura somente a consulta de autenticação e mantém `redirect()` fora do `catch`, preservando o controle de fluxo do SvelteKit.

### Teardown e concorrência

- `CorrectionEditor` invalida a conclusão do save remoto ao desmontar e não dispara `onSaved` para uma tela inexistente;
- `InstallAppButton` invalida a conclusão do prompt, consome cada `beforeinstallprompt` uma única vez e trata rejeições do navegador;
- login, exportação e logout deixam de publicar estado ou navegar depois do teardown;
- a criação de cadernos possui token separado da recarga da lista;
- criação, renomeação, exclusão e associação de tags, incluindo `refreshTags`, são invalidadas em conjunto ao sair da rota;
- saves paralelos da organização em lote continuam independentes, mas usam um token de vida da rota para suprimir conclusões após desmontagem;
- o rastreador global de sessão ignora eventos já enfileirados em microtask depois que a assinatura é encerrada.

### Importação e OCR

- o cancelamento de uma retomada de OCR de PDF que rejeita com `AbortError` permanece em `cancelled`, sem ser reclassificado como falha pendente;
- a fila continua preservando resultados parciais quando o provedor conclui trabalho mesmo após o sinal de cancelamento;
- os clientes de worker de imagem e PDF encerram worker e listener por tarefa.

### Pipeline e documentação

- o workflow valida também `README.md` e `docs/**`;
- falhas de frontend geram log persistente;
- falhas de formatação geram um patch exato produzido pela versão travada do Prettier;
- o recibo informa outcomes de frontend, source, Chromium, browser, Edge e banco;
- `docs/TESTING.md` foi reconstruído para refletir os comandos e gates reais do repositório.

## Produto implementado

### Fundação e interface

- SvelteKit 5, TypeScript e adapter estático com fallback SPA;
- interface editorial responsiva para desktop, tablet e celular;
- autenticação separada do shell privado;
- home dinâmica, biblioteca, cadernos, tags, organização em lote e painel de uso;
- leitor lado a lado, revisão manual e rascunhos locais recuperáveis;
- PWA opcional com cache limitado ao shell e ativos públicos.

### Importação e OCR

- preparação de imagens em worker, miniaturas, SHA-256 e deduplicação;
- inspeção local de PDFs e preservação de texto nativo por página;
- renderização PDF.js somente quando OCR é necessário;
- publicação atômica de documentos, páginas e trabalhos;
- consentimento persistido, claim concorrente, idempotência e limite diário;
- estados explícitos de retry, quota, revisão, falha e cancelamento;
- retomada sem reupload e rollup automático do estado do documento;
- seleção de caderno preservada entre URL, importação por imagens e PDF;
- bloqueio de fallback silencioso quando o caderno solicitado não pôde ser confirmado.

### Busca, revisão e organização

- busca textual reativa a alterações de `?q=` sem remontar a rota;
- busca global conectada à rota de resultados;
- cancelamento e versionamento de consultas antigas;
- filtro de caderno com erro e retry independentes;
- fila de revisão paginada e protegida contra recargas antigas;
- retry OCR invalidado ao desmontar a rota;
- rascunhos locais resolvidos em lotes de até 100 IDs;
- rascunhos continuam visíveis e descartáveis quando a localização remota falha;
- tags com carga inicial, associações versionadas, retry específico e mutações serializadas;
- organização em lote preserva título e caderno quando fontes opcionais falham.

### Resiliência de rotas

As rotas e componentes assíncronos usam `RequestVersion`, `AbortController` ou cancelamento equivalente para impedir que respostas antigas alterem dados, erros, callbacks ou indicadores depois de uma tentativa mais nova ou do desmontar da tela.

Foram endurecidos:

- home, busca, biblioteca e painel de uso;
- lista e detalhe de cadernos;
- detalhe e exclusão de documentos;
- fila de revisão e rascunhos locais;
- tags e organização em lote;
- importação por imagem e PDF;
- login, logout, exportação, editor de correção e instalação do PWA.

Falhas parciais preservam conteúdo válido e oferecem retry independente. Operações incompatíveis — como exportar e sair, retomar OCR e excluir, ou alterar associação durante mutação de tag — são mutuamente exclusivas.

Conclusões de domínio também são separadas da navegação: documento excluído, login confirmado ou logout concluído não são reclassificados como falha apenas porque `goto()` falhou.

### Dados e segurança

- allowlist `app_users` fail-closed;
- RLS forçada nas tabelas privadas;
- bucket `documents` privado e prefixado por `auth.uid()`;
- nenhum segredo no bundle do navegador;
- URLs assinadas somente sob demanda;
- CSP, HSTS, Permissions Policy e política de cache verificáveis;
- exportação JSON portátil sem tokens, URLs assinadas ou caminhos internos;
- exclusão composta e idempotente por Edge Function;
- parsers estritos para respostas de serviços e RPCs;
- validação de UUIDs, timestamps, filtros, payloads de criação e atualização.

## Workspace offline

O repositório `Semogtw/Offline-Toolchains` fabrica um workspace Linux x64 com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI.

O bundle permite instalar dependências com o registry bloqueado, executar frontend, build/PWA, gates de fonte, E2E e `deno check`. Docker e imagens Supabase continuam externos ao archive.

O trigger deve ser movido para um checkpoint novo somente depois que o source estiver estabilizado e o workflow do repositório principal estiver verde. O próximo alvo é o commit documental que preservar este checkpoint verde e também passar pelo workflow.

Ao atualizar o source commit:

1. estabilizar o HEAD e obter o recibo verde do repositório principal;
2. mover `triggers/fichario-toolchain.json` para o SHA exato;
3. aguardar o recibo em `Offline-Toolchains#28`;
4. baixar manifest e partes do run bem-sucedido;
5. conferir SHA-256 antes de extrair;
6. usar o novo bundle como base, sem sobrepor um checkout antigo implicitamente.

## Ainda não validado externamente

- migrations, Auth, RLS e Storage no projeto Supabase remoto;
- expiração de URL assinada no serviço real;
- modelo Gemini e quota reais;
- persistência, retomada e cleanup implantados após 429, 503, timeout e payload inválido;
- PDFs extensos e mistos em dispositivo físico;
- instalação e atualização do PWA no navegador-alvo;
- headers e cache do host final;
- limites gratuitos, billing desativado, backup e rollback operacionais.

## Próximas prioridades

1. validar os commits documentais posteriores ao checkpoint de código;
2. atualizar a toolchain offline para o SHA final estabilizado e obter recibo exato;
3. criar um projeto Supabase de staging sem dados reais;
4. aplicar migrations e cadastrar duas contas exclusivas de teste;
5. executar `Verify Supabase staging` e `Verify OCR staging`;
6. publicar um host HTTPS e executar `Verify deployed Fichário`;
7. testar PDFs, cancelamento, retomada e PWA em tablet e celular;
8. confirmar billing desativado, backup e rollback;
9. somente então decidir entre staging prolongado e release privada.

## Regras de continuidade

- não inserir chaves privadas no frontend, GitHub, artifacts ou logs;
- não transformar falha de OCR em perda ou novo upload;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- não adicionar endpoint ou controle de fault injection à função implantada;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
