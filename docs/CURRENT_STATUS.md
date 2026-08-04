# Estado atual do Fichário Virtual

_Atualizado: 2026-08-04_  
_Branch ativa: `main`_  
_Checkpoint de código coberto por este documento: `af1ed46b7ac6af1ca008eaf584498e0d724400e1`_  
_Último gate local integral confirmado: `788f170409a323adb8d5b45e83d615f7c1f8d31f`_  
_Estado: MVP funcional com hardening amplo de contratos, concorrência e recuperação; o checkpoint novo ainda precisa de recibo integral de validação e os gates externos continuam pendentes._

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão, organização e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

O MVP está implementado. O trabalho mais recente corrigiu uma busca global que apontava para a rota errada, eliminou novas corridas de teardown em componentes e mutações, preservou o controle de fluxo de redirects do SvelteKit e alinhou o cancelamento da retomada de OCR em PDFs.

A prontidão operacional ainda depende de staging real, host HTTPS, testes em dispositivos e verificação dos limites gratuitos. Percentuais de prontidão, quando necessários, devem ser derivados de `docs/READINESS.md`; este documento registra fatos e evidências, não estimativas novas.

## Evidência e estado dos gates

### Último gate local integral confirmado

No SHA `788f170409a323adb8d5b45e83d615f7c1f8d31f`, o workspace offline passou:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS — 0 erros, 0 warnings
Vitest: PASS — 460 testes em 102 arquivos
build estático/PWA: PASS
5 gates offline de fonte: PASS
6 módulos Edge verificados com Deno offline: PASS
Playwright Chromium: PASS — 3/3 E2E
```

O SHA inclui snapshots de Prettier gerados pela mesma toolchain usada no checkout limpo.

### Checkpoint novo

O código documentado até `af1ed46b7ac6af1ca008eaf584498e0d724400e1` contém testes e implementações posteriores ao gate local acima. O workflow automático `Validate current head` publica o recibo persistente em `Semogtw/FicharioVirtual#1`.

Nesta sessão, o checkout local não pôde ser materializado porque o ambiente não resolveu `github.com`; por isso os commits foram gravados diretamente pela conexão GitHub e os gates completos não foram declarados como locais. Não atribuir `PASS` ao checkpoint novo até o recibo do workflow registrar sucesso para o SHA correspondente.

### Checkout exato da toolchain

O trigger `Semogtw/Offline-Toolchains@63799e383a5d2b07ba96dae486e528541766c6ab` ainda aponta para `788f170409a323adb8d5b45e83d615f7c1f8d31f`.

O recibo persistente desse bundle é `Semogtw/Offline-Toolchains#28`. O trigger deve ser movido para um checkpoint novo somente depois que o código estiver estabilizado e o workflow do repositório principal estiver verde.

### Gates externos ainda não executados

```text
pnpm verify:full: NOT RUN — exige Supabase local completo, Docker e banco recriado
pnpm test:db:local: NOT RUN — Docker/imagens Supabase não fazem parte do bundle portátil
Verify Supabase staging: NOT RUN — projeto e credenciais de staging não configurados
Verify OCR staging: NOT RUN — função e secret do provedor não configurados em staging
Verify deployed Fichário: NOT RUN — host HTTPS final não publicado
```

## Mudanças posteriores ao último gate local

### Navegação e busca

- a busca global do `AppShell` agora navega para `/search/?q=...`, em vez de enviar a consulta para `/library/`, que não consumia o parâmetro;
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
- os clientes de worker de imagem e PDF foram revisados e continuam encerrando worker e listener por tarefa.

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

Ao atualizar o source commit:

1. estabilizar o HEAD e obter o recibo verde do repositório principal;
2. mover `triggers/fichario-toolchain.json` para o SHA exato;
3. aguardar o recibo em `Offline-Toolchains#28`;
4. baixar manifest e partes do run bem-sucedido;
5. conferir SHA-256 antes de extrair;
6. usar o novo bundle como base, sem sobrepor um checkout antigo de forma implícita.

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

1. obter `PASS` do workflow para o HEAD atual e corrigir qualquer regressão encontrada;
2. atualizar a toolchain offline para o SHA estabilizado e obter recibo exato;
3. executar `pnpm verify:full` em ambiente com Docker e imagens Supabase disponíveis;
4. criar um projeto Supabase de staging sem dados reais;
5. aplicar migrations e cadastrar duas contas exclusivas de teste;
6. executar `Verify Supabase staging` e `Verify OCR staging`;
7. publicar um host HTTPS e executar `Verify deployed Fichário`;
8. testar PDFs, cancelamento, retomada e PWA em tablet e celular;
9. confirmar billing desativado, backup e rollback;
10. somente então decidir entre staging prolongado e release privada.

## Regras de continuidade

- não inserir chaves privadas no frontend, GitHub, artifacts ou logs;
- não transformar falha de OCR em perda ou novo upload;
- não enviar páginas de PDF com texto para OCR;
- não cachear respostas autenticadas;
- não habilitar billing ou fallback pago silencioso;
- não adicionar endpoint ou controle de fault injection à função implantada;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
