# PDFs grandes: divisão automática e compressão segura

**Data:** 6 de agosto de 2026  
**Status:** decisão aprovada; implementação pendente  
**Escopo:** importação, inspeção, fragmentação, compressão temporária, OCR Gemini e worker desktop

## 1. Objetivo

O Fichário Virtual deve aceitar como documento lógico um PDF maior do que o limite aceito por uma única chamada de OCR. O arquivo original permanece intacto no Google Drive. Quando necessário, o aplicativo cria artefatos temporários menores, processa cada parte e reúne os resultados pela numeração original das páginas.

A divisão não contorna cotas de requisições, tokens ou uso do provedor. Ela apenas permite processar um documento cuja quantidade de páginas ou tamanho em bytes excede o máximo de um único arquivo ou cuja transcrição completa não cabe com segurança em uma única resposta.

## 2. Limites externos conhecidos

Na verificação de 6 de agosto de 2026, a documentação oficial da Gemini API informava para PDFs:

```text
Tamanho máximo por PDF: 50 MB
Quantidade máxima por PDF: 1.000 páginas
Aplicação: dados inline e Files API
Custo visual aproximado: 258 tokens de entrada por página
```

Referências oficiais:

- https://ai.google.dev/gemini-api/docs/document-processing?hl=pt-BR
- https://ai.google.dev/gemini-api/docs/files?hl=pt-br

O modelo `gemini-3.6-flash` registrava:

```text
Entrada máxima: 1.048.576 tokens
Saída máxima: 65.536 tokens
```

Referência oficial:

- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash

Esses números são limites externos e podem mudar. Devem ser verificados novamente antes de cada release e não devem ficar espalhados como constantes rígidas em vários módulos.

## 3. Limites distintos

O sistema deve distinguir três classes de limite:

1. **Limite do documento lógico:** o PDF que aparece na biblioteca e permanece no Drive. Não deve herdar automaticamente o limite de uma chamada Gemini.
2. **Limite de importação e inspeção do aplicativo:** depende de memória, navegador, Drive, Supabase temporário e dispositivo. É um limite técnico configurável, não uma cota de OCR.
3. **Limite do artefato de processamento:** precisa respeitar o provedor ou worker que receberá aquele lote.

O teto atual de 20 MB da importação de PDF é uma restrição transitória da implementação existente. Ele não representa a arquitetura desejada e não deve ser aumentado artificialmente para 50 MB como solução definitiva. O fluxo Drive-first precisa permitir que o original seja armazenado e inspecionado mesmo quando o OCR exigir divisão posterior.

## 4. Princípio de preservação

- O PDF original nunca é recomprimido, sobrescrito ou fragmentado no Google Drive.
- A biblioteca continua exibindo um único documento.
- Divisão e compressão produzem apenas artefatos temporários derivados.
- Cada artefato registra o hash do original, o intervalo ou conjunto de páginas, a versão da transformação e seu próprio hash.
- Retry, limpeza ou troca de mecanismo não alteram o original.
- Exportação e visualização usam o arquivo original, não as cópias reduzidas.

## 5. Fluxo de processamento

### 5.1 Inspeção local primeiro

1. Obter metadados do PDF e um identificador estável do original.
2. Inspecionar quantidade de páginas, tamanho, texto nativo e páginas visualmente necessárias.
3. Extrair e indexar texto nativo sem OCR.
4. Criar um manifesto apenas com as páginas que ainda precisam de reconhecimento visual.
5. Aplicar a preferência `automatic`, `printed`, `handwritten` ou `mixed` para escolher Gemini, worker desktop ou revisão.

PDFs mistos não devem enviar páginas que já possuem texto nativo suficiente.

### 5.2 Planejamento de lotes

A unidade persistente continua sendo a página. A unidade de processamento pode ser:

- uma imagem avulsa;
- um PDF curto inteiro;
- um PDF temporário com páginas contíguas;
- um PDF temporário contendo somente páginas selecionadas;
- um lote explícito destinado ao worker desktop.

O planejador deve considerar:

- máximo externo de bytes e páginas;
- margem de segurança abaixo do limite externo;
- limite de entrada e principalmente de saída do modelo;
- quantidade e densidade estimada de texto;
- presença de fórmulas, tabelas ou layout complexo;
- rota Gemini ou desktop;
- histórico de truncamento, timeout e falhas daquele documento;
- memória disponível no dispositivo que cria o artefato.

