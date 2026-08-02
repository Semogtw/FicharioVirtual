# Fichário Virtual — Especificação de Produto e Arquitetura

**Status:** aprovado para planejamento de implementação  
**Data-base:** 2 de agosto de 2026  
**Usuário inicial:** uma única conta  
**Dispositivo de referência:** Samsung Galaxy Tab S6 Lite  
**Restrição financeira:** custo operacional obrigatório de R$ 0

## 1. Visão

O Fichário Virtual é uma biblioteca pessoal pesquisável para anotações. O usuário importa fotos de caderno, capturas de aplicativos como Samsung Notes e PDFs. O sistema preserva o original, extrai ou reconhece o texto e permite encontrar posteriormente a página correta por palavra, frase, caderno, data ou tag.

O produto não será apresentado como chatbot. A experiência deve remeter a um fichário digital editorial: capas discretas, páginas reais, tipografia clara, busca central e revisão lado a lado.

### Exemplo principal

1. O usuário fotografa uma página sobre fotossíntese.
2. A aplicação prepara e envia a imagem sem travar a interface.
3. Uma função protegida solicita a transcrição a um provedor externo.
4. A transcrição é normalizada e indexada.
5. A pesquisa por `cloroplasto`, `fotossintese` ou uma variante com pequeno erro localiza a página.
6. O resultado abre a imagem original e destaca o termo na transcrição.

## 2. Objetivos do MVP

- Login de uma única conta autorizada.
- Organização em cadernos e documentos.
- Importação de JPG, PNG, WebP e PDF.
- Captura direta pela câmera no Android.
- Extração de texto nativo de PDFs sem OCR.
- OCR de texto manuscrito e impresso em imagens.
- Processamento retomável e idempotente.
- Busca exata, textual e aproximada.
- Visualização do arquivo original na página correta.
- Correção manual da transcrição.
- Fila de páginas que precisam de revisão.
- Instalação como PWA.
- Exportação e exclusão dos dados.
- Painel de consumo das franquias gratuitas.

## 3. Fora do MVP

- Colaboração ou compartilhamento público.
- Múltiplos usuários.
- Treinamento de modelo com a caligrafia do usuário.
- Modelos de IA executados localmente.
- Reconhecimento matemático especializado.
- Edição estrutural de PDF.
- Sincronização integral da biblioteca para uso offline.
- Banco vetorial e embeddings.
- Chat irrestrito com todos os documentos.
- Destaque geométrico preciso sobre palavras manuscritas.

Uma função de perguntas fundamentadas poderá ser adicionada depois que a recuperação documental estiver confiável.

## 4. Requisitos não funcionais

### 4.1 Desempenho

O Tab S6 Lite é o dispositivo de referência, mas não será tratado como hardware extremamente limitado. A aplicação pode usar WebAssembly, PDF.js, Web Workers, IndexedDB e processamento de imagem no navegador. A restrição é não carregar ou executar modelos locais de IA.

Metas iniciais:

- A tela inicial não carrega PDF.js nem `pdf-inspector`.
- Bibliotecas de PDF são carregadas somente ao importar ou visualizar um PDF.
- A interface permanece responsiva durante classificação, renderização e compressão.
- Navegação entre telas já carregadas deve parecer imediata.
- A busca deve retornar normalmente em menos de 500 ms após chegar ao backend.
- Uma imagem comum deve ser preparada em poucos segundos, sem bloquear a thread principal.
- Miniaturas devem aparecer antes do término do OCR.
- Resultados já indexados devem abrir sem esperar por IA.

Concorrência padrão:

- uploads: até 3 arquivos;
- preparação de imagens: até 2 tarefas em worker;
- renderização de PDF: 1 página por vez;
- chamadas de OCR: até 2 páginas simultâneas;
- reprocessamento de qualidade: 1 por vez.

A concorrência poderá ser reduzida quando o navegador sinalizar pouca memória, quando houver erros de rede ou quando o provedor limitar requisições.

### 4.2 Gratuidade

