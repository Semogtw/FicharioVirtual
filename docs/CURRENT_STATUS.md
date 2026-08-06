# Estado atual do Fichário Virtual

_Atualizado: 2026-08-06_  
_Branch ativa: `main`_  
_Estado: OCR por lotes e quota real implementado em código; release ainda bloqueada por CI atual, banco limpo, staging externo, Drive completo, Cloudflare e dispositivos reais._

## Resumo executivo

O Fichário Virtual é uma PWA privada para organizar imagens e PDFs, preservar o original no Google Drive, extrair texto nativo, executar OCR seletivo, pesquisar, revisar e exportar metadados.

A arquitetura canônica possui quatro autoridades ou superfícies:

- **Google Drive:** arquivos originais permanentes;
- **Supabase:** Auth, PostgreSQL, RLS, filas, resultados, busca, sincronização e temporários;
- **Cloudflare Pages:** frontend estático e artefatos públicos, sem documentos privados;
- **computador confiável:** rota opcional futura para manuscritos e páginas difíceis.

O OCR Gemini agora suporta chamadas multipágina com persistência por página, lotes adaptativos, retomada e divisão seletiva. O Fichário não cria mais uma franquia diária própria; somente a quota real do provedor pode bloquear a execução.

## Capacidades já implementadas

### Produto e segurança

- conta única com allowlist fail-closed;
- interface responsiva para desktop, tablet e celular;
- biblioteca, cadernos, tags e organização em lote;
- RLS, Storage privado, Edge Functions e URLs assinadas;
- PWA sem cache de conteúdo autenticado;
- exportação JSON portátil sem tokens;
- coordenação entre abas;
- busca textual, leitor lado a lado e correção manual.

### Importação e PDFs

- importação cancelável e retomável de imagens e PDFs;
- preparação local, miniaturas, SHA-256 e deduplicação;
- inspeção local de PDFs;
- texto nativo preservado sem OCR;
- PDF misto envia somente páginas sem texto suficiente;
- teto artificial de 20 MB removido da importação local;
- original local segue por upload retomável ao Drive;
- páginas visuais são renderizadas separadamente;
- derivação acima de 12 MiB recebe uma segunda renderização conservadora;
- original nunca é recomprimido ou substituído;
- caminho direto do Google Picker aceita até 50 MiB e verifica tamanho antes do download.

O limite de 50 MiB do Picker é técnico e restrito ao download integral no navegador. Ele não é limite do documento lógico nem dos lotes de OCR. Arquivos externos maiores ainda dependem da conclusão do fluxo Drive-first por referência ou cópia.

## OCR por quota real e lotes adaptativos

A implementação está detalhada em:

- `docs/checkpoints/2026-08-06-provider-only-ocr-large-pdf-implementation.md`;
- `docs/superpowers/specs/2026-08-06-provider-only-ocr-quota-and-adaptive-batching-design.md`;
- `docs/superpowers/specs/2026-08-06-oversized-pdf-splitting-and-compression-design.md`.

### Banco

Migrations novas:

```text
202608060014_provider_only_ocr_batches.sql
202608060015_ocr_batch_usage_and_hardening.sql
202608060016_harden_ocr_batch_transitions.sql
```

Elas implementam:

- `ocr_batches` com páginas, números originais, rota, bytes, modelo, tentativas e chamadas;
- vínculo ordenado por `batch_id` e `batch_ordinal` em `ocr_jobs`;
- métricas informativas de páginas, lotes, chamadas e tentativas;
- nova assinatura de `claim_ocr_job` sem limite diário do aplicativo;
- remoção da assinatura antiga com quarto argumento;
- RLS de manifestos;
- escrita somente por RPCs validados;
- transições terminais idempotentes;
- `blocked_quota` reservado para bloqueio real do provedor.

### Planejamento

O planejador:

- ordena por número original;
- rejeita IDs e números duplicados;
- não mistura rotas;
- usa normalmente até 40 páginas;
- reduz para até 20 páginas em conteúdo denso;
- respeita limite acumulado de bytes;
- divide deterministicamente o subconjunto afetado;
- valida omissões, duplicações e páginas inesperadas.

Os valores 40 e 20 são padrões técnicos, não franquias.

### Execução

`process-ocr` aceita uma página legada ou uma lista de páginas. A função:

- valida um único documento;
- reivindica cada página;
- ignora itens já concluídos;
- baixa derivados sequencialmente;
- envia o maior prefixo seguro;
- registra manifesto e chamada;
- faz uma requisição Gemini para várias páginas;
- exige identidade estável por `pageId` e número original;
- persiste resultados válidos independentemente;
- transforma JSON truncado em páginas ausentes;
- divide somente omissões e duplicações afetadas;
- não repete páginas aceitas;
- deixa uma página isolada pendente em vez de entrar em loop;
- limpa somente temporários concluídos;
- diferencia rate limit temporário de quota diária real.

A retomada depois de reload utiliza o mesmo executor adaptativo.

### Telemetria