### 5.3 Política inicial conservadora

- PDF escaneado curto e pouco denso: pode ser enviado inteiro quando seguro.
- PDF longo ou denso: lotes iniciais em torno de 20 a 40 páginas.
- Manuscrito denso, fórmulas ou layout complexo: lotes menores.
- Páginas simples: lotes maiores somente após evidência de integridade.
- Nenhum lote Gemini pode se aproximar do limite de 50 MB sem margem operacional.
- O limite de 1.000 páginas nunca deve ser usado como tamanho de lote recomendado para transcrição completa.

Os números iniciais são parâmetros de planejamento, não franquias. O sistema pode adaptá-los conforme testes e telemetria.

## 6. Divisão automática

A fragmentação deve acontecer sem intervenção manual quando qualquer condição for verdadeira:

- original acima de 50 MB;
- original acima de 1.000 páginas;
- estimativa de saída incompatível com o limite do modelo;
- lote anterior truncado;
- resposta omitiu ou duplicou páginas;
- timeout ou falha repetida relacionada ao tamanho;
- memória insuficiente para preparar o lote planejado;
- mecanismo selecionado impõe limite menor.

### 6.1 Mapeamento de páginas

Cada lote deve possuir:

```text
batch_id
source_document_id
source_hash
page_ids
original_page_numbers
first_page e last_page quando contíguo
artifact_hash
artifact_size
transformation_version
route
gemini_model ou desktop_model
attempt
state
```

A resposta precisa associar cada texto ao `page_id` e ao número original. A ordem da resposta não é autoridade suficiente.

### 6.2 Bisseção de falhas

Quando um lote falhar por tamanho, timeout, truncamento, omissão ou resposta inválida:

1. preservar páginas já validadas;
2. selecionar somente a parte afetada;
3. dividir o lote aproximadamente ao meio;
4. reenviar os sublotes separadamente;
5. repetir até sucesso ou até chegar a uma única página;
6. encaminhar falha persistente para revisão ou outro mecanismo aprovado.

Nunca reprocessar o documento inteiro quando apenas um lote falhou.

## 7. Compressão temporária

Compressão é uma otimização secundária. Dividir é a estratégia principal quando há risco de perda de legibilidade ou estouro de saída.

### 7.1 Permitido

Em cópias temporárias, o sistema pode:

- remover metadados e objetos não necessários ao OCR;
- eliminar recursos duplicados;
- recomprimir imagens com qualidade conservadora;
- reduzir resolução excessiva mantendo legibilidade;
- converter cor para escala de cinza quando testes mostrarem que não há perda semântica;
- preservar páginas vetoriais e texto nativo sem rasterização desnecessária.

### 7.2 Proibido

- modificar o original no Drive;
- aplicar compressão destrutiva sem versão e hash do artefato;
- apagar cores relevantes de marcações, diagramas ou códigos;
- reduzir resolução apenas para economizar tokens, pois páginas menores não recebem redução proporcional de custo visual documentada;
- tratar arquivo abaixo de 50 MB como garantia de que a resposta caberá;
- substituir divisão por compressão agressiva de manuscritos.

### 7.3 Recuperação de qualidade

Se a cópia comprimida gerar muitos avisos, texto ilegível ou resultado pior:

1. descartar somente o resultado derivado inadequado;
2. criar lote menor a partir do original;
3. usar compressão mais leve ou nenhuma compressão;
4. encaminhar ao worker desktop quando aplicável;
5. preservar resultados anteriores separadamente para comparação.

## 8. Gemini e Files API

- Upload pela Files API não elimina o limite de 50 MB por PDF.
- O ganho principal da Files API é reutilização, latência e menor reenvio de bytes quando o mesmo artefato participa de mais de uma interação.
- A economia de RPD e RPM vem de processar várias páginas em uma única inferência, não apenas de fazer upload do arquivo separadamente.
- Um PDF pode caber na janela de entrada e ainda ultrapassar o máximo de saída durante transcrição literal.
- O prompt de lote deve exigir JSON estruturado por página e indicar explicitamente páginas ausentes, truncadas ou ilegíveis.

## 9. Worker desktop

