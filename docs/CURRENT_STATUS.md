# Estado atual do Fichário Virtual

_Atualizado: 2026-08-04_  
_Branch ativa: `main`_  
_HEAD documentado: `788f170409a323adb8d5b45e83d615f7c1f8d31f`_  
_Estado: MVP funcional com hardening amplo de contratos, concorrência e recuperação; validações externas de staging e host continuam pendentes._

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão, organização e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

O código do MVP está implementado. O trabalho recente concentrou-se em eliminar estados enganosos e corridas assíncronas nas rotas, manter conteúdo válido durante falhas parciais e impedir que ações incompatíveis atravessem a mesma sessão ou entidade.

A prontidão operacional ainda depende de staging real, host HTTPS, testes em dispositivos e verificação dos limites gratuitos. Percentuais de prontidão, quando necessários, devem ser derivados de `docs/READINESS.md`; este documento registra fatos e evidências, não estimativas novas.

## Evidência do HEAD

### Gates locais executados

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

### Checkout exato da toolchain

O trigger `Semogtw/Offline-Toolchains@63799e383a5d2b07ba96dae486e528541766c6ab` aponta para `788f170409a323adb8d5b45e83d615f7c1f8d31f`.

Status no momento desta atualização: **PENDING**. O recibo persistente é a issue `Semogtw/Offline-Toolchains#28`. Não atribuir `PASS` exato ao SHA até a issue registrar um run bem-sucedido para esse source commit.

### Gates não executados neste SHA

```text
pnpm verify:full: NOT RUN — exige Supabase local completo, Docker e banco recriado
pnpm test:db:local: NOT RUN — Docker/imagens Supabase não fazem parte do bundle portátil
Verify Supabase staging: NOT RUN — projeto e credenciais de staging não configurados
Verify OCR staging: NOT RUN — função e secret do provedor não configurados em staging
Verify deployed Fichário: NOT RUN — host HTTPS final não publicado
```

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
- estados explícitos de retry, quota, revisão e falha;
- retomada sem reupload e rollup automático do estado do documento;
- cancelamento durante inspeção, publicação e leitura automática;
- seleção de caderno preservada entre URL, importação por imagens e PDF;
- bloqueio de fallback silencioso quando o caderno solicitado não pôde ser confirmado.

### Busca, revisão e organização

- busca textual reativa a alterações de `?q=` sem remontar a rota;
- cancelamento e versionamento de consultas antigas;
- filtro de caderno com erro e retry independentes;
- fila de revisão paginada e protegida contra recargas antigas;
- retry OCR invalidado ao desmontar a rota;
- rascunhos locais resolvidos em lotes de até 100 IDs;
- rascunhos continuam visíveis e descartáveis quando a localização remota falha;
- tags com carga inicial e associações versionadas, retry específico e mutações serializadas;
- organização em lote preserva título e caderno quando fontes opcionais falham.

### Resiliência de rotas

As rotas usam `RequestVersion` ou cancelamento equivalente para impedir que respostas antigas alterem dados, erros ou indicadores depois de uma tentativa mais nova ou do desmontar da tela.

Foram endurecidos:

- home, busca, biblioteca e painel de uso;
- lista e detalhe de cadernos;
- detalhe e exclusão de documentos;
- fila de revisão e rascunhos locais;
- tags e organização em lote;
- importação por imagem e PDF;
- login, logout e exportação.

Falhas parciais preservam conteúdo válido e oferecem retry independente. Operações incompatíveis — como exportar e sair, retomar OCR e excluir, ou alterar associação durante mutação de tag — são mutuamente exclusivas.

Conclusões de domínio também foram separadas da navegação: documento excluído, login confirmado ou logout concluído não são reclassificados como falha apenas porque `goto()` falhou.

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

Ao atualizar o source commit, sempre:

1. mover `triggers/fichario-toolchain.json` para o SHA exato;
2. aguardar o recibo em `Offline-Toolchains#28`;
3. baixar manifest e partes do run bem-sucedido;
4. conferir SHA-256 antes de extrair;
5. usar o novo bundle como base, sem sobrepor um checkout antigo de forma implícita.

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

1. obter `PASS` exato da toolchain para o HEAD documentado;
2. executar `pnpm verify:full` em ambiente com Docker e imagens Supabase disponíveis;
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
