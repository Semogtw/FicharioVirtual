# Cloudflare Pages e OCR local no computador — Design

**Data:** 6 de agosto de 2026  
**Status:** decisão aprovada; implementação pendente  
**Escopo:** hospedagem pública, distribuição de modelos, roteamento híbrido de OCR e processamento em computador confiável

## 1. Decisão

O Fichário Virtual mantém:

- Google Drive como armazenamento permanente dos originais;
- Supabase como autoridade para autenticação, banco, RLS, filas, resultados, busca e sincronização;
- Gemini como OCR geral e resposta imediata;
- Cloudflare Pages como host preferencial da PWA;
- um worker local no computador para manuscritos, conteúdo misto e páginas difíceis.

Cloudflare recebe somente assets públicos. O computador não recebe push direto do navegador: ele consulta a fila no Supabase por HTTPS de saída, reivindica um trabalho e devolve o resultado. Não existe porta pública, encaminhamento no roteador ou Cloudflare Tunnel.

## 2. Objetivos

- hospedar a PWA estática no Cloudflare Pages;
- preservar `@sveltejs/adapter-static`, `build/`, `200.html` e `_headers`;
- impedir que documentos, OCR, tokens ou metadados privados passem pela Cloudflare;
- usar Gemini para páginas gerais e classificá-las na mesma chamada;
- encaminhar manuscritos e resultados incertos para o computador;
- permitir que o computador fique desligado sem perder trabalhos;
- preservar resultados Gemini e desktop separadamente;
- manter correção manual como autoridade final;
- distribuir modelos sem obrigar o tablet a baixá-los;
- manter custo obrigatório de R$ 0 e nenhum fallback pago automático.

## 3. Fora de escopo

- executar OCR pesado em Cloudflare Workers, Pages Functions ou Workers AI;
- armazenar originais ou páginas privadas em Pages ou R2;
- abrir uma API doméstica para a Internet;
- depender exclusivamente de ROCm na RX 6600;
- escolher modelo definitivo antes de benchmark com páginas reais;
- trocar automaticamente para serviço pago;
- reprocessar páginas antigas apenas porque um modelo novo foi publicado.

## 4. Topologia

```text
Cloudflare Pages — PWA
├── HTML, CSS, JS, ícones e manifesto
└── nenhum dado privado

Cloudflare Pages — modelos públicos
├── manifestos versionados
├── partes de até 20 MiB
├── SHA-256
└── licenças

Google Drive
└── originais permanentes

Supabase
├── Auth + allowlist
├── PostgreSQL + RLS
├── filas, leases e resultados
├── registro de dispositivos
├── Edge Functions
└── Storage privado temporário

Gemini
└── OCR geral, classificação e transcrição preliminar

Computador confiável
└── Fichário Desktop OCR Worker
    ├── consulta a fila
    ├── reivindica item
    ├── baixa página temporária
    ├── executa modelo local
    └── envia resultado
```

## 5. Cloudflare Pages da PWA

Configuração alvo:

```text
Repository:       Semogtw/FicharioVirtual
Branch:           main
Node.js:          >=22.12
Build command:    corepack enable && pnpm install --frozen-lockfile && pnpm build
Output directory: build
```

Somente estas variáveis públicas entram no build:

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Nunca entram no Pages:

```text
GEMINI_API_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
DRIVE_REFRESH_TOKEN
OCR_WORKER_DEVICE_TOKEN
```

O deployment preserva `_headers`, `200.html`, `sw.js`, `registerSW.js` e `manifest.webmanifest`. A origem `*.pages.dev` redireciona para a origem canônica ou fica limitada a preview.

A troca de domínio exige atualização coordenada de:

- `APP_ORIGIN` nas Edge Functions;
- Site URL e Redirect URLs do Supabase Auth;
- origens CORS;
- links de retorno dos fluxos externos;
- CSP e gates pós-deployment.

## 6. Distribuição dos modelos

### 6.1 Caminho padrão sem R2

Os modelos ficam em um segundo projeto Cloudflare Pages por Direct Upload. Como o Pages limita cada asset a 25 MiB, o empacotador usa partes de no máximo 20 MiB.

Estrutura:

```text
/models/<model-id>/<version>/manifest.json
/models/<model-id>/<version>/part-000.bin
/models/<model-id>/<version>/part-001.bin
/models/<model-id>/<version>/LICENSE.txt
/models/<model-id>/<version>/NOTICE.txt
```

O manifesto registra:

- schema;
- ID e versão imutáveis;
- formato;
- tamanho total;
- SHA-256 do arquivo reconstruído;
- versão mínima do worker;
- origem pública;
- licença;
- caminho, tamanho e SHA-256 de cada parte.

