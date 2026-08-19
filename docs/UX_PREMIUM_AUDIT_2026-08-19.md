# Vistoria de experiência premium — 2026-08-19

## Objetivo

Tratar o Fichário Virtual como um produto pronto para uso cotidiano, não apenas como uma interface funcional. A revisão prioriza clareza, previsibilidade, recuperação de erros, continuidade entre telas, uso no celular e redução de detalhes internos que não ajudam quem está usando o fichário.

## Superfícies revisadas

- Shell global e navegação desktop/mobile.
- Login e recuperação após falha de navegação.
- Início e resumo do fichário.
- Biblioteca, filtros, Tags e organização em lote.
- Cadernos, detalhe de caderno e inclusão de documentos existentes.
- Importação de imagens/PDFs, captura por câmera e documento de fotos.
- Pesquisa textual/por significado e abertura de resultado no documento original.
- Documento, navegação entre páginas, correção e exclusão.
- Fila de revisão e rascunhos.
- Cobertura de conteúdo e entrada por foto.
- Google Drive, importação, pendências, conflitos e recuperação.
- Configurações e telas avançadas de processamento/uso.

## Correções implementadas nesta vistoria

### Navegação

- A barra inferior mobile deixa de espremer seis destinos e passa a priorizar Início, Biblioteca, Cadernos e Importar, mantendo Revisar, Cobertura, Drive e Configurações em “Mais”.
- Cadernos e Configurações deixam de ficar escondidos no celular.
- A tela de organização em lote passa a ser descobrível pela navegação da Biblioteca.
- O topo da tela de Pesquisa não mostra uma segunda caixa de busca concorrente.
- O falso avatar “A”, que na verdade abria Configurações, foi substituído por um ícone com significado correto.
- “Fila remota” e “Rascunhos locais” foram simplificados para “Para revisar” e “Rascunhos”.

### Importação

- Removidas as abas “Imagens e câmera” / “PDFs e arquivos” que sugeriam dois fluxos diferentes embora ambas as rotas entregassem a mesma tela unificada.
- As URLs antigas continuam compatíveis e chegam à mesma experiência de importação.
- Arquivos aguardando a resolução de um caderno não são mais descartados se o carregamento dos cadernos falhar; a tela preserva a seleção e oferece tentativa explícita de recuperação.
- Descartar um documento de fotos com várias páginas agora exige confirmação; remover uma página individual continua direto para não criar atrito excessivo.
- Mensagens de quantidade usam pluralização natural em vez de `foto(s)`, `arquivo(s)`, `página(s)` e `documento(s)`.
- “Entrada unificada” foi trocado por “Importar”, evitando expor uma decisão de arquitetura como título de produto.

### Biblioteca

- Filtros ativos passam a ser explicitados.
- Há uma saída clara para voltar à biblioteca completa com “Limpar filtros”.
- O estado vazio de um recorte filtrado deixa de sugerir que o usuário importe um novo arquivo; primeiro oferece desfazer o filtro.
- “Estado” foi substituído por “Status”, termo mais natural nesse contexto.
- Intervalos de data invertidos são detectados antes da consulta, com os dois campos marcados como inválidos e mensagem explicando a correção necessária.

### Pesquisa

- A consulta digitada na página agora é preservada no parâmetro `q` da URL; recarregar, voltar ou compartilhar a tela mantém o contexto correto.
- A interface deixa de anunciar detalhes internos quando a busca está saudável.
- Quando a busca por significado está temporariamente indisponível, o aviso explica apenas o impacto e informa que a busca por texto continua funcionando.

### Documento

- A faixa de páginas não expõe mais estados internos como `pending`, `uploading`, `processing`, `ready` ou `failed`; todos são apresentados em português com rótulos curtos e consistentes.
- A exclusão continua protegida por diálogo de confirmação e mantém recuperação caso a navegação posterior falhe.

### Google Drive

- As telas já implementadas de mudanças pendentes e resolução de conflitos deixaram de ser rotas escondidas: agora aparecem junto de “Visão geral”, com estado ativo claro.
- “Importar do Drive” permanece destacado como ação contextual, separado das abas de diagnóstico/sincronização.
- A tela de conflitos deixou de exigir termos como “snapshot remoto”, “estado local” e “ausência física”; as escolhas agora explicam a consequência em linguagem de produto.
- A tela de pendências usa “Sincronizar agora”, estados mais curtos e mensagens com pluralização natural em vez de textos de fila/worker.
- Conflitos continuam isolados por item e as duas resoluções seguras existentes foram preservadas, apenas com rótulos compreensíveis.

### Login

- Textos sobre índice vetorial/plano interno foram substituídos por benefícios compreensíveis para o usuário.
- Campo de senha ganhou controle acessível para mostrar/ocultar conteúdo.
- Mensagens mantêm diferença entre autenticação concluída e eventual falha posterior de navegação.

## Achados para o próximo passe

### Prioridade média

1. Trocar carregamentos textuais remanescentes em Revisar, Organizar, Tags e detalhe de Caderno pelos padrões de skeleton/loading já usados nas telas principais.
2. Tornar cartões de resumo da tela inicial acionáveis quando houver destino natural: Documentos → Biblioteca e Para revisar → Revisar.
3. Simplificar subtítulos ainda técnicos em telas secundárias, por exemplo “Metadados em lote” e “Organização transversal”.
4. No construtor de fotos, ocultar ou contextualizar o campo de título quando o modo “Separadas” estiver ativo, já que cada foto seguirá como documento independente.

### Prioridade baixa / acabamento

1. Uniformizar movimentos de entrada dos painéis secundários com os componentes principais, sempre respeitando `prefers-reduced-motion`.
2. Avaliar foco automático apenas em contextos que não abram teclado inesperadamente no celular.
3. Uniformizar densidade e largura de ações em telas administrativas/avançadas para não competir visualmente com os fluxos de uso diário.

## Critérios de “premium” usados

- Nenhuma ação principal deve depender de conhecimento da arquitetura interna.
- Todo estado vazio deve explicar o que aconteceu e oferecer a próxima ação correta.
- Toda falha recuperável deve ter recuperação próxima e explícita.
- A navegação deve oferecer as mesmas capacidades essenciais em desktop e mobile sem comprimir alvos de toque.
- Controles não devem fingir ser outra coisa (avatar, aba, status técnico, botão sem consequência clara).
- Busca, filtros e seleção devem preservar contexto suficiente para recarregar ou voltar sem surpreender o usuário.
- Ações destrutivas devem ser proporcionais ao dano: confirmação para perda relevante, ação direta para operações pequenas/reversíveis.
- Mensagens saudáveis descrevem resultado/benefício; detalhes de implementação só aparecem quando necessários para diagnosticar uma falha em área avançada.

## Validação esperada antes do merge

- `pnpm verify:full` no SHA final da branch.
- Contratos unitários para navegação mobile, importação unificada, preservação do rascunho, shell de pesquisa/configurações e recuperação do Drive.
- Smoke dos fluxos principais em viewport desktop e mobile sempre que o ambiente de staging/autenticação estiver disponível.
- Conferir regressões de teclado, foco, estados vazios, botões desabilitados e mensagens de erro durante importação, pesquisa e sincronização.
