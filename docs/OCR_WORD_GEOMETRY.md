# Geometria de palavras do OCR

## Objetivo

A busca do Fichário consegue localizar texto mesmo quando o OCR erra a grafia. A geometria por palavra liga essa correspondência textual à posição física da palavra na página, permitindo destacar o resultado diretamente sobre imagem ou PDF.

## Contrato espacial

Cada palavra persistida usa a forma compacta:

```text
[text, left, top, right, bottom]
```

As quatro coordenadas são inteiros no intervalo `0..10000`, com origem no canto superior esquerdo. O sistema não grava pixels absolutos. Isso torna a geometria independente da resolução da imagem, do DPI e do nível de zoom do visualizador.

Exemplo:

```json
["fotossintcse", 1200, 2400, 3500, 2900]
```

O banco limita uma página a 20.000 caixas e 4 MiB de geometria. Caixas fora da página, vazias, invertidas ou com texto inválido são recusadas pelo `CHECK` da tabela.

## Persistência e consistência

A geometria é armazenada em dois lugares:

- `ocr_results.word_geometry`: cópia pertencente ao resultado OCR imutável;
- `pages.ocr_word_geometry`: projeção do resultado atualmente aceito, otimizada para leitura do visualizador.

Os RPCs `complete_ocr_job_with_geometry` e `complete_desktop_ocr_job_with_geometry` concluem o OCR e vinculam a geometria ao mesmo resultado aceito na mesma transação. Um replay idêntico é permitido. Um replay com o mesmo resultado textual mas caixas diferentes é rejeitado para impedir que uma versão antiga da geometria seja colocada sobre uma versão nova do texto.

## Gemini

O contrato estruturado em lote pede `wordGeometry` junto com `text`, `warnings` e `contentClass`. Para reduzir tokens de saída, o provedor envia cada caixa como uma string compacta:

```text
left,top,right,bottom|palavra
```

O parser converte apenas caixas válidas para a forma persistida. Uma caixa individual defeituosa é descartada sem perder a transcrição da página. Respostas antigas do provedor sem geometria continuam aceitas e resultam em uma lista vazia.

## Worker desktop

O contrato do worker aceita `wordGeometry` no payload de conclusão. Workers antigos que não enviam esse campo continuam compatíveis e são tratados como geometria vazia.

O backend Ollama atualizado solicita as mesmas coordenadas normalizadas e as entrega junto com a transcrição. O endpoint `desktop-ocr-worker` usa o RPC atômico de conclusão com geometria.

Backends que ainda não produzem posição espacial podem continuar entregando texto normalmente; nesses casos a interface usa o marcador textual como fallback.

## Visualizador

`DocumentMediaViewer.svelte` controla a renderização da página para que a imagem apresentada e o overlay compartilhem o mesmo retângulo:

- imagem Supabase: usa o original assinado;
- PDF Supabase: renderiza a página selecionada com PDF.js;
- imagem Google Drive: baixa o original com autenticação do usuário;
- PDF Google Drive: usa leitura por faixas para referências grandes quando o tamanho original está registrado; documentos menores podem ser baixados e renderizados localmente.

`WordGeometryOverlay.svelte` converte `0..10000` para porcentagens CSS e desenha os retângulos sobre a mídia. O matching reutiliza a mesma lógica fuzzy usada pelo marcador textual; por isso uma busca por `fotossíntese` pode marcar fisicamente uma caixa cujo OCR contém `fotossintcse`.

O overlay não recebe eventos de ponteiro e não interfere em zoom, rolagem ou ações da página.

## Compatibilidade com documentos existentes

A migração inicializa páginas antigas com `ocr_word_geometry = []`, portanto nenhuma importação existente deixa de abrir.

Uma página OCR antiga só ganha posição espacial depois de ser reprocessada por um backend que produza geometria. Até isso acontecer, a busca continua localizando a página e mostrando o trecho textual correspondente, mas não inventa uma posição física.

## Segurança

- O cliente autenticado não pode reescrever `ocr_results.word_geometry` diretamente.
- O validador puro `is_valid_ocr_word_geometry` é executável por `authenticated` porque o `CHECK` da coluna precisa ser reavaliado também em edições normais da página.
- O RPC de conclusão Gemini mantém a fronteira de autorização do usuário.
- O RPC de conclusão do worker desktop permanece exclusivo de `service_role`.
- URLs assinadas e downloads do Drive continuam efêmeros e não são persistidos na geometria.

## Testes relevantes

- `supabase/tests/ocr_word_geometry.sql`
- `tests/unit/ocr/word-geometry.test.ts`
- `tests/unit/ocr/batch-contract.test.ts`
- `tests/unit/desktop/worker-contract.test.ts`
- `tests/unit/desktop-worker/ollama-engine.test.ts`

Os testes cobrem validação de coordenadas, persistência atômica, replay, conflito, fuzzy match espacial e compatibilidade com payloads antigos.
