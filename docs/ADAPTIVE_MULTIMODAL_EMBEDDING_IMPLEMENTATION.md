# Plano de implementação — embedding multimodal adaptativo

**Status:** planejado; ainda não implementado  
**Design:** [`ADAPTIVE_MULTIMODAL_EMBEDDING.md`](ADAPTIVE_MULTIMODAL_EMBEDDING.md)  
**Data:** 13 de agosto de 2026

## Objetivo

Adicionar um terceiro sinal de recuperação — embedding visual por página — sem substituir o fluxo atual de FTS/fuzzy e embeddings textuais por chunks. A implementação deve ser seletiva, degradável e compatível com operação gratuita.

## Princípios obrigatórios

- decisão por página, nunca por arquivo inteiro;
- nenhuma chamada extra de IA apenas para decidir elegibilidade;
- `gemini-embedding-2` e 768 dimensões permanecem o contrato inicial;
- primeira versão usa embedding **image-only** para desacoplar visual de correções no OCR;
- páginas com bom texto nativo e `book_clean` não entram por padrão;
- OCR válido nunca falha por causa do enriquecimento visual;
- canal visual pode ficar indisponível sem quebrar busca;
- original do Drive nunca é alterado;
- nenhuma rota paga é ativada automaticamente.

## Etapa 1 — benchmark de baseline

Criar fixtures representativas para:

- `book_clean`;
- `scan_degraded`;
- `handwriting`;
- `mixed`;
- `table_layout`;
- `math`;
- `sparse` vazio e útil;
- PDF com texto nativo;
- página com erro OCR;
- página com diagrama/fórmula cujo significado não esteja totalmente no OCR.

Cobrir consultas lexicais, conceituais, visuais e negativas. Registrar o ranking atual lexical + semântico textual antes de alterar produção.

- [ ] fixtures versionadas;
- [ ] harness de benchmark;
- [ ] baseline reproduzível;
- [ ] nenhuma alteração de peso nesta etapa.

## Etapa 2 — roteador `visual-v1`

Criar uma função pura, sugerida em:

```text
supabase/functions/_shared/visual-embedding-routing.ts
```

Entrada: presença de texto nativo, `contentClass`, warning count, `needsReview`, tamanho do texto e, quando útil, quantidade de caixas em `wordGeometry`.

Política inicial:

```text
native_text suficiente                    -> não
book_clean sem warning/review             -> não
handwriting                               -> sim
scan_degraded                             -> sim
mixed                                     -> sim
table_layout                              -> sim
math                                      -> sim
needsReview                               -> sim
warnings relevantes                       -> sim
unknown sem outro sinal                   -> não
sparse                                    -> depende de regra de quase-vazio
```

A saída deve conter `eligible`, um `reason` allowlisted e `routingVersion = visual-v1`.

- [ ] testes de todas as classes;
- [ ] quase-vazio não gera chamada;
- [ ] nenhum acesso a rede/banco dentro do roteador.

## Etapa 3 — persistência visual separada

Criar uma tabela própria, sem reutilizar `page_semantic_chunks`:

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

Criar RPCs equivalentes a:

```text
replace_page_visual_embedding
search_pages_visual_semantic
visual_embedding_stats
```

Requisitos:

- RLS owner-only;
- escrita validada por RPC/Edge Function;
- HNSW/cosseno;
- nenhuma mídia, OCR, prompt ou URL privada na tabela;
- hash visual independente do `page_effective_text`.

- [ ] migration;
- [ ] pgTAP owner isolation;
- [ ] stale-hash test;
- [ ] índice vetorial.

## Etapa 4 — hash visual

O hash atual dos chunks semânticos é textual e não pode ser reutilizado.

Definir uma identidade estável para os pixels efetivamente usados pelo embedding visual. Correção de OCR deve invalidar somente o canal textual; mudança da representação visual deve invalidar somente o canal visual.

- [ ] localizar hash/identidade reutilizável no pipeline atual;
- [ ] introduzir contrato explícito se ele não existir;
- [ ] versionar o método quando necessário.

## Etapa 5 — cliente visual do Gemini Embedding 2

Preservar o cliente textual atual e adicionar entrada explícita:

```ts
type GeminiVisualEmbeddingInput = {
	mimeType: 'image/png' | 'image/jpeg';
	bytes: Uint8Array;
};
```

Requisitos:

- 768 dimensões;
- lote compatível com o máximo documentado de seis imagens por request;
- limites de bytes e response bounded;
- abort/timeout;
- um vetor válido por entrada;
- normalização igual à usada no texto;
- bytes nunca entram em logs ou mensagens persistidas.

- [ ] testes PNG/JPEG;
- [ ] rejeição de formato/lote inválido;
- [ ] teste 429/5xx/abort;
- [ ] regressão do caminho textual.

## Etapa 6 — preparação da mídia

### Imagem

Usar PNG/JPEG original quando seguro ou derivado efêmero equivalente.

### PDF

