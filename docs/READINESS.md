# Prontidão do Fichário Virtual

_Atualizado em 3 de agosto de 2026._

Os percentuais abaixo são uma estimativa de engenharia, não uma métrica automática. Eles separam implementação do produto de validação operacional para evitar que um MVP funcional seja confundido com uma release já pronta para dados reais.

## Estimativa atual

| Dimensão                           | Progresso estimado | Interpretação                                                                                                                                  |
| ---------------------------------- | -----------------: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP implementado em código         |            **98%** | As funções centrais e os gates remotos de host, RLS e Storage estão implementados; o restante codificável se concentra em OCR remoto e operação. |
| Prontidão operacional para release |            **85%** | CI local, banco, navegador, Edge Functions, PWA e recuperação estão validados; faltam evidências no ambiente remoto e em dispositivos físicos. |
| Progresso total ponderado do MVP   |            **94%** | Estimativa combinada, atribuindo maior peso à implementação e mantendo peso relevante para segurança e operação reais.                         |

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
- 139 testes unitários;
- 3 cenários E2E no Chromium;
- gates de fonte, tipos, lint, build, PWA, Deno e banco;
- verificador automático do host HTTPS e dos headers;
- verificador remoto de staging com duas contas, sentinela RLS, objeto Storage privado, download exato e URL assinada;
- workspace offline com Node, pnpm/store, Chromium, Deno/cache e Supabase CLI;
- proteção do repositório de toolchains contra material de chave privada rastreado.

## O que falta para 100% do MVP

### Evidência remota

- criar o projeto Supabase de staging;
- aplicar migrations remotamente;
- cadastrar duas contas exclusivas de teste;
- executar `Verify Supabase staging`;
- observar a expiração da URL assinada no projeto remoto;
- implantar as Edge Functions com secrets exclusivos de staging.

### OCR real

- confirmar o modelo Gemini e credencial reais;
- executar OCR com imagens sintéticas e PDFs representativos;
- provocar 429 diário, rate limit transitório, 503, timeout e payload inválido;
- verificar que nenhuma falha habilita cobrança ou fallback silencioso.

### Host e dispositivos

- publicar o build em uma origem HTTPS;
- executar `Verify deployed Fichário` contra a URL final;
- instalar, atualizar e remover o PWA no navegador-alvo;
- testar tablet e celular com PDFs extensos e mistos;
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
