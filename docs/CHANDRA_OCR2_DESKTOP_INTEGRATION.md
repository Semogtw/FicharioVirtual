# Chandra OCR 2 no Desktop OCR Worker

**Status:** candidato local recomendado; integração e validação em hardware ainda pendentes  
**Última revisão:** 10 de agosto de 2026  
**Hardware alvo:** Radeon RX 6600 8 GiB + Ryzen 5 5500 + 16 GiB DDR4, CachyOS  
**Escopo:** OCR local de livros digitalizados, páginas fotografadas, escrita à mão contemporânea em papel/tablet, conteúdo misto, tabelas, fórmulas e layouts complexos

## 1. Decisão

O candidato principal para o OCR local do Fichário Virtual passa a ser **Chandra OCR 2**, da Datalab.

Essa decisão significa **candidato recomendado**, não `PASS` operacional. O modelo só deve se tornar o padrão do Desktop OCR Worker depois de passar pelos gates de licença, proveniência, qualidade e estabilidade descritos neste documento na RX 6600 real.

A estratégia pretendida é:

1. usar o checkpoint oficial `datalab-to/chandra-ocr-2` como referência de qualidade;
2. validar uma versão GGUF do mesmo modelo com `llama.cpp` + Vulkan na RX 6600;
3. tentar primeiro **Q8_0 + projetor visual Q8_0** por priorizar qualidade;
4. usar **Q6_K** somente se Q8_0 não couber de forma estável ou tiver regressão operacional relevante;
5. manter concorrência `1`, processando uma página por vez;
6. manter Gemini disponível como rota separada, comparação e fallback explícito — nunca como fallback pago automático;
7. não redistribuir pesos/quantizações pelo projeto de modelos do Fichário antes de uma revisão de licença e proveniência.

O OvisOCR2 permanece um comparador importante para páginas impressas e parsing estrutural, mas não é o candidato padrão porque o corpus do Fichário inclui escrita à mão contemporânea e documentos reais heterogêneos, onde a evidência pública disponível para Chandra 2 é mais abrangente.

## 2. Por que Chandra OCR 2

O projeto precisa de um único modelo local que continue útil quando a página deixa de ser um PDF limpo. O caso de uso inclui:

- livros e apostilas digitalizados;
- scans antigos ou degradados;
- páginas fotografadas;
- texto pequeno e várias colunas;
- português;
- tabelas e formulários;
- matemática;
- anotações manuscritas;
- letra cursiva;
- conteúdo impresso e manuscrito na mesma página.

O Chandra OCR 2 foi publicado especificamente como OCR/document parser com suporte a mais de 90 idiomas, handwriting, formulários, tabelas, matemática e layout complexo, com saída Markdown/HTML/JSON.

A evidência mais importante para o Fichário não é somente um leaderboard do próprio fabricante. O **RealDocBench** avalia documentos reais e difíceis com formulários densos, tabelas, small text, checkboxes, handwriting e artefatos de scanner. Nesse benchmark independente, Chandra-2 lidera os OCRs open-source avaliados com **86,2% de precisão por campo e 78,1% por questão**, enquanto Gemini 3.5 Flash marca **89,3% / 82,2%**. Isso não prova equivalência com Gemini 3.6 Flash, mas mostra que Chandra está próximo de um VLM comercial forte em documentos reais e supera claramente os outros OCRs open-source testados no mesmo protocolo.

A própria Datalab reporta para Chandra 2 **85,9 no olmOCR benchmark**, com resultados fortes em old scans + matemática, tabelas, múltiplas colunas e texto minúsculo. No benchmark multilíngue do fabricante, português aparece com **95,2%** para Chandra 2. Como esse segundo benchmark é do fabricante, ele deve ser tratado como sinal adicional e não como prova final.

O Chandra 2 também publica exemplos específicos de `Cursive Writing`, `Handwritten Notes` e `Handwritten Math`, que correspondem ao significado de “manuscrito” neste projeto: **texto contemporâneo escrito à mão em papel ou tablet**, não “escrita histórica/antiga”.

### Fontes primárias e reprodutíveis

