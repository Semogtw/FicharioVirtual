# Cobertura de assuntos por unidade

## Objetivo

A tela **Cobertura** permite colar a lista de assuntos de uma unidade/disciplina e verificar quais deles já possuem material pesquisável no Fichário Virtual.

A primeira versão é propositalmente independente de IA generativa. Ela reutiliza a busca textual/fuzzy já existente sobre o texto efetivo das páginas — texto nativo de PDF, OCR e correções manuais — e sempre devolve evidências navegáveis para o documento original.

Rota: `/coverage/`.

## Fluxo atual

1. O usuário informa opcionalmente o nome da unidade.
2. Cola até 40 assuntos, um por linha ou separados por `;`.
3. Numeração e marcadores comuns (`3.1`, `1.`, `-`, `•`) são removidos.
4. Assuntos duplicados são eliminados com comparação normalizada, sem diferenciar caixa ou acentos.
5. É possível restringir a análise a um caderno ou usar todo o fichário.
6. Para cada assunto, o cliente chama a RPC `search_pages` já usada pela busca normal.
7. As consultas rodam com concorrência máxima de 4 por padrão para evitar rajadas desnecessárias.
8. Os melhores resultados são classificados e até quatro evidências são exibidas.
9. Cada evidência abre diretamente o documento, página e termo de destaque.

Nenhum conteúdo adicional é enviado a Gemini ou a outro serviço externo por esta funcionalidade.

## Classificação

A classificação usa o `rank` retornado pela busca fuzzy atual:

- `covered` / **Coberto**: melhor `rank >= 0.85`;
- `partial` / **Parcial**: melhor `rank >= 0.40` e abaixo do limiar de cobertura;
- `missing` / **Não encontrado**: nenhum resultado ou melhor `rank < 0.40`.

Os limiares ficam centralizados em `src/lib/coverage/topic-coverage.ts` para poderem ser calibrados com telemetria e testes reais sem acoplar a UI ao algoritmo.

A força mostrada na interface é uma indicação relativa ao limiar de cobertura, limitada a 100%. Ela **não é uma probabilidade estatística** de o assunto estar coberto.

### Percentual da unidade

O percentual geral é uma métrica simples e explicável:

- coberto = `1.0`;
- parcial = `0.5`;
- não encontrado = `0.0`.

`percentual = soma dos pesos / quantidade de assuntos * 100`

Isso evita apresentar uma precisão falsa e torna o resultado reproduzível sem IA.

## Evidências e rastreabilidade

Para cada assunto são preservados, quando disponíveis:

- `documentId` e título do documento;
- `pageId` e número da página;
- caderno;
- trecho (`excerpt`) retornado pela busca;
- `rank` da ocorrência.

A UI cria links no formato:

`/documents/{documentId}/?page={pageNumber}&highlight={topic}`

Assim, o resultado de cobertura nunca precisa ser aceito sem inspeção: o usuário pode abrir a fonte que justificou a classificação.

## Arquitetura

### Domínio

`src/lib/coverage/topic-coverage.ts`

Responsável por:

- normalização e parsing da lista;
- limites públicos da feature;
- seleção/deduplicação de evidências;
- classificação por assunto;
- cálculo do resumo da unidade.

Esse módulo é puro e não conhece Supabase nem Svelte.

### Serviço

`src/lib/services/topic-coverage.ts`

Responsável por:

- reutilizar `searchPages`;
- limitar concorrência;
- propagar cancelamento com `AbortSignal`;
- preservar a ordem dos assuntos;
- montar o `UnitCoverageSummary` consumido pela interface.

A função aceita uma implementação de busca injetável, o que permite teste unitário sem rede.

### Interface

`src/routes/coverage/+page.svelte`

Responsável por:

- entrada da unidade/lista;
- filtro por caderno;
- estados de carregamento/erro/cancelamento;
- percentual e contagens;
- cards por assunto;
- evidências com navegação para página/trecho.

A rota aparece na navegação desktop e mobile.

## Limitações conhecidas da primeira versão

A busca atual é lexical/fuzzy, não semântica. Portanto:

- sinônimos distantes podem não ser reconhecidos;
- um documento pode explicar um conceito sem usar palavras suficientemente parecidas com o nome do tópico;
- um match textual forte comprova presença do termo, não necessariamente profundidade pedagógica completa;
- “Coberto” significa **evidência textual forte**, não que todos os subtópicos possíveis foram ensinados.

Por isso a UI usa o estado intermediário **Parcial** e expõe as evidências.

## Evolução semântica planejada

O contrato atual foi separado da estratégia de busca para permitir uma segunda camada sem quebrar a tela.

Uma evolução recomendada é:

1. dividir texto efetivo em blocos/páginas;
2. gerar embeddings no processamento/indexação, preferencialmente sem custo por consulta;
3. recuperar candidatos por similaridade semântica;
4. combinar sinal semântico + `search_pages`;
5. opcionalmente enviar apenas os poucos trechos candidatos a Gemini para avaliar profundidade da cobertura (por exemplo: conceito presente, exemplos, exercícios, subtópicos ausentes);
6. manter as mesmas evidências e classificação explicável na UI.

Gemini deve continuar opcional. Ausência de cota/chave não pode inutilizar a análise básica.

## Calibração futura

Antes de alterar os limiares, registrar em telemetria agregada e não sensível:

- número de assuntos por análise;
- distribuição dos melhores ranks;
- proporção coberto/parcial/ausente;
- quantidade de evidências por assunto;
- estratégia usada (`lexical`, futuramente `semantic`/`hybrid`);
- duração da análise.

Não registrar o texto dos assuntos, OCR, excerpts ou títulos apenas para calibrar a feature.

## Testes

`tests/unit/coverage/topic-coverage.test.ts` cobre:

- listas numeradas e com marcadores;
- normalização de acentos;
- deduplicação;
- classificação conservadora;
- ordenação/limite das evidências;
- cálculo ponderado do percentual;
- integração do analisador com uma busca injetada;
- lista vazia sem chamadas ao backend.

Os gates normais do repositório continuam sendo `pnpm lint`, `pnpm check`, `pnpm test` e `pnpm build` (ou `pnpm verify`).
