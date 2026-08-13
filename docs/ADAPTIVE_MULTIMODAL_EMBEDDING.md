# Embedding multimodal adaptativo por página

**Status:** proposta arquitetural documentada; **não implementada**  
**Última revisão:** 13 de agosto de 2026  
**Objetivo:** aumentar a qualidade da busca semântica em páginas visualmente difíceis sem transformar o embedding multimodal em custo obrigatório para todo o acervo.

## 1. Decisão

O Fichário deve manter o embedding textual atual como caminho padrão e adicionar, em uma etapa futura, um **segundo sinal visual seletivo** para páginas em que a imagem original provavelmente carrega informação que o OCR/texto não representa bem.

A política alvo é:

```text
texto nativo ou OCR
        ↓
embedding textual por chunks
        ↓
canal semântico padrão

página visual difícil
        ↓
roteador determinístico, sem nova chamada de IA
        ↓
embedding visual da página
        ↓
canal semântico complementar
```

O embedding visual:

- é decidido **por página**, nunca pelo arquivo inteiro;
- não substitui OCR, FTS, fuzzy search nem os embeddings textuais;
- não é obrigatório para uma página ser pesquisável;
- é um enriquecimento de baixa prioridade e deve falhar de forma degradável;
- deve preservar a política de operação sem cobrança do projeto.

## 2. Estado atual do projeto

Hoje o Fichário usa `gemini-embedding-2` com 768 dimensões, mas envia apenas **texto** ao provedor.

Fluxo atual:

```text
PDF com texto
  → native_text
  → page_effective_text
  → normalização
  → chunks textuais
  → gemini-embedding-2
  → page_semantic_chunks

imagem / PDF escaneado
  → OCR
  → ocr_raw_text ou corrected_text
  → page_effective_text
  → normalização
  → chunks textuais
  → gemini-embedding-2
  → page_semantic_chunks
```

Arquivos relevantes:

- `supabase/functions/_shared/gemini-embedding-client.ts` — cliente atual de embedding textual;
- `supabase/functions/_shared/semantic-indexer.ts` — indexação textual por chunks;
- `supabase/functions/_shared/background-semantic-indexer.ts` — indexação textual em background;
- `supabase/functions/_shared/semantic-config.ts` — modelo e dimensão canônicos;
- `supabase/migrations/202608101410_semantic_coverage.sql` — `page_semantic_chunks` e RPCs vetoriais;
- `docs/SEMANTIC_COVERAGE.md` — contrato semântico atual;
- `docs/SEARCH_OCR_MATCHING.md` — recuperação híbrida e normalização.

A proposta deste documento **não altera esse contrato atual até ser implementada, testada e explicitamente promovida**.

## 3. Por que não aplicar embedding visual a tudo

`gemini-embedding-2` aceita texto, imagem, vídeo, áudio e PDF no mesmo espaço vetorial. Isso permite comparar uma consulta textual contra uma representação visual da página.

Entretanto, aplicar esse caminho a todas as páginas criaria trabalho redundante:

- PDFs com bom texto nativo já possuem representação textual de alta qualidade;
- páginas impressas simples normalmente são bem representadas pelo OCR;
- o canal textual já é granular por chunks e fornece bons excerpts;
- chamadas multimodais adicionais pressionam RPM/TPM/RPD do nível gratuito;
- o PDF direto é particularmente redundante na Gemini Developer API, porque o embedding de PDF processa a representação visual **e** extrai texto; PDFs escaneados recebem OCR interno automaticamente.

Segundo a documentação oficial consultada em 13 de agosto de 2026:

- `gemini-embedding-2` aceita até 8.192 tokens de entrada;
- suporta imagens PNG/JPEG, no máximo seis imagens por solicitação;
- suporta um PDF por solicitação e até seis páginas;
- para PDF, cada página adiciona 258 tokens da representação visual, além dos tokens de texto extraído;
- na Gemini Developer API, o OCR de PDFs fica ativado e não pode ser desligado;
- 768 dimensões continuam entre os tamanhos recomendados.

Referências oficiais:

- <https://ai.google.dev/gemini-api/docs/embeddings>
- <https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2>

Esses limites são externos e precisam ser revistos antes de ativar a feature em produção.

## 4. Sinal visual separado, não substituto do texto

A primeira implementação deve preferir um **embedding visual isolado da página**, e não um embedding agregado de `imagem + OCR`.

Motivos:

1. o sinal visual fica independente do texto textual já indexado;
2. uma correção posterior do OCR não obriga a reenviar a imagem;
3. o hash visual pode depender apenas da representação visual da página;
4. fica mais fácil medir se o canal visual realmente acrescenta recuperação;
5. a busca continua podendo comparar consulta textual com embedding de imagem porque o modelo usa um espaço multimodal unificado.