- projeto oficial: <https://github.com/datalab-to/chandra>
- checkpoint oficial: <https://huggingface.co/datalab-to/chandra-ocr-2>
- release Chandra 2: <https://github.com/datalab-to/chandra/releases/tag/v0.2.0>
- RealDocBench: <https://arxiv.org/abs/2606.07401>
- harness do RealDocBench: <https://github.com/extend-hq/realdoc-bench>
- llama.cpp multimodal: <https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md>

## 3. Tamanho e precisão: o que cabe na RX 6600

O Hugging Face publica o checkpoint como **5B parâmetros / BF16**. A release da Datalab descreve Chandra 2 como “4B”; essa diferença de contagem não deve ser escondida. Para planejamento de memória, usar o tamanho efetivo dos artefatos e medir VRAM real é mais seguro do que depender do número arredondado de parâmetros.

O checkpoint BF16 completo não deve ser considerado o caminho de produção na RX 6600 de 8 GiB. Somente os pesos em BF16 já ficam na ordem de 10 GB antes de encoder visual, KV cache, buffers e runtime.

Há quantizações GGUF de terceiros compatíveis com o ecossistema `llama.cpp`. Exemplos públicos incluem:

- Q8_0 de aproximadamente 5,16 GB;
- projetor visual Q8_0 de aproximadamente 367 MB;
- Q6_K de aproximadamente 4,08 GB em outro repositório de quantização.

Esses tamanhos deixam Q8_0 **plausível** em 8 GiB, mas não provado. A decisão final deve ser tomada por medição de peak VRAM na RX 6600, porque contexto, imagens, buffers Vulkan e implementação do encoder visual também consomem memória.

### Ordem de tentativa

```text
1. Q8_0 + mmproj Q8_0
   ↓ se OOM/instabilidade
2. Q6_K + mmproj Q8_0 ou equivalente validado
   ↓ somente se ainda necessário
3. Q5_K_M / Q4_K_M
```

Q4 não é a escolha inicial. O objetivo do computador é qualidade máxima, não throughput, e o usuário aceita dedicar a máquina inteira ao OCR durante o processamento.

## 4. Regra de proveniência

**Nenhuma quantização de terceiros é automaticamente confiável.**

O checkpoint oficial é a origem de referência. Antes de promover qualquer GGUF, registrar:

- repositório e revision imutável;
- arquivo exato;
- SHA-256 dos pesos;
- SHA-256 do projetor visual;
- quantização;
- versão/commit do `llama.cpp` usado para validar;
- prompt profile;
- resultado do corpus de regressão;
- licença upstream e licença/metadados declarados pelo quantizador.

O model lock deve apontar para artefatos por hash, não somente para uma tag mutável.

## 5. Licença: gate obrigatório

O **código** do projeto Chandra é Apache-2.0, mas os **pesos do modelo** usam licença OpenRAIL modificada. O model card oficial informa condições próprias para uso comercial/self-hosted.

Consequências para o Fichário:

- uso local pessoal não autoriza assumir que redistribuição pública está liberada;
- não copiar automaticamente Chandra/GGUF para o projeto Cloudflare Pages de modelos;
- não re-licenciar uma quantização derivada como se a licença upstream tivesse desaparecido;
- revisar os termos da versão exata do checkpoint antes de qualquer distribuição ou release público;
- se a licença não permitir a distribuição pretendida, o instalador deve baixar o modelo diretamente da origem aprovada pelo usuário em vez de hospedá-lo pelo Fichário.

**Gate:** `LICENSE_REVIEW=PASS` é obrigatório antes de distribuição do artefato pelo projeto.

## 6. Estado atual do worker e impacto da integração

O Desktop OCR Worker já possui a maior parte da infraestrutura que Chandra precisa:

- modelo pull/outbound-only;
- fonte privada temporária com hash;
- lease e renovação;
- spool e conclusão idempotente;
- remoção da imagem temporária;
- model lock;
- concorrência efetivamente serial;
- engine abstrata por método `process()`;
- backend Ollama restrito a loopback.

A integração não deve reescrever fila, lease, spool ou autenticação. A mudança correta é **adicionar uma engine local especializada e evoluir o model lock**.

O ponto de extensão atual é:

