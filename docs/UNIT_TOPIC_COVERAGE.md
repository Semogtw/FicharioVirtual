# Cobertura de assuntos por unidade

A rota `/coverage/` compara os conteúdos de uma unidade, disciplina ou ementa com o material pesquisável do Fichário Virtual. O usuário pode montar a lista manualmente ou extrair os conteúdos de uma foto, revisar cada item em campos independentes e então receber os estados `Coberto`, `Parcial` e `Não encontrado`, sempre acompanhados das evidências disponíveis.

A feature possui duas camadas de análise:

1. **textual/fuzzy**, sempre disponível quando a busca normal do fichário está disponível;
2. **semântica híbrida**, opcional e sujeita a consentimento, que combina embeddings e verificação conservadora do Gemini sem remover o fallback textual.

Os detalhes da segunda camada estão em [`SEMANTIC_COVERAGE.md`](SEMANTIC_COVERAGE.md).

## Objetivo de produto

A tela responde a uma pergunta prática: **“o que desta ementa eu já tenho estudado/documentado no meu fichário?”**

Ela não afirma domínio pedagógico absoluto. `Coberto` significa que foram encontradas evidências suficientemente fortes segundo os sinais disponíveis. O usuário continua podendo abrir a página original e conferir a fonte.

## Fluxo do usuário

1. Informar opcionalmente um nome para a unidade.
2. Escolher se a análise considera todo o fichário ou apenas um caderno.
3. Adicionar conteúdos por uma ou ambas as formas:
   - digitar/colar uma lista;
   - fotografar/selecionar uma imagem da ementa e usar OCR.
4. Revisar os conteúdos já separados em campos independentes.
5. Editar, remover, reordenar e ajustar hierarquia.
6. Opcionalmente ativar **relação semântica com Gemini**, com consentimento específico.
7. Clicar em **Verificar cobertura**.
8. Consultar percentual, estado por tópico e evidências.
9. Abrir documento/página para inspeção do trecho original.

## Editor estruturado

O texto bruto nunca é a fonte canônica da análise. Antes da verificação, cada assunto vira um `EditableTopic` com:

- identificador local;
- texto editável;
- origem `manual` ou `ocr`;
- confiança heurística do OCR;
- sinal de revisão;
- nível hierárquico relativo.

A análise usa os textos já revisados desses campos.

### Operações disponíveis

Cada campo pode ser:

- editado;
- excluído;
- movido para cima ou para baixo;
- promovido ou rebaixado na hierarquia, até quatro níveis relativos.

A unidade aceita no máximo `MAX_UNIT_TOPICS` conteúdos. Duplicatas são comparadas usando a mesma normalização sem acentos/caixa usada pela cobertura.

## Entrada manual

O usuário pode colar uma lista com um item por linha e usar **Transformar em campos**.

São removidos de forma conservadora marcadores comuns como:

- `1.` / `1.2` / `3.2.1`;
- letras e romanos;
- `-`, `*`, `•` e similares;
- caixas de seleção.

Também existe **Adicionar campo vazio** para cadastrar itens individualmente.

## Foto da ementa

Arquivo principal: `src/lib/services/coverage-photo-import.ts`.

O fluxo reutiliza a infraestrutura real de importação/OCR do projeto em vez de criar um OCR paralelo:

1. registra consentimento de OCR;
2. prepara a imagem em alta definição;
3. envia a imagem como documento temporário;
4. executa `processPageOcr`;
5. lê o texto efetivo da página;
6. segmenta os conteúdos;
7. apaga o documento temporário criado por esse fluxo.

Se a imagem já existir no fichário, o documento existente é reutilizado e **não é apagado**.

Formatos aceitos pela UI:

- JPEG;
- PNG;
- WebP.

A câmera móvel usa `capture="environment"` quando suportado.

### Estágios visíveis

- `preparing` — preparando a foto;
- `uploading` — envio temporário;
- `reading` — OCR;
- `extracting` — separação dos conteúdos;
- `cleaning_up` — remoção do temporário.

O fluxo aceita `AbortSignal` e pode ser cancelado.