Renderizar somente a página elegível e enviar PNG/JPEG. Não enviar o PDF inteiro na primeira versão, evitando OCR duplicado do endpoint de embedding de PDF e preservando a granularidade por página.

Como o derivado OCR pode ser WebP, a rota visual deve converter efemeramente para JPEG/PNG quando necessário.

- [ ] original nunca recomprimido/substituído;
- [ ] derivado temporário removido após estado terminal apropriado;
- [ ] hash do original inalterado.

## Etapa 7 — job/worker visual

Após OCR válido:

```text
persistir OCR
→ obter contentClass/warnings/review já produzidos
→ visual-v1
→ se elegível, enfileirar enriquecimento visual
```

O job deve ser idempotente por página/modelo/hash. Rate limit e falhas temporárias entram em backoff; erro visual nunca muda uma página de `ready` para erro de OCR.

Worker sugerido:

```text
supabase/functions/semantic-visual-worker/
```

- [ ] fila durável ou extensão segura da infraestrutura semântica existente;
- [ ] concorrência baixa;
- [ ] lote máximo de seis imagens e também limitado por bytes;
- [ ] 429 interrompe o lote sem loop agressivo;
- [ ] página problemática não bloqueia as demais;
- [ ] desligar worker visual mantém produto funcional.

## Etapa 8 — recuperação visual em shadow

Antes de mudar resultados do usuário:

```text
consulta
  → lexical
  → semantic_text
  → semantic_visual (shadow)
```

O query embedding textual existente deve ser comparado com os vetores visuais no mesmo espaço multimodal.

Medir somente agregados seguros, como quantidade de candidatos, overlap/top-K, latência e cobertura do índice visual.

- [ ] resultado visível idêntico com shadow ligado/desligado;
- [ ] benchmark de ganho por classe;
- [ ] nenhum trecho textual inventado para match puramente visual.

## Etapa 9 — RRF de três canais

Somente após benchmark positivo, estender o ranking para:

```text
lexical/fuzzy
semantic_text
semantic_visual
```

Não fixar pesos por intuição. O benchmark deve calibrar o terceiro canal e garantir que:

- match lexical forte não seja deslocado por ruído visual;
- visual recupere páginas realmente úteis perdidas pelo texto;
- ausência de embedding visual preserve o ranking anterior.

- [ ] testes determinísticos de ranking;
- [ ] pesos/limiares documentados depois da calibração;
- [ ] fallback completo para dois canais.

## Etapa 10 — UI

O documento original continua sendo o alvo da busca.

Resultado visual puro:

- abre a página correta;
- não inventa highlight;
- não inventa excerpt textual;
- pode receber um badge discreto de origem visual;
- mantém a transcrição como ferramenta auxiliar.

## Etapa 11 — telemetria e cota

Registrar somente metadados:

- canal/operação;
- modelo/dimensão;
- quantidade de imagens;
- bytes agregados;
- latência/status;
- routing reason/version;
- usage metadata oficial quando disponível;
- elegíveis/indexadas/pendentes.

Nunca registrar mídia, base64, OCR, query em claro, prompt, embedding ou URL privada.

Sem hard cap diário artificial: a resposta real do provedor continua autoridade de quota. Se a cota visual acabar, OCR, FTS/fuzzy e embedding textual continuam.

## Etapa 12 — staging e ativação

Antes do ranking visual de produção:

- [ ] migrations em banco limpo;
- [ ] pgTAP completo;
- [ ] Deno/Edge checks;
- [ ] smoke PNG/JPEG real;
- [ ] `handwriting` elegível;
- [ ] `book_clean` e `native_text` ignorados;
- [ ] retry idempotente;
- [ ] cleanup correto;
- [ ] consulta textual recuperando vetor visual;
- [ ] logs/telemetria sem dados privados;
- [ ] billing desativado confirmado.

Rollout:

1. gravação visual sem uso na busca;
2. shadow retrieval;
3. contribuição pequena calibrada no RRF;
4. recalibração usando dados reais.

A feature deve poder ser desativada operacionalmente, retornando imediatamente ao ranking lexical + textual sem interromper OCR/importação.

## Ordem sugerida de commits

1. `test(search): add visual semantic benchmark fixtures`
2. `feat(search): add deterministic visual embedding router`
3. `feat(db): add page visual embedding index`
4. `feat(search): support Gemini image embeddings`
5. `feat(search): add visual embedding worker`
6. `feat(search): add shadow visual retrieval`
7. `feat(search): fuse visual semantic ranking`
8. `docs(search): record multimodal rollout evidence`

## Definição de pronto

- [ ] roteamento seletivo por página;
- [ ] nenhuma IA extra só para decidir rota;
- [ ] image-only na primeira versão;
- [ ] visual separado de `page_semantic_chunks`;
- [ ] OCR e busca funcionam sem visual;
- [ ] cota não é duplicada no corpus inteiro;
- [ ] RLS/privacidade passam;
- [ ] original permanece intacto;
- [ ] benchmark mostra ganho nas classes alvo;
- [ ] staging real passa;
- [ ] billing/fallback pago permanecem desativados.