```text
tools/desktop-worker/service.mjs
└── createLockedOcrEngine(paths)
    └── engine.process(source)
        └── {
              backend,
              modelId,
              modelVersion,
              rawText,
              correctedText,
              contentType,
              warnings,
              needsReview,
              timingMs
            }
```

O `runner.mjs` não deve conhecer Chandra. Ele deve continuar recebendo qualquer engine que respeite esse contrato.

## 7. Runtime recomendado na RX 6600

### 7.1 Não depender de ROCm

O caminho alvo é **llama.cpp + Vulkan**.

Motivos:

- RX 6600 deve ser tratada como hardware Vulkan-first neste projeto;
- a arquitetura original já proíbe depender exclusivamente de ROCm;
- `llama.cpp` possui backend Vulkan e suporte multimodal via `libmtmd`/`llama-server`;
- isso permite usar GGUF quantizado e dedicar quase toda a VRAM ao modelo;
- CPU continua disponível para offload/fallback, embora mais lenta.

ROCm pode ser experimentado depois, mas não deve bloquear a integração nem ser requisito de release.

### 7.2 Processo local gerenciado

Preferir que o Fichário gerencie uma instância própria de `llama-server` em vez de confiar em um daemon genérico compartilhado.

Topologia alvo:

```text
fichario-ocr-worker.service
├── valida model lock
├── valida SHA-256 dos artefatos
├── inicia/garante llama-server local
│   ├── bind 127.0.0.1
│   ├── Chandra OCR 2 GGUF fixado por hash
│   ├── mmproj fixado por hash
│   ├── Vulkan
│   └── concorrência 1
├── chama API local
└── encerra/recupera runtime conforme política do serviço
```

Uma unit separada `fichario-ocr-llama.service` também é aceitável, desde que:

- o bind seja somente loopback;
- o worker consiga verificar que os artefatos carregados correspondem ao lock;
- a ordem de start/stop seja explícita;
- nenhum endpoint remoto seja aceito;
- não exista fallback silencioso para um modelo diferente.

## 8. Backend `llama_cpp`

O contrato do worker hoje aceita `transformers` e `ollama`, mas usar o nome `transformers` para uma inferência feita por llama.cpp seria enganoso. A implementação recomendada é adicionar explicitamente:

```text
llama_cpp
```

como backend permitido.

Alterações necessárias:

1. `tools/desktop-worker/contract.mjs` — incluir `llama_cpp` em `BACKENDS`;
2. `supabase/functions/_shared/desktop-worker-contract.ts` — espelhar o enum;
3. nova migration — permitir `llama_cpp` em `complete_desktop_ocr_job` sem editar migrations antigas;
4. testes unitários e pgTAP — cobrir aceitação/rejeição do novo backend;
5. UI/status — mostrar backend público `llama.cpp` sem revelar paths locais.

Não reutilizar `ollama` como nome apenas para evitar uma migration. Proveniência de resultado importa: o histórico precisa dizer qual runtime realmente produziu o texto.

## 9. `LlamaCppChandraEngine`

Adicionar uma engine dedicada, por exemplo:

```text
tools/desktop-worker/llama-cpp-chandra-engine.mjs
```

Responsabilidades:

- aceitar apenas `http://127.0.0.1:<porta>/` ou `[::1]`;
- rejeitar redirect;
- limitar tamanho de request/response;
- respeitar `AbortSignal` e lease renewal;
- reler a fonte por descriptor seguro e validar SHA-256 antes da inferência;
- enviar a imagem ao endpoint multimodal local;
- usar prompt profile versionado específico do Chandra;
- validar e limitar a saída;
- retornar o contrato genérico do worker;
- nunca escrever imagem ou OCR em log.

Erros devem continuar usando códigos fechados, por exemplo:

```text
llama_cpp_unavailable
llama_cpp_model_mismatch
llama_cpp_response_invalid
chandra_output_invalid
chandra_output_too_large
chandra_repetition_detected
```

## 10. Não usar o prompt genérico do Ollama

O `OllamaOcrEngine` atual força um JSON próprio com `rawText`, `contentType`, `warnings` e `needsReview`.

Esse prompt não deve ser copiado cegamente para Chandra.

