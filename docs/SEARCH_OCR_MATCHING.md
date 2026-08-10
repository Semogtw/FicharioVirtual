# Busca tolerante a OCR e marcação de correspondências

## Objetivo

A busca do Fichário Virtual precisa recuperar conteúdo mesmo quando a transcrição nativa ou o OCR contém pequenas diferenças de grafia. O caminho de busca também deve mostrar ao usuário qual trecho motivou o resultado, sem fingir precisão geométrica que o pipeline não possui.

## Recuperação no PostgreSQL

A função pública `search_pages` mantém o contrato existente e combina sinais diferentes:

- igualdade e substring sobre texto normalizado;
- Full Text Search com `tsvector`;
- `strict_word_similarity` para encontrar palavras inteiras parecidas dentro de páginas longas;
- `word_similarity` para tolerar variações parciais e erros típicos de OCR;
- similaridade de trigramas em título de documento e nome de fichário.

A função configura limiares locais de `pg_trgm` para privilegiar recuperação de OCR sem alterar a configuração global do banco. Os operadores de word similarity continuam usando os índices GIN existentes.

O ranking favorece, nesta ordem geral, correspondência exata, substring, Full Text Search e correspondências de palavra. A similaridade entre a consulta curta e a página inteira permanece apenas como sinal secundário de ranking.

## Trechos de resultado

`search_excerpt` é executada somente depois da ordenação e paginação dos candidatos. Ela escolhe a palavra da página mais parecida com um termo da consulta e recorta o texto ao redor dela, em vez de devolver sempre os primeiros caracteres da página.

O helper é puro, executável por `authenticated` porque `search_pages` é `SECURITY INVOKER`, e continua indisponível para `anon`.

## Marcação no frontend

`src/lib/search/highlight.ts` preserva o texto original e aplica dois níveis de marcação:

1. correspondência exata depois de remover acentos e diferenças de caixa;
2. correspondência aproximada por distância de edição quando o termo exato não aparece.

Termos com menos de quatro caracteres não recebem fuzzy highlight para reduzir falsos positivos. Quando existem vários candidatos aproximados, somente os mais próximos do melhor candidato são marcados.

`SearchMatch.svelte` é o componente reutilizável que apresenta o trecho e usa `<mark>` sem gerar HTML a partir do conteúdo do usuário.

## Mídias suportadas

Ao abrir um resultado com `?highlight=...`, a correspondência aparece:

- no resultado da busca;
- sobre o painel da mídia original;
- na transcrição/correção da página.

Isso funciona para imagens, PDFs e referências externas porque usa o texto efetivo da página (`corrected_text`, `native_text` ou `ocr_raw_text`).

### Limite geométrico atual

A marcação sobre a mídia é um overlay textual associado à página, não um retângulo posicionado sobre os pixels da palavra. O contrato OCR atual persiste somente `text` e `warnings`; não existem bounding boxes por palavra. Inventar coordenadas a partir da ordem do texto produziria marcações visualmente erradas.

O Gemini oferece suporte a bounding boxes normalizadas para tarefas visuais, portanto uma evolução futura pode adicionar regiões de texto opcionais ao contrato OCR. Essa mudança deve ser feita de ponta a ponta (provider, parser, persistência, histórico, exportação e viewer) e precisa controlar o aumento de tokens/armazenamento. Provedores locais também precisam de um caminho equivalente ou de um fallback explícito.

## Cobertura de testes

A implementação inclui testes para:

- destaque sem acento preservando o texto original;
- erro OCR aproximado (`fotossintcse` para consulta `fotossíntese`);
- proteção contra fuzzy em termos muito curtos;
- recorte centrado no termo aproximado;
- privilégios do helper SQL;
- comportamento básico e limite de tamanho do excerpt SQL.