- Hospedagem em plano gratuito pessoal.
- Banco, autenticação, armazenamento e funções em plano gratuito.
- OCR em projeto sem faturamento vinculado.
- Nenhum fallback automático para modelo ou serviço pago.
- Ao atingir uma cota, o trabalho é pausado e preservado.
- O painel mostra uso e limites internos.
- A documentação registra como migrar de fornecedor sem reescrever o domínio da aplicação.

### 4.3 Privacidade

- Arquivos em bucket privado.
- URLs assinadas com validade curta.
- Row Level Security em todas as tabelas expostas.
- Chave do OCR somente em segredo de backend.
- Consentimento explícito antes do primeiro envio a um provedor externo.
- Opção por documento para não usar leitura automática.
- Exclusão integral e exportação de dados.

No nível gratuito da Gemini Developer API, o conteúdo pode ser usado pelo Google para melhorar produtos. A interface deve informar isso claramente e sem linguagem jurídica obscura.

### 4.4 Portabilidade

O usuário poderá exportar:

- arquivos originais;
- miniaturas opcionais;
- transcrições brutas e corrigidas;
- metadados em JSON;
- índice de documentos em CSV.

A aplicação não deve depender de campos proprietários do provedor de OCR para representar o domínio principal.

## 5. Arquitetura

```text
PWA SvelteKit / TypeScript
│
├── interface, cache e fila local
├── Web Workers
│   ├── preparação de imagens
│   └── inspeção de PDFs
├── pdf-inspector WASM
├── PDF.js sob demanda
│
├── Supabase
│   ├── Auth
│   ├── PostgreSQL
│   ├── Storage privado
│   └── Edge Functions
│
└── Provedor OCR
    └── Gemini Developer API no nível gratuito
```

### 5.1 Frontend

**Stack:** SvelteKit, TypeScript estrito, adapter estático, PWA, Vitest e Playwright.

Responsabilidades:

- autenticação e navegação;
- organização da biblioteca;
- preparação e upload dos arquivos;
- classificação local de PDFs;
- renderização local de páginas que precisam de OCR;
- controle da fila de importação;
- busca, visualização e revisão;
- cache leve de metadados recentes.

O frontend não contém a chave do OCR nem uma service role do Supabase.

### 5.2 Backend

**Stack:** Supabase Auth, PostgreSQL, Storage e Edge Functions.

Responsabilidades:

- autorização e isolamento dos dados;
- persistência do estado dos trabalhos;
- geração de URLs assinadas;
- chamadas ao provedor de OCR;
- validação da resposta estruturada;
- normalização e indexação do texto;
- busca ranqueada;
- medição de uso.

A Edge Function orquestra rede e banco. Ela não executa renderização de PDF nem transformação pesada de imagem.

### 5.3 OCR substituível

A aplicação terá uma interface de provedor:

```ts
export interface OcrProvider {
	transcribe(input: OcrInput): Promise<OcrResultV1>;
}
```

O provedor inicial será Gemini. O nome do modelo será uma variável de ambiente, pois modelos e franquias mudam. Na implantação, deve-se selecionar um modelo multimodal rápido que esteja explicitamente disponível no nível gratuito.

A resposta interna será estável:

```ts
export interface OcrResultV1 {
	schemaVersion: 1;
	fullText: string;
	detectedLanguage: string | null;
	uncertainSegments: Array<{
		text: string;
		context: string | null;
	}>;
	suggestedTitle: string | null;
	suggestedTags: string[];
	warnings: string[];
}
```

O sistema não inventará uma porcentagem de confiança. Trechos incertos são registrados explicitamente.

## 6. Pipeline de imagens

1. Validar extensão, MIME e tamanho.
2. Ler orientação da imagem.
3. Decodificar uma imagem por tarefa.
4. Corrigir orientação.
5. Redimensionar para até 2.560 px no maior lado por padrão.
6. Gerar WebP ou JPEG entre 82% e 88% de qualidade.
7. Criar miniatura de até 480 px.
8. Calcular SHA-256 do arquivo preparado.
9. Consultar duplicidade.
10. Enviar original preparado e miniatura.
11. Criar documento, página e trabalho de OCR.
12. Processar até duas páginas simultaneamente.

