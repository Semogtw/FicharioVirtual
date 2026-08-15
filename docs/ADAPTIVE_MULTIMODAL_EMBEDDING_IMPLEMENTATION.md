# Implementação — embeddings visuais adaptativos

**Status:** implementação concluída, validada em staging e promovida para `active` como modo operacional contínuo. O benchmark pós-deploy ainda força `shadow` temporariamente para medir a baseline e volta para `active` ao final.

**Arquitetura:** [ADAPTIVE_MULTIMODAL_EMBEDDING.md](./ADAPTIVE_MULTIMODAL_EMBEDDING.md)

## Entregas concluídas

- [x] roteador determinístico `visual-v1` após OCR;
- [x] seleção apenas das páginas que se beneficiam de sinal visual;
- [x] derivado JPEG compartilhável entre OCR e embedding;
- [x] `page_visual_embeddings` separado, vetor 768 + HNSW;
- [x] fila privada e worker visual de baixa prioridade;
- [x] hash dos bytes visuais reais e reuse idempotente;
- [x] batch máximo de 6 imagens e limites explícitos de bytes;
- [x] retry/backoff de 429 sem bloquear OCR nem semântica textual;
- [x] cleanup em sucesso, reuse e falha terminal;
- [x] busca cross-modal com `search_pages_visual_semantic`;
- [x] modos `off`, `shadow` e `active`;
- [x] RRF multimodal sem somar duas vezes OCR e imagem correlacionados;
- [x] proteção de `lexicalRank = 1` no modo visual ativo;
- [x] confiança visual limitada à janela calibrada;
- [x] resultado visual puro abre a mídia real sem inventar excerpt/highlight;
- [x] telemetria visual sem conteúdo da página;
- [x] testes unitários e contratuais;
- [x] benchmark de staging idempotente entre execuções;
- [x] smokes PNG/JPEG, corpus de 15 documentos, negativas e cleanup real;
- [x] rollout contínuo do ranking visual em `active`.

## Configuração calibrada

Fonte: `supabase/functions/_shared/semantic-config.ts`.

- `SEMANTIC_VISUAL_SEARCH_MIN_SIMILARITY = 0.36`;
- `SEMANTIC_RRF_VISUAL_WEIGHT = 0.475`;
- `SEMANTIC_RRF_VISUAL_CONFIDENCE_WEIGHT = 0.04`;
- `SEMANTIC_RRF_VISUAL_CONFIDENCE_MARGIN_CAP = 0.1`;
- `SEMANTIC_RRF_EXACT_LEXICAL_GUARD_BONUS = 0.0045`.

Sem canal visual, o RRF textual anterior permanece inalterado. Em `active`, uma página encontrada por texto e imagem usa o sinal mais forte e apenas um pequeno bônus de corroboração. O primeiro resultado lexical recebe uma guarda específica contra uma evidência visual concorrente exagerada.

## Benchmark real aprovado

Workflow run `31864249498`, SHA `a254e43d248943fad6ccf71203dc9059e6b40c63`.

Resultado final: `status: pass`, `recommendation: promote_active`.

### Shadow

- raw visual Recall@1: `0.8571`;
- raw visual Recall@3: `0.9286`;
- raw visual MRR: `0.9008`;
- similaridade esperada mediana: `0.4371`;
- 14/14 consultas visuais esperadas acima de `0.36`;
- 0 negativas acima do threshold;
- 0 retries;
- 0 erros do RPC visual;
- nenhum sinal de quota.

### Active

- Recall@1 global: `0.8667`;
- Recall@3 global: `0.9333`;
- Recall@5 global: `0.9333`;
- MRR global: `0.9067`;
- visual Recall@1: `0.8571`;
- visual Recall@3: `0.9286`;
- visual MRR: `0.9000`;
- match lexical de controle preservado no top-1;
- 0 negativas visuais acima do threshold;
- 0 retries, 0 erros de RPC e nenhum sinal de quota;
- mediana de latência: `2408 ms`;
- p95 de latência: `4882 ms`.

Delta sobre shadow: MRR visual `+0.8286`, Recall@3 global `+0.80`, p95 `+1387 ms`; todos os gates configurados passaram.

## Estado operacional após promoção

O benchmark continua isolando as duas fases para manter comparação real entre `shadow` e `active`. Antes da medição de baseline, o workflow troca temporariamente `SEMANTIC_VISUAL_MODE=shadow`; depois ativa o canal visual, mede o ranking multimodal e, ao final, garante `SEMANTIC_VISUAL_MODE=active` novamente.

Assim, `shadow` deixou de ser o estado final de staging. Ele existe apenas como baseline temporária de validação pós-deploy. O estado contínuo esperado depois do pipeline é `active`.

O cleanup continua removendo os documentos e o fichário temporários usados pelo benchmark.

## Evidência da validação que autorizou a promoção

- `31863518399` — `Offline-Toolchains`: focused tests, `pnpm verify`, 318 arquivos / 1.358 testes, build e Edge checks;
- `31863888994` — validação oficial da `main`, incluindo browser e banco local/pgTAP;
- `31863889014` — artifact staging construído e verificado;
- `31864139871` — deploy Supabase staging e verificações reais pós-deploy;
- `31864249498` — benchmark multimodal, comparação, restore e cleanup, com recomendação `promote_active`.

## Rollout

- [x] manter `shadow` como default durante a implementação;
- [x] validar `active` somente depois de medir o índice visual;
- [x] exigir Recall@1/MRR visual >= 0.80 e match lexical preservado;
- [x] medir latência, retries, erros e quota;
- [x] obter recomendação positiva de promoção;
- [x] promover o modo operacional contínuo para `active`;
- [x] preservar `shadow` apenas como baseline temporária do benchmark pós-deploy;
- [x] restaurar `active` automaticamente ao final do benchmark.

A implementação técnica e o rollout operacional estão concluídos.
