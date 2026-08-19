# Cache local de mídia

O Fichário usa um cache local de previews para tirar o Google Drive do caminho crítico de abertura de documentos sem duplicar a biblioteca inteira no dispositivo.

## Arquitetura

O Google Drive continua sendo a fonte permanente dos arquivos originais. O navegador/PWA mantém apenas representações recriáveis e compactas no armazenamento privado da aplicação (OPFS):

- imagens recém-importadas: a imagem já preparada para OCR é gravada no cache local depois que o upload é concluído;
- imagens antigas: a primeira abertura ainda baixa o original do Drive, mostra o original imediatamente e, em segundo plano, cria um preview WebP/JPEG de até 2560 px para as próximas aberturas;
- PDFs: o PDF original não é copiado para o cache. Cada página renderizada pelo viewer (JPEG, atualmente até 2400 px) pode ser persistida individualmente;
- thumbnails e previews são derivados descartáveis. A remoção deles nunca remove o original do Drive.

Uma abertura subsequente consulta o cache antes de buscar metadados pesados ou mídia no Drive. Em um cache hit, a página pode ser exibida diretamente a partir do dispositivo.

## Uso de espaço

O cache é deliberadamente limitado. O orçamento local é calculado a partir da quota de armazenamento exposta pelo navegador:

- padrão quando a quota não pode ser estimada: 256 MiB;
- mínimo: 64 MiB;
- alvo: 8% da quota disponível;
- máximo: 512 MiB;
- um único preview não pode ultrapassar 16 MiB.

Quando o cache excede o orçamento ou o navegador fica com pouco espaço livre, as entradas menos acessadas são removidas primeiro. O sistema solicita armazenamento persistente (`navigator.storage.persist()`) quando suportado, mas continua correto se o navegador negar a solicitação ou decidir tratar os dados como best-effort.

## Isolamento e invalidação

As chaves incluem o usuário, documento, página, origem física e tipo de mídia. Isso evita reutilizar previews entre usuários e entre arquivos diferentes. O cache é apenas uma otimização: falha, ausência, limpeza pelo navegador ou falta de suporte ao OPFS sempre levam ao fluxo remoto normal.

Arquivos gerenciados pelo Fichário são tratados como originais imutáveis após a importação. Caso a identidade física da origem mude, uma nova chave de cache é usada.

## Compatibilidade

A implementação usa feature detection. Navegadores que não oferecem OPFS continuam usando o viewer remoto sem perda funcional. No desktop e no Android com navegadores/PWAs compatíveis, o mesmo caminho local-first é utilizado.

## Garantias de produto

- O original continua armazenado apenas no provedor permanente configurado para o documento.
- O cache não deve conter uma segunda cópia integral de um PDF.
- Para imagens, apenas a representação preparada/comprimida é persistida; um download legado só é cacheado quando for possível gerar uma representação menor.
- Limpar o cache pode tornar a próxima abertura mais lenta, mas não causa perda de documento.
