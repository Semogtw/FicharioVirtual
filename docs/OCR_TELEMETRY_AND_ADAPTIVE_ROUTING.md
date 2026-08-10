# Telemetria de OCR e roteamento adaptativo Gemini/local

**Status:** telemetria de uso e classificação Gemini por página implementadas; roteamento adaptativo ainda não ativado  
**Última revisão:** 10 de agosto de 2026  
**Objetivo:** maximizar qualidade e quantidade usando Gemini como recurso de maior qualidade e OCR local como capacidade de overflow, sem depender de estimativas fixas de quota

## 1. Decisão

O Fichário não deve usar a política ingênua “Gemini até a cota acabar e local depois”.

A política alvo é **valor de qualidade por unidade de cota**:

- Gemini recebe prioridade nas páginas em que a diferença de qualidade esperada contra o OCR local é maior;
- OCR local absorve páginas fáceis, repetitivas ou de grande volume quando a melhoria esperada do Gemini é pequena;
- quota temporária (`RPM`/`TPM`) continua usando retry/backoff;
- quota diária real não provoca retry agressivo e pode liberar trabalho para a rota desktop;
- uma pequena fração futura de páginas pode ser processada em modo `shadow` por Gemini e local para medir diferença real entre os backends;
- nenhuma cobrança ou fallback pago é ativado automaticamente.

Gemini continua sendo o OCR principal de qualidade. O objetivo da rota local é **economizar capacidade Gemini onde ela agrega pouco**, não vencer o Gemini universalmente.

## 2. O que está implementado agora

A base de telemetria foi implementada em três camadas.

### 2.1 Captura da resposta Gemini

`supabase/functions/_shared/gemini-ocr-client.ts` captura de `usageMetadata` somente campos numéricos/sanitizados:

- `promptTokenCount`;
- `cachedContentTokenCount`;
- `candidatesTokenCount`;
- `toolUsePromptTokenCount`;
- `thoughtsTokenCount`;
- `totalTokenCount`;
- detalhes de tokens por modalidade;
- `serviceTier`;
- `modelVersion`;
- `responseId`.

Referência oficial:

- <https://ai.google.dev/api/generate-content>
- <https://ai.google.dev/gemini-api/docs/generate-content/tokens>

O parser limita modalidades/contagens, não persiste o JSON bruto da resposta e não inclui prompt, texto OCR ou bytes de imagem na telemetria.

A mesma resposta multipágina também solicita um `contentClass` fechado para cada página. Essa classificação é explicitamente **telemetria**: o prompt diz que ela não pode resumir, normalizar ou alterar a transcrição. Não existe uma segunda chamada Gemini para classificar.

### 2.2 Persistência no PostgreSQL

Migration:

```text
supabase/migrations/202608101045_ocr_provider_telemetry.sql
```

Tabelas:

```text
ocr_provider_usage_events
└── uma linha por chamada ao provedor

ocr_provider_page_metrics
└── uma linha por página participante daquela chamada
```

`ocr_provider_usage_events` armazena:

- usuário/documento/lote;
- provedor/modelo/versão real retornada;
- versão do prompt;
- tipo físico do documento (`image`/`pdf`);
- sucesso/erro e código seguro;
- páginas e bytes da chamada;
- latência do provedor;
- tokens de prompt, cache, saída, tools, thinking e total;
- detalhes sanitizados por modalidade;
- service tier e identificador de resposta do provedor.

`ocr_provider_page_metrics` armazena:

- página e número original;
- bytes da imagem derivada;
- quantidade de caracteres retornados;
- quantidade de warnings;
- `needsReview`;
- classe de conteúdo;
- motivo do roteamento;
- flag de shadow sample.

### 2.3 Integração no `process-ocr`

`supabase/functions/process-ocr/index.ts` agora:

1. gera um UUID de telemetria antes da chamada Gemini;
2. mede somente a latência da chamada ao provedor;
3. em sucesso, grava tokens oficiais + métricas por página + `contentClass` retornado pelo Gemini;
4. em erro, grava páginas/bytes/latência/código seguro mesmo quando não existe `usageMetadata`;
5. trata a persistência de telemetria como **best-effort**: inclusive exceção de transporte na escrita da telemetria é isolada e nunca transforma um OCR válido em erro.

Isso permite observar inclusive quantas chamadas terminaram por quota sem armazenar o corpo de erro do Google.

## 3. Privacidade e fronteira de dados

Telemetria **não pode conter**:

- imagem ou PDF;
- bytes/base64;
- prompt;
- texto OCR;
- correção do usuário;
- URL assinada;
- path privado de Storage/Drive;
- API key/token;
- corpo bruto de erro do provedor.

As tabelas possuem RLS forçada. O usuário autenticado recebe somente `SELECT` das próprias linhas; escrita ocorre pelo RPC validado `record_ocr_provider_usage`.

O RPC verifica:

