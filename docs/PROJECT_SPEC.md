# Fichário Virtual — Especificação canônica

**Atualizado:** 6 de agosto de 2026  
**Usuário inicial:** uma única conta autorizada  
**Dispositivo de referência:** Samsung Galaxy Tab S6 Lite  
**Restrição financeira:** custo operacional obrigatório de R$ 0  
**Armazenamento permanente:** Google Drive

## 1. Visão

O Fichário Virtual é uma PWA privada e pesquisável para organizar fotos, capturas de tela e PDFs de anotações. O sistema preserva o arquivo original no Google Drive, extrai ou reconhece texto, indexa o conteúdo e permite recuperar rapidamente a página correta por palavra, frase, caderno, data ou tag.

A experiência deve parecer um fichário digital editorial, não um chatbot. Preparação de imagens e inspeção de PDFs acontecem no dispositivo sempre que possível. O backend guarda somente o necessário para autenticação, busca, OCR, sincronização e operação segura.

## 2. Objetivos obrigatórios do MVP

- login de uma única conta autorizada por allowlist fail-closed;
- cadernos e subcadernos refletidos em pastas e subpastas do Drive;
- pasta raiz controlada pelo aplicativo chamada `Fichário Digital`;
- importação de JPG, PNG, WebP e PDF;
- captura direta pela câmera no Android;
- seleção explícita de arquivos externos por “Importar do Drive”;
- arquivos originais permanentes no Google Drive;
- extração de texto nativo de PDFs sem OCR desnecessário;
- OCR seletivo de texto manuscrito e impresso;
- processamento e sincronização retomáveis, idempotentes e concorrentes;
- busca exata, textual, tolerante a acentos e aproximada;
- visualização do arquivo original na página correta;
- correção manual, fila de revisão, tags e organização em lote;
- instalação como PWA sem cache de conteúdo privado;
- exportação portátil de metadados e textos sem tokens;
- preservação de OCR e metadados quando um arquivo físico desaparece;
- painel de uso e ausência de billing/fallback pago automático.

## 3. Autoridades de dados

### Google Drive

O Drive é a autoridade para:

- existência física de imagens e PDFs;
- bytes do arquivo original;
- identidade física por `drive_file_id`;
- identidade de pastas por `drive_folder_id`;
- nome, pasta pai, versão e horário de modificação remotos.

O aplicativo solicita apenas o escopo:

```text
https://www.googleapis.com/auth/drive.file
```

Arquivos externos são selecionados conscientemente e copiados para a área controlada pelo aplicativo. Leitura ampla do Drive e autoimportação global ficam fora do MVP.

### Supabase PostgreSQL

O banco é a autoridade para:

- conta autorizada e sessão do produto;
- cadernos como entidades de domínio e suas ligações a pastas;
- títulos, tags, datas e organização;
- texto nativo, OCR bruto, correções e índice de busca;
- filas, leases, backoff, cursores do feed e idempotência;
- conflitos, arquivos ausentes e reconexões;
- consentimento e franquia diária de OCR.

### Supabase Storage

O Storage privado é limitado a:

- artefatos temporários de processamento;
- páginas renderizadas que aguardam OCR;
- miniaturas quando a arquitetura exigir;
- fallback/migração explicitamente controlado.

Ele não é o armazenamento permanente canônico dos originais depois da migração confirmada para o Drive.

## 4. Arquitetura

```text
PWA SvelteKit estática
├── UI editorial responsiva
├── preparação de imagens em worker
├── inspeção local de PDF
├── filas locais retomáveis
├── cliente Drive com token de acesso efêmero
└── reconciliação ao abrir e sob demanda

Google Drive
├── Fichário Digital/
│   ├── Caderno/
│   │   ├── Subcaderno/
│   │   └── original.pdf
│   └── original.jpg
└── feed de mudanças

Supabase
├── Auth + allowlist
├── PostgreSQL + RLS
├── Edge Functions
├── OCR Gemini isolado no backend
└── Storage privado temporário
```

