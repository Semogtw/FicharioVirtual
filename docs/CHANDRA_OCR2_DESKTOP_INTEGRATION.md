# Chandra OCR 2 no Desktop OCR Worker

**Status:** candidato local recomendado; configuração final depende de benchmark no hardware  
**Última revisão:** 10 de agosto de 2026  
**Hardware alvo:** Radeon RX 6600 8 GiB + Ryzen 5 5500 + 16 GiB DDR4, CachyOS  
**Escopo:** OCR local de livros digitalizados, páginas fotografadas, escrita à mão contemporânea em papel/tablet, conteúdo misto, tabelas, fórmulas e layouts complexos

## 1. Decisão

O candidato principal para o OCR local do Fichário Virtual continua sendo **Chandra OCR 2**, da Datalab.

A decisão, porém, não presume mais que uma quantização do Chandra herda automaticamente a liderança do checkpoint de maior precisão. A diferença para concorrentes em alguns benchmarks é pequena o bastante para uma regressão de quantização potencialmente inverter a ordem.

Portanto existem três papéis diferentes:

1. **referência local de qualidade máxima:** Chandra OCR 2 F16/BF16 em execução híbrida GPU + CPU, se couber e permanecer estável no hardware;
2. **provável perfil de produção:** Chandra OCR 2 **Q8_0 + projetor visual BF16**, via `llama.cpp` + Vulkan;
3. **fallback de memória:** Chandra OCR 2 **Q6_K + projetor visual BF16** ou a maior precisão de projetor que o benchmark validar.

Nenhum deles recebe `PASS` por antecipação.

O perfil final será o que produzir a melhor qualidade no corpus real do Fichário entre todas as alternativas locais viáveis. Se OvisOCR2, dots.ocr ou outro concorrente local superar Chandra Q8/Q6 de forma consistente no corpus do projeto, o concorrente deve ser promovido em vez de Chandra.

A estratégia pretendida é:

1. usar o checkpoint oficial `datalab-to/chandra-ocr-2` como referência upstream de qualidade e proveniência;
2. tentar uma execução local F16/BF16 híbrida como **controle de perda por quantização**, sem exigir que ela seja rápida;
3. validar **Q8_0 + mmproj BF16** como primeira configuração candidata a produção;
4. testar Q6_K somente se Q8_0 apresentar OOM, instabilidade ou custo operacional inaceitável;
5. comparar cada variante com o melhor concorrente local viável no mesmo corpus;
6. manter concorrência `1`, processando uma página por vez;
7. manter Gemini como rota separada, comparação e fallback explícito — nunca como fallback pago automático;
8. não redistribuir pesos/quantizações pelo projeto de modelos do Fichário antes de revisão de licença e proveniência.

## 2. Por que Chandra OCR 2 continua sendo o candidato principal

O projeto precisa de OCR que continue útil quando a página deixa de ser um PDF limpo. O corpus esperado inclui:

- livros e apostilas digitalizados;
- scans degradados;
- páginas fotografadas;
- texto pequeno e várias colunas;
- português;
- tabelas e formulários;
- matemática;
- anotações manuscritas;
- letra cursiva;
- conteúdo impresso e manuscrito na mesma página.

O Chandra OCR 2 foi publicado especificamente como OCR/document parser com suporte a mais de 90 idiomas, handwriting, formulários, tabelas, matemática e layout complexo, com saída Markdown/HTML/JSON.

A evidência mais importante para o Fichário não é somente um leaderboard do próprio fabricante. O **RealDocBench** avalia documentos reais e difíceis com formulários densos, tabelas, small text, checkboxes, handwriting e artefatos de scanner. Nesse benchmark independente, Chandra-2 lidera os OCRs open-source avaliados com **86,2% de precisão por campo e 78,1% por questão**, enquanto Gemini 3.5 Flash marca **89,3% / 82,2%**.

A própria Datalab reporta Chandra 2 na faixa de **85,8–85,9 no olmOCR benchmark**, com resultados fortes em old scans + matemática, tabelas, múltiplas colunas e texto minúsculo. O segundo colocado nesse benchmark fica próximo o bastante para a diferença não ser tratada como margem garantida depois de quantização.

No benchmark multilíngue do fabricante, português aparece com **95,2%** para Chandra 2. Como esse resultado é do fabricante, ele deve ser usado como sinal adicional, não como prova final.

