# Cobertura de assuntos por unidade

## Objetivo

A tela **Cobertura** permite montar a ementa/conteúdo de uma unidade e verificar quais assuntos já possuem material pesquisável no Fichário Virtual.

Rota: `/coverage/`.

A entrada deixou de ser apenas um bloco de texto. A unidade agora tem uma lista estruturada de assuntos editáveis que pode ser alimentada de três formas:

1. digitando ou colando uma lista e convertendo-a em campos;
2. adicionando campos vazios manualmente;
3. fotografando a lista de conteúdos e usando o OCR existente para preencher os campos automaticamente.

A análise de cobertura continua propositalmente independente de IA generativa. Ela reutiliza a busca textual/fuzzy existente sobre o texto efetivo das páginas — texto nativo de PDF, OCR e correções manuais — e sempre devolve evidências navegáveis para o documento original.

## Modelo de edição estruturada

A lista estruturada é a fonte única usada pela análise. Cada assunto possui um campo independente e pode ser:

- editado sem alterar os demais;
- excluído;
- movido para cima ou para baixo;
- promovido ou rebaixado em até quatro níveis hierárquicos;
- identificado como entrada manual ou originada por OCR;
- marcado para revisão quando a extração tiver baixa confiança heurística.

O limite atual permanece em `40` assuntos por análise para evitar rajadas de consultas. Assuntos repetidos são comparados com normalização de caixa e acentos e entram apenas uma vez no cálculo final.

### Entrada escrita

O usuário ainda pode escrever ou colar normalmente, inclusive listas como:

```text
3.1 Temperatura
3.2 Calor específico
3.3 Mudanças de fase
3.4 Primeira lei da termodinâmica
```

Ao selecionar **Transformar em campos**, cada item vira um campo editável. Numeração e marcadores comuns são removidos nessa conversão.

O texto colado não é a fonte final da análise: depois da conversão, os campos estruturados são a fonte de verdade.

## Importação por foto da ementa

### Fluxo de usuário

1. O usuário confirma o consentimento de leitura automática.
2. Seleciona uma imagem existente ou abre a câmera traseira do dispositivo.
3. A imagem é preparada localmente com o pipeline `ocr_clean_v1` em alta definição.
4. O arquivo é enviado temporariamente usando o mesmo pipeline de importação de imagens do Fichário.
5. O mesmo `process-ocr` usado nos documentos normais executa a leitura.
6. O texto efetivo da página é carregado.
7. `src/lib/coverage/topic-import.ts` separa o OCR em itens de lista.
8. Cada item extraído vira imediatamente um campo editável na tela.
9. Se o arquivo temporário foi criado por este fluxo, ele é removido após a extração.
10. Só depois da revisão do usuário os campos são enviados para a análise de cobertura.

Não existe um segundo motor de OCR específico para Cobertura. A funcionalidade reutiliza o pipeline já mantido pelo projeto.

### Formatos

A interface aceita:

- JPEG;
- PNG;
- WebP;
- captura direta pela câmera com `capture="environment"` quando o navegador oferece suporte.

Os limites de tamanho e validações continuam sendo os mesmos de `src/lib/import/image-client.ts`.

### Arquivo temporário e privacidade

A imagem da ementa não deve permanecer como um documento novo apenas por ter sido usada para preencher o formulário.

Por isso `src/lib/services/coverage-photo-import.ts`:

- cria um documento temporário apenas quando necessário para reutilizar o pipeline existente;
- processa a página com OCR;
- extrai os tópicos;
- chama `deleteDocument` no `finally`, inclusive em falhas de cota/processamento após o upload;
- não mascara uma extração bem-sucedida se somente a limpeza falhar; nesse caso a UI mostra um aviso de limpeza pendente.

Se a imagem já existe no fichário, `DuplicateImageError` é tratado de forma diferente:

- a primeira página do documento existente é reaproveitada;
- o OCR existente é processado/reutilizado;
- o documento original **não é apagado**.

Esse comportamento é importante porque uma foto já pertencente à biblioteca não pode ser tratada como temporária.

### Consentimento

A tela repete o aviso de privacidade da importação normal e chama `recordOcrConsent()` antes do processamento. A seleção da foto fica desabilitada até o usuário confirmar o consentimento.

## Segmentação do OCR em assuntos

O módulo puro `src/lib/coverage/topic-import.ts` recebe o texto do OCR e devolve `OcrTopicCandidate[]`.

### Listas numeradas e marcadas

São reconhecidos, entre outros:

- `1. Assunto`;
- `3.1 Assunto`;
- `3.2.1 Assunto`;
- `A. Assunto`;
- `IV. Assunto`;
- `- Assunto`;
- `• Assunto`;
- caixas de seleção como `☐ Assunto`.