O worker valida cada parte, reconstitui em arquivo temporário, valida o hash total e promove atomicamente o modelo para o cache. Falha de checksum impede inferência.

Caminhos versionados recebem cache longo. O índice de versão recomendada recebe cache curto. O modelo nunca entra no precache da PWA.

### 6.2 R2 opcional

R2 pode ser adotado futuramente se a fragmentação deixar de ser adequada. Ele não faz parte do MVP porque usa cobrança por consumo e exige assinatura.

Se habilitado:

- guarda somente modelos públicos e licenças;
- usa classe Standard;
- possui domínio separado;
- nunca recebe documentos, páginas, OCR ou tokens;
- exige decisão explícita, revisão de consumo e procedimento de desligamento;
- não se torna fallback automático.

## 7. Roteamento de OCR

### 7.1 Preferência explícita

Cada caderno e página aceita:

```text
automatic
printed
handwritten
mixed
```

A preferência da página vence a do caderno, que vence a global.

- `printed`: Gemini por padrão;
- `handwritten`: computador por padrão, sem chamada Gemini obrigatória;
- `mixed`: computador por padrão;
- `automatic`: inspeção e classificação determinam a rota.

### 7.2 Texto nativo primeiro

Página com texto nativo suficiente não entra em OCR nem em classificação visual.

### 7.3 Classificação junto da chamada Gemini

Para página automática, a mesma resposta Gemini contém:

```text
contentType: printed | handwritten | mixed | unknown
handwritingConfidence: 0..1
localReprocessingRecommended: boolean
routingReasons: códigos fechados
text: transcrição preliminar
warnings: avisos por página
```

Não existe chamada separada apenas para classificar.

Entram na fila desktop:

- `handwritten`;
- `mixed`;
- `unknown`;
- recomendação de reprocessamento;
- truncamento;
- layout ambíguo;
- fórmula incerta;
- muitos trechos ilegíveis;
- ação manual do usuário.

Uma página `printed` confiável pode aceitar Gemini como resultado principal. O usuário sempre pode enviá-la ao computador depois.

## 8. Resultados e precedência

Resultados não se sobrescrevem. A tabela `ocr_results` registra:

- página e trabalho;
- mecanismo `gemini` ou `desktop`;
- modelo e versão;
- hash da origem;
- texto bruto;
- avisos;
- classificação;
- dispositivo local, quando aplicável;
- estado `preliminary`, `candidate`, `accepted` ou `rejected`;
- timestamps.

Precedência:

```text
corrected_text
> resultado desktop aceito
> resultado Gemini aceito
> resultado preliminar
> texto nativo quando aplicável
```

Correção manual nunca é substituída automaticamente.

## 9. Fila desktop

### 9.1 Modelo pull

Fluxo:

1. o site cria ou redireciona um trabalho para `desktop`;
2. o Supabase mantém `waiting_desktop`;
3. o worker autenticado lista trabalhos compatíveis;
4. o worker reivindica um item com lease;
5. o backend fornece acesso temporário à página preparada;
6. o worker valida tamanho, MIME e SHA-256;
7. o modelo local produz texto e avisos;
8. o worker envia resultado, modelo, versão e hash;
9. o backend valida lease, nonce e origem;
10. a PWA recebe a atualização e abre revisão.

Computador desligado não é falha. O trabalho permanece aguardando até retomada ou cancelamento.

### 9.2 Origem temporária

O worker não recebe token do Google Drive. A preparação de OCR gera página temporária em Supabase Storage privado. Uma Edge Function entrega URL assinada curta somente após claim.

A limpeza da página temporária aguarda todas as rotas obrigatórias. Cada trabalho registra `source_sha256`; resultado para origem anterior é rejeitado.

### 9.3 Lease e heartbeat

O claim registra:

- dispositivo;
- início e expiração do lease;
- número de tentativa;
- nonce de conclusão.

O worker envia heartbeat durante inferência. Se cair, o lease expira e o trabalho volta à fila.

## 10. Pareamento e autenticação

O computador nunca recebe `service_role`, chave Gemini ou refresh token do Drive.

Pareamento:

1. `fichario-worker pair` cria segredo aleatório e código curto;
2. o usuário confirma no Fichário autenticado;
3. a Edge Function aprova o dispositivo;
4. o worker recebe credencial longa exibida uma vez;
5. o banco guarda somente o hash;
6. a credencial fica no Secret Service/keyring;
7. o dispositivo pode ser revogado.

Tabelas mínimas:

```text
ocr_worker_devices
ocr_worker_pairing_requests
ocr_worker_events
```

Edge Functions mínimas:

```text
desktop-worker-pair
desktop-ocr-claim
desktop-ocr-source
desktop-ocr-heartbeat
desktop-ocr-complete
desktop-ocr-fail
```