O Chandra 2 também publica exemplos específicos de `Cursive Writing`, `Handwritten Notes` e `Handwritten Math`, que correspondem ao significado de “manuscrito” neste projeto: **texto contemporâneo escrito à mão em papel ou tablet**, não escrita histórica/antiga.

### Fontes de referência

- projeto oficial: <https://github.com/datalab-to/chandra>
- checkpoint oficial: <https://huggingface.co/datalab-to/chandra-ocr-2>
- release Chandra 2: <https://github.com/datalab-to/chandra/releases/tag/v0.2.0>
- RealDocBench: <https://arxiv.org/abs/2606.07401>
- harness do RealDocBench: <https://github.com/extend-hq/realdoc-bench>
- llama.cpp multimodal: <https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md>

## 3. Quantização não é assumida como neutra

O checkpoint de maior precisão e uma quantização GGUF devem ser tratados como **modelos de execução diferentes para fins de validação**.

Não existe, no momento desta decisão, um resultado público suficientemente completo de Chandra OCR 2 BF16 versus Q8_0 versus Q6_K no mesmo benchmark de OCR que permita declarar a perda exata.

Consequências:

- não afirmar que Q8 perde “quase nada” sem medir;
- não inferir qualidade apenas por perplexidade de linguagem;
- não usar resultado BF16 para preencher score de uma quantização;
- não promover Q8 só porque é a maior quantização que cabe inteira na GPU;
- medir regressão separadamente em texto impresso, manuscrito, layout, tabelas e matemática.

A hipótese de trabalho é que Q8 tende a preservar melhor o checkpoint que quantizações agressivas, mas **hipótese não é gate de produção**.

## 4. Tamanho e estratégia para RX 6600

O Hugging Face publica o checkpoint na ordem de **5B parâmetros / BF16**. A release da Datalab usa uma contagem arredondada diferente. Para planejamento de memória, o tamanho real dos artefatos e a medição de VRAM/RAM valem mais que o número nominal de parâmetros.

Somente os pesos BF16 ficam aproximadamente na ordem de 10 GB antes de encoder visual, KV cache, buffers e runtime. Portanto não cabe inteiro nos 8 GiB da RX 6600.

Isso não impede uma tentativa de referência local em **F16/BF16 híbrido GPU + CPU** usando `llama.cpp`: carregar o máximo possível na GPU e manter o restante na RAM. Essa execução pode ser lenta; seu papel é medir a qualidade sem a incerteza da quantização.

A máquina possui apenas 16 GiB de RAM, então o perfil F16/BF16 também precisa provar que cabe de forma estável junto do sistema operacional e buffers. Se não couber, ele é registrado como `REFERENCE_NOT_RUN_OOM` e não bloqueia o teste das quantizações.

Há quantizações GGUF de terceiros com tamanhos aproximadamente nesta ordem:

- Chandra Q8_0: ~5,16 GB;
- mmproj Q8_0: ~367 MB;
- mmproj BF16: ~676 MB;
- Chandra Q6_K: ~4,08 GB em quantizações públicas.

O tamanho do arquivo não equivale ao peak VRAM. O benchmark deve registrar uso real do runtime.

## 5. Nova ordem de tentativa

```text
Controle de qualidade, se estável:
0. F16/BF16 + mmproj BF16
   GPU + CPU híbrido
   objetivo: referência, não velocidade

Candidato principal de produção:
1. Q8_0 + mmproj BF16
   Vulkan, máximo offload possível

Fallback de memória:
2. Q6_K + mmproj BF16
   ou maior precisão de mmproj que permaneça estável

Somente mediante benchmark explícito:
3. Q5_K_M / Q4_K_M
```

### Por que mmproj BF16 com Q8

O projetor visual é pequeno em relação aos pesos principais, e a diferença de memória entre mmproj Q8 e BF16 é muito menor que a diferença entre quantizações do modelo principal.

Como OCR depende diretamente da fidelidade da representação visual, o perfil inicial deve gastar essa memória adicional para preservar o projetor em BF16.

Isso é uma **decisão de engenharia a validar**, não uma alegação de que mmproj BF16 necessariamente melhora o score. O benchmark deve confirmar ou rejeitar a escolha.

Q4 não é o alvo inicial. O computador pode ser dedicado integralmente ao OCR durante a execução, portanto qualidade tem prioridade sobre throughput.

