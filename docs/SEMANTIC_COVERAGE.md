# Cobertura semântica de conteúdos

Este documento descreve a segunda camada da feature de cobertura de unidade. A interface continua usando os mesmos estados `Coberto`, `Parcial` e `Não encontrado`, mas a análise pode combinar busca textual/fuzzy, embeddings e uma verificação opcional do Gemini sobre poucos trechos candidatos.

A regra operacional principal é: **a semântica melhora a busca; ela nunca é requisito para a cobertura funcionar**. Se consentimento, cota, configuração, índice ou provedor estiverem indisponíveis, a análise textual/fuzzy existente continua válida e cobre todo o corpus pesquisável.

## Objetivos

A camada semântica resolve casos em que o assunto da ementa e a anotação expressam o mesmo conceito com vocabulário diferente. Exemplo:

- tópico: `Primeira lei da termodinâmica`;
- anotação: `ΔU = Q − W representa a conservação de energia do sistema`.

A busca textual pode ter pouco sinal nesse caso. Embeddings permitem recuperar o trecho por proximidade de significado. Um verificador opcional pode então distinguir explicação real de mera coincidência ou menção superficial.

## Fluxo completo

1. O usuário monta e revisa os campos de conteúdo da unidade.
2. A análise textual/fuzzy usa `search_pages` para todos os tópicos.
3. Se o usuário ativar e consentir com a análise semântica, o frontend chama a Edge Function `semantic-coverage`.
4. A função atualiza um pequeno lote do índice semântico que esteja ausente ou obsoleto.
5. Os tópicos são transformados em embeddings de consulta.
6. `search_pages_semantic` recupera os chunks semanticamente mais próximos.
7. Resultados lexicais e semânticos são deduplicados por página e combinados.
8. Um conjunto pequeno dos melhores candidatos pode ser enviado ao Gemini para verificar se a evidência é forte, parcial ou insuficiente.
9. O frontend aplica um score conservador e mantém os estados públicos já existentes.
10. Evidências continuam apontando para documento e página, permitindo inspeção manual.

## Modelo de embeddings

O padrão atual é `gemini-embedding-2`, com vetores de **768 dimensões**. O modelo pode ser trocado por configuração de ambiente, desde que preserve o contrato de dimensionalidade do índice atual.

O Gemini Embedding 2 não usa `taskType` como o modelo anterior. A intenção de recuperação é incluída no texto de instrução enviado ao modelo:

- consulta: representar o tópico para recuperar anotações acadêmicas relacionadas;
- documento: representar o trecho da anotação para recuperação semântica.

Para modelos antigos compatíveis, o cliente continua suportando `RETRIEVAL_QUERY` e `RETRIEVAL_DOCUMENT` via `embedContentConfig`.

## Chunking

Arquivo: `supabase/functions/_shared/semantic-chunks.ts`.

O texto efetivo de uma página é normalizado e dividido de modo determinístico:

- máximo de 1.800 caracteres por chunk;
- sobreposição aproximada de 220 caracteres;
- preferência por quebra em parágrafo/pontuação e depois espaço;
- máximo de 16 chunks por página;
- no máximo 48 chunks enviados para indexação em uma execução da Edge Function.

A consulta que lista páginas a indexar devolve no máximo os primeiros 24.000 caracteres do texto para limitar memória e tráfego da função. O hash, porém, é calculado sobre o **texto efetivo completo**.

## Invalidação por hash

Cada chunk guarda `source_hash`, SHA-256 do `page_effective_text` completo.

A busca semântica só considera um embedding quando:

- pertence ao usuário autenticado;
- usa o modelo solicitado;
- o `source_hash` ainda é igual ao hash do texto efetivo atual da página.

Se OCR, texto nativo ou correção manual mudar, os vetores antigos deixam de participar imediatamente. A página volta para a fila incremental de indexação. Isso impede que uma correção de conteúdo mantenha evidências semânticas obsoletas.

