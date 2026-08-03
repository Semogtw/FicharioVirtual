# Prontidão do Fichário Virtual

_Atualizado em 3 de agosto de 2026._

Os percentuais abaixo são uma estimativa de engenharia, não uma métrica automática. Eles separam implementação do produto de validação operacional para evitar que um MVP funcional seja confundido com uma release já pronta para dados reais.

## Estimativa atual

| Dimensão                           | Progresso estimado | Interpretação                                                                                                                                       |
| ---------------------------------- | -----------------: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP implementado em código         |            **99%** | Produto, segurança e gates externos principais estão implementados; o restante codificável está concentrado em falhas remotas e operação assistida. |
| Prontidão operacional para release |            **85%** | CI local, banco, navegador, Edge Functions, PWA e recuperação estão validados; faltam evidências no ambiente remoto e em dispositivos físicos.      |
| Progresso total ponderado do MVP   |            **95%** | Estimativa combinada, atribuindo maior peso à implementação e mantendo peso relevante para segurança e operação reais.                              |

A estimativa total usa aproximadamente 70% de peso para implementação e 30% para prontidão operacional. Ela deve cair se o staging revelar um defeito arquitetural e subir somente quando novas evidências forem executadas, não apenas documentadas.

## O que está concluído

- aplicação SvelteKit estática e responsiva;
- autenticação fail-closed por allowlist;
- biblioteca, cadernos, tags e organização em lote;
- importação otimizada de imagens;
- inspeção local e roteamento seletivo de PDFs;
- OCR persistente, retomável, concorrente e idempotente;
- busca, leitor, revisão e rascunhos locais;
- exportação portátil e painel de uso;
- RLS, Storage privado e Edge Functions sem segredo no navegador;
- PWA com cache restrito ao shell público;
- 27 migrations aplicáveis em banco limpo;
- 54 contratos pgTAP;
- 232 testes unitários em 56 arquivos;
- 3 cenários E2E no Chromium;
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
- workflow leve para formatação de documentação;
- workspace offline com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI;
- proteção do repositório de toolchains contra material de chave privada rastreado.

## O que falta para 100% do MVP

### Evidência remota

- criar o projeto Supabase de staging;
- aplicar migrations remotamente;
- cadastrar duas contas exclusivas de teste;
- executar `Verify Supabase staging`;
- implantar as Edge Functions com secrets exclusivos de staging;
- executar `Verify OCR staging` com confirmação explícita;
- publicar um host HTTPS e executar `Verify deployed Fichário`.

### Persistência de falhas OCR em staging

- observar 429 diário/transitório, 503, timeout e payload inválido passando pela função implantada;
- confirmar `page.status`, `ocr_jobs.status`, `last_error_code`, `next_retry_at` e `finished_at`;
- confirmar retomada depois do backoff e limpeza somente após terminal válido;
- verificar que nenhuma falha habilita cobrança, endpoint alternativo ou fallback silencioso.

A classificação, a resposta pública e o cálculo de backoff desses cenários já estão cobertos localmente por HTTP loopback. O item pendente é evidência operacional no Supabase remoto, não ausência do contrato em código.

### Dispositivos

- instalar, atualizar e remover o PWA no navegador-alvo;
- testar tablet e celular com PDFs extensos, digitalizados e mistos;
- medir memória, retomada após encerramento e comportamento com rede instável.

### Operação

- confirmar limites gratuitos e billing desativado na conta real;
- registrar procedimento de backup e rollback usado no ambiente escolhido;
- decidir se o resultado será release privada, staging prolongado ou produção.

## Critério para alterar os percentuais

- código novo sem teste não aumenta prontidão;
- Action criada mas não executada aumenta implementação, não evidência remota;
- teste remoto verde aumenta prontidão;
- falha descoberta pode reduzir temporariamente a estimativa;
- 100% exige execução dos gates externos, não apenas ausência de itens no roadmap.