A variante `imagem + texto` pode ser benchmarkada depois, mas não deve ser o primeiro contrato de produção.

## 5. Identificação automática de páginas elegíveis

A decisão não deve chamar outra IA. O roteador usa sinais que já existem no pipeline de OCR ou podem ser derivados localmente.

O contrato OCR já possui a taxonomia:

```text
unknown
book_clean
scan_degraded
handwriting
mixed
table_layout
math
sparse
```

Ela é produzida na mesma chamada Gemini usada para OCR e validada por `supabase/functions/_shared/ocr-batch-contract.ts`.

A telemetria atual também persiste por página:

- `contentClass`;
- número de warnings;
- `needsReview`;
- caracteres retornados;
- bytes da imagem derivada.

Importante: essa classificação existe **depois que o OCR Gemini já ocorreu**. Isso é suficiente para a decisão de embedding visual pós-OCR, mas não deve ser confundido com um classificador pré-OCR.

### 5.1 Política inicial de roteamento

A política `visual-v1` deve começar conservadora:

| Situação | Embedding visual |
| --- | --- |
| página com `native_text` suficiente | não |
| `book_clean` sem warning/review | não |
| `handwriting` | sim |
| `scan_degraded` | sim |
| `mixed` | sim |
| `table_layout` | sim |
| `math` | sim |
| qualquer classe com `needsReview = true` | sim |
| qualquer classe com warnings relevantes | sim |
| `sparse` | somente se não for quase vazia |
| `unknown` | somente se houver warning/review ou outro sinal seguro |

O roteador deve retornar uma decisão reproduzível:

```ts
type VisualEmbeddingDecision = {
  eligible: boolean;
  reason:
    | 'native_text'
    | 'clean_textual_page'
    | 'handwriting'
    | 'degraded_scan'
    | 'mixed_content'
    | 'table_layout'
    | 'math'
    | 'ocr_review'
    | 'ocr_warning'
    | 'sparse_content'
    | 'near_blank'
    | 'unknown_conservative';
  routingVersion: 'visual-v1';
};
```

Não inferir classe por filename, extensão ou tamanho do arquivo.

### 5.2 Páginas `sparse`

`sparse` não deve significar automaticamente “gaste embedding visual”. Uma página quase vazia não merece uma chamada extra.

A primeira versão deve usar uma regra local versionada baseada em sinais como:

- tamanho do texto efetivo;
- quantidade de palavras/caixas válidas em `wordGeometry`;
- existência de warnings;
- presença de revisão necessária.

Os limiares exatos devem ser definidos por fixture/benchmark, não por intuição e não como constante escondida em UI.

### 5.3 PDFs com texto nativo e diagramas

Na primeira versão, páginas com texto nativo suficiente devem **continuar sem embedding visual**, mesmo que possam conter figuras.

Isso deliberadamente favorece economia de cota.

Uma fase posterior poderá usar sinais locais do PDF — por exemplo densidade de texto, objetos gráficos/raster ou estrutura de página — se `pdf-inspector`/PDF.js fornecerem métricas confiáveis sem chamada de IA. Só então deve ser avaliado se algumas páginas nativas merecem enriquecimento visual.

## 6. Unidade de indexação visual

A unidade deve ser **uma página = um embedding visual**.

Não usar um embedding único para um PDF inteiro porque:

- a busca abre páginas específicas;
- o índice textual já é page-based;
- documentos longos perderiam granularidade;
- a invalidação seria muito mais cara;
- uma página difícil não deve fazer outras páginas do mesmo arquivo consumir cota.

Para PDFs, a rota inicial deve preferir uma representação renderizada da página em PNG/JPEG em vez de enviar o PDF inteiro ao endpoint de embedding.

Isso evita usar o OCR interno obrigatório do embedding de PDF quando o Fichário já possui sua própria transcrição e mantém a indexação alinhada à unidade de página.

## 7. Preparação da mídia

O embedding visual não pode alterar o original do Drive.

### Imagem original

Se a página já for uma imagem PNG/JPEG segura e dentro dos limites técnicos, ela pode ser usada diretamente ou através de um derivado efêmero equivalente.

### Página de PDF

Renderizar somente a página elegível usando o pipeline existente de PDF.js. O resultado enviado ao Embedding 2 deve ser PNG ou JPEG, pois são os formatos de imagem documentados para o modelo.

O projeto já produz derivados temporários para OCR. A implementação deve reutilizar o máximo possível desse trabalho, mas sem assumir que WebP é aceito pelo endpoint de embedding.

Se o derivado OCR for WebP, a rota visual pode:

1. produzir um JPEG/PNG efêmero a partir dos mesmos pixels; ou
2. escolher JPEG para a página quando a decisão visual já estiver disponível antes da limpeza.

Nenhuma cópia multimodal permanente deve ser criada apenas para essa feature.