## Banco de dados

Migrações:

- `202608101410_semantic_coverage.sql`;
- `202608101411_semantic_coverage_consent.sql`;
- `202608101412_semantic_coverage_hardening.sql`.

### `page_semantic_chunks`

Armazena:

- usuário;
- página;
- modelo;
- hash do texto-fonte;
- índice e texto do chunk;
- embedding `vector(768)`;
- timestamps.

A tabela tem RLS e apenas leitura direta para o usuário autenticado dono dos dados. A substituição de vetores é feita por RPC validado, sem conceder escrita livre à tabela.

### RPCs

`list_pages_needing_semantic_index`
: Lista páginas cujo texto atual ainda não possui chunks válidos para o modelo solicitado.

`replace_page_semantic_chunks`
: Substitui atomicamente os chunks de uma página depois de verificar autenticação, proprietário, modelo, hash atual e formato do payload.

`semantic_index_stats`
: Informa páginas elegíveis e páginas já indexadas com hash atual.

`search_pages_semantic`
: Recebe o vetor da consulta, calcula similaridade cosseno e retorna o melhor chunk por página.

`record_coverage_semantic_consent`
: Registra consentimento específico para envio de trechos de anotações à camada semântica.

`has_coverage_semantic_consent`
: Confirma a versão de consentimento exigida pela Edge Function.

## Consentimento e privacidade

O consentimento de OCR da foto da ementa **não é reutilizado automaticamente** para a análise semântica. São operações diferentes:

- OCR da ementa envia a imagem escolhida pelo usuário;
- cobertura semântica pode enviar trechos das páginas já armazenadas no fichário.

A opção de relação semântica começa desativada na tela. Ao ativá-la e iniciar uma análise, o frontend registra o consentimento dedicado antes de solicitar embeddings.

A chave Gemini permanece apenas no ambiente da Edge Function. O navegador não recebe `GEMINI_API_KEY`.

## Indexação incremental

Não existe uma varredura obrigatória bloqueando a primeira análise. A Edge Function faz indexação oportunista em pequenos lotes:

- padrão: até 8 páginas candidatas por chamada;
- teto configurável: 32 páginas listadas;
- teto efetivo de trabalho do provedor: 48 chunks por execução.

Por isso o índice pode ficar temporariamente incompleto. A resposta traz:

- `totalPages`;
- `indexedPages`;
- `indexedThisRun`;
- `complete`.

Enquanto o índice não estiver completo, a UI avisa que a busca lexical continua cobrindo o fichário inteiro. Novas análises avançam a indexação sem tornar o usuário refém de uma tarefa longa.

## Recuperação híbrida

Para cada tópico são executadas duas recuperações, quando a semântica está disponível:

1. lexical/fuzzy por `search_pages`;
2. semântica por `search_pages_semantic`.

Os resultados são unidos por `pageId`. Cada candidato preserva:

- `lexicalRank`;
- `semanticSimilarity`;
- documento, página e caderno;
- trecho de evidência;
- veredito opcional do Gemini.

O trecho semântico substitui o excerpt lexical quando há similaridade suficiente, pois geralmente contém a região mais conceitualmente relevante da página.

## Score explicável e conservador

Arquivo: `src/lib/coverage/semantic-coverage.ts`.

Os sinais são normalizados separadamente:

- sinal lexical: `clamp(rank / 0.9)`;
- sinal semântico: `clamp((similaridade - 0.45) / 0.33)`.

O score-base usa o melhor sinal individual e também recompensa concordância entre os dois:

`max(lexical × 0.94, semântico × 0.96, lexical × 0.55 + semântico × 0.52)`.

Depois, se houver verificação:

- `strong`: pode promover uma evidência conceitualmente forte;
- `partial`: mantém o score abaixo do limiar de `Coberto`;
- `none`: reduz fortemente o score proporcionalmente à confiança do verificador.

Limiar final:

- `Coberto`: score >= 0,78;
- `Parcial`: score >= 0,42;
- `Não encontrado`: abaixo de 0,42.

A força mostrada na UI é o score final convertido para 0–100. Ela é um **indício operacional**, não uma probabilidade estatística.

## Verificador Gemini

Arquivo: `supabase/functions/_shared/gemini-coverage-verifier.ts`.

O verificador não lê o fichário inteiro. A Edge Function seleciona no máximo:

- dois candidatos por tópico;
- 24 candidatos no lote total;
- apenas candidatos com score-base minimamente útil.

O prompt trata trechos como dados não confiáveis e instrui explicitamente o modelo a ignorar comandos presentes dentro deles. O veredito usa structured output e só aceita:

- `strong`;
- `partial`;
- `none`;
- confiança de 0 a 1.

Falha do verificador não invalida embeddings nem busca lexical. O resultado retorna `verification: unavailable` e continua com score híbrido.

## Modos e fallback

A Edge Function pode responder:

### `hybrid`

Embeddings foram gerados para os tópicos e a busca semântica participou da recuperação. O verificador pode ou não ter sido usado.

### `lexical`

O resultado continua baseado na busca existente. Razões incluem:

- consentimento ainda não registrado;
- configuração semântica ausente;
- cota/rate limit do embedding;
- indisponibilidade temporária do provedor.

Se a própria Edge Function não puder ser chamada, `src/lib/services/topic-coverage.ts` também faz fallback local para `searchPages`.

## Configuração da Edge Function

`supabase/config.toml` registra `semantic-coverage` com JWT obrigatório.

Variáveis esperadas:

- `SUPABASE_URL`;
- `SUPABASE_ANON_KEY`;
- `GEMINI_API_KEY`;
- `APP_ORIGIN`;
- `SEMANTIC_EMBEDDING_MODEL` — opcional, padrão `gemini-embedding-2`;
- `COVERAGE_VERIFY_MODEL` — opcional, cai para `OCR_MODEL_PRIMARY` quando ausente;
- `SEMANTIC_INDEX_BATCH_PAGES` — opcional, padrão 8;
- `SEMANTIC_COVERAGE_TIMEOUT_MS` — opcional, padrão 55.000 ms.

## Segurança

Controles relevantes:

- JWT obrigatório na função;
- confirmação de usuário com `auth.getUser()`;
- RLS na tabela de chunks;
- RPC de escrita confirma proprietário e hash atual;
- respostas do Gemini têm tamanho limitado;
- payloads e respostas são validados estritamente;
- vetor precisa ter exatamente 768 dimensões;
- chunks e quantidade de candidatos têm limites rígidos;
- prompt do verificador trata o conteúdo recuperado como dado não confiável;
- nenhuma chave privada é exposta ao cliente;
- falhas externas degradam para busca local/lexical em vez de bloquear a feature.

## Limitações atuais

- A indexação incremental pode precisar de várias análises para cobrir fichários grandes.
- O índice atual usa somente texto; o Gemini Embedding 2 também suporta outras modalidades, mas imagens/PDFs não são enviados diretamente nesta feature.
- Os limiares híbridos são heurísticos e devem ser calibrados com exemplos reais do usuário, mantendo falsos positivos como custo principal.
- O verificador avalia evidência, não qualidade pedagógica completa de uma disciplina.
- Não existe ainda job periódico de indexação em background; a indexação é oportunista para evitar custo/complexidade obrigatórios.

## Testes

A implementação adiciona testes para:

- chunking e limites de trabalho;
- relação semântica sem sobreposição lexical;
- rejeição de similaridade fraca;
- promoção e supressão pelo verificador;
- garantia de que `partial` do verificador não vire `Coberto`;
- contrato estrito do serviço browser;
- consentimento dedicado;
- contrato atual do Gemini Embedding 2;
- structured output do verificador.

Os gates de Edge Function e banco devem validar também as novas migrações, a extensão `vector` e as permissões dos RPCs antes de deploy.