## 6. Comparadores obrigatórios

A escolha final não pode ser apenas “qual variante de Chandra usar”. Ela precisa responder também “Chandra quantizado ainda é o melhor local?”.

O corpus deve incluir, conforme disponibilidade de runtime no hardware:

1. Chandra F16/BF16 híbrido — controle de qualidade;
2. Chandra Q8_0 + mmproj BF16;
3. Chandra Q6_K + mmproj BF16, se necessário;
4. **OvisOCR2** — comparador forte de parsing/documentos impressos;
5. **dots.ocr** ou o melhor concorrente local que estiver tecnicamente viável na data do teste;
6. Gemini usado pelo projeto — referência externa, sem torná-lo dependência do benchmark local.

Se um concorrente local vencer Chandra Q8 no agregado e não apresentar regressão importante em manuscrito, scans ou estrutura, ele deve substituir Chandra como candidato padrão.

## 7. Regra de proveniência

**Nenhuma quantização de terceiros é automaticamente confiável.**

O checkpoint oficial é a origem de referência. Antes de promover qualquer GGUF, registrar:

- repositório e revision imutável;
- arquivo exato;
- SHA-256 dos pesos;
- SHA-256 do projetor visual;
- quantização;
- versão/commit do `llama.cpp`;
- prompt profile;
- parâmetros de execução e offload;
- resultado do corpus de regressão;
- licença upstream e licença/metadados declarados pelo quantizador.

O model lock deve apontar para artefatos por hash, não somente para uma tag mutável.

## 8. Licença: gate obrigatório

O **código** do projeto Chandra é Apache-2.0, mas os **pesos do modelo** usam licença OpenRAIL modificada. O model card oficial informa condições próprias para uso comercial/self-hosted.

Consequências para o Fichário:

- uso local pessoal não autoriza assumir que redistribuição pública está liberada;
- não copiar automaticamente Chandra/GGUF para o projeto Cloudflare Pages de modelos;
- não re-licenciar quantização derivada como se a licença upstream tivesse desaparecido;
- revisar os termos da versão exata antes de distribuição/release público;
- se a licença não permitir a distribuição pretendida, o instalador deve baixar o modelo diretamente da origem aprovada pelo usuário.

**Gate:** `LICENSE_REVIEW=PASS` é obrigatório antes de distribuição do artefato pelo projeto.

## 9. Estado atual do worker e impacto da integração

O Desktop OCR Worker já possui a maior parte da infraestrutura necessária:

- modelo pull/outbound-only;
- fonte privada temporária com hash;
- lease e renovação;
- spool e conclusão idempotente;
- remoção da imagem temporária;
- model lock;
- concorrência serial;
- engine abstrata por método `process()`;
- backend Ollama restrito a loopback.

A integração não deve reescrever fila, lease, spool ou autenticação. A mudança correta é **adicionar uma engine local especializada e evoluir o model lock**.

O `runner.mjs` não deve conhecer Chandra. Ele deve continuar recebendo qualquer engine que respeite o contrato genérico:

```text
engine.process(source)
  -> backend
  -> modelId
  -> modelVersion
  -> rawText
  -> correctedText
  -> contentType
  -> warnings
  -> needsReview
  -> timingMs
```

## 10. Runtime recomendado

### 10.1 Vulkan-first

O caminho alvo é **llama.cpp + Vulkan**.

Motivos:

- RX 6600 deve ser tratada como hardware Vulkan-first neste projeto;
- a arquitetura original já proíbe depender exclusivamente de ROCm;
- `llama.cpp` possui backend Vulkan e suporte multimodal;
- GGUF permite quantização e execução híbrida CPU/GPU;
- CPU permanece disponível para offload/fallback.

ROCm pode ser experimentado depois, mas não deve bloquear integração nem ser requisito de release.

### 10.2 Processo local gerenciado

Preferir instância própria de `llama-server` em vez de daemon genérico compartilhado.

```text
fichario-ocr-worker.service
├── valida model lock
├── valida SHA-256 dos artefatos
├── inicia/garante llama-server local
│   ├── bind 127.0.0.1
│   ├── Chandra fixado por hash
│   ├── mmproj fixado por hash
│   ├── Vulkan
│   └── concorrência 1
├── chama API local
└── encerra/recupera runtime conforme política
```