## 8. Momento da decisão e lifecycle

A decisão visual pode ocorrer imediatamente após o parse bem-sucedido do OCR, quando `contentClass`, warnings e `needsReview` estão disponíveis.

Fluxo alvo:

```text
OCR concluído
   ↓
persistir texto/telemetria normalmente
   ↓
visualEmbeddingDecision(page)
   ↓
┌──────────── não ────────────→ fluxo atual termina
│
sim
   ↓
enfileirar enriquecimento visual
   ↓
worker visual gera embedding
   ↓
persistir vetor
```

Falha do enriquecimento visual **nunca pode reverter um OCR válido nem impedir a página de ficar pesquisável**.

O trabalho visual deve ter prioridade abaixo de:

1. OCR necessário para tornar uma página pesquisável;
2. indexação semântica textual básica;
3. operações interativas do usuário.

Se a implementação precisar manter um derivado temporário para retry, a limpeza deve preservar apenas o mínimo necessário e removê-lo assim que o job visual atingir um estado terminal. Não criar retenção indefinida.

## 9. Persistência proposta

Não reutilizar `page_semantic_chunks` para vetores visuais. Os dois canais têm granularidade e política de invalidação diferentes.

Tabela proposta:

```text
page_visual_embeddings
  id
  user_id
  page_id
  model
  source_hash
  routing_version
  embedding vector(768)
  created_at
  updated_at
```

Propriedades obrigatórias:

- RLS por owner;
- escrita apenas por RPC/Edge Function validada;
- uma variante canônica por página/modelo/hash;
- nenhum byte de imagem, OCR, prompt ou URL persistido na tabela;
- `source_hash` representa a fonte visual da página, não `page_effective_text`.

O hash visual precisa ser definido a partir de uma identidade estável da página/derivado. Se o schema atual não expuser um hash por página adequado, a implementação deve introduzir um campo/derivação explícita em vez de reutilizar incorretamente o hash textual.

### Jobs/falhas

Se a feature tiver retry durável, usar uma fila própria ou generalizar a quarentena semântica para distinguir canais:

```text
channel = text | visual
```

Não permitir que uma página visual problemática bloqueie o backfill textual.

## 10. Cliente Gemini

O cliente atual `gemini-embedding-client.ts` valida apenas entradas textuais:

```ts
{ text: string; title?: string }
```

A implementação multimodal deve preservar o caminho textual existente e adicionar um contrato explícito para mídia, por exemplo:

```ts
type GeminiVisualEmbeddingInput = {
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
};
```

Requisitos:

- `gemini-embedding-2` permanece o modelo canônico;
- `outputDimensionality = 768`;
- lote visual respeita no máximo seis imagens por request, com margem operacional se benchmarks mostrarem necessidade;
- resposta precisa ter exatamente um vetor válido por item esperado;
- vetores continuam normalizados antes da persistência;
- bytes da imagem nunca entram em logs/telemetria;
- erros 429 interrompem o lote visual e entram em backoff sem derrubar busca/OCR.

## 11. Recuperação com três canais

A busca passa a ter três fontes independentes:

```text
1. lexical/fuzzy
2. embedding textual por chunk
3. embedding visual por página
```

A consulta continua textual e gera **um único embedding de consulta** no mesmo `gemini-embedding-2`. Esse vetor pode ser comparado tanto com os chunks textuais quanto com os vetores visuais.

RPC proposta:

```text
search_pages_visual_semantic
```

Ela retorna pelo menos:

- página/documento/caderno;
- similaridade visual;
- ausência de excerpt inventado.

O canal visual não deve produzir uma “citação textual” falsa. A interface abre a página original; se não houver correspondência lexical, não inventa palavra para destacar.

### Ranking

A fusão deve continuar determinística por RRF, mas não fixar pesos de produção antes de benchmark.

Princípios:

- preservar a força de matches lexicais fortes;
- preservar o canal textual semântico já validado;
- começar com contribuição visual limitada;
- medir ganho de recall antes de aumentar o peso visual;
- impedir que ruído visual desloque resultados textuais claramente melhores.

A implementação deve adicionar um benchmark determinístico com consultas reais/fixtures representativas antes de promover novos pesos.

## 12. Economia de cota

A feature existe para melhorar qualidade **sem duplicar a carga do corpus inteiro**.

Controles obrigatórios:

- uma página visual recebe no máximo um embedding visual por versão/hash;
- texto nativo limpo não entra por padrão;
- `book_clean` sem problemas não entra por padrão;
- quase vazio não entra;
- correção textual não invalida vetor visual quando o embedding é image-only;
- jobs visuais têm prioridade inferior e podem aguardar rate limit;
- nenhuma falha visual bloqueia FTS/fuzzy ou embedding textual;
- nenhum teto diário artificial é apresentado como “quota restante”; a resposta real do provedor continua autoridade para bloqueio de quota;
- nenhuma rota ativa billing ou fallback pago.

