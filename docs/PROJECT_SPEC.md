# Fichário Virtual — Especificação canônica

**Atualizado:** 6 de agosto de 2026  
**Usuário inicial:** uma única conta autorizada  
**Dispositivo de referência:** Samsung Galaxy Tab S6 Lite  
**Computador de referência:** CachyOS com RX 6600  
**Restrição financeira:** custo operacional obrigatório de R$ 0  
**Armazenamento permanente:** Google Drive  
**Host público preferencial:** Cloudflare Pages

## 1. Visão

O Fichário Virtual é uma PWA privada e pesquisável para organizar fotos, capturas de tela e PDFs de anotações. O sistema preserva o arquivo original no Google Drive, extrai ou reconhece texto, indexa o conteúdo e permite recuperar rapidamente a página correta por palavra, frase, caderno, data ou tag.

A experiência deve parecer um fichário digital editorial, não um chatbot. Preparação de imagens e inspeção de PDFs acontecem no dispositivo sempre que possível. O Gemini oferece leitura geral e resposta imediata. Manuscritos, conteúdo misto e páginas difíceis podem aguardar um computador confiável, que executa um modelo local mais pesado sem abrir porta pública.

Cloudflare Pages hospeda somente a PWA e artefatos públicos. Supabase mantém autenticação, banco, RLS, filas, resultados, busca e sincronização. Nenhum documento privado passa pela Cloudflare.

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
- Gemini para conteúdo geral, classificação e transcrição preliminar;
- fila opcional para processamento local no computador;
- caderno ou página configurável como automático, impresso, manuscrito ou misto;
- worker desktop sem porta pública, com pareamento, revogação, lease e retomada;
- resultados Gemini e desktop preservados separadamente;
- processamento adaptativo de PDFs com resultados persistidos por página;
- ausência de franquia diária artificial criada pelo aplicativo;
- processamento e sincronização retomáveis, idempotentes e concorrentes;
- busca exata, textual, tolerante a acentos e aproximada;
- visualização do arquivo original na página correta;
- correção manual, fila de revisão, tags e organização em lote;
- instalação como PWA sem cache de conteúdo privado;
- frontend estático validado no Cloudflare Pages;
- modelos do worker distribuídos sem download automático no tablet;
- exportação portátil de metadados e textos sem tokens;
- preservação de OCR e metadados quando um arquivo físico desaparece;
- painel de uso e ausência de billing ou fallback pago automático.

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
- texto nativo, resultados OCR, correções e índice de busca;
- filas, rotas, lotes, leases, backoff, cursores do feed e idempotência;
- classificação de conteúdo e overrides do usuário;
- dispositivos locais pareados e revogados;
- conflitos, arquivos ausentes e reconexões;
- consentimento e métricas informativas de uso de OCR.

Contadores locais de páginas, lotes, chamadas ou tentativas servem para telemetria e diagnóstico. Eles não são autoridade para uma franquia diária nem podem bloquear uma chamada que ainda seja aceita pelo provedor.

### Supabase Storage

O Storage privado é limitado a:

- artefatos temporários de processamento;
- páginas renderizadas que aguardam Gemini ou worker local;
- miniaturas quando a arquitetura exigir;
- fallback ou migração explicitamente controlado.

Ele não é o armazenamento permanente canônico dos originais depois da migração confirmada para o Drive.

### Cloudflare Pages

Cloudflare Pages é autoridade apenas para deployments públicos e imutáveis de:

- HTML, CSS, JavaScript, ícones e manifesto da PWA;
- headers públicos versionados;
- manifestos e partes públicas de modelos;
- licenças e avisos de redistribuição.

Cloudflare não armazena:

- originais;
- páginas temporárias;
- OCR;
- metadados privados;
- sessões;
- chaves ou tokens.

### Computador confiável

O computador é um executor, não autoridade de dados. Ele pode manter temporariamente:

- cache validado de modelos públicos;
- página de um trabalho reivindicado;
- spool de resultado ainda não transmitido;
- credencial do dispositivo no keyring.

O servidor continua decidindo propriedade, estado, lease, aceitação e precedência do resultado.

## 4. Arquitetura