### Falhas tratadas

- página/texto indisponível;
- OCR pendente;
- cota esgotada;
- falha definitiva do OCR;
- imagem lida sem conteúdos utilizáveis;
- falha isolada de limpeza do documento temporário.

Quando a extração foi bem-sucedida e apenas a limpeza falhou, os conteúdos são preservados e a UI avisa o usuário.

## Segmentação do OCR

Arquivo: `src/lib/coverage/topic-import.ts`.

O módulo é puro e determinístico. Ele:

- reconhece numeração e marcadores;
- junta linhas quebradas que pertencem ao item anterior;
- preserva listas sem numeração usando uma linha por candidato;
- ignora cabeçalhos genéricos como `EMENTA` e `CONTEÚDO PROGRAMÁTICO`;
- evita colar prováveis títulos em tópicos anteriores;
- deduplica conteúdos normalizados;
- infere hierarquia relativa de 0 a 3;
- limita o resultado ao máximo aceito pela unidade.

### Confiança do OCR

`alta`, `média` e `baixa` são **sinais heurísticos de revisão**, não probabilidades estatísticas.

A confiança pode ser reduzida por:

- item sem marcador explícito;
- caracteres suspeitos de OCR;
- página `needs_review`;
- warnings produzidos pelo pipeline.

Itens de confiança baixa ficam marcados como `revisar` e permanecem totalmente editáveis.

## Análise textual/fuzzy

Arquivo: `src/lib/services/topic-coverage.ts`.

Sem semântica, cada tópico reutiliza `searchPages`, que por sua vez chama `search_pages` no Supabase. O ranking atual combina full-text, substring e fuzzy/trigram, além de sinais de título/caderno conforme o contrato da busca normal.

A análise:

- usa até quatro workers por padrão;
- limita resultados por tópico;
- preserva a ordem dos assuntos;
- propaga cancelamento;
- mantém a classificação textual já existente.

### Classificação textual

No domínio `src/lib/coverage/topic-coverage.ts`:

- `Coberto`: melhor rank textual >= `0.85`;
- `Parcial`: melhor rank textual >= `0.40` e abaixo do limiar de coberto;
- `Não encontrado`: abaixo de `0.40`.

O percentual pondera:

- coberto = 1;
- parcial = 0,5;
- não encontrado = 0.

## Análise semântica híbrida

A opção **Usar relação semântica com Gemini** começa desativada porque essa operação pode enviar trechos de páginas já armazenadas ao provedor. Ao ativá-la, a UI registra consentimento dedicado antes da chamada semântica.

Quando disponível, a análise adiciona:

- chunks persistidos em `page_semantic_chunks`;
- embeddings `vector(768)`;
- busca por similaridade cosseno;
- fusão lexical + semântica;
- verificação opcional de poucos candidatos pelo Gemini;
- hash do texto efetivo para invalidar embeddings antigos;
- indexação incremental para evitar rajadas de custo/cota.

O score final é conservador. Um veredito `partial` do Gemini não pode promover o resultado para `Coberto`, e um `none` de alta confiança reduz um falso positivo lexical/semântico.

Consulte [`SEMANTIC_COVERAGE.md`](SEMANTIC_COVERAGE.md) para arquitetura, RPCs, limites, configuração e fórmula de score.

### Fallback obrigatório

A semântica não é um ponto único de falha.

Sem consentimento, chave, cota, índice atual ou disponibilidade do provedor:

- a Edge Function pode responder em modo `lexical`;
- se a própria função semântica não estiver acessível, o browser volta a `searchPages`;
- a busca textual/fuzzy continua cobrindo todo o corpus pesquisável.

Quando o índice semântico está incompleto, a UI informa a proporção indexada e deixa claro que a busca textual continua cobrindo o restante.

## Evidências

Para cada assunto são preservados, quando disponíveis:

- `documentId` e título do documento;
- `pageId` e número da página;
- caderno;
- trecho relevante;
- força final usada para ordenar a evidência.

A UI cria links no formato:

`/documents/{documentId}/?page={pageNumber}&highlight={topic}`

