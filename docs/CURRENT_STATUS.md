# Estado atual do Fichário Virtual

_Atualizado: 2026-08-05_  
_Branch ativa: `main`_  
_Último checkpoint integralmente validado: `2c9ed12bace23412ae35dde0f246d85b9ff97d2c`_  
_Recibo: workflow `Validate current head`, run `30979143410`, job `92219621128`_  
_Estado: escopo codificável conhecido concluído; staging real, OCR externo, host HTTPS, dispositivos físicos e operação continuam pendentes._

## Resumo executivo

O Fichário Virtual é uma PWA SvelteKit estática para organizar imagens e PDFs privados, preservar texto nativo, executar OCR seletivo no backend e oferecer busca, leitura, revisão, organização e exportação. A aplicação usa Supabase Auth, PostgreSQL, RLS, Storage privado e Edge Functions.

O MVP e os gates necessários para validá-lo estão implementados no repositório. O checkpoint mais recente adicionou uma prova real de navegador com duas abas, encontrou e corrigiu uma falha de reatividade das filas Svelte e consolidou toda a configuração externa restante em `docs/EXTERNAL_SETUP_RUNBOOK.md`.

A auditoria final não encontrou `TODO`, `FIXME` ou teste ignorado que representasse uma feature conhecida incompleta. Isso não substitui staging ou testes físicos: a prontidão operacional ainda depende de serviços reais, host HTTPS, OCR externo, dispositivos e controles de billing, backup e rollback.

## Evidência do checkpoint validado

No SHA `2c9ed12bace23412ae35dde0f246d85b9ff97d2c`, o workflow `Validate current head` passou integralmente:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS — 0 erros e 0 avisos
Vitest: PASS — 560 testes em 131 arquivos
build estático/PWA: PASS
gates offline de fonte: PASS — 31 migrations e 13 RPCs frontend
Playwright Chromium: PASS — 4/4 E2E
Edge Functions com Deno: PASS
Supabase local: PASS — 76 testes de banco
```

O run `30979143410` publicou o archive exato do source e evidência do Playwright, sem artifact de falha de frontend nem reparo do Prettier. O checkpoint detalhado está em `docs/checkpoints/2026-08-05-multitab-reactivity-and-external-runbook.md`.

## Mudanças mais recentes

### E2E multiaba real

- duas páginas compartilham um único `BrowserContext` Chromium;
- o cenário usa IndexedDB, `BroadcastChannel` e Web Locks reais;
- somente a fronteira HTTP do Supabase é simulada;
- o teste exige uma única criação de metadados, uma única chamada OCR, os uploads esperados e uma única conclusão visual;
- o registro persistido é removido ao final, sem retomada duplicada.

### Reatividade das filas Svelte

O E2E revelou que as filas inseriam um objeto comum em um array `$state` e continuavam a mutar a referência crua. O backend concluía o trabalho, mas a interface podia continuar exibindo `Na fila`.

As filas de imagem e PDF agora continuam o processamento usando a referência proxificada realmente armazenada no array reativo. Um contrato unitário estrutural protege inclusão e restauração contra regressão.

### Configuração externa

`docs/EXTERNAL_SETUP_RUNBOOK.md` descreve a ordem exata para:

- criar o Supabase de staging;
- aplicar migrations e gerar tipos;
- cadastrar duas contas de teste;
- configurar o environment `staging` no GitHub;
- implantar Edge Functions e secrets;
- construir e publicar o frontend estático em HTTPS;
- executar os três gates externos;
- testar celular e tablet;
- confirmar billing, backup e rollback.

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
- coordenação entre abas e reconciliação de registros locais com sessões remotas;
- prova Chromium de que duas abas não duplicam uma retomada de imagem persistida.

### Busca, revisão e organização

- busca textual reativa a alterações de `?q=` sem remontar a rota;
- busca global conectada à rota de resultados;
- cancelamento e versionamento de consultas antigas;
- fila de revisão paginada e protegida contra recargas antigas;
- rascunhos locais resolvidos em lotes e preservados diante de falhas parciais;
- tags com carga inicial, associações versionadas, retry específico e mutações serializadas;
- organização em lote preserva título e caderno quando fontes opcionais falham.

### Resiliência e concorrência

- rotas e componentes assíncronos usam versionamento, abort ou cancelamento equivalente;
- Web Locks cai para lease de `localStorage` somente antes de a tarefa iniciar;
- mensagens de `BroadcastChannel` são validadas na entrada e na saída;
- conclusões de outra aba impedem persistências tardias e retomadas obsoletas;
- sessões remotas por `resumeKey` reconciliam abas que estavam fechadas;
- falhas de rede preservam trabalho local recuperável;
- filas processam a referência reativa observada pela interface.

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
Verify deployed Fichário: NOT RUN — host HTTPS final não publicado
Verify OCR staging: NOT RUN — função, secret e modelo não configurados em staging
Testes em tablet e celular físicos: NOT RUN
Verificação operacional de billing, backup e rollback: NOT RUN
```

Também permanecem sem validação externa:

- expiração de URL assinada no serviço real;
- modelo Gemini e quota reais;
- persistência, retomada e cleanup implantados após 429, 503, timeout e payload inválido;
- PDFs extensos e mistos em dispositivo físico;
- instalação e atualização da PWA no navegador-alvo;
- headers e cache do host final;
- limites gratuitos, billing desativado, backup e rollback operacionais.

## Workspace offline

O repositório `Semogtw/Offline-Toolchains` fabrica um workspace Linux x64 com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI. O bundle permite instalar dependências com o registry bloqueado e executar frontend, build/PWA, gates de fonte, E2E e `deno check`. Docker e imagens Supabase continuam externos ao archive.

O trigger deve apontar somente para um SHA integralmente verde do repositório principal. Depois de estabilizar este checkpoint documental, `triggers/fichario-toolchain.json` deve ser movido para o SHA final e o recibo registrado em `Offline-Toolchains#28`.

## Próximas prioridades

1. validar o commit documental final deste checkpoint;
2. atualizar a toolchain offline para o SHA final verde e obter recibo exato;
3. seguir `docs/EXTERNAL_SETUP_RUNBOOK.md` para criar o Supabase de staging;
4. executar `Verify Supabase staging`;
5. implantar Edge Functions e publicar o host HTTPS;
6. executar `Verify deployed Fichário` e `Verify OCR staging`;
7. testar PDFs, cancelamento, retomada, duas abas e PWA em tablet e celular;
8. confirmar billing desativado, backup e rollback;
9. decidir entre staging prolongado, release privada e produção.

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