```text
Cloudflare Pages — PWA
├── SvelteKit estático
├── UI editorial responsiva
├── preparação de imagens em worker
├── inspeção local de PDF
├── filas locais retomáveis
├── cliente Drive com token de acesso efêmero
└── reconciliação ao abrir e sob demanda

Cloudflare Pages — modelos públicos
├── index e manifestos versionados
├── partes de até 20 MiB
├── SHA-256 por parte e arquivo final
└── licenças

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
├── filas Gemini e desktop
├── resultados OCR independentes
├── pareamento e revogação de dispositivos
└── Storage privado temporário

Gemini
└── OCR geral, classificação e resultado preliminar

Fichário Desktop OCR Worker
├── conexão HTTPS de saída
├── claim + lease + heartbeat
├── download temporário validado por hash
├── inferência CPU, Vulkan ou backend aprovado
└── conclusão idempotente
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

## 7. Hospedagem Cloudflare

### 7.1 PWA

O frontend usa:

```text
@svleltejs/adapter-static
```

O identificador correto em dependência e código continua sendo `@sveltejs/adapter-static`; a grafia acima não deve ser copiada para implementação.

Configuração canônica:

```text
Branch: main
Build: corepack enable && pnpm install --frozen-lockfile && pnpm build
Output: build
Fallback: 200.html
```

O deployment precisa preservar `static/_headers`, service worker, manifesto e origem HTTPS única. Somente variáveis `PUBLIC_*` entram no build.

### 7.2 Modelos públicos

O caminho padrão usa um projeto Pages separado por Direct Upload. Modelos são divididos em partes de até 20 MiB, com manifestos estritos, licença e SHA-256.

O tablet não baixa esses artefatos ao abrir a PWA. Somente o worker desktop baixa o modelo solicitado.

Cloudflare R2 não é obrigatório. Por envolver assinatura e cobrança por uso, só pode ser habilitado como espelho após decisão explícita e atualização da política de operação gratuita.

## 8. PDFs, OCR e roteamento

### 8.1 Texto nativo primeiro

- PDF com texto preserva e indexa o texto nativo sem Gemini ou worker local.
- PDF misto encaminha somente páginas sem texto suficiente.
- Nenhuma classificação visual é executada em página que já possui texto nativo suficiente.

### 8.2 Preferência explícita

Cadernos e páginas aceitam:

```text
automatic
printed
handwritten
mixed
```

A preferência mais específica vence:

```text
página > caderno > configuração global
```

Regras:

- `printed`: Gemini por padrão;
- `handwritten`: computador por padrão, sem chamada Gemini obrigatória;
- `mixed`: computador por padrão;
- `automatic`: inspeção e classificação determinam a rota.

### 8.3 Classificação Gemini

Quando uma página automática precisa do Gemini, a mesma resposta inclui:

- `contentType`;
- confiança de manuscrito;
- recomendação de reprocessamento local;
- códigos fechados de roteamento;
- texto preliminar;
- avisos por página.

Não existe chamada separada apenas para classificação.

Encaminham para computador:

- manuscrito;
- misto;
- desconhecido;
- truncamento;
- layout ambíguo;
- fórmulas incertas;
- muitos trechos ilegíveis;
- solicitação manual.

### 8.4 Resultados múltiplos

A unidade persistente continua sendo a página. Resultados diferentes ficam em `ocr_results` e não se sobrescrevem.

Cada resultado registra:

- mecanismo;
- modelo e versão;
- hash da origem;
- texto bruto;
- avisos;
- classificação;
- dispositivo, quando local;
- estado preliminar, candidato, aceito ou rejeitado.

Precedência:

```text
corrected_text
> resultado desktop aceito
> resultado Gemini aceito
> resultado preliminar
> texto nativo quando aplicável
```

Correção manual nunca é substituída automaticamente.

### 8.5 PDFs em lotes

- uma chamada Gemini pode processar várias páginas quando seguro;
- PDFs escaneados curtos podem ser enviados inteiros;
- PDFs longos ou densos usam lotes adaptativos;
- cada resposta associa explicitamente transcrição e avisos à página;
- omissão, duplicação ou truncamento impede sucesso integral;
- páginas enviadas ao computador continuam persistidas e reivindicadas individualmente ou em lote explícito com integridade por página.

## 9. Worker desktop

### 9.1 Modelo pull

O worker consulta a fila por HTTPS de saída. Não existe push direto, porta pública, NAT, webhook doméstico ou Cloudflare Tunnel.

Fluxo:

1. site cria trabalho `waiting_desktop`;
2. worker autenticado lista trabalhos compatíveis;
3. worker reivindica com lease;
4. backend entrega URL curta para página temporária;
5. worker valida tamanho, MIME e SHA-256;
6. worker executa modelo local;
7. worker envia resultado com nonce, hash, modelo e versão;
8. backend valida e persiste;
9. PWA mostra resultado para revisão.

### 9.2 Pareamento

- código de uso único;
- aprovação no Fichário já autenticado;
- credencial longa exibida uma vez;
- somente hash no servidor;
- token no Secret Service/keyring;
- dispositivo nomeado, auditável e revogável;
- nenhuma chave administrativa no PC.

### 9.3 Lease e retomada

- um dispositivo por trabalho;
- heartbeat durante inferência;
- expiração devolve trabalho à fila;
- conclusão idempotente;
- origem alterada rejeita resultado obsoleto;
- spool local preserva resultado ainda não enviado;
- computador desligado mantém fila aguardando.

### 9.4 Backends

```text
auto
vulkan
cpu
rocm-experimental
```

CPU é fallback obrigatório. RX 6600 e ROCm só recebem `PASS` após teste real. O primeiro release usa concorrência `1`.

## 10. Segurança e privacidade

- RLS forçada em todas as tabelas privadas.
- Uma allowlist ativa é necessária além de uma sessão válida.
- Refresh token do Drive fica somente em armazenamento backend protegido.
- O navegador recebe no máximo access token efêmero.
- Tokens, secrets e URLs temporárias não entram em localStorage, exportações, logs, artifacts ou service worker.
- Credencial do worker fica no keyring e possui escopo restrito.
- Worker não recebe service-role, chave Gemini ou refresh token do Drive.
- Cloudflare contém somente assets públicos.
- Páginas temporárias possuem URL curta, trabalho, dispositivo e hash associados.
- Conteúdo das páginas não entra nos logs do worker.
- O service worker guarda somente shell e ativos públicos da PWA.
- Respostas Google, Supabase, Gemini e worker são validadas fail-closed.
- CSP permite apenas origens estritamente necessárias.

## 11. Operação gratuita

- Nenhum serviço ativa billing automaticamente.
- Cloudflare Pages é o host público padrão.
- R2 permanece desativado por padrão.
- Modelos usam partes em Pages enquanto esse caminho atender ao volume.
- Limites gratuitos dos provedores são observados e exibidos.
- O Fichário não cria um teto diário próprio de páginas ou tentativas.
- Permanecem apenas controles técnicos de concorrência, tentativas finitas, backoff e prevenção de repetição infinita.
- Quando a cota Gemini acaba, o trabalho fica pendente, bloqueado ou pode ser encaminhado ao computador.
- Não existe fallback automático para plano, modelo ou provedor pago.
- Backup, rollback e migração devem ser ensaiados antes da promoção.

## 12. Interface obrigatória

### Configuração global

```text
Automático
Priorizar computador
Somente Gemini
```

### Tipo de caderno ou página

```text
Detectar automaticamente
Predominantemente impresso
Predominantemente manuscrito
Conteúdo misto
```

### Dispositivos locais

- parear;
- renomear;
- revogar;
- estado online, offline, ocupado ou incompatível;
- versão do worker;
- backend e modelo;
- último heartbeat;
- fila aguardando.

### Ações por página

- enviar ao computador;
- usar Gemini agora;
- cancelar processamento local;
- comparar resultados;
- aceitar resultado;
- corrigir manualmente.

## 13. Critério de conclusão

O plano original e a evolução aprovada só estão concluídos quando houver evidência, no mesmo conjunto de versões, para:

```text
Frontend/PWA e gates locais: PASS
Cloudflare Pages produção: PASS
Origem canônica e headers: PASS
Modelos públicos sem R2 obrigatório: PASS
Supabase remoto e RLS: PASS
OCR Gemini real: PASS
OCR sem franquia diária interna: PASS
OCR em lotes com integridade por página: PASS
Roteamento impresso/manuscrito/misto: PASS
Pareamento e revogação desktop: PASS
Fila pull sem porta pública: PASS
Lease, heartbeat e retomada: PASS
Resultado desktop idempotente: PASS
CPU local: PASS
RX 6600: PASS ou riscos registrados
OAuth drive.file: PASS
Pasta Fichário Digital: PASS
Pastas de cadernos e subcadernos: PASS
Upload retomável: PASS
Importar do Drive explicitamente: PASS
Feed de mudanças: PASS
Arquivo ausente preservando OCR e metadados: PASS
Reconexão pelo mesmo ID: PASS
Conflito isolado: PASS
Celular e tablet: PASS ou riscos registrados
Nenhum conteúdo privado na Cloudflare: PASS
Billing desativado: PASS
Backup e rollback: PASS
```

A especificação detalhada da integração Drive fica em `docs/superpowers/specs/2026-08-06-google-drive-primary-storage-design.md`. A estratégia de cotas e lotes fica em `docs/superpowers/specs/2026-08-06-provider-only-ocr-quota-and-adaptive-batching-design.md`. A arquitetura Cloudflare e desktop fica em `docs/superpowers/specs/2026-08-06-cloudflare-pages-and-desktop-ocr-design.md`.
