# Geometria espacial do OCR

## Objetivo

A busca do Fichário precisa destacar na mídia a palavra encontrada, inclusive quando a correspondência foi fuzzy. O formato persistido continua oferecendo caixas por palavra ao visualizador, mas o Gemini não precisa mais repetir cada palavra e quatro coordenadas na resposta.

## Contrato persistido

Cada palavra aceita pelo backend é persistida como:

```text
[text, left, top, right, bottom]
```

As coordenadas são inteiros normalizados em `0..10000`, com origem no canto superior esquerdo. O formato é independente de resolução, DPI e zoom.

## Gemini: geometria compacta por linha

O contrato do Gemini em lote usa `lineGeometry`, não `wordGeometry`.

Para cada linha não vazia de `text`, na mesma ordem, o modelo devolve somente:

```text
left,top,right,bottom
```

As coordenadas do provedor usam `0..1000`. O texto da linha **não é repetido** dentro da geometria. Isso elimina a parte mais redundante da resposta: antes cada palavra repetia a própria grafia mais quatro coordenadas.

O backend valida as caixas, converte `0..1000` para `0..10000` e deriva localmente as caixas por palavra usando os offsets das palavras dentro da linha. O resultado derivado mantém o contrato consumido pela busca e pelo overlay.

Uma geometria de linha malformada, incompleta ou desalinhada não invalida uma transcrição boa. Nesse caso a página preserva o OCR e fica sem overlay espacial para aquele resultado; não se desperdiça outra chamada Gemini apenas para recuperar coordenadas.

## Orçamento de saída

O planner de OCR considera quatro limites independentes antes de montar uma chamada:

- quantidade de páginas;
- presença de páginas densas;
- bytes das imagens derivadas;
- orçamento estimado de tokens de saída.

Os defaults atuais são:

```text
páginas normais: até 28
lote que contém página densa: até 14
imagens derivadas: até 12 MiB
saída estimada: até 48.000 tokens
resposta Gemini permitida: até 65.536 tokens
```

A estimativa inicial reserva aproximadamente 900 tokens para página esparsa, 1.700 para página normal e 3.000 para página densa. O teto de 48 mil deixa folga para documentos cuja densidade real seja maior do que a inspeção prévia estimou.

Quando o tamanho de uma página é desconhecido durante retomada, o planner não usa mais um byte fictício como custo real: assume 1 MiB e densidade conservadora. Isso evita a primeira tentativa excessivamente grande.

## Falhas parciais

O contrato continua identificado por `pageId` e `pageNumber`. Se uma resposta omitir ou duplicar uma página, páginas válidas são preservadas e somente o subconjunto afetado é dividido e reenviado. Uma página isolada que continua impossível de processar permanece pendente em vez de entrar em loop.

## Worker desktop

O worker desktop pode continuar produzindo geometria por palavra no contrato interno dele. Essa rota não consome tokens do Gemini e, portanto, não precisa adotar o formato comprimido do provedor.

## Visualizador

`DocumentMediaViewer.svelte` e `WordGeometryOverlay.svelte` recebem a geometria normalizada por palavra já derivada. O overlay converte `0..10000` em porcentagens CSS e reutiliza o mesmo matching fuzzy da busca textual.

A derivação horizontal por palavra é propositalmente aproximada: a caixa da linha vem do modelo e o backend reparte seu eixo horizontal pelos offsets dos termos na transcrição. Para destaque de busca isso evita milhares de tokens de coordenadas sem exigir uma segunda chamada.

## Segurança e limites

- geometria inválida nunca pode substituir texto OCR válido;
- coordenadas fora da página ou invertidas são descartadas;
- o cliente autenticado não reescreve diretamente resultados OCR imutáveis;
- URLs assinadas, bytes de imagem e conteúdo do prompt não são persistidos na telemetria;
- páginas já concluídas não são repetidas só porque outra página do lote falhou.

## Testes relevantes

- `tests/unit/ocr/batch-contract.test.ts`
- `tests/unit/ocr/batch-planner.test.ts`
- `tests/unit/ocr/gemini-batch-client.test.ts`
- `tests/unit/pdf/ocr-batching.test.ts`
- `tests/unit/services/ocr-resume-batch.test.ts`
- `tests/unit/ocr/word-geometry.test.ts`
- `supabase/tests/ocr_word_geometry.sql`