O limite de 2.560 px prioriza legibilidade e velocidade no Tab S6 Lite. Imagens com texto muito pequeno poderão usar um modo de alta definição de até 3.200 px, escolhido manualmente ou por heurística.

## 7. Pipeline de PDFs

O `pdf-inspector` será executado em Web Worker. Ele detecta PDFs textuais, digitalizados, baseados em imagens ou mistos, extrai texto e identifica páginas que precisam de OCR.

### PDF textual

```text
PDF → pdf-inspector → texto por página → normalização → índice
```

Não há chamada de OCR.

### PDF misto

```text
PDF → pdf-inspector
       ├── páginas textuais → extração direta
       └── páginas sem texto → PDF.js → imagem → OCR
```

### PDF digitalizado

O PDF original é enviado ao Storage. O cliente renderiza uma página por vez, prepara a imagem e a envia para OCR. A imagem temporária é removida após o resultado ser persistido.

O modo de inspeção completo deve ser usado quando a classificação inicial indicar um documento misto. Para documentos muito grandes, uma amostragem rápida pode antecipar a interface, seguida de análise completa em worker.

## 8. Busca

O MVP não usa embeddings.

A busca combina:

1. título e nome do caderno;
2. correspondência exata no texto efetivo;
3. PostgreSQL Full Text Search;
4. texto sem acentos;
5. similaridade por trigramas;
6. tags aceitas pelo usuário.

Texto efetivo:

```text
corrected_text ?? native_text ?? ocr_raw_text
```

A transcrição original nunca é sobrescrita pela correção humana.

Exemplos esperados:

- `fotossintese` encontra `fotossíntese`;
- `mitocondria` encontra `mitocôndria`;
- `fotossintesc` pode encontrar `fotossíntese`;
- uma frase entre aspas recebe prioridade sobre resultados parciais.

## 9. Modelo de dados

### `app_users`

- `user_id uuid primary key`
- `is_active boolean`
- `created_at timestamptz`

Somente usuários ativos nessa tabela acessam a aplicação.

### `notebooks`

- `id uuid primary key`
- `user_id uuid not null`
- `name text not null`
- `description text`
- `cover_style text`
- `created_at timestamptz`
- `updated_at timestamptz`

### `documents`

- `id uuid primary key`
- `user_id uuid not null`
- `notebook_id uuid`
- `title text not null`
- `kind text` (`image` ou `pdf`)
- `original_filename text`
- `storage_path text not null`
- `thumbnail_path text`
- `page_count integer`
- `status text`
- `sha256 text`
- `source_created_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

### `pages`

- `id uuid primary key`
- `user_id uuid not null`
- `document_id uuid not null`
- `page_number integer not null`
- `native_text text`
- `ocr_raw_text text`
- `corrected_text text`
- `normalized_text text`
- `search_vector tsvector`
- `extraction_source text`
- `temporary_image_path text`
- `warnings jsonb`
- `status text`
- `was_manually_reviewed boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

### `ocr_jobs`

- `id uuid primary key`
- `user_id uuid not null`
- `page_id uuid not null`
- `provider text`
- `model text`
- `prompt_version integer`
- `status text`
- `attempt_count integer`
- `idempotency_key text unique`
- `last_error_code text`
- `last_error_message text`
- `next_retry_at timestamptz`
- `started_at timestamptz`
- `finished_at timestamptz`
- `created_at timestamptz`

### Tabelas auxiliares

- `tags`
- `document_tags`
- `import_sessions`
- `usage_daily`

## 10. Estados

### Documento

- `uploading`
- `pending`
- `processing`
- `ready`
- `partially_ready`
- `needs_review`
- `failed`

### Trabalho de OCR

- `pending`
- `processing`
- `ready`
- `retryable`
- `blocked_quota`
- `needs_review`
- `failed`