Chandra foi treinado para parsing de documento e possui prompt profile/estrutura próprios, incluindo `ocr_layout`. A primeira prioridade deve ser **preservar a distribuição de inferência em que o modelo foi treinado**. Forçar um schema estranho pode reduzir justamente a qualidade que motivou a troca.

A implementação deve manter um prompt profile versionado, por exemplo:

```text
chandra-ocr-2/ocr-layout-v1
```

O perfil deve ser parte da proveniência do resultado e do benchmark.

## 11. Como adaptar a saída ao contrato do Fichário

### 11.1 Primeira versão

Para não bloquear a integração em uma migração grande de dados:

- executar Chandra no modo de OCR/layout recomendado;
- armazenar a saída Markdown fiel em `rawText`;
- manter `correctedText = null`;
- preservar quebras, tabelas e ordem de leitura em vez de achatá-las prematuramente;
- preencher `contentType` a partir de hint do job quando disponível; caso contrário `unknown`;
- gerar warnings somente por regras verificáveis;
- não inventar uma confiança numérica que o modelo não fornece de forma calibrada.

A pesquisa/FTS deve ser testada com Markdown. Se a marcação prejudicar busca, derivar uma representação plain-text determinística para indexação sem destruir o original.

### 11.2 Evolução recomendada

Depois do primeiro E2E, preservar separadamente:

```text
raw_text              -> representação textual canônica usada hoje
structured_text       -> Markdown/HTML original do parser
structured_format     -> markdown | html | json
prompt_profile        -> chandra-ocr-2/ocr-layout-v1
```

Alternativamente `structured_text` pode ficar em metadata somente se houver limite explícito e testes de tamanho. Uma coluna própria é preferível para conteúdo potencialmente grande.

A UI pode então usar `structured_text` para comparação rica/tabelas, enquanto a busca usa texto normalizado.

## 12. `contentType`, warnings e revisão

Não transformar autoavaliação do modelo em “confidence” sem calibração.

### `contentType`

Ordem de preferência:

1. override explícito da página;
2. hint de roteamento já persistido no job;
3. classificação previamente produzida pelo Gemini, quando o fluxo passou por Gemini;
4. `unknown`.

Não fazer uma segunda chamada Chandra somente para classificar se essa chamada puder alterar ou atrasar o resultado sem ganho medido.

### Warnings determinísticos iniciais

```text
possible_omission
layout_complex
low_legibility
uncertain_characters
```

Só emitir quando houver sinal observável. Exemplos adicionais internos podem incluir:

- saída vazia para imagem não vazia;
- repetição anormal de tokens/linhas;
- truncamento por limite de tokens;
- parser de estrutura inválido;
- diferença extrema de tamanho em reprocessamento conhecido.

`needsReview=true` deve ser consequência de warning relevante ou política da rota, não um palpite aleatório do modelo.

## 13. Model lock v2

O schema atual está preso a `backend: ollama` e um único digest de modelo. Chandra via GGUF multimodal possui pelo menos pesos + projetor visual.

Criar uma nova versão do lock sem quebrar leitura do v1 durante migração.

Shape recomendado:

```json
{
  "schemaVersion": 2,
  "backend": "llama_cpp",
  "model": "datalab-to/chandra-ocr-2",
  "upstreamRevision": "REVISION_IMUTAVEL",
  "quantization": "Q8_0",
  "promptProfile": "chandra-ocr-2/ocr-layout-v1",
  "weightsSha256": "SHA256",
  "mmprojSha256": "SHA256",
  "runtimeVersion": "LLAMA_CPP_COMMIT_OU_RELEASE"
}
```

Não colocar no lock:

- token Hugging Face;
- URL assinada;
- credencial do worker;
- texto OCR;
- caminhos privados desnecessários.

Paths locais podem ser derivados do cache por hash ou mantidos em configuração local não exibida pelo status.

## 14. Instalação do runtime

A integração deve ter um instalador explícito, separado do instalador do worker até ser validada:

```text
tools/desktop-worker/install-chandra-runtime.sh
```

Responsabilidades pretendidas:

1. verificar arquitetura/OS;
2. verificar disponibilidade Vulkan;
3. instalar ou apontar para build conhecido do `llama.cpp`;
4. baixar os artefatos somente de origem permitida;
5. validar tamanho e SHA-256;
6. gravar em cache content-addressed;
7. executar uma inferência de sanity-check sem documento privado;
8. somente então permitir criar o model lock.

O instalador **não** deve:

- usar `sudo` automaticamente;
- baixar binário sem hash/proveniência;
- aceitar endpoint remoto;
- iniciar upload de documento;
- escolher quantização inferior silenciosamente;
- escrever segredo em `.env`.

## 15. Comando de configuração pretendido

Evoluir `fichario-worker-model` para aceitar backend/model profile explicitamente, por exemplo:

```bash
fichario-worker-model chandra-ocr-2 --backend llama_cpp --quality max
```

`--quality max` deve resolver para a maior quantização **já validada neste hardware**, não para “a maior existente na Internet”.

No perfil RX 6600:

```text
Q8_0 validado -> usar Q8_0
Q8_0 falha/OOM -> usar Q6_K se validado
nenhum validado -> recusar readyToRun
```

A escolha deve aparecer no status como informação pública:

```text
backend: llama_cpp
model: datalab-to/chandra-ocr-2
quantization: Q8_0
promptProfile: chandra-ocr-2/ocr-layout-v1
hardwareValidation: pending | pass
```

Sem imprimir path, token ou conteúdo privado.

## 16. Benchmark obrigatório na RX 6600

A validação deve usar páginas reais representativas do Fichário, mas nenhuma fixture privada deve ser commitada no repositório.

Corpus mínimo recomendado: **100 páginas**.

| Grupo | Páginas mínimas | Exemplos |
| --- | ---: | --- |
| livro/apostila limpos | 20 | impressão nítida, parágrafos, títulos |
| livros/scans degradados | 20 | ruído, skew, contraste ruim, bleed-through |
| manuscrito contemporâneo | 25 | letra de forma, cursiva, caneta, tablet |
| misto | 15 | impresso + anotação, formulário preenchido |
| tabelas/múltiplas colunas | 10 | tabelas, boxes, leitura não linear |
| matemática/texto pequeno | 10 | fórmulas, subscritos, fonte pequena |

### Comparações

Rodar cada página, quando possível, com:

1. checkpoint Chandra 2 oficial — referência de qualidade;
2. Chandra 2 Q8_0 Vulkan;
3. Chandra 2 Q6_K Vulkan se necessário;
4. Gemini atual do projeto como referência externa;
5. OvisOCR2 em uma amostra se houver runtime comparável, para confirmar que a escolha não ficou obsoleta.

## 17. Métricas

Registrar por página:

- CER — Character Error Rate;
- WER — Word Error Rate, quando útil;
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
- temperatura máxima observada;
- reinício/crash do runtime.

Para páginas sem ground truth, usar revisão cega lado a lado. Não usar somente “parece bom”.

## 18. Gates para promover Q8_0

Q8_0 vira o perfil `quality=max` somente se:

```text
100/100 páginas sem OOM: PASS
nenhum crash de driver/runtime: PASS
nenhuma troca silenciosa de modelo: PASS
hash de pesos/projetor verificado: PASS
Vulkan real confirmado: PASS
qualidade manuscrita >= alternativa local testada: PASS
qualidade livro/scan >= alternativa local testada: PASS
regressão vs checkpoint oficial aceitável: PASS
licença/proveniência: PASS
logs sem conteúdo privado: PASS
E2E staging: PASS
```

A regressão aceitável versus checkpoint oficial deve ser definida após o primeiro corpus. Como ponto inicial conservador, investigar qualquer aumento de CER maior que **0,5 ponto percentual absoluto** no agregado ou regressão evidente em manuscrito/tabelas.

Se Q8_0 falhar somente por memória, repetir o mesmo protocolo com Q6_K. Não promover Q4 apenas porque “roda”.

## 19. Testes automatizados a adicionar

### Unitários

- URL `llama.cpp` aceita somente loopback;
- redirects são rejeitados;
- response body é limitado;
- imagem alterada depois do download é rejeitada;
- hash de weights/mmproj divergente bloqueia start;
- model lock v1 continua legível durante migração;
- model lock v2 valida keys exatas;
- backend `llama_cpp` chega corretamente ao completion contract;
- abort encerra inferência/child process sem vazar temporário;
- saída vazia/repetitiva/truncada gera código seguro;
- logs não contêm prompt, OCR, imagem, path privado ou URL assinada.