- usuário autenticado/permitido;
- ownership do documento;
- ownership e vínculo do lote quando existe;
- pertencimento de cada página ao documento;
- unicidade do manifesto;
- limites numéricos e classes permitidas;
- coerência entre evento de sucesso e ausência de código de erro.

O vínculo opcional com `ocr_batches` usa `ON DELETE RESTRICT`, evitando apagar silenciosamente a proveniência de uma chamada já medida.

## 4. Tokens exatos x atribuição por página

`usageMetadata` descreve a **requisição inteira**. Em um lote com 20 páginas, o provedor informa tokens exatos do lote, não necessariamente tokens exatos de cada página.

Regra arquitetural:

> Nunca transformar uma divisão estimada em “tokens reais da página”.

Hoje:

- tokens ficam exatos no evento de provedor;
- por página ficam medidas observáveis: bytes, caracteres de saída, warnings, classe e review;
- nenhuma coluna `estimated_prompt_tokens` é criada nesta fase.

No futuro, se for útil estimar custo por página, a estimativa deve carregar explicitamente um método de atribuição, por exemplo resolução/tiles + proporção de saída, e permanecer separada do total oficial.

## 5. Classificação de conteúdo implementada

A telemetria aceita as seguintes classes:

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

Nas chamadas Gemini multipágina, o contrato pede exatamente uma dessas classes por página. O parser:

- valida a enumeração;
- persiste a classe junto da métrica da página;
- continua aceitando a forma antiga sem `contentClass`, atribuindo `unknown` para compatibilidade;
- rejeita classes fora da lista;
- não usa a classe para modificar o texto OCR.

Isso já permite começar a construir estatísticas reais de uso e `needsReview` por tipo visual nas páginas que passam pelo Gemini.

Limitação importante: **essa classe é uma classificação do próprio Gemini depois que a rota Gemini já foi escolhida**. Ela é excelente para observabilidade e para treinar/calibrar políticas futuras, mas ainda não serve sozinha para decidir se uma página deve gastar Gemini antes da chamada.

Para classificação **pré-rota**, a próxima camada poderá combinar:

1. hint explícito do usuário/documento;
2. classificador local barato;
3. sinais de layout/qualidade da preparação da página;
4. classe histórica de páginas semelhantes ou reprocessamentos;
5. combinação versionada desses sinais.

Não inferir “manuscrito”, “livro” ou “scan ruim” apenas de filename ou tamanho do arquivo.

## 6. RPC de análise implementado

O banco expõe:

```sql
select public.get_ocr_telemetry_overview(30);
```

Janela permitida: `1..365` dias.

A resposta inclui:

- requests totais/sucesso/erro;
- páginas e bytes;
- prompt/output/thinking/total tokens;
- latência média;
- agrupamento por `document_kind`;
- agrupamento por `content_class`;
- série diária de requests, páginas e tokens.

Com a classificação Gemini agora incluída na mesma resposta OCR, `byContentClass` começa a ganhar dados semânticos assim que a migration e a função atual forem implantadas e chamadas reais forem processadas. Falhas antes de uma resposta classificável continuam corretamente em `unknown`.

## 7. Política alvo de prioridade

A ordem inicial recomendada, antes de aprendizado estatístico, é:

```text
prioridade muito alta
  manuscrito/cursiva
  impresso + manuscrito misto
  local anterior com warning/needs_review

prioridade alta
  scan degradado/foto ruim
  matemática difícil
  tabela/layout complexo

prioridade média
  livro degradado
  múltiplas colunas moderadas

prioridade baixa
  livro impresso limpo
  layout simples/repetitivo

sem Gemini quando possível
  página vazia/quase vazia
  texto nativo já existente
```

Texto nativo de PDF continua fora do OCR.

## 8. Score futuro

Não é necessário começar com ML.

Um score versionado pode combinar:

```text
prioridade =
  ganho_esperado_de_qualidade
  / custo_esperado_de_capacidade
```

Com fatores adicionais:

- urgência do documento;
- cota disponível/estado de rate limit;
- fila desktop disponível;
- histórico de qualidade do backend para aquela classe;
- tamanho esperado da chamada;
- risco de `needs_review`;
- quota reservada para páginas difíceis.

O score deve ser reproduzível e registrar `route_reason` para auditoria.

## 9. Reserva de capacidade Gemini

Quando houver estimativa confiável da capacidade diária, não permitir que um PDF enorme monopolize todo o orçamento.

Política inicial sugerida para teste, **não ativada ainda**:

```text
70–80% -> fila normal ordenada por prioridade
20–30% -> reserva para páginas difíceis, manuscrito e reprocessamento
```

Esses percentuais devem ser configuráveis e ajustados pelos dados reais. Não são limites do Google.

## 10. Shadow evaluation

Para aprender qual backend realmente vale a pena, o sistema precisa ocasionalmente processar **a mesma página** em Gemini e local.

Sem isso existe viés de seleção: se Gemini só vê páginas difíceis e local só vê páginas fáceis, as médias dos dois não são comparáveis.

