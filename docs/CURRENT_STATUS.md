# Estado atual do Fichário Virtual

_Atualizado: 2026-08-05_  
_Branch ativa: `main`_  
_Último checkpoint de código integralmente validado: `c5aee7b9bfbe553d8f253814cac9c3f67a0faba7`_  
_Recibo: workflow `Validate current head`, run `30973916483`_  
_Estado: MVP funcional com hardening amplo de contratos, concorrência, recuperação e retomada; staging real, OCR externo e host HTTPS continuam pendentes._

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão, organização e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

O MVP está implementado. O checkpoint validado mais recente endureceu as filas de importação de imagem e PDF contra concorrência entre abas, mensagens malformadas, falhas de Web Locks, persistências tardias e restaurações locais obsoletas. Uma aba que estava fechada durante a conclusão agora consulta a sessão remota pelo `resumeKey` e não reativa trabalho já concluído ou cancelado.

A prontidão operacional ainda depende de staging real, host HTTPS, testes em dispositivos e verificação dos limites gratuitos. Percentuais de prontidão, quando necessários, devem ser derivados de `docs/READINESS.md`; este documento registra fatos e evidências.

## Evidência do checkpoint validado

No SHA `c5aee7b9bfbe553d8f253814cac9c3f67a0faba7`, o workflow `Validate current head` passou integralmente:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS
Vitest: PASS — 559 testes em 131 arquivos
build estático/PWA: PASS
gates offline de fonte: PASS
Playwright Chromium: PASS — 3/3 E2E
Edge Functions com Deno: PASS
Supabase local: PASS — migrations, RLS, Storage e testes de banco
```

O run `30973916483` publicou o archive exato do source e evidência do Playwright, sem artifact de falha de frontend ou reparo de Prettier. O checkpoint detalhado está em `docs/checkpoints/2026-08-05-cross-tab-import-hardening.md`.

Este documento é posterior ao checkpoint de código acima. Seu próprio commit deve ser considerado validado somente quando o workflow registrar sucesso para o SHA documental final.

## Mudanças do checkpoint

### Coordenação entre abas

- as filas de imagem e PDF usam exclusão mútua compartilhada por `resumeKey`;
- Web Locks continua sendo a primeira opção e cai para lease de `localStorage` somente quando a API falha antes de executar a tarefa;
- erros da tarefa adquirida são propagados sem retry que possa duplicar upload ou OCR;
- mensagens de `BroadcastChannel` são validadas estritamente tanto na recepção quanto antes da publicação;
- uma falha em subscriber ou no reporter da falha não interrompe subscribers seguintes;
- subscribers adicionados durante um dispatch só recebem a próxima mensagem;
- coordenadores fechados ficam inertes e encerram o canal nativo uma única vez.

### Conclusão remota e tombstones

- uma atualização terminal de outra aba remove o item perdedor, aborta trabalho ativo e cancela retries;
- persistências tardias não podem regredir a sessão remota depois que outra aba venceu;
- tombstones por objeto usam `WeakSet`, sem impedir coleta de lixo;
- um cache limitado a 512 IDs por 30 minutos cobre mensagens recebidas antes da leitura do IndexedDB;
- registros locais concluídos em outra aba antes da restauração são apagados sem preparação, upload ou OCR duplicados.

### Restauração após aba fechada

- as filas consultam sessões remotas pelos `resumeKey`, incluindo estados terminais;
- uma sessão remota `completed` ou `cancelled` elimina o registro local obsoleto mesmo quando a aba não recebeu broadcast;
- falha de rede preserva o registro local e mantém o caminho offline recuperável;
- o ID da sessão encontrada pelo servidor prevalece sobre um `sessionId` local antigo;
- respostas remotas são submetidas aos mesmos contratos estritos de propriedade, UUID, timestamps, contadores, status e unicidade.

### Pipeline e diagnóstico

- commits de teste vermelho foram usados antes das correções comportamentais;
- falhas de frontend continuam gerando logs persistentes;
- falhas de formatação continuam gerando patch exato produzido pela versão travada do Prettier;
- o workflow valida frontend, build, gates offline, Chromium, Edge Functions e banco Supabase local;
- o ambiente desta sessão não resolveu GitHub nem o registry do npm, mas o checkout foi reconstruído a partir do artifact do CI e os gates completos foram executados pelo workflow reproduzível.

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
- coordenação entre abas e reconciliação de registros locais com sessões remotas.

### Busca, revisão e organização

- busca textual reativa a alterações de `?q=` sem remontar a rota;
- busca global conectada à rota de resultados;
- cancelamento e versionamento de consultas antigas;
- fila de revisão paginada e protegida contra recargas antigas;
- rascunhos locais resolvidos em lotes e preservados diante de falhas parciais;
- tags com carga inicial, associações versionadas, retry específico e mutações serializadas;
- organização em lote preserva título e caderno quando fontes opcionais falham.

### Resiliência de rotas

Rotas e componentes assíncronos usam `RequestVersion`, `AbortController` ou cancelamento equivalente para impedir que respostas antigas alterem dados, erros, callbacks ou indicadores depois de uma tentativa mais nova ou do desmontar da tela.

Foram endurecidos home, busca, biblioteca, cadernos, documentos, revisão, rascunhos, tags, organização em lote, importações, login, logout, exportação, editor de correção e instalação do PWA.

Falhas parciais preservam conteúdo válido e oferecem retry independente. Operações incompatíveis são mutuamente exclusivas, e conclusões de domínio não são reclassificadas como falha somente porque uma navegação posterior falhou.

### Dados e segurança

- allowlist `app_users` fail-closed;
- RLS forçada nas tabelas privadas;
- bucket `documents` privado e prefixado por `auth.uid()`;
- nenhum segredo no bundle do navegador;
- URLs assinadas somente sob demanda;
- CSP, HSTS, Permissions Policy e política de cache verificáveis;
- exportação JSON portátil sem tokens, URLs assinadas ou caminhos internos;
- exclusão composta e idempotente por Edge Function;
- parsers estritos para respostas de serviços, RPCs e coordenação entre abas;
- validação de UUIDs, timestamps, filtros, payloads de criação e atualização.

## Gates externos ainda não executados

```text
Verify Supabase staging: NOT RUN — projeto e credenciais de staging não configurados
Verify OCR staging: NOT RUN — função e secret do provedor não configurados em staging
Verify deployed Fichário: NOT RUN — host HTTPS final não publicado
Testes em tablet e celular físicos: NOT RUN
Verificação operacional de billing, backup e rollback: NOT RUN
```

Também permanecem sem validação externa:

- expiração de URL assinada no serviço real;
- modelo Gemini e quota reais;
- persistência, retomada e cleanup implantados após 429, 503, timeout e payload inválido;
- PDFs extensos e mistos em dispositivo físico;
- instalação e atualização do PWA no navegador-alvo;
- headers e cache do host final;
- limites gratuitos, billing desativado, backup e rollback operacionais.

## Workspace offline

O repositório `Semogtw/Offline-Toolchains` fabrica um workspace Linux x64 com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI.

O bundle permite instalar dependências com o registry bloqueado, executar frontend, build/PWA, gates de fonte, E2E e `deno check`. Docker e imagens Supabase continuam externos ao archive.

O trigger deve ser movido somente depois que o commit documental final estiver verde:

1. estabilizar o HEAD e obter o recibo verde do repositório principal;
2. mover `triggers/fichario-toolchain.json` para o SHA exato;
3. aguardar o recibo em `Offline-Toolchains#28`;
4. baixar manifest e partes do run bem-sucedido;
5. conferir SHA-256 antes de extrair;
6. usar o novo bundle como base, sem sobrepor um checkout antigo implicitamente.

## Próximas prioridades

1. validar o commit documental final deste checkpoint;
2. atualizar a toolchain offline para o SHA final estabilizado e obter recibo exato;
3. adicionar um cenário E2E multiaba quando o harness puder controlar duas páginas com IndexedDB e `BroadcastChannel` compartilhados;
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
- falha na consulta remota de sessão não deve apagar trabalho local recuperável;
- manter commits pequenos e documentação alinhada;
- atribuir `PASS` somente ao SHA em que o gate foi realmente executado.