### Integração local

- fake `llama-server` loopback;
- startup/readiness;
- crash e restart;
- timeout;
- modelo errado;
- mmproj errado;
- uma página válida -> spool -> complete.

### Banco/Edge Function

- `llama_cpp` aceito somente no campo backend;
- replay idempotente preserva backend/modelVersion;
- resultado de outro backend não pode fingir replay idêntico;
- metadata registra runtime/prompt profile sem segredo.

## 20. Segurança

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

- bind `0.0.0.0` para o servidor de inferência;
- endpoint de inferência remoto configurável sem uma nova decisão de arquitetura;
- enviar imagem para Hugging Face Inference, Ollama Cloud ou API da Datalab por acidente;
- armazenar imagem original no spool;
- logar output do Chandra;
- carregar tag mutável sem digest;
- aceitar modelo que mudou de bytes mantendo o mesmo nome.

## 21. Sequência de implementação

### Fase A — decisão e fixtures

- [x] selecionar Chandra OCR 2 como candidato principal;
- [x] documentar riscos e estratégia;
- [ ] preparar corpus privado de benchmark fora do Git;
- [ ] registrar ground truth para subconjunto representativo.

### Fase B — contrato/runtime

- [ ] adicionar backend `llama_cpp` ponta a ponta;
- [ ] criar model lock v2;
- [ ] criar verificador de artefatos GGUF/mmproj;
- [ ] implementar `LlamaCppChandraEngine`;
- [ ] adicionar prompt profile Chandra versionado;
- [ ] criar testes unitários e de integração fake-server.

### Fase C — Vulkan RX 6600

- [ ] buildar/instalar `llama.cpp` com Vulkan;
- [ ] confirmar RX 6600 no backend, não CPU disfarçada;
- [ ] testar Q8_0;
- [ ] medir VRAM/RAM/latência/temperatura;
- [ ] testar Q6_K somente se necessário;
- [ ] comparar qualidade com checkpoint oficial/Gemini.

### Fase D — integração E2E

- [ ] executar job real contra staging;
- [ ] validar lease renewal em inferência longa;
- [ ] validar spool após queda de rede;
- [ ] validar cleanup do temporário;
- [ ] comparar resultado Gemini x Chandra na UI;
- [ ] registrar receipt/checkpoint.

### Fase E — promoção

- [ ] licença aprovada;
- [ ] quantização aprovada;
- [ ] hashes/revision fixados;
- [ ] documentação de instalação atualizada;
- [ ] `readyToRun` passa a incluir validação do runtime Chandra;
- [ ] somente então declarar Chandra padrão do Desktop OCR Worker.

## 22. O que não fazer

- não trocar o Ollama atual por uma implementação improvisada sem testes;
- não chamar uma quantização aleatória de “oficial”;
- não assumir que Q8 cabe porque o arquivo tem menos de 8 GB;
- não medir apenas velocidade;
- não usar benchmark só de PDF digital para validar handwriting;
- não transformar benchmark do fabricante em única fonte de verdade;
- não perder Markdown/layout apenas para encaixar num prompt JSON genérico;
- não marcar `RX 6600 / Vulkan = PASS` antes de execução real;
- não apagar o resultado Gemini quando Chandra gerar outro resultado;
- não promover um modelo porque ele é maior: promover por qualidade medida.

## 23. Critério final de escolha

A decisão final não é “Chandra 2 porque tem 5B”. É:

> **Usar a maior configuração de Chandra OCR 2 que permaneça estável na RX 6600 e preserve a qualidade do checkpoint oficial no corpus real do Fichário, com prioridade explícita para escrita à mão contemporânea e livros digitalizados.**

Hoje o perfil alvo é **Chandra OCR 2 Q8_0 via llama.cpp/Vulkan, concorrência 1**, com **Q6_K como fallback de memória**, sujeito aos gates acima.

Até que esses gates passem, a documentação deve dizer “candidato recomendado / validação pendente”, nunca “modelo local validado”.