Mesmo quando o trecho foi encontrado semanticamente sem as mesmas palavras do tópico, o link continua levando à página-fonte para inspeção.

## Arquitetura

### `src/lib/coverage/topic-coverage.ts`

Responsável pelo contrato lexical:

- parsing/normalização;
- limites públicos;
- classificação textual;
- deduplicação de evidências;
- resumo e percentual.

### `src/lib/coverage/semantic-coverage.ts`

Responsável pelo contrato híbrido:

- normalização dos sinais lexical e semântico;
- combinação dos sinais;
- aplicação conservadora do verificador;
- classificação híbrida;
- metadados do modo/indexação.

### `src/lib/coverage/topic-import.ts`

Responsável pela segmentação pura do OCR em conteúdos editáveis.

### `src/lib/services/coverage-photo-import.ts`

Orquestra consentimento, preparação, upload, OCR, leitura, segmentação e limpeza da foto.

### `src/lib/services/semantic-coverage.ts`

Responsável por:

- registrar consentimento semântico;
- invocar `semantic-coverage`;
- validar estritamente a resposta;
- expor candidatos e metadados tipados ao browser.

### `src/lib/services/topic-coverage.ts`

Orquestra o modo selecionado e garante fallback textual local quando a camada semântica falha.

### `supabase/functions/semantic-coverage/index.ts`

Orquestra:

- autenticação;
- indexação incremental;
- embeddings de documento e consulta;
- busca lexical e vetorial;
- fusão dos candidatos;
- verificação opcional;
- fallback por cota/configuração/provedor.

### `src/routes/coverage/+page.svelte`

Responsável por entrada, revisão, consentimentos, filtro, progresso e apresentação dos resultados.

## Limitações atuais

### Layout da ementa

Tabelas complexas, múltiplas colunas ou diagramação incomum podem exigir edição manual após o OCR.

### Semântica

- o índice é construído incrementalmente e pode ficar incompleto durante as primeiras análises de um fichário grande;
- os limiares são heurísticos e precisam ser calibrados com dados reais, priorizando redução de falsos positivos;
- o verificador avalia os trechos recuperados, não garante que uma disciplina inteira foi dominada;
- não há job periódico obrigatório de backfill; a indexação oportunista evita custo e infraestrutura permanentes;
- a busca principal do Fichário ainda não reutiliza automaticamente o índice semântico desta feature — esse reuso é a evolução arquitetural natural para evitar um segundo índice.

## Testes

### Cobertura lexical

`tests/unit/coverage/topic-coverage.test.ts`

- parsing;
- deduplicação;
- classificação;
- evidências;
- percentual;
- concorrência/cancelamento via busca injetada.

### Importação da ementa

`tests/unit/coverage/topic-import.test.ts`

- listas numeradas;
- hierarquia;
- continuação de linha;
- listas sem marcadores;
- confiança/warnings;
- deduplicação;
- cabeçalhos;
- OCR suspeito.

`tests/unit/coverage/photo-topic-import.test.ts`

- lifecycle do OCR;
- documento temporário;
- duplicata existente;
- limpeza;
- cota.

### Semântica

`tests/unit/coverage/semantic-coverage.test.ts`

- paráfrase sem overlap lexical;
- proximidade média/fraca;
- promoção `strong`;
- supressão `none`;
- garantia de que `partial` não vira `Coberto`;
- metadados de índice.

`tests/unit/coverage/semantic-service.test.ts`

- contrato estrito Edge → browser;
- fallback lexical do provedor;
- rejeição de shape drift;
- consentimento dedicado.

`tests/unit/coverage/semantic-chunks.test.ts`

- normalização;
- limites;
- sobreposição;
- teto de chunks.

`tests/unit/coverage/gemini-semantic-clients.test.ts`

- contrato do Gemini Embedding 2;
- compatibilidade com modelos anteriores;
- vetor pgvector;
- structured output do verificador.

Os gates normais continuam sendo `pnpm verify` e, para validação completa, `pnpm verify:full`, incluindo Playwright, Edge Functions e banco local.