O worker local também pode receber lotes, mas precisa preservar a mesma integridade por página.

- O computador pode dividir ou renderizar localmente quando isso reduzir transferência temporária.
- O servidor continua emitindo manifestos, leases e hashes.
- O worker não recebe acesso amplo ao Drive nem secrets administrativos.
- Resultado local registra modelo, versão, backend, dispositivo e hash da origem.
- Um lote local com falha devolve somente suas páginas à fila.
- O computador desligado mantém os trabalhos em `waiting_desktop` sem degradar o original.

## 10. Armazenamento e limpeza

- Original permanente: Google Drive.
- Manifesto e estados: PostgreSQL.
- Artefatos temporários: navegador, computador ou Supabase Storage privado conforme a rota.
- URLs temporárias: curtas, vinculadas ao trabalho e ao hash esperado.
- Limpeza ocorre somente depois de todos os resultados necessários serem persistidos ou o trabalho ser cancelado de forma segura.
- Lease expirado não autoriza apagar artefato ainda necessário por outro retry.
- O painel deve mostrar espaço temporário ocupado por documentos grandes.

## 11. Experiência do usuário

A interface deve apresentar um único documento e progresso compreensível:

```text
Inspecionando PDF
Texto nativo encontrado em X páginas
Preparando Y páginas para leitura
Processando lote A de B
Aguardando computador
Repetindo somente páginas N–M
Concluído com Z páginas para revisão
```

O usuário não precisa dividir o PDF manualmente. A interface pode oferecer controle avançado para pausar, alterar rota ou reprocessar, mas a fragmentação padrão é automática.

## 12. Telemetria informativa

Registrar sem criar franquia local:

- tamanho e páginas do original;
- quantidade de páginas com texto nativo;
- lotes planejados e efetivos;
- bytes antes e depois da transformação;
- chamadas Gemini;
- trabalhos desktop;
- bisseções realizadas;
- páginas omitidas ou truncadas;
- tempo e falhas por lote;
- qualidade percebida da compressão;
- espaço temporário usado.

Não registrar conteúdo da página, tokens, URLs assinadas ou secrets em logs públicos.

## 13. Alterações de implementação necessárias

1. remover o teto de 20 MB como limite arquitetural do documento lógico;
2. separar limite de importação, limite de processamento e limite do provedor;
3. criar manifesto de páginas e contrato persistente de lote;
4. implementar extrator de subconjuntos de páginas sem alterar o original;
5. criar compressão temporária versionada e conservadora;
6. implementar planejador adaptativo com margem abaixo dos limites externos;
7. suportar PDF inteiro, páginas selecionadas e lotes contíguos;
8. implementar bisseção automática de lotes problemáticos;
9. validar resposta estruturada com correspondência exata de páginas;
10. integrar rotas Gemini e desktop ao mesmo manifesto;
11. adaptar progresso, retomada, limpeza e painel;
12. testar documentos acima de 50 MB e acima de 1.000 páginas com fixtures sintéticas;
13. testar truncamento, omissão, duplicação, timeout e memória insuficiente;
14. verificar novamente limites oficiais antes do deployment.

## 14. Critérios de aceitação

- PDF original maior que 50 MB pode permanecer como um único documento no Drive.
- PDF com mais de 1.000 páginas pode permanecer como um único documento lógico.
- nenhuma chamada Gemini recebe arquivo fora do limite vigente.
- o usuário não precisa dividir o arquivo manualmente.
- texto nativo não chama OCR.
- somente páginas necessárias entram em artefatos visuais.
- compressão nunca altera o original.
- falha de um lote não reinicia páginas já concluídas.
- truncamento ou omissão causa bisseção ou revisão, nunca sucesso silencioso.
- resultado mantém numeração original das páginas.
- Gemini e desktop podem processar partes diferentes do mesmo documento.
- a transcrição final continua pesquisável como um documento único.
- não existe billing ou fallback pago automático.

## 15. Fora de escopo

Esta decisão não fixa um tamanho máximo definitivo para o documento lógico, não garante que qualquer PDF possa ser processado em um único dispositivo e não escolhe uma biblioteca final de reescrita ou compressão. Esses pontos dependem de implementação, memória disponível, testes no tablet e no computador e limites vigentes dos serviços.