A tabela já possui:

```text
shadow_sample boolean
```

O fluxo de shadow ainda não está ativado.

Rollout sugerido durante aprendizado:

```text
book_clean       3–5%
scan_degraded     10%
table_layout      10%
handwriting       15%
mixed             15%
```

Depois de obter amostra suficiente, reduzir fortemente o shadow para economizar quota.

## 11. Feedback por correção humana

A correção manual é a melhor aproximação de ground truth disponível em produção.

Fase futura:

1. preservar resultado OCR original imutável;
2. preservar texto final corrigido;
3. quando a correção for explicitamente salva, calcular métricas derivadas sem guardar cópia adicional na telemetria:
   - caracteres inseridos/removidos/substituídos;
   - distância normalizada;
   - proporção alterada;
   - alterações estruturais relevantes;
4. associar a métrica ao backend/modelo/classe que produziu o resultado.

Não interpretar toda edição como erro do OCR: o usuário pode reformular texto voluntariamente. Essa métrica precisa ser chamada de **correction delta**, não CER verdadeiro, a menos que a UI esteja em modo de revisão literal.

## 12. Dados que queremos aprender

Exemplos de perguntas que o banco deverá responder:

- quantos tokens Gemini são usados por 100 páginas?
- qual tipo de documento gera mais output/thinking?
- quantos requests um PDF de 100/300/1000 páginas consome na prática?
- quantas chamadas falham por rate limit versus quota diária?
- qual classe mais produz `needs_review`?
- qual backend local reduz mais o uso Gemini sem aumentar correções?
- Chandra é necessário em quantas páginas ou um modelo ~0,9B cobre a maior parte?
- quanto Gemini melhora manuscrito em relação ao local?
- qual tamanho de batch entrega mais páginas por request sem aumentar splits?

## 13. Fases de rollout

### Fase A — observabilidade básica — IMPLEMENTADA EM CÓDIGO

- [x] capturar `usageMetadata`;
- [x] sanitizar detalhes por modalidade;
- [x] medir latência;
- [x] persistir sucesso/erro;
- [x] persistir métricas de página sem conteúdo;
- [x] RLS e writer RPC validado;
- [x] overview de 1–365 dias;
- [x] testes unitários de sanitização/payload;
- [x] testes estáticos do contrato SQL;
- [x] isolamento best-effort para falha da telemetria.

### Fase B — classificação — PARCIALMENTE IMPLEMENTADA

- [x] taxonomia fechada de conteúdo;
- [x] classificação Gemini na mesma chamada OCR, sem request adicional;
- [x] fallback compatível para `unknown`;
- [x] persistência por página para análise posterior;
- [ ] classificador/hints **antes** da decisão de rota;
- [ ] versionar o classificador pré-rota;
- [ ] medir matriz classe x backend quando a rota local equivalente estiver disponível.

### Fase C — shadow

- [ ] selecionar amostras estratificadas;
- [ ] executar Gemini + local sem trocar automaticamente o resultado aceito;
- [ ] registrar pares comparáveis;
- [ ] limitar o orçamento de shadow.

### Fase D — qualidade por correção

- [ ] criar correction delta seguro;
- [ ] diferenciar edição livre de revisão literal;
- [ ] agregar por modelo/classe.

### Fase E — roteamento adaptativo

- [ ] introduzir score versionado;
- [ ] reservar quota para casos difíceis;
- [ ] comparar política nova contra baseline;
- [ ] ativar somente após dados suficientes;
- [ ] oferecer override `Gemini`, `local` e `local-only` quando fizer sentido.

## 14. Gates antes de chamar a telemetria de validada

O código versionado não prova o banco remoto.

Obrigatório:

```text
migration aplicada em Supabase limpo/staging: PASS
pgTAP/verify local: PASS
Edge Function type-check: PASS
smoke Gemini real com usageMetadata: PASS
contentClass real retornado e persistido: PASS
RLS owner isolation: PASS
nenhum OCR/prompt/imagem em tabela de telemetria: PASS
get_ocr_telemetry_overview com dados reais: PASS
quota/rate-limit gerando evento sanitizado: PASS
```

Até esses gates passarem, o estado correto é:

> **telemetria e classificação implementadas em código / validação de staging pendente**.

## 15. Relação com OCR local

Esta telemetria é independente do modelo local escolhido.

Ela existe justamente para decidir com dados reais entre estratégias como:

```text
Gemini principal
+ OCR local pequeno para volume
+ OCR local de alta qualidade para casos difíceis
```

ou qualquer alternativa que os benchmarks do hardware e a telemetria de produção demonstrarem melhor.

O modelo local não deve ser promovido por tamanho ou leaderboard isolado. A decisão deve combinar:

- qualidade por classe;
- correction delta;
- throughput;
- estabilidade;
- proporção de páginas que evita gastar Gemini;
- custo de oportunidade da quota Gemini.
