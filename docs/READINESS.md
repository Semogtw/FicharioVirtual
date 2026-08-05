# Prontidão do Fichário Virtual

_Atualizado em 5 de agosto de 2026._

Os percentuais abaixo são uma estimativa de engenharia, não uma métrica automática. Eles separam implementação codificável de validação operacional para evitar que um produto completo no repositório seja confundido com uma release já comprovada em serviços reais e dispositivos físicos.

## Estimativa atual

| Dimensão                           | Progresso estimado | Interpretação                                                                                                                                                    |
| ---------------------------------- | -----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escopo codificável conhecido       |           **100%** | O produto, os contratos de segurança, os gates e o runbook externo estão implementados; a auditoria não encontrou uma lacuna de código conhecida ainda pendente. |
| Prontidão operacional para release |            **85%** | CI, banco local, navegador, Edge Functions, PWA, retomada e concorrência estão validados; faltam staging, host real, OCR externo e dispositivos físicos.         |
| Progresso total ponderado do MVP   |            **96%** | Estimativa combinada, atribuindo maior peso à implementação e mantendo peso relevante para evidência remota, operação e comportamento em hardware real.          |

A estimativa total usa aproximadamente 70% de peso para implementação e 30% para prontidão operacional. Ela deve cair se staging ou dispositivos revelarem um defeito arquitetural e subir somente quando novas evidências forem executadas, não apenas documentadas.

`100%` do escopo codificável conhecido não significa `100%` de prontidão de release. Novos defeitos ainda podem ser encontrados pelos gates externos.

## Evidência local e de CI concluída

O checkpoint `2c9ed12bace23412ae35dde0f246d85b9ff97d2c`, validado pelo run `30979143410`, registra:

- aplicação SvelteKit estática e responsiva;
- autenticação fail-closed por allowlist;
- bootstrap cliente da sessão com revalidação imediata em logout externo;
- biblioteca, cadernos, tags e organização em lote;
- importação otimizada de imagens;
- inspeção local e roteamento seletivo de PDFs;
- OCR persistente, retomável, concorrente e idempotente;
- busca, leitor, revisão e rascunhos locais;
- exportação portátil e painel de uso;
- RLS, Storage privado e Edge Functions sem segredo no navegador;
- PWA com cache restrito ao shell público;
- 31 migrations aplicáveis em banco limpo;
- 76 testes de banco;
- 560 testes Vitest em 131 arquivos;
- 4 cenários E2E no Chromium;
- E2E real com duas abas, IndexedDB, `BroadcastChannel` e exclusão mútua compartilhados;
- gate HTTP loopback com 7 cenários de falha OCR;
- classificação e backoff locais para 429 diário/transitório, 503, payload inválido e timeout;
- parser fail-closed do resultado completo de `claim_ocr_job`;
- validação exata de estados, chaves, UUIDs, timestamps e contadores de claim;
- provas PostgreSQL das formas simples, concorrentes, agendadas, completas e não-retryable;
- gate anti-backdoor contra endpoint alternativo, transporte injetado ou fault control no OCR implantado;
- gates de fonte, tipos, lint, build, PWA, Deno e banco;
- verificador automático do host HTTPS e dos headers;
- verificador remoto com duas contas, sentinela RLS e Storage privado;
- verificação de URL assinada antes e depois da expiração;
- verificador de OCR real com imagem sintética e cleanup por Edge Function;
- workflows manuais protegidos para host, Supabase e OCR;
- workflow integral para código e documentação, com archive do source, log de falha e patch de Prettier;
- workspace offline com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI;
- runbook único de configuração externa em `docs/EXTERNAL_SETUP_RUNBOOK.md`;
- proteção do repositório de toolchains contra material de chave privada rastreado.

## O que falta para 100% operacional

### Evidência remota

- criar o projeto Supabase de staging;
- aplicar migrations remotamente;
- cadastrar duas contas exclusivas de teste;
- executar `Verify Supabase staging`;
- implantar as Edge Functions com secrets exclusivos de staging;
- publicar um host HTTPS e executar `Verify deployed Fichário`;
- executar `Verify OCR staging` com confirmação explícita.

### Persistência de falhas OCR em staging

- observar 429 diário/transitório, 503, timeout e payload inválido passando pela função implantada;
- confirmar `page.status`, `ocr_jobs.status`, `last_error_code`, `next_retry_at` e `finished_at`;
- confirmar retomada depois do backoff e limpeza somente após terminal válido;
- verificar que nenhuma falha habilita cobrança, endpoint alternativo ou fallback silencioso.

A classificação, a resposta pública e o cálculo de backoff desses cenários já estão cobertos localmente por HTTP loopback. O item pendente é evidência operacional no Supabase remoto, não ausência do contrato em código.

### Dispositivos

- instalar, atualizar e remover a PWA no navegador-alvo;
- testar tablet e celular com imagens e PDFs textuais, digitalizados, mistos e extensos;
- testar duas abas durante retomada real;
- medir memória, retomada após encerramento e comportamento com rede instável.

### Operação

- confirmar limites gratuitos e billing desativado na conta real;
- executar e registrar backup;
- ensaiar rollback do frontend e das Edge Functions;
- decidir se o resultado será release privada, staging prolongado ou produção.

## Ordem recomendada

1. seguir `docs/EXTERNAL_SETUP_RUNBOOK.md` para criar o staging;
2. executar `Verify Supabase staging`;
3. implantar Edge Functions e publicar o host HTTPS;
4. executar `Verify deployed Fichário`;
5. executar `Verify OCR staging`;
6. concluir a matriz manual em celular e tablet;
7. registrar billing, backup e rollback;
8. decidir o destino da release.

## Critério para alterar os percentuais

- código novo sem teste não aumenta prontidão;
- Action criada mas não executada aumenta implementação, não evidência remota;
- teste remoto verde aumenta prontidão;
- falha descoberta pode reduzir temporariamente a estimativa;
- `100%` operacional exige execução dos gates externos, não apenas ausência de itens no roadmap.