Quando pelo menos dois marcadores explícitos são encontrados, a entrada é tratada como lista estruturada.

Linhas sem novo marcador entre dois itens são consideradas continuação do item anterior. Isso cobre OCRs como:

```text
1. Primeira lei da termodinâmica e conservação
   de energia em sistemas fechados
2. Máquinas térmicas
```

que produzem dois campos, e não três.

### Listas sem marcadores

Se a foto contém apenas uma linha por conteúdo, cada linha não vazia vira um candidato independente.

### Cabeçalhos genéricos

Cabeçalhos puramente estruturais, como `EMENTA`, `CONTEÚDO PROGRAMÁTICO` e `LISTA DE CONTEÚDOS`, são ignorados quando reconhecidos exatamente.

Cabeçalhos específicos da disciplina não são descartados agressivamente. Em caso de dúvida, é preferível mostrar um campo que o usuário possa excluir a apagar silenciosamente um assunto real.

### Deduplicação

Os candidatos são deduplicados com a mesma normalização de `normalizeTopic`:

- ignora caixa;
- ignora acentos;
- normaliza pontuação e espaços.

Exemplo: `Calor específico` e `Calor especifico` contam como o mesmo assunto.

## Hierarquia

A numeração extraída preserva até quatro níveis (`0` a `3` internamente).

Exemplo:

```text
3. Termodinâmica
3.1 Temperatura
3.2 Calorimetria
3.2.1 Capacidade térmica
```

resulta em níveis relativos `0`, `1`, `1`, `2`.

Os níveis são normalizados pelo menor nível encontrado, portanto uma foto contendo apenas `3.1`, `3.2`, `3.3` não aparece artificialmente toda indentada.

Na interface o usuário pode ajustar a hierarquia com os controles de promover/rebaixar. A hierarquia é metadado de organização da ementa; a primeira versão da análise de cobertura continua avaliando os textos de forma plana e individual.

## Confiança e revisão

O OCR atual não fornece uma probabilidade calibrada por item. Portanto a UI **não apresenta o indicador como probabilidade estatística**.

`topic-import.ts` gera um sinal heurístico `high | medium | low` baseado em:

- presença de marcador explícito de lista;
- caracteres estranhos ou sinais típicos de OCR corrompido;
- tamanho inválido/suspeito;
- estado `needs_review` retornado pelo pipeline de OCR;
- quantidade de warnings da página.

O sinal é degradado quando a página inteira precisa de revisão ou quando há warnings. Itens com `low` recebem `reviewRequired = true` e ficam visualmente destacados.

O objetivo do indicador é dizer **“confira este campo”**, não afirmar uma precisão numérica falsa.

## Estados da importação por foto

A interface expõe os estágios:

- `preparing` — preparação local da foto;
- `uploading` — upload temporário;
- `reading` — execução do OCR;
- `extracting` — segmentação em assuntos;
- `cleaning_up` — remoção do documento temporário.

A operação pode ser cancelada por `AbortController`. A limpeza do documento temporário não depende do mesmo signal, para que um cancelamento não abandone o arquivo que já foi enviado.

Erros específicos tratados pelo serviço incluem:

- página de origem indisponível;
- OCR pendente/retryable;
- cota diária esgotada;
- falha definitiva de OCR;
- OCR concluído sem nenhum assunto utilizável.

## Fluxo de análise de cobertura

Depois que os campos estão revisados:

1. campos vazios são ignorados;
2. os textos passam novamente por `parseUnitTopics` para aplicar limite e deduplicação defensiva;
3. é possível restringir a análise a um caderno ou usar todo o fichário;
4. para cada assunto, o cliente chama a RPC `search_pages` já usada pela busca normal;
5. as consultas rodam com concorrência máxima de 4 por padrão;
6. os melhores resultados são classificados;
7. até quatro evidências por assunto são exibidas;
8. cada evidência abre diretamente o documento, página e termo de destaque.

Nenhum conteúdo adicional é enviado a Gemini ou a outro serviço externo **para classificar a cobertura**. O provedor de OCR continua sendo o já configurado pelo pipeline normal de leitura.

## Classificação

A classificação usa o `rank` retornado pela busca fuzzy atual:

- `covered` / **Coberto**: melhor `rank >= 0.85`;
- `partial` / **Parcial**: melhor `rank >= 0.40` e abaixo do limiar de cobertura;
- `missing` / **Não encontrado**: nenhum resultado ou melhor `rank < 0.40`.

Os limiares ficam centralizados em `src/lib/coverage/topic-coverage.ts`.

A força mostrada na interface é uma indicação relativa ao limiar de cobertura, limitada a 100%. Ela **não é uma probabilidade estatística** de o assunto estar coberto.

### Percentual da unidade

O percentual geral continua simples e explicável:

- coberto = `1.0`;
- parcial = `0.5`;
- não encontrado = `0.0`.

`percentual = soma dos pesos / quantidade de assuntos * 100`

## Evidências e rastreabilidade

Para cada assunto são preservados, quando disponíveis:

- `documentId` e título do documento;
- `pageId` e número da página;
- caderno;
- trecho (`excerpt`) retornado pela busca;
- `rank` da ocorrência.

A UI cria links no formato:

`/documents/{documentId}/?page={pageNumber}&highlight={topic}`

Assim o resultado de cobertura nunca precisa ser aceito sem inspeção.

## Arquitetura

### Domínio de cobertura

`src/lib/coverage/topic-coverage.ts`

Responsável por:

- normalização e parsing defensivo da lista;
- limites públicos da feature;
- seleção/deduplicação de evidências;
- classificação por assunto;
- cálculo do resumo da unidade.

### Segmentação de OCR

`src/lib/coverage/topic-import.ts`

Responsável por:

- reconhecer marcadores/numeração;
- separar ou juntar linhas do OCR;
- detectar hierarquia relativa;
- remover cabeçalhos genéricos;
- deduplicar candidatos;
- gerar sinal heurístico de confiança/revisão;
- limitar o resultado ao máximo aceito pela unidade.

É um módulo puro: não conhece Svelte, Supabase nem o provedor de OCR.

### Serviço de foto

`src/lib/services/coverage-photo-import.ts`

Responsável por:

- registrar consentimento;
- preparar a imagem em alta definição;
- reutilizar `uploadPreparedImage`;
- reutilizar `processPageOcr`;
- carregar o texto efetivo da página;
- reaproveitar documento duplicado sem destruí-lo;
- chamar o segmentador puro;
- apagar o documento criado temporariamente;
- propagar cancelamento e estágios de progresso.

A função central possui uma variante com dependências injetáveis para testes sem rede, storage ou provider real.

### Serviço de cobertura

`src/lib/services/topic-coverage.ts`

Responsável por:

- reutilizar `searchPages`;
- limitar concorrência;
- propagar cancelamento com `AbortSignal`;
- preservar a ordem dos assuntos;
- montar o `UnitCoverageSummary` consumido pela interface.

### Interface

`src/routes/coverage/+page.svelte`

Responsável por:

- nome da unidade;
- entrada escrita e conversão em campos;
- captura/seleção de foto;
- consentimento;
- progresso e cancelamento da extração;
- lista editável/reordenável/hierárquica;
- avisos de confiança/revisão;
- filtro por caderno;
- estados de cobertura e evidências.

## Limitações atuais

### Segmentação da ementa

A segmentação é determinística e conservadora, não um entendimento semântico completo de layout. Fotos com tabelas complexas, múltiplas colunas ou diagramação incomum podem exigir edição manual depois do OCR — exatamente por isso os campos são sempre revisáveis.

### Cobertura

A busca atual é lexical/fuzzy, não semântica. Portanto:

- sinônimos distantes podem não ser reconhecidos;
- um documento pode explicar um conceito sem usar palavras suficientemente parecidas com o nome do tópico;
- um match textual forte comprova presença do termo, não necessariamente profundidade pedagógica completa;
- “Coberto” significa **evidência textual forte**, não que todos os subtópicos possíveis foram ensinados.

## Evolução semântica planejada

O contrato atual continua preparado para uma segunda camada:

1. dividir texto efetivo em blocos/páginas;
2. gerar embeddings no processamento/indexação;
3. recuperar candidatos por similaridade semântica;
4. combinar sinal semântico + `search_pages`;
5. opcionalmente enviar apenas poucos trechos candidatos a Gemini para avaliar profundidade da cobertura;
6. manter as mesmas evidências e classificação explicável na UI.

Gemini deve continuar opcional para a **análise de cobertura**. Ausência de cota/chave não pode inutilizar a análise lexical básica.

## Testes

### `tests/unit/coverage/topic-coverage.test.ts`

Cobre parsing manual, classificação, evidências, percentual e integração com a busca injetada.

### `tests/unit/coverage/topic-import.test.ts`

Cobre:

- listas numeradas;
- níveis hierárquicos;
- continuação de linha;
- listas sem marcadores;
- confiança degradada por warnings/revisão;
- deduplicação;
- cabeçalhos genéricos;
- texto OCR suspeito.

### `tests/unit/coverage/photo-topic-import.test.ts`

Cobre:

- pipeline completo com dependências fake;
- exclusão do documento temporário;
- reaproveitamento seguro de documento duplicado;
- falha de limpeza sem perda dos tópicos extraídos;
- limpeza quando a cota interrompe o OCR.

Os gates normais do repositório continuam sendo `pnpm lint`, `pnpm check`, `pnpm test` e `pnpm build` (ou `pnpm verify`).
