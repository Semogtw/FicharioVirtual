# Busca híbrida, tolerância a OCR e marcação de correspondências

## Objetivo

A busca global do Fichário Virtual precisa recuperar conteúdo em dois cenários complementares:

1. quando a consulta e a página usam palavras iguais ou parecidas, inclusive com erros de OCR;
2. quando a consulta e a página expressam o mesmo conceito com vocabulário diferente.

Por isso a busca global combina **recuperação textual/fuzzy** e **recuperação semântica por embeddings**. O Gemini não é usado para decidir sozinho quais páginas aparecem: ele gera embeddings; PostgreSQL/pgvector faz a recuperação vetorial; os sinais lexical e semântico são então combinados de forma determinística.

A camada semântica é opcional e degradável. Sem configuração, cota ou provedor disponível, `search_pages` continua pesquisando o corpus inteiro.

## Recuperação textual no PostgreSQL

A função pública `search_pages` combina sinais diferentes:

- igualdade e substring sobre texto normalizado;
- Full Text Search com `tsvector`;
- `strict_word_similarity` para encontrar palavras inteiras parecidas dentro de páginas longas;
- `word_similarity` para tolerar variações parciais e erros típicos de OCR;
- similaridade de trigramas em título de documento e nome de fichário.

A função configura limiares locais de `pg_trgm` para privilegiar recuperação de OCR sem alterar a configuração global do banco. Os operadores de word similarity continuam usando os índices GIN existentes.

O ranking lexical favorece, nesta ordem geral, correspondência exata, substring, Full Text Search e correspondências de palavra. A similaridade entre a consulta curta e a página inteira permanece apenas como sinal secundário.

## Recuperação semântica

A busca global reutiliza **o mesmo índice de páginas usado pela cobertura de conteúdos**:

- tabela `page_semantic_chunks`;
- embeddings de 768 dimensões;
- modelo padrão `gemini-embedding-2`;
- hash SHA-256 do texto efetivo para invalidação;
- índice HNSW com distância cosseno;
- RPC `search_pages_semantic`.

Não existe um segundo conjunto de vetores para a busca. Se uma página já foi indexada pela cobertura com o mesmo modelo e hash, a busca global a reutiliza sem nova chamada de embedding de documento. O inverso também vale: páginas indexadas durante uma pesquisa ficam disponíveis para a cobertura.

A Edge Function `semantic-search` faz indexação oportunista de páginas ainda ausentes ou obsoletas, gera um embedding `RETRIEVAL_QUERY` para a consulta e recupera os chunks semanticamente mais próximos. Uma página só é persistida como atual quando todos os chunks dela cabem no lote da execução.

Exemplo de recuperação semântica:

- consulta: `conservação de energia em um sistema`;
- anotação: `ΔU = Q − W` acompanhada de explicação sobre calor, trabalho e energia interna.

Mesmo com pouca sobreposição literal, a anotação pode entrar no conjunto candidato por similaridade vetorial.

## Ranking híbrido

A Edge Function consulta em paralelo:

- `search_pages`, para o sinal lexical/fuzzy;
- `search_pages_semantic`, para similaridade vetorial.

Os resultados são deduplicados por página. O score final normaliza os sinais separadamente e privilegia correspondências lexicais fortes, sem impedir resultados puramente semânticos.

Resultados semânticos isolados precisam atingir o limiar configurado para entrar no conjunto. Esses valores são heurísticos e devem ser calibrados com consultas reais; não representam probabilidade estatística.

A interface identifica a origem do match:

- sem badge: resultado essencialmente textual;
- `Por sentido`: resultado recuperado apenas semanticamente;
- `Texto + sentido`: ambos os sinais encontraram a página.

A busca global **não usa o verificador generativo da cobertura**. Esse verificador responde à pergunta específica “este trecho cobre este tópico?”. Para pesquisa livre, a recuperação híbrida é o mecanismo correto e evita custo/latência de uma chamada generativa por consulta.

## Paginação e custo

A busca digitada usa debounce mais conservador para não gerar um embedding a cada tecla. Consultas muito curtas permanecem textuais.

A janela híbrida inicial é limitada aos melhores candidatos combinados. Resultados mais profundos continuam disponíveis pela paginação textual. Isso mantém custo e latência previsíveis sem transformar a camada semântica em requisito para navegar por resultados antigos.