A tela de uso mostra:

- páginas;
- lotes;
- chamadas;
- tentativas;
- média de páginas por chamada;
- páginas bloqueadas pela quota real do provedor;
- pendências, revisão e falhas.

Nenhum contador local é apresentado como quantidade restante.

## Google Drive

Já existem:

- design e plano Drive-first;
- contratos TypeScript estritos;
- escopo `drive.file`;
- reconciliação paginada;
- checkpoint somente após persistência;
- identidade por IDs remotos;
- ausência sem perda de OCR e metadados;
- conflitos isolados;
- migrations de conexão, pastas, arquivos, jobs e conflitos;
- estado público sem tokens;
- upload local retomável do original;
- Google Picker explícito com download direto limitado.

Ainda faltam para considerar o Drive completo:

1. OAuth real e redirects finais;
2. raiz e pastas em ambiente externo;
3. Picker e upload validados com conta real;
4. feed de mudanças e runner implantados;
5. UI final de ausentes e conflitos;
6. migração dos originais antigos com rollback;
7. importação por referência ou cópia para arquivo externo acima de 50 MiB.

## Cloudflare Pages

Decisão aprovada e documentada:

- frontend estático em `build/`;
- integração Git com `main`;
- nenhum documento privado na Cloudflare;
- projeto separado para partes públicas de modelos;
- R2 desativado por padrão;
- nenhum billing automático.

Ainda faltam:

1. criar projetos reais;
2. configurar origem final, headers e fallback;
3. validar deploy e rollback;
4. validar PWA instalada em celular e tablet;
5. publicar artefatos de modelo somente depois da implementação do worker.

## Worker desktop

A arquitetura do worker continua aprovada, mas não está implementada por esta entrega.

Decisões preservadas:

- conexão HTTPS somente de saída;
- nenhuma porta pública;
- pareamento e revogação;
- claim, lease e heartbeat;
- resultado separado do Gemini;
- CPU como fallback obrigatório;
- Vulkan candidato;
- RX 6600 e ROCm experimentais até benchmark;
- nenhum service-role, chave Gemini ou refresh token no computador.

## Testes e gates adicionados

### Unitários

- planejador e bisseção;
- parser estrito do lote;
- cliente Gemini multi-imagem;
- cliente browser agregado;
- 429 temporário versus quota diária;
- PDF de 21 MiB;
- 45 páginas em 40 + 5;
- segunda renderização de página grande;
- cancelamento e retomada;
- JSON truncado;
- página isolada sem loop;
- Picker até 50 MiB.

### Banco

- claim sem quota interna;
- contador histórico alto sem bloqueio;
- concorrência;
- idempotência;
- manifesto e ordem;
- telemetria separada;
- RLS;
- transições terminais.

### Estáticos

- Deno inclui contrato multipágina;
- gate impede retorno do teto diário no código ativo;
- migration histórica permanece imutável e é explicitamente superada;
- imports unitários continuam compatíveis por reexportação.

## Estado de validação

### Executado parcialmente

Uma execução intermediária do GitHub Actions alcançou frontend, gates offline, Deno e banco, mas foi rejeitada no final porque:

- o snapshot intermediário ainda possuía divergência de Prettier;
- um teste concorrente antigo do Google Drive produziu artifact de reparo;
- etapas de navegador foram puladas.

Essa execução não aprova o código atual e também não demonstrou falha do novo OCR.

### Ainda obrigatório no mesmo SHA atual

```bash
pnpm format:check
pnpm check
pnpm lint
pnpm test:unit
pnpm check:edge
pnpm check:offline
pnpm test:db
pnpm build
pnpm test:e2e
```

Além disso:

- migrations em banco limpo;
- smoke Gemini real;
- lote real multipágina;
- fixtures acima de 50 MB e 1.000 páginas;
- hash do original antes e depois;
- cancelamento e retomada em dispositivo real;
- tablet e celular;
- confirmação administrativa de ausência de billing.

## Pendências imediatas

1. obter CI integralmente verde no SHA atual;
2. corrigir qualquer formatação ou tipo revelado pelo CI atual;
3. aplicar migrations em Supabase limpo;
4. regenerar tipos TypeScript pelo schema real;
5. executar `docs/OCR_STAGING.md`;
6. validar PDFs grandes em computador e tablet;
7. completar o Drive externo, incluindo arquivos maiores que o caminho direto do Picker;
8. implantar Cloudflare;
9. continuar worker desktop como etapa separada.

## Regras de continuidade

- não reinserir teto diário interno;
- não apresentar contadores locais como quota restante;
- não comprimir ou substituir o original;
- não repetir páginas já aceitas;
- não apagar temporário antes de todas as rotas necessárias terminarem;
- não ampliar além de `drive.file` no MVP;
- não persistir tokens no navegador;
- não colocar conteúdo privado na Cloudflare;
- não ativar R2, billing ou fallback pago automaticamente;
- não declarar release pronta sem gates, staging e dispositivos no mesmo SHA.
