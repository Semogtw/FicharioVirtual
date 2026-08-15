# Busca híbrida, OCR e correspondências multimodais

## Objetivo

A busca global precisa localizar o **documento/página real** mesmo quando a transcrição não é perfeita. Hoje há três caminhos complementares:

1. lexical/fuzzy para palavras iguais ou parecidas, inclusive erros de OCR;
2. embedding textual para conceitos expressos com vocabulário diferente;
3. embedding visual seletivo para páginas cuja estrutura/imagem carrega informação que OCR não representa bem.

O Gemini gera embeddings; PostgreSQL/pgvector recupera candidatos e a ordenação final é determinística. O documento original continua sendo o destino da busca — OCR e embeddings são mecanismos internos de localização.

## Recuperação lexical/fuzzy

`search_pages` combina normalização, substring, Full Text Search, `strict_word_similarity`, `word_similarity` e trigramas. O ranking lexical favorece correspondência exata e mantém tolerância a erros como `fotossintcse`/`fotossíntese` ou `ocitona`/`oxitona` sem reescrever automaticamente o conteúdo armazenado.

## Semântica textual

O índice textual compartilhado usa:

- `page_semantic_chunks`;
- vetores 768;
- `gemini-embedding-2`;
- `source_hash` versionado;
- HNSW/cosine;
- `search_pages_semantic`.

A normalização para embedding remove ruído de layout de forma conservadora — NFKC, invisíveis, soft hyphen e hifenização de fim de linha — mas não funciona como corretor ortográfico.

Busca e cobertura reutilizam os mesmos chunks. Se uma página já está indexada com modelo/hash atuais, não é necessário reenviar seu texto apenas porque outra superfície precisa da mesma representação.

## Semântica visual seletiva

Páginas elegíveis podem receber um embedding adicional em `page_visual_embeddings`. O roteador `visual-v1` é determinístico e favorece manuscritos, scans degradados, conteúdo misto, tabelas/layout, matemática, warnings de OCR e revisão; páginas textuais limpas ou quase vazias não consomem esse canal sem necessidade.

`search_pages_visual_semantic` usa o mesmo embedding da consulta textual para procurar páginas visualmente relacionadas no espaço multimodal.

O threshold visual atual é `0.36`.

## Ranking

`semantic-search` consulta os sinais aplicáveis e deduplica por página.

O RRF textual permanece exatamente igual quando o visual não participa. Em `active`, a extensão multimodal:

- permite resultado puramente visual;
- evita somar integralmente OCR e imagem correlacionados;
- usa o sinal mais forte + pequeno bônus quando texto e visual corroboram;
- limita a confiança visual à faixa realmente calibrada;
- protege `lexicalRank = 1` para que um match lexical exato não seja derrubado por um visual concorrente exagerado.

`SEMANTIC_VISUAL_MODE` aceita `off`, `shadow` e `active`. O default versionado é `shadow`; staging testa `active` temporariamente e restaura `shadow` ao final.

## Modos de match na API/UI

Os resultados podem usar:

- `lexical`;
- `semantic`;
- `hybrid`;
- `visual`;
- `lexical_visual`;
- `semantic_visual`;
- `hybrid_visual`.

A interface pode traduzir esses sinais para badges como “Por sentido”, “Por conteúdo visual” e combinações de texto/sentido/visual.

## Trecho e highlight

O comportamento depende de como o resultado foi encontrado:

- lexical: excerpt centrado no termo/fuzzy e highlight quando houver geometria/texto confiável;
- semântico textual: excerpt pode vir do chunk semanticamente mais próximo;
- visual puro: **não é inventado texto nem highlight**. A busca abre a página correta da mídia original sem fingir que alguma palavra foi encontrada.

Ao abrir imagens/PDFs, a mídia original é a representação principal. A transcrição continua disponível como ferramenta interna/auxiliar para pesquisa, correção e acessibilidade, mas não substitui o documento.

## Geometria OCR

Quando `wordGeometry` confiável existe, highlights literais podem ser posicionados sobre a mídia. Caixas inválidas ou palavras que não correspondam à transcrição são descartadas; o sistema não inventa coordenadas.

## Custo e degradação

Consultas muito curtas permanecem textuais. O embedding de consulta usa cache e pode ser reutilizado pelos índices textual e visual.

Falhas degradam de forma independente:

- sem Gemini/quota → lexical;
- índice textual indisponível → lexical;
- índice visual indisponível → lexical + semântico textual;
- visual em `shadow` → coleta de evidência sem mudar a ordenação entregue;
- paginação profunda → mecanismo textual continua disponível.

## Privacidade

Quando a semântica é usada, consultas/chunks ou uma imagem de página elegível podem ser enviados ao Gemini para embedding. A chave permanece nas Edge Functions.

Telemetria persiste somente metadados operacionais — operação, modelo, volume, latência e status — sem consulta, OCR, imagem, prompt ou vetor nos eventos.

## Benchmark multimodal atual

Run `31864249498`, SHA `a254e43d248943fad6ccf71203dc9059e6b40c63`.

O índice visual bruto atingiu Recall@1 `85,7%`, Recall@3 `92,9%` e MRR `0,901`. Com a fusão `active`, a busca entregue atingiu Recall@1 global `86,7%`, Recall@3 `93,3%`, MRR `0,907` e MRR visual `0,900`. O teste lexical permaneceu top-1, não houve falso positivo visual acima de `0.36` nas consultas negativas e todos os gates de latência/erro/quota passaram.

Depois da medição o staging voltou para `shadow` e os 16 documentos temporários foram apagados.

## Cobertura de testes

A suíte mantém contratos para:

- fuzzy/highlight tolerante a OCR;
- normalização semântica;
- cache e fallback;
- RRF textual;
- roteamento visual;
- cliente Gemini multimodal;
- RRF multimodal e proteção lexical top-1;
- resultado visual sem trecho inventado;
- migrations/RLS da fila e índice visual;
- benchmark de staging com bytes únicos por execução, threshold de produção, negativas e cleanup.