Uma unit separada `fichario-ocr-llama.service` é aceitável desde que:

- bind seja somente loopback;
- artefatos carregados correspondam ao lock;
- start/stop sejam explícitos;
- endpoint remoto seja proibido;
- não exista fallback silencioso para outro modelo ou outra quantização.

## 11. Backend `llama_cpp`

O contrato do worker hoje aceita `transformers` e `ollama`, mas usar `transformers` para inferência via llama.cpp seria enganoso. Adicionar explicitamente:

```text
llama_cpp
```

Alterações necessárias:

1. `tools/desktop-worker/contract.mjs` — incluir `llama_cpp` em `BACKENDS`;
2. `supabase/functions/_shared/desktop-worker-contract.ts` — espelhar o enum;
3. nova migration — permitir `llama_cpp` em `complete_desktop_ocr_job` sem editar migration antiga;
4. testes unitários e pgTAP — cobrir aceitação/rejeição;
5. UI/status — mostrar backend público `llama.cpp` sem revelar paths locais.

Não reutilizar `ollama` apenas para evitar migration. Proveniência de resultado importa.

## 12. `LlamaCppChandraEngine`

Adicionar, por exemplo:

```text
tools/desktop-worker/llama-cpp-chandra-engine.mjs
```

Responsabilidades:

- aceitar apenas `http://127.0.0.1:<porta>/` ou `[::1]`;
- rejeitar redirect;
- limitar request/response;
- respeitar `AbortSignal` e lease renewal;
- reler fonte por descriptor seguro e validar SHA-256;
- enviar imagem ao endpoint multimodal local;
- usar prompt profile Chandra versionado;
- validar e limitar saída;
- retornar contrato genérico do worker;
- nunca escrever imagem ou OCR em log.

Erros usam códigos fechados, por exemplo:

```text
llama_cpp_unavailable
llama_cpp_model_mismatch
llama_cpp_response_invalid
chandra_output_invalid
chandra_output_too_large
chandra_repetition_detected
```

## 13. Não usar o prompt genérico do Ollama

O `OllamaOcrEngine` atual força um JSON próprio com `rawText`, `contentType`, `warnings` e `needsReview`.

Esse prompt não deve ser copiado para Chandra.

Chandra foi treinado para parsing de documento e possui prompt profile/estrutura próprios, incluindo `ocr_layout`. A prioridade é preservar a distribuição de inferência em que o modelo foi treinado.

Usar um prompt profile versionado, por exemplo:

```text
chandra-ocr-2/ocr-layout-v1
```

O profile deve fazer parte da proveniência e do benchmark.

## 14. Adaptar a saída ao contrato do Fichário

### Primeira versão

- executar Chandra no modo recomendado de OCR/layout;
- armazenar saída Markdown fiel em `rawText`;
- manter `correctedText = null`;
- preservar quebras, tabelas e ordem de leitura;
- preencher `contentType` por hint do job quando disponível, senão `unknown`;
- gerar warnings somente por regras verificáveis;
- não inventar confiança numérica não calibrada.

A pesquisa/FTS deve ser testada com Markdown. Se necessário, derivar plain text determinístico para indexação sem destruir a saída original.

### Evolução recomendada

Preservar separadamente:

```text
raw_text              -> representação textual canônica
structured_text       -> Markdown/HTML original do parser
structured_format     -> markdown | html | json
prompt_profile        -> chandra-ocr-2/ocr-layout-v1
```

Uma coluna própria é preferível para `structured_text` potencialmente grande.

## 15. `contentType`, warnings e revisão

Não transformar autoavaliação do modelo em confidence sem calibração.

### `contentType`

Ordem de preferência:

1. override explícito da página;
2. hint de roteamento persistido no job;
3. classificação Gemini previamente existente, quando aplicável;
4. `unknown`.

Não fazer segunda chamada Chandra apenas para classificar sem ganho medido.

### Warnings iniciais

```text
possible_omission
layout_complex
low_legibility
uncertain_characters
```

Também detectar deterministicamente quando possível:

- saída vazia para imagem não vazia;
- repetição anormal de tokens/linhas;
- truncamento por limite;
- estrutura inválida;
- diferença extrema em reprocessamento conhecido.

`needsReview=true` deve resultar de warning relevante ou política da rota.

