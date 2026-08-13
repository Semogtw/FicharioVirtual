# Documentação do Fichário Virtual

Este diretório concentra a documentação técnica, operacional e de acompanhamento do projeto. O `README.md` da raiz serve como apresentação estável do Fichário Virtual; estado de desenvolvimento, pendências, decisões em andamento e recibos de validação pertencem aos arquivos abaixo.

## Acompanhamento do desenvolvimento

- [`CURRENT_STATUS.md`](CURRENT_STATUS.md) — estado canônico do projeto: o que está implementado, validado e ainda pendente.
- [`READINESS.md`](READINESS.md) — critérios de prontidão e bloqueios para release/deploy.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — plano de implementação e próximos passos.
- [`TESTING.md`](TESTING.md) — estratégia de testes, gates e recibos de validação.

Ao registrar progresso, prefira atualizar um desses arquivos em vez de adicionar snapshots, SHAs, runs de CI ou listas de pendências ao `README.md` da raiz.

## Produto e arquitetura

- [`PROJECT_SPEC.md`](PROJECT_SPEC.md) — especificação canônica do produto e da arquitetura.
- [`SEARCH_OCR_MATCHING.md`](SEARCH_OCR_MATCHING.md) — busca global híbrida: FTS/fuzzy, embeddings, pgvector, ranking, consentimento e fallback textual.
- [`UNIT_TOPIC_COVERAGE.md`](UNIT_TOPIC_COVERAGE.md) — cobertura de assuntos por unidade, editor estruturado de conteúdos e importação de ementa por foto/OCR.
- [`SEMANTIC_COVERAGE.md`](SEMANTIC_COVERAGE.md) — embeddings, índice pgvector compartilhado, score híbrido, consentimento e verificador Gemini da cobertura de conteúdos.
- [`ADAPTIVE_MULTIMODAL_EMBEDDING.md`](ADAPTIVE_MULTIMODAL_EMBEDDING.md) — design proposto para embedding visual seletivo por página, roteamento por sinais do OCR e economia de cota.
- [`ADAPTIVE_MULTIMODAL_EMBEDDING_IMPLEMENTATION.md`](ADAPTIVE_MULTIMODAL_EMBEDDING_IMPLEMENTATION.md) — plano de implementação, benchmark, schema, worker, shadow retrieval e rollout do canal visual.
- [`superpowers/specs/`](superpowers/specs/) — designs e decisões técnicas detalhadas.
- [`superpowers/plans/`](superpowers/plans/) — planos de implementação associados aos designs.

## Google Drive, infraestrutura e deploy

- [`GOOGLE_DRIVE_SETUP.md`](GOOGLE_DRIVE_SETUP.md) — configuração da integração com Google Drive.
- [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md) — configuração do host e artefatos públicos na Cloudflare.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — processo de deployment, verificação e rollback.
- [`EXTERNAL_SETUP_RUNBOOK.md`](EXTERNAL_SETUP_RUNBOOK.md) — passos que dependem de serviços e ambientes externos.
- [`FREE_TIER_OPERATIONS.md`](FREE_TIER_OPERATIONS.md) — operação dentro das camadas gratuitas e limites associados.

## OCR e IA

- [`DESKTOP_OCR_WORKER.md`](DESKTOP_OCR_WORKER.md) — arquitetura e operação do worker local de OCR.
- [`DESKTOP_OCR_WORKER_LOCAL_RUNTIME.md`](DESKTOP_OCR_WORKER_LOCAL_RUNTIME.md) — runtime local do worker.
- [`CHANDRA_OCR2_DESKTOP_INTEGRATION.md`](CHANDRA_OCR2_DESKTOP_INTEGRATION.md) — decisão e integração do Chandra OCR 2.
- [`OCR_TELEMETRY_AND_ADAPTIVE_ROUTING.md`](OCR_TELEMETRY_AND_ADAPTIVE_ROUTING.md) — telemetria e estratégia de roteamento adaptativo.
- [`OCR_IMAGE_PREPROCESSING.md`](OCR_IMAGE_PREPROCESSING.md) — preparação conservadora de fotos/imagens, preservação do original e telemetria do perfil OCR.
- [`OCR_FAILURE_MATRIX.md`](OCR_FAILURE_MATRIX.md) — matriz de falhas e comportamento esperado.
- [`OCR_MIGRATION_ROLLOUT.md`](OCR_MIGRATION_ROLLOUT.md) — rollout/migração do fluxo de OCR.
- [`OCR_STAGING.md`](OCR_STAGING.md) — validação e operação do OCR em staging.

## Onde registrar cada tipo de informação

| Informação                       | Arquivo preferencial                      |
| -------------------------------- | ----------------------------------------- |
| Estado atual e progresso recente | `CURRENT_STATUS.md`                       |
| O que falta para release/deploy  | `READINESS.md`                            |
| Próximas etapas de implementação | `IMPLEMENTATION_PLAN.md`                  |
| Runs, gates, testes e evidências | `TESTING.md`                              |
| Decisão arquitetural duradoura   | `PROJECT_SPEC.md` ou `superpowers/specs/` |
| Procedimento operacional         | runbook específico em `docs/`             |
| Detalhes de OCR/IA               | documentação específica de OCR/IA         |

A regra geral é manter o `README.md` da raiz útil mesmo meses depois: detalhes voláteis devem viver aqui, nos documentos responsáveis por acompanhar sua evolução.
