# Rollout das migrations de OCR por lotes

_Atualizado em 6 de agosto de 2026._

Este runbook complementa `docs/DEPLOYMENT.md`. As migrations abaixo são cumulativas, forward-only e precisam ser aplicadas na ordem exata antes da Edge Function `process-ocr` correspondente ao código atual.

## Ordem obrigatória

```text
202608060014_provider_only_ocr_batches.sql
202608060015_ocr_batch_usage_and_hardening.sql
202608060016_harden_ocr_batch_transitions.sql
202608060017_harden_ocr_batch_manifest_jobs.sql
202608060018_recover_stale_ocr_batches.sql
```

## Responsabilidade de cada migration

### 014 — quota do provedor e manifestos

- remove a assinatura de `claim_ocr_job` que recebia limite diário interno;
- cria `ocr_batches` e o vínculo inicial com `ocr_jobs`;
- adiciona telemetria de lotes, chamadas e tentativas;
- eleva o bucket remoto `documents` para pelo menos 50 MiB como compatibilidade transitória da migração Drive-first;
- mantém o original permanente no Google Drive como arquitetura alvo.

### 015 — telemetria e superfície de escrita

- valida arrays positivos de números de página;
- restringe escrita direta em `ocr_batches`;
- amplia `get_usage_overview()` com páginas, lotes, chamadas, tentativas e bloqueios reais;
- não cria franquia local nem contador de páginas restantes.

### 016 — transições terminais

- torna chamadas e finalização de lote idempotentes;
- impede reabertura de lote definitivamente `ready` ou `failed`;
- qualifica timestamps para evitar colisão entre parâmetros e colunas.

### 017 — integridade e linhagem

- muda a referência `ocr_jobs.batch_id` para `ON DELETE RESTRICT`;
- exige um job vinculável para cada página solicitada;
- valida pares ordenados de `pageId` e número original;
- religa atomicamente jobs de lotes `retryable` ou `blocked_quota`;
- infere um único lote-pai seguro;
- reagrupa múltiplos pais terminais sem inventar linhagem;
- deriva `split_depth` mesmo quando um cliente antigo ainda envia zero;
- recusa jobs ligados a lote ativo ou terminal definitivo.

### 018 — recuperação após interrupção

- recupera jobs `processing` sem progresso há pelo menos 15 minutos;
- coloca job, página e manifesto em `retryable` na mesma transação;
- registra `stale_processing_claim` sem conteúdo privado;
- preserva jobs e lotes ainda frescos.

## Aplicação

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase test db
```

Não implante `process-ocr` novo antes de o banco possuir as cinco migrations. Não edite migration já aplicada; qualquer correção posterior deve receber novo timestamp.

## Validação mínima

Os pgTAP relevantes incluem:

```text
supabase/tests/ocr_batches.sql
supabase/tests/ocr_batch_transitions.sql
supabase/tests/ocr_batch_manifest_integrity.sql
supabase/tests/ocr_batch_stale_recovery.sql
```

A validação precisa demonstrar:

- contador local elevado não bloqueia claim;
- página sem job não cria manifesto parcial;
- números trocados entre IDs são rejeitados;
- referências históricas não podem ser apagadas em cascata;
- lote-filho preserva pai e profundidade;
- crash libera job, página e lote;
- job fresco não é recuperado prematuramente;
- RLS e grants continuam fail-closed.

## Rollback

As migrations são forward-only. Em caso de defeito:

1. interrompa novas invocações de `process-ocr`;
2. preserve `ocr_batches`, `ocr_jobs`, páginas e telemetria;
3. crie uma migration corretiva;
4. não restaure a assinatura com limite diário;
5. não apague manifestos referenciados;
6. reexecute pgTAP em banco limpo antes de reimplantar a função.