A indexação oportunista trabalha em lotes pequenos e o índice pode, portanto, ficar temporariamente incompleto; o status é mostrado na tela, enquanto a busca textual continua cobrindo todas as páginas pesquisáveis.

## Privacidade e envio ao provedor

O sistema privado atual não mantém telas, flags ou RPCs de consentimento pré-lançamento para busca semântica. A chamada segue diretamente o fluxo normal da funcionalidade e degrada para busca textual quando o provedor não está disponível.

Quando a camada semântica é usada:

- a consulta pode ser enviada ao Gemini para gerar o embedding de pesquisa;
- pequenos chunks de páginas ainda não indexadas podem ser enviados para gerar embeddings de documento;
- a chave `GEMINI_API_KEY` permanece exclusivamente na Edge Function;
- telemetria registra operação, modelo, volume, latência e status, mas não persiste consulta, texto de página, prompt completo ou vetor.

As migrations históricas que introduziram consentimentos permanecem no repositório para preservar a sequência de schema; a migration de limpeza pré-lançamento remove essas superfícies do schema resultante.

## Fallback

A pesquisa continua textual quando ocorrer qualquer uma destas condições:

- consulta curta demais;
- Edge Function ainda não implantada no ambiente;
- chave/modelo semântico ausente;
- quota ou rate limit do Gemini;
- indisponibilidade do provedor;
- paginação além da janela híbrida inicial.

O navegador também faz fallback para `searchPages()` se a chamada à Edge Function falhar.

## Trechos de resultado

Na recuperação lexical, `search_excerpt` é executada somente depois da ordenação e paginação dos candidatos. Ela escolhe a palavra da página mais parecida com um termo da consulta e recorta o texto ao redor dela.

Na recuperação semântica, o excerpt pode vir diretamente do chunk vetorial mais próximo. Isso é necessário porque uma correspondência conceitual pode não conter nenhuma palavra da consulta.

## Marcação no frontend

`src/lib/search/highlight.ts` preserva o texto original e aplica dois níveis de marcação:

1. correspondência exata depois de remover acentos e diferenças de caixa;
2. correspondência aproximada por distância de edição quando o termo exato não aparece.

Termos com menos de quatro caracteres não recebem fuzzy highlight para reduzir falsos positivos. Em um resultado `Por sentido`, pode não existir trecho literal para marcar; nesse caso o excerpt semântico continua sendo exibido sem inventar destaque.

`SearchMatch.svelte` é o componente reutilizável que apresenta o trecho e usa `<mark>` sem gerar HTML a partir do conteúdo do usuário.

## Mídias suportadas

Ao abrir um resultado com `?highlight=...`, a correspondência literal aparece quando disponível:

- no resultado da busca;
- sobre o painel da mídia original;
- na transcrição/correção da página.

Isso funciona para imagens, PDFs e referências externas porque usa o texto efetivo da página (`corrected_text`, `native_text` ou `ocr_raw_text`). Para resultados puramente semânticos, a página correta ainda é aberta mesmo que não haja palavra equivalente para destacar.

### Geometria OCR

O contrato OCR de lançamento inclui `wordGeometry` opcional por palavra em coordenadas normalizadas, além de `text`, `warnings` e `contentClass`. O backend filtra caixas inválidas ou palavras que não aparecem na transcrição antes de persistir os dados.

Quando existe geometria confiável, a interface pode posicionar a marcação sobre a mídia original. Quando uma palavra não possui caixa válida, o sistema preserva a marcação textual e não inventa coordenadas.

## Cobertura de testes

A implementação inclui ou deve manter testes para:

- destaque sem acento preservando o texto original;
- erro OCR aproximado (`fotossintcse` para consulta `fotossíntese`);
- proteção contra fuzzy em termos muito curtos;
- recorte centrado no termo aproximado;
- contrato estrito do cliente `semantic-search`;
- recuperação `semantic` e `hybrid` sem exigir overlap literal;
- ausência das superfícies de consentimento pré-lançamento;
- reuso de `page_semantic_chunks` e `search_pages_semantic`;
- fallback lexical para cota, provider e função indisponível;
- geometria OCR validada e fallback textual sem coordenadas inventadas;
- configuração JWT e inclusão da Edge Function nos gates de deploy/Deno.
