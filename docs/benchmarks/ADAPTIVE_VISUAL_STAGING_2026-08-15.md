# Benchmark de staging — busca visual adaptativa — 2026-08-15

## Identificação

- SHA: `a254e43d248943fad6ccf71203dc9059e6b40c63`
- Validate current head: `31863888994` — success
- Artifact staging: `31863889014` — success
- Deploy Supabase staging: `31864139871` — success
- Verify adaptive visual staging: `31864249498` — success
- threshold visual: `0.36`
- estado normal após o teste: `SEMANTIC_VISUAL_MODE=shadow`

O corpus de benchmark usou bytes PNG únicos por execução por meio de metadata não visual, preservando a geometria dos padrões e impedindo reuse acidental de embeddings de uma execução anterior. Também houve smoke JPEG.

## Shadow

- Recall@1 global: `0.1333`;
- Recall@3 global: `0.1333`;
- MRR global: `0.1333`;
- raw visual Recall@1: `0.8571`;
- raw visual Recall@3: `0.9286`;
- raw visual MRR: `0.9008`;
- similaridade esperada mediana: `0.4371`;
- esperados visuais acima do threshold: `14/14`;
- negativos visuais acima do threshold: `0`;
- RPC errors: `0`;
- search retries: `0`;
- latência mediana: `2129 ms`;
- latência p95: `3495 ms`.

O baixo Recall/MRR global é esperado em `shadow`: o terceiro canal é medido, mas não altera a ordenação entregue.

## Active

- Recall@1 global: `0.8667`;
- Recall@3 global: `0.9333`;
- Recall@5 global: `0.9333`;
- MRR global: `0.9067`;
- visual Recall@1: `0.8571`;
- visual Recall@3: `0.9286`;
- visual Recall@5: `0.9286`;
- visual MRR: `0.9000`;
- raw visual MRR: `0.9008`;
- negativos visuais acima do threshold: `0`;
- RPC errors: `0`;
- search retries: `0`;
- latência mediana: `2408 ms`;
- latência p95: `4882 ms`.

O match lexical de controle permaneceu no top-1.

## Delta

- visual MRR: `+0.8286`;
- Recall@3 global: `+0.80`;
- latência p95: `+1387 ms`.

## Gates

Todos passaram:

- `noQuotaSignal`;
- `noSearchRetries`;
- `noVisualRpcErrors`;
- `noRecallRegression`;
- `visualImproved`;
- `visualTop1Quality`;
- `visualMrrQuality`;
- `lexicalPreserved`;
- `noNegativeVisualThresholdHits`;
- `negativeNotWorse`;
- `latencyAcceptable`.

Recomendação automática do relatório: `promote_active`.

## Cleanup

- documentos tentados: 16;
- documentos removidos: 16;
- fichário temporário removido: sim;
- falhas: nenhuma.

O workflow restaurou `SEMANTIC_VISUAL_MODE=shadow` antes do encerramento. A recomendação de promoção é evidência para uma mudança deliberada de rollout; o benchmark não altera sozinho o default operacional.