## 16. Model lock v2

O schema atual está preso a `backend: ollama` e um digest. Chandra multimodal possui pelo menos pesos + projetor visual.

O lock v2 deve registrar precisão de cada artefato e parâmetros suficientes para reproduzir a execução:

```json
{
	"schemaVersion": 2,
	"backend": "llama_cpp",
	"model": "datalab-to/chandra-ocr-2",
	"upstreamRevision": "REVISION_IMUTAVEL",
	"weightsPrecision": "Q8_0",
	"mmprojPrecision": "BF16",
	"promptProfile": "chandra-ocr-2/ocr-layout-v1",
	"weightsSha256": "SHA256",
	"mmprojSha256": "SHA256",
	"runtimeVersion": "LLAMA_CPP_COMMIT_OU_RELEASE",
	"executionProfile": "rx6600-quality-max-v1"
}
```

Para F16/BF16 híbrido, `weightsPrecision` e `executionProfile` devem refletir isso explicitamente.

Não colocar no lock token, URL assinada, credencial, OCR ou paths privados desnecessários.

## 17. Instalação do runtime

Criar instalador explícito, separado até a validação:

```text
tools/desktop-worker/install-chandra-runtime.sh
```

Responsabilidades:

1. verificar arquitetura/OS;
2. verificar Vulkan;
3. instalar ou apontar build conhecido do `llama.cpp`;
4. baixar artefatos somente de origem permitida;
5. validar tamanho e SHA-256;
6. gravar em cache content-addressed;
7. executar sanity-check sem documento privado;
8. permitir criação do model lock somente após validação.

O instalador não deve usar `sudo` automaticamente, aceitar binário sem hash, endpoint remoto, downgrade silencioso de precisão ou segredo em `.env`.

## 18. Configuração pretendida

Evoluir `fichario-worker-model` para backend/profile explícitos:

```bash
fichario-worker-model chandra-ocr-2 --backend llama_cpp --quality max
```

`--quality max` significa **o melhor perfil já validado no corpus deste hardware**, não a maior quantização disponível.

Exemplo de resolução depois do benchmark:

```text
F16 híbrido vence e tempo é aceitável -> F16 híbrido
Q8+mmproj BF16 é equivalente e muito mais eficiente -> Q8+mmproj BF16
Q8 perde para concorrente local -> concorrente vira padrão
Q8 OOM -> testar Q6
nenhum perfil validado -> readyToRun=false
```

O status deve expor somente informação pública:

```text
backend: llama_cpp
model: datalab-to/chandra-ocr-2
weightsPrecision: Q8_0
mmprojPrecision: BF16
promptProfile: chandra-ocr-2/ocr-layout-v1
hardwareValidation: pending | pass
```

## 19. Benchmark obrigatório na RX 6600

Fixtures privadas não entram no Git.

Corpus mínimo recomendado: **100 páginas**.

| Grupo                     | Páginas mínimas | Exemplos                                   |
| ------------------------- | --------------: | ------------------------------------------ |
| livro/apostila limpos     |              20 | impressão nítida, parágrafos, títulos      |
| livros/scans degradados   |              20 | ruído, skew, contraste ruim, bleed-through |
| manuscrito contemporâneo  |              25 | letra de forma, cursiva, caneta, tablet    |
| misto                     |              15 | impresso + anotação, formulário preenchido |
| tabelas/múltiplas colunas |              10 | tabelas, boxes, leitura não linear         |
| matemática/texto pequeno  |              10 | fórmulas, subscritos, fonte pequena        |

### Matriz de comparação

Rodar cada página, quando tecnicamente possível, com:

```text
A. Chandra F16/BF16 híbrido + mmproj BF16
B. Chandra Q8_0 + mmproj BF16
C. Chandra Q8_0 + mmproj Q8_0 (controle opcional do projetor)
D. Chandra Q6_K + mmproj BF16, se necessário
E. melhor concorrente local viável
F. OvisOCR2, quando runtime comparável estiver disponível
G. Gemini atual do projeto como referência externa
```

A comparação C existe para medir se gastar ~300 MB adicionais no projetor BF16 realmente traz benefício. Se não trouxer, mmproj Q8 pode ser preferido.

## 20. Métricas

Registrar por página:

- CER;
- WER, quando útil;
- omissões relevantes;
- hallucinations/invenções;
- ordem de leitura;
- preservação de tabela;
- fórmulas;
- legibilidade de manuscrito;
- tempo total;
- peak VRAM;
- peak RAM;
- falha/OOM;
- temperatura máxima;
- crash/restart do runtime.

Para páginas sem ground truth, usar revisão cega lado a lado. Não usar apenas “parece bom”.

Também registrar métricas agregadas **por grupo**, porque uma pequena melhora em livro impresso não deve esconder regressão grande em manuscrito.

## 21. Gate de perda por quantização

A promoção de Q8 depende primeiro da comparação com a referência de maior precisão.

Se F16/BF16 híbrido puder ser executado:

```text
CER_Q8 - CER_F16 <= limite aprovado
WER_Q8 - WER_F16 <= limite aprovado
sem regressão crítica em handwriting
sem regressão crítica em tabelas/layout
sem aumento relevante de omissões/hallucinations
```

Como ponto inicial conservador, investigar qualquer aumento de CER maior que **0,5 ponto percentual absoluto** no agregado ou regressão evidente em uma categoria crítica.

Esse número não é uma tolerância automática. Depois do primeiro corpus ele deve ser substituído por um critério baseado na variância e no impacto observado.

Se F16/BF16 não couber, a ausência do controle deve ficar documentada; não fingir que Q8 foi comparado ao checkpoint original.

## 22. Gate contra o melhor concorrente

Mesmo que Q8 preserve bem o Chandra, ele só vira padrão se continuar sendo a melhor escolha local.

Critérios mínimos:

```text
qualidade agregada >= melhor concorrente local testado
handwriting >= melhor concorrente, salvo trade-off explicitamente aceito
livros/scans >= melhor concorrente, salvo trade-off explicitamente aceito
layout/tabelas sem regressão material
nenhuma vantagem baseada apenas em velocidade
```

Uma diferença pequena deve ser avaliada por intervalo de confiança/bootstrap ou pelo menos por contagem de vitórias por página, não apenas média única.

Se houver empate estatístico/prático, preferir nesta ordem:

1. menor taxa de omissão/hallucination;
2. melhor manuscrito;
3. melhor preservação estrutural;
4. maior estabilidade;
5. menor consumo de memória;
6. maior velocidade.

## 23. Gate operacional do perfil vencedor

O perfil escolhido precisa ainda passar:

```text
100/100 páginas sem OOM: PASS
nenhum crash de driver/runtime: PASS
nenhuma troca silenciosa de modelo: PASS
hash de pesos/projetor verificado: PASS
Vulkan real confirmado quando perfil usa GPU: PASS
licença/proveniência: PASS
logs sem conteúdo privado: PASS
E2E staging: PASS
```

Se Q8 falhar somente por memória, repetir protocolo com Q6_K. Não promover Q4 apenas porque roda.

## 24. Testes automatizados a adicionar

### Unitários

- URL llama.cpp somente loopback;
- redirects rejeitados;
- response body limitado;
- imagem alterada rejeitada;
- hash de weights/mmproj divergente bloqueia start;
- model lock v1 legível durante migração;
- model lock v2 valida keys exatas;
- precisão de weights/mmproj registrada separadamente;
- backend `llama_cpp` chega ao completion contract;
- abort encerra inferência/child process;
- saída vazia/repetitiva/truncada gera código seguro;
- logs não contêm prompt, OCR, imagem, path privado ou URL assinada.

### Integração local

- fake `llama-server` loopback;
- startup/readiness;
- crash/restart;
- timeout;
- modelo errado;
- mmproj errado;
- profile de precisão errado;
- uma página válida -> spool -> complete.

### Banco/Edge Function

- `llama_cpp` aceito somente no campo backend;
- replay idempotente preserva backend/modelVersion;
- resultado de outro backend não finge replay idêntico;
- metadata registra runtime/prompt profile/precision sem segredo.

## 25. Segurança

A adoção de Chandra não muda a fronteira de confiança:

```text
Internet
   ↓ HTTPS de saída
Fichário worker
   ↓ arquivo temporário verificado
llama.cpp local em loopback
   ↓
Chandra OCR 2
```

Proibido:

- bind `0.0.0.0` para inferência;
- endpoint remoto sem nova decisão de arquitetura;
- enviar imagem para serviço externo por acidente;
- armazenar imagem original no spool;
- logar output Chandra;
- carregar tag mutável sem digest;
- aceitar modelo que mudou de bytes mantendo o nome;
- trocar precisão/modelo silenciosamente após OOM.

## 26. Sequência de implementação

### Fase A — decisão e corpus

- [x] selecionar Chandra OCR 2 como candidato principal;
- [x] documentar risco de quantização;
- [x] separar referência F16/BF16 de perfil de produção Q8;
- [ ] preparar corpus privado fora do Git;
- [ ] registrar ground truth representativo.

### Fase B — contrato/runtime

- [ ] adicionar backend `llama_cpp` ponta a ponta;
- [ ] criar model lock v2;
- [ ] criar verificador GGUF/mmproj;
- [ ] implementar `LlamaCppChandraEngine`;
- [ ] adicionar prompt profile versionado;
- [ ] criar testes unitários/fake-server.

### Fase C — precisão e Vulkan RX 6600

- [ ] buildar/instalar llama.cpp com Vulkan;
- [ ] confirmar RX 6600 realmente usada;
- [ ] tentar F16/BF16 híbrido como controle;
- [ ] testar Q8_0 + mmproj BF16;
- [ ] testar Q8_0 + mmproj Q8 opcionalmente;
- [ ] medir VRAM/RAM/latência/temperatura;
- [ ] testar Q6_K somente se necessário;
- [ ] executar melhor concorrente local comparável.

### Fase D — qualidade

- [ ] comparar CER/WER por grupo;
- [ ] medir omissões e hallucinations;
- [ ] revisar handwriting separadamente;
- [ ] revisar layout/tabelas separadamente;
- [ ] comparar quantização versus referência;
- [ ] comparar perfil vencedor versus concorrente local;
- [ ] registrar decisão reproduzível.

### Fase E — integração E2E

- [ ] executar job real contra staging;
- [ ] validar lease renewal em inferência longa;
- [ ] validar spool após queda de rede;
- [ ] validar cleanup;
- [ ] comparar resultado Gemini x local na UI;
- [ ] registrar receipt/checkpoint.

### Fase F — promoção

- [ ] licença aprovada;
- [ ] perfil de precisão aprovado;
- [ ] hashes/revision fixados;
- [ ] documentação de instalação atualizada;
- [ ] `readyToRun` passa a incluir validação do runtime;
- [ ] somente então declarar o modelo/perfil padrão.

## 27. O que não fazer

- não assumir que Q8 preserva a posição do BF16;
- não assumir que Q8 vence porque Chandra BF16 vence;
- não trocar Ollama por implementação improvisada;
- não chamar quantização de terceiros de oficial;
- não assumir que arquivo <8 GB significa que cabe em 8 GiB de VRAM;
- não medir apenas velocidade;
- não validar handwriting com benchmark só de PDF digital;
- não usar benchmark do fabricante como única fonte;
- não perder Markdown/layout para encaixar em JSON genérico;
- não marcar RX 6600/Vulkan como PASS antes da execução real;
- não apagar resultado Gemini quando o local gerar outro;
- não promover um modelo porque é maior;
- não esconder que F16/BF16 não pôde ser executado se houver OOM.

## 28. Critério final de escolha

A decisão final passa a ser:

> **Escolher a configuração local que tiver a melhor qualidade medida no corpus real do Fichário, usando Chandra F16/BF16 híbrido como controle de qualidade quando possível e tratando Q8/Q6 como candidatos independentes que precisam provar que preservam a vantagem do modelo.**

A hipótese principal de produção é hoje:

```text
Chandra OCR 2 Q8_0
+ mmproj BF16
+ llama.cpp/Vulkan
+ concorrência 1
```

Mas o perfil de **qualidade máxima a tentar primeiro como referência** é:

```text
Chandra OCR 2 F16/BF16
+ mmproj BF16
+ offload híbrido GPU/CPU
+ concorrência 1
```

Se esse perfil for estável e o tempo por página for aceitável, ele próprio pode virar o perfil `quality=max`. Se Q8 produzir qualidade indistinguível com vantagem operacional grande, Q8 deve ser preferido. Se um concorrente local superar Q8/Q6 no corpus real, o concorrente deve ser promovido.

Até os gates passarem, a documentação deve dizer **“candidato recomendado / validação pendente”**, nunca “modelo local validado”.