A credencial permite apenas essas operações e não concede acesso SQL direto.

## 11. Worker no CachyOS

O worker roda como serviço systemd do usuário, sem root.

Responsabilidades:

- pareamento e keyring;
- descoberta de capacidades;
- download e validação de modelos;
- polling, claim, heartbeat e conclusão;
- spool local de resultados não transmitidos;
- logs sem conteúdo privado;
- atualização explícita.

Backends planejados:

```text
auto
vulkan
cpu
rocm-experimental
```

CPU é fallback obrigatório. Vulkan depende de teste. ROCm na RX 6600 permanece experimental até validação real. O primeiro release usa concorrência máxima `1`.

O spool pode guardar texto e metadados com permissão `0600`, mas não preserva a imagem depois da conclusão.

## 12. Interface

Configuração global:

```text
Automático
Priorizar computador
Somente Gemini
```

Configuração por caderno:

```text
Detectar automaticamente
Predominantemente impresso
Predominantemente manuscrito
Conteúdo misto
```

A UI mostra:

- dispositivos pareados;
- online, offline, ocupado ou incompatível;
- versão do worker, backend e modelo;
- último heartbeat;
- fila aguardando;
- ações para enviar ao computador, usar Gemini, cancelar ou comparar resultados.

Offline é estado normal, não erro.

## 13. Falhas e recuperação

- computador desligado: mantém `waiting_desktop`;
- queda durante inferência: lease expira e item volta à fila;
- modelo ausente: instala antes do claim ou informa incompatibilidade;
- checksum inválido: bloqueia a versão, não a página;
- origem alterada: rejeita resultado obsoleto;
- envio falha: preserva resultado no spool;
- credencial revogada: novos claims e conclusões são recusados;
- GPU falha: CPU é usada somente se a política permitir;
- resultado local pior: ambos permanecem disponíveis para escolha.

## 14. Segurança e privacidade

- Cloudflare contém somente assets públicos;
- originais ficam no Drive;
- páginas temporárias ficam no Supabase privado;
- URLs são curtas e vinculadas ao trabalho;
- credencial do worker é revogável e armazenada por hash;
- nenhuma chave administrativa fica no computador;
- nenhuma porta doméstica é exposta;
- logs não contêm texto, imagem, token ou URL assinada completa;
- resultado exige lease, nonce e hash da origem;
- modelos exigem licença e checksums;
- service worker da PWA não armazena modelos nem conteúdo privado.

## 15. Testes obrigatórios

### Cloudflare

- build reproduzível;
- fallback sem reescrever assets;
- `_headers` aplicado;
- HTTPS e origem canônica;
- PWA instalável;
- nenhum secret no bundle;
- rollback;
- partes abaixo de 25 MiB e hashes válidos.

### Roteamento

- texto nativo não chama OCR;
- caderno manuscrito pula Gemini;
- `printed` confiável conclui com Gemini;
- `handwritten`, `mixed` e `unknown` entram na fila;
- override manual vence classificação;
- resultado preliminar não apaga resultado aceito.

### Worker

- pareamento de uso único;
- revogação;
- claim exclusivo;
- lease expirado retomável;
- heartbeat;
- URL expirada recusada;
- hash divergente rejeitado;
- conclusão idempotente;
- spool após queda de rede;
- logs sem conteúdo;
- CPU sem GPU;
- RX 6600 somente após benchmark.

## 16. Critérios de aceitação

```text
Cloudflare Pages produção: PASS
Origem canônica e headers: PASS
Distribuição de modelo sem R2 obrigatório: PASS
Nenhum conteúdo privado na Cloudflare: PASS
Gemini geral e roteamento: PASS
Pareamento e revogação: PASS
Fila pull sem porta pública: PASS
Lease, heartbeat e retomada: PASS
Fonte e hash validados: PASS
Resultados múltiplos preservados: PASS
Correção manual com precedência: PASS
CPU local: PASS
RX 6600: PASS ou limitação documentada
Nenhuma cobrança automática: PASS
```

## 17. Ordem de implementação

1. migrar e validar frontend no Cloudflare Pages;
2. criar projeto de modelos e manifesto fragmentado;
3. separar resultados OCR;
4. adicionar tipos e roteamento;
5. criar dispositivos, pareamento e leases;
6. implementar Edge Functions do worker;
7. criar worker CPU-first e serviço systemd;
8. validar cache, checksums, spool e retomada;
9. integrar modelo de manuscrito candidato;
10. executar benchmark na RX 6600;
11. atualizar staging e gates de release.

A execução deve usar planos separados para hospedagem Cloudflare e worker desktop, ambos subordinados a esta especificação.