Toda transição deve ser idempotente e persistida antes da próxima etapa.

## 11. Interface e identidade

### Direção

A aparência deve ser editorial, organizada e silenciosa. Referências visuais: fichários, índices de biblioteca, papel de boa gramatura e aplicações de leitura.

### Paleta inicial

- papel: `#F7F4EE`;
- superfície: `#FCFAF6`;
- tinta: `#202124`;
- texto secundário: `#66706B`;
- linha: `#DDD7CC`;
- terracota: `#A65E43`;
- verde arquivo: `#536A5B`.

### Tipografia

- títulos: Georgia, Cambria ou serif do sistema;
- corpo e interface: `system-ui`;
- metadados técnicos: `ui-monospace` somente quando necessário.

### Evitar

- gradientes roxo-azuis;
- brilho, estrelas e robôs;
- glassmorphism excessivo;
- tela inicial em formato de chat;
- linguagem como “a IA está pensando”;
- cartões genéricos com raios exagerados;
- animações longas.

### Vocabulário

- “Leitura automática”, não “OCR com IA”.
- “Trechos para revisar”, não “baixa confiança”.
- “Perguntar às anotações”, não “RAG”.
- “Processando página”, não “agente trabalhando”.

### Navegação

No tablet e celular:

```text
Início | Biblioteca | Importar | Revisar
```

Em telas largas, menu lateral com busca fixa no topo.

## 12. Segurança

- Desativar novos cadastros depois de criar a conta principal.
- Verificar `app_users` após a autenticação.
- Ativar RLS em todas as tabelas.
- Políticas baseadas em `auth.uid() = user_id`.
- Bucket privado com caminho iniciado pelo UUID do usuário.
- URLs assinadas e curtas.
- JWT obrigatório na Edge Function.
- Chave do Gemini em segredo do Supabase.
- Nenhum conteúdo integral em logs.
- Conteúdo da anotação tratado como dado não confiável, nunca como instrução.
- Exclusão transacional dos metadados e limpeza dos arquivos.

## 13. Tratamento de falhas

- Upload interrompido: retomar via `import_sessions`.
- Duplicata: oferecer abrir o documento existente.
- Limite da API: status `blocked_quota`, sem repetição contínua.
- JSON inválido: uma tentativa de reparo e depois revisão manual.
- OCR vazio: permitir rotação, recorte, modo de alta definição ou digitação.
- Aplicação fechada: a chamada atual pode terminar; pendências retomam na próxima abertura.
- Duas abas: coordenar com `BroadcastChannel`, `navigator.locks` e idempotência no banco.
- Supabase pausado: mostrar uma mensagem específica e instrução de restauração.

## 14. Critérios de aceitação do MVP

O MVP estará pronto quando o usuário puder:

1. abrir a PWA no Tab S6 Lite;
2. autenticar-se;
3. fotografar ou importar uma página;
4. continuar usando a interface durante a preparação;
5. fechar e reabrir sem perder o estado;
6. pesquisar com ou sem acento;
7. encontrar resultados apesar de um pequeno erro de OCR;
8. abrir o documento na página correta;
9. corrigir a transcrição;
10. ver a correção refletida na busca;
11. exportar e excluir seus dados;
12. confirmar que não há faturamento habilitado.

## 15. Referências verificadas

Verificadas em 2 de agosto de 2026:

- Supabase Free: https://supabase.com/pricing
- Limites de Edge Functions: https://supabase.com/docs/guides/functions/limits
- Limites de arquivo: https://supabase.com/docs/guides/storage/uploads/file-limits
- Gemini Developer API — preços: https://ai.google.dev/gemini-api/docs/pricing?hl=pt-br
- Gemini Developer API — faturamento: https://ai.google.dev/gemini-api/docs/billing?hl=pt-BR
- Gemini Developer API — rate limits: https://ai.google.dev/gemini-api/docs/rate-limits?hl=pt-br
- Vercel Hobby: https://vercel.com/docs/plans/hobby
- pdf-inspector: https://github.com/firecrawl/pdf-inspector