## 5. Sincronização Drive

- IDs do Drive são identidade; nomes e caminhos nunca são identidade.
- O primeiro vínculo cria ou reconecta `Fichário Digital`.
- Um caderno corresponde a uma pasta; um subcaderno corresponde a uma subpasta.
- A reconciliação usa `changes.getStartPageToken` e páginas de `changes.list`.
- O checkpoint só avança depois de a página ter sido aplicada com sucesso.
- Cada operação possui chave idempotente, tentativas, lease e backoff.
- Uploads persistentes usam sessões retomáveis.
- Mudanças ordenáveis usam a versão mais recente.
- Mudanças ambíguas criam conflito manual apenas para o item envolvido.
- Uma falha ou conflito não bloqueia o restante da fila.

## 6. Arquivos ausentes e exclusão

Quando o Drive informa remoção ou perda de acesso:

- `physical_state` vira `missing`;
- título, caderno, tags, OCR, correções, busca e histórico permanecem;
- o item continua encontrável e informa que o original está ausente;
- o mesmo `drive_file_id` reconecta automaticamente quando reaparece;
- o usuário pode selecionar outro original conscientemente ou excluir definitivamente o registro.

Excluir no Fichário não deve apagar silenciosamente um arquivo externo não controlado pelo app. Exclusão física e exclusão dos metadados são operações explícitas e idempotentes.

## 7. PDFs e OCR

- PDFs com texto preservam e indexam o texto nativo.
- Apenas páginas sem texto suficiente são renderizadas e enviadas ao OCR.
- Gemini é chamado somente por Edge Function, com chave fora do navegador.
- O resultado é validado por schema estrito.
- Falhas 429, 503, timeout ou payload inválido persistem estado e backoff.
- Falha de OCR não implica perda nem novo upload do original.
- Nenhum fallback pode ativar cobrança ou trocar silenciosamente de modelo.

## 8. Segurança e privacidade

- RLS forçada em todas as tabelas privadas.
- Uma allowlist ativa é necessária além de uma sessão válida.
- Refresh token fica somente em armazenamento backend protegido.
- O navegador recebe no máximo access token efêmero.
- Tokens, secrets e URLs temporárias não entram em localStorage, exportações, logs, artifacts ou service worker.
- O service worker guarda somente shell e ativos públicos.
- Respostas Google, Supabase e OCR são validadas fail-closed.
- CSP permite apenas origens estritamente necessárias.

## 9. Operação gratuita

- Nenhum serviço ativa billing automaticamente.
- Limites gratuitos são observados e exibidos.
- Quando a cota acaba, o trabalho fica pendente ou bloqueado de forma explícita.
- Não existe fallback automático para plano, modelo ou provedor pago.
- Backup, rollback e migração devem ser ensaiados antes da promoção.

## 10. Critério de conclusão

O plano original só está concluído quando houver evidência, no mesmo conjunto de versões, para:

```text
Frontend/PWA e gates locais: PASS
Supabase remoto e RLS: PASS
OCR real: PASS
OAuth drive.file: PASS
Pasta Fichário Digital: PASS
Pastas de cadernos/subcadernos: PASS
Upload retomável: PASS
Importar do Drive explicitamente: PASS
Feed de mudanças: PASS
Arquivo ausente preservando OCR/metadados: PASS
Reconexão pelo mesmo ID: PASS
Conflito isolado: PASS
Celular/tablet: PASS ou riscos registrados
Billing desativado: PASS
Backup e rollback: PASS
```

A especificação detalhada da integração fica em `docs/superpowers/specs/2026-08-06-google-drive-primary-storage-design.md`; o plano executável fica em `docs/superpowers/plans/2026-08-06-google-drive-primary-storage.md`; a configuração externa fica em `docs/GOOGLE_DRIVE_SETUP.md`.