Telemetria pode registrar apenas metadados como:

- quantidade de páginas elegíveis;
- quantidade realmente indexada;
- `route_reason`;
- modelo/dimensão;
- quantidade de chamadas;
- latência;
- status/código seguro;
- tamanho em bytes da entrada;
- usage metadata oficial quando disponível.

Não registrar mídia nem embeddings em telemetria.

## 13. Invalidação

Os dois canais devem ser invalidados independentemente.

### Texto

Mantém o contrato atual:

```text
page_effective_text mudou
→ source_hash textual mudou
→ chunks textuais ficam obsoletos
```

### Visual

```text
representação visual da página mudou
→ visual source_hash mudou
→ vetor visual fica obsoleto
```

Uma correção manual apenas do OCR **não** deve invalidar o visual na fase image-only.

Se uma futura variante usar `imagem + texto`, ela precisa de um hash composto e será um canal/versionamento diferente.

## 14. Rollout recomendado

### Fase A — benchmark offline/staging

- montar fixtures de `book_clean`, `scan_degraded`, `handwriting`, `mixed`, `table_layout`, `math`, `sparse` e páginas nativas;
- comparar busca textual atual contra canal visual isolado;
- medir recall útil, falsos positivos, latência, requests e volume;
- validar consulta textual contra embedding de imagem.

### Fase B — schema e cliente, sem ranking de produção

- criar persistência visual privada;
- criar roteador `visual-v1` puro/determinístico;
- adicionar cliente multimodal;
- adicionar job/worker visual;
- gravar vetores sem usá-los ainda na busca principal.

### Fase C — shadow retrieval

- consultar canal visual em paralelo;
- registrar somente métricas agregadas de overlap/posição;
- não alterar resultados do usuário;
- calibrar limiar e peso.

### Fase D — RRF em produção

- incorporar canal visual com peso calibrado;
- preservar fallback completo;
- observar quota e qualidade;
- desativação operacional simples sem migração de dados do usuário.

### Fase E — expansão opcional

Somente se dados justificarem:

- avaliar embedding combinado `imagem + texto`;
- avaliar algumas páginas de PDF com texto nativo e alta carga visual;
- aprender roteamento por métricas locais adicionais;
- reduzir ainda mais chamadas onde o visual não acrescenta recall.

## 15. Critérios de aceite

A feature só pode ser marcada como implementada quando:

1. páginas textuais limpas não recebem chamadas visuais por padrão;
2. páginas elegíveis são decididas sem chamada adicional de IA;
3. o vetor visual é page-level e separado de `page_semantic_chunks`;
4. busca textual/fuzzy e embedding textual continuam funcionando sem o canal visual;
5. falha/quota visual não altera status OCR válido;
6. mídia original nunca é modificada;
7. nenhuma mídia é persistida na telemetria;
8. RLS e RPCs isolam usuário corretamente;
9. 429/5xx possuem backoff e não criam loop agressivo;
10. benchmark demonstra ganho real nas classes alvo antes da ativação no ranking;
11. pesos/limiares do terceiro canal são cobertos por teste determinístico;
12. staging confirma billing desativado e ausência de fallback pago.

## 16. Fora de escopo da primeira implementação

- substituir OCR por embedding visual;
- eliminar `page_semantic_chunks`;
- gerar embedding visual de todas as páginas;
- enviar PDF inteiro como unidade semântica;
- usar um modelo generativo para classificar se deve gerar embedding;
- interpretar similaridade como probabilidade;
- inventar destaque textual para resultado puramente visual;
- ativar serviço pago quando a quota gratuita acabar.

## 17. Resumo da arquitetura alvo

```text
                            PÁGINA
                               │
             ┌─────────────────┴─────────────────┐
             │                                   │
       texto efetivo                        mídia original
             │                                   │
       chunks textuais                    sinais OCR existentes
             │                                   │
    Gemini Embedding 2                           │
             │                             visual-v1 router
             │                                   │
             │                              elegível?
             │                              │      │
             │                             não    sim
             │                              │      │
             │                              │  imagem da página
             │                              │      │
             │                              │  Gemini Embedding 2
             │                              │      │
             ▼                              │      ▼
 page_semantic_chunks                       │ page_visual_embeddings
             │                              │      │
             └───────────────┬──────────────┘      │
                             │                     │
consulta → embedding ────────┼─────────────────────┘
                             ▼
                   lexical + text + visual
                             ▼
                            RRF
                             ▼
                       página original
```

A ideia central é simples: **texto continua sendo o caminho barato e granular; visão entra somente quando há evidência de que pode recuperar informação perdida pela transcrição.**
