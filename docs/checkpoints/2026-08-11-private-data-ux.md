# Checkpoint — UX de dados para uso privado

Data: 2026-08-11

## Decisão de produto

O Fichário Virtual é configurado para uso privado e não deve interromper operações comuns com confirmações recorrentes de processamento de dados.

A interface passa a seguir estes princípios:

- OCR é acionado automaticamente somente quando imagens ou páginas visuais realmente precisam de leitura;
- busca e cobertura semânticas tentam ativar sua camada de significado automaticamente e preservam o fallback textual/fuzzy quando ela não está disponível;
- importações por imagem, PDF e Google Drive não exigem um checkbox repetido antes de cada operação;
- um aviso informativo compacto aparece uma única vez por navegador e aponta para `Configurações → Privacidade e dados`;
- a página de configurações mantém de forma permanente a explicação sobre OCR, Gemini, telemetria técnica e gerenciamento de arquivos;
- o fluxo não cria cadastro público adicional.

## Compatibilidade interna

O banco e alguns RPCs ainda usam nomes históricos com `consent`, como `record_ocr_consent` e os marcadores semânticos. Eles permanecem nesta etapa para evitar uma migração ampla e arriscada do contrato já usado pelas Edge Functions.

No produto atual esses registros funcionam como marcadores internos de ativação/compatibilidade. A interface não os apresenta como uma autorização manual e não exige que o usuário marque caixas repetidamente.

## Privacidade e fallback

A simplificação da interface não remove os limites técnicos existentes:

- conteúdo externo só é processado ao usar uma função que precisa dele;
- PDFs com texto nativo continuam aproveitando o texto existente;
- OCR é reservado às páginas sem texto aproveitável e às imagens;
- a semântica pode processar consultas e pequenos trechos quando ativa;
- falha de ativação, cota, provedor ou índice semântico preserva a busca textual/fuzzy;
- telemetria operacional continua sem persistir o conteúdo integral do usuário nos eventos de uso.

## Validação

O código funcional desta mudança foi validado no `Semogtw/Offline-Toolchains` a partir do SHA `3682b4b5dc3de17eb358aa59f7e1d4df82bdd0b7`.

O manifesto da execução registrou:

- `validation_status=passed`;
- `validation_failures=none`.

Depois dessa validação foram alterados apenas documentos Markdown desta decisão. O merge final deve ser validado novamente pelo Toolchains se o SHA exato da `main` for usado como candidato de deploy.
