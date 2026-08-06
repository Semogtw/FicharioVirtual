# Cloudflare Pages e OCR local no computador — Design

**Data:** 6 de agosto de 2026  
**Status:** decisão aprovada; implementação pendente  
**Escopo:** hospedagem pública, distribuição de artefatos de modelos, roteamento híbrido de OCR e processamento local em um computador confiável

## 1. Contexto

O Fichário Virtual precisa continuar privado, pesquisável, retomável e operável sem custo obrigatório. O Google Drive permanece como armazenamento permanente dos originais e o Supabase permanece como autoridade para autenticação, metadados, busca, filas e sincronização.

A arquitetura anterior enviava todo conteúdo visual necessário ao Gemini. A nova decisão mantém o Gemini para conteúdo geral e resultados imediatos, mas permite encaminhar manuscritos, conteúdo misto e páginas incertas para um worker executado no computador do usuário. Esse worker pode usar modelos locais mais pesados e aproveitar CPU ou GPU sem expor uma porta doméstica à Internet.

A PWA passa a ter Cloudflare Pages como host público preferencial. Artefatos públicos de modelos podem ser distribuídos por um segundo projeto Pages em arquivos fragmentados. Cloudflare R2 não é requisito do MVP porque é um produto de cobrança por uso e exige uma assinatura; ele só pode ser ativado posteriormente como espelho opcional mediante decisão explícita.

## 2. Objetivos

- hospedar a PWA estática no Cloudflare Pages;
- preservar `@sveltejs/adapter-static`, o diretório `build/`, o fallback `200.html` e os headers de segurança;
- manter imagens, PDFs, OCR, tokens e metadados privados fora da Cloudflare;
- usar o Gemini para texto impresso, páginas gerais e resposta imediata;
- encaminhar manuscritos, conteúdo misto e páginas incertas para uma fila local;
- permitir que um computador confiável processe a fila quando estiver ligado;
- não exigir abertura de porta, encaminhamento no roteador ou Cloudflare Tunnel;
- preservar resultados de diferentes mecanismos para comparação, revisão e rollback;
- manter correção manual como autoridade final;
- garantir retomada após desligamento do computador, falha do modelo ou perda temporária de rede;
- manter custo obrigatório de R$ 0 e impedir ativação silenciosa de serviços pagos.

## 3. Fora de escopo

- usar Cloudflare Workers, Pages Functions ou Workers AI para executar OCR pesado;
- armazenar originais ou páginas privadas no Pages, R2 ou cache público;
- manter o computador ligado permanentemente;
- aceitar resultados locais sem lease, hash de origem e validação de contrato;
- depender exclusivamente de ROCm na RX 6600;
- selecionar definitivamente um modelo de manuscrito antes de benchmark com páginas reais;
- sincronização ponto a ponto direta entre navegador e computador;
- abertura de uma API local acessível pela rede pública.

## 4. Topologia canônica

```text
Cloudflare Pages
├── PWA SvelteKit estática
├── shell público, CSS, JS e ícones
└── nenhuma página privada ou segredo

Cloudflare Pages — projeto separado de artefatos
├── manifestos versionados
├── partes de modelos com até 20 MiB
├── checksums SHA-256
└── nenhum documento do usuário

Google Drive
└── originais permanentes

Supabase
├── Auth + allowlist
├── PostgreSQL + RLS
├── filas e leases
├── registro de dispositivos locais
├── resultados de OCR e busca
├── Edge Functions de autenticação e acesso temporário
└── Storage privado temporário

Gemini
└── OCR geral, classificação e transcrição preliminar

Computador confiável
└── Fichário Desktop OCR Worker
    ├── consulta a fila por HTTPS de saída
    ├── baixa somente o item reivindicado
    ├── executa modelo local
    ├── envia texto e metadados do resultado
    └── não aceita conexões externas
```

Cloudflare nunca fica no caminho de dados privados. O site não envia uma imagem diretamente ao computador. O navegador cria ou altera um trabalho no Supabase; o worker consulta a fila e puxa o item autorizado quando estiver online.

## 5. Cloudflare Pages para a PWA

O projeto principal usa integração Git com `Semogtw/FicharioVirtual`.

Configuração de produção:

```text
Branch:          main
Node.js:         >=22.12
Build command:   corepack enable && pnpm install --frozen-lockfile && pnpm build
Output directory: build
```

Somente estas variáveis públicas podem participar do build:

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Secrets, chaves Gemini, service-role, refresh tokens do Drive e credenciais do worker não entram no Cloudflare Pages.

O arquivo `static/_headers` continua sendo a fonte versionada de CSP, HSTS, framing, MIME, permissions e políticas de cache. O deploy precisa preservar `200.html`, `sw.js`, `registerSW.js` e `manifest.webmanifest` com os tipos e caches atuais.

Depois da troca de domínio, devem ser atualizados no mesmo rollout:

- `APP_ORIGIN` das Edge Functions;
- Site URL e Redirect URLs do Supabase Auth;
- origens permitidas por CORS;
- links de retorno do fluxo Google Drive;
- CSP e testes pós-deployment;
- qualquer referência ao host antigo em documentação ou configuração externa.

O domínio `*.pages.dev` deve redirecionar para o domínio canônico ou permanecer apenas para preview controlado. O aplicativo deve considerar uma única origem de produção para evitar sessões e redirects divergentes.

## 6. Distribuição gratuita dos modelos

### 6.1 Caminho padrão sem assinatura de cobrança

Os modelos usados pelo computador ficam em um projeto Cloudflare Pages separado, implantado por Direct Upload. Como cada asset do Pages possui limite de 25 MiB, o empacotador divide os modelos em partes de no máximo 20 MiB.

Estrutura pública:

```text
/models/<model-id>/<version>/manifest.json
/models/<model-id>/<version>/part-000.bin
/models/<model-id>/<version>/part-001.bin
/models/<model-id>/<version>/LICENSE.txt
/models/<model-id>/<version>/NOTICE.txt
```

O `manifest.json` contém exatamente:

```json
{
  "schemaVersion": 1,
  "modelId": "string-estavel",
  "version": "versao-imutavel",
  "format": "onnx-ou-outro-formato-aprovado",
  "totalBytes": 0,
  "sha256": "hash-do-arquivo-reconstituido",
  "minimumWorkerVersion": "0.1.0",
  "sourceUrl": "origem-publica-do-modelo",
  "license": "identificador-da-licenca",
  "parts": [
    {
      "path": "part-000.bin",
      "bytes": 0,
      "sha256": "hash-da-parte"
    }
  ]
}
```

O worker baixa cada parte, valida tamanho e SHA-256, reconstitui em arquivo temporário, valida o hash total e só então promove o modelo para o cache local. Falha de checksum nunca inicia inferência.

Os caminhos de versão são imutáveis e recebem cache longo. O manifesto que aponta a versão recomendada recebe cache curto ou `no-cache`.

### 6.2 R2 opcional

R2 pode substituir o projeto de partes quando a fragmentação se tornar operacionalmente inconveniente. Essa mudança exige aprovação explícita porque R2 usa cobrança por consumo, requer assinatura e pode gerar excedente além da franquia incluída.

R2, quando habilitado, obedece a todas estas regras:

- somente artefatos públicos de modelos e licenças;
- classe Standard;
- domínio próprio separado;
- nenhum original, página preparada, OCR ou token;
- alertas de orçamento e revisão manual de consumo;
- ausência de fallback automático para R2;
- possibilidade de desativação sem quebrar modelos já instalados no computador.

R2 não integra o critério obrigatório de release enquanto o projeto mantiver a política de não ativar cobrança por uso.

## 7. Política de roteamento de OCR

A decisão de rota usa informação explícita antes de classificação automática.

### 7.1 Preferência por caderno e página

Cada caderno e página pode declarar:

```text
automatic
printed
gandwritten
mixed
```

O valor canônico em código deve usar `handwritten`; a grafia acima é somente uma enumeração visual e não deve ser copiada como identificador.

Regras:

- `printed`: usa Gemini, salvo reprocessamento manual no computador;
- `handwritten`: vai direto para o computador e não gasta uma chamada Gemini por padrão;
- `mixed`: vai para o computador, podendo receber transcrição preliminar Gemini somente por ação explícita;
- `automatic`: segue inspeção de PDF e classificação do provedor.

### 7.2 Texto nativo primeiro

Página de PDF com texto nativo suficiente não entra em OCR nem em classificação visual. O texto nativo é indexado diretamente.

### 7.3 Classificação automática junto da chamada Gemini

Quando uma página em modo `automatic` precisa do Gemini, a mesma resposta estruturada deve incluir:

```text
contentType: printed | handwritten | mixed | unknown
handwritingConfidence: número entre 0 e 1
localReprocessingRecommended: boolean
routingReasons: lista fechada de códigos
text: transcrição preliminar
warnings: avisos por página
```

Não existe uma chamada separada apenas para classificar.

Encaminham para o computador:

- `handwritten`;
- `mixed`;
- `unknown`;
- `localReprocessingRecommended = true`;
- resposta truncada, layout ambíguo, fórmula incerta ou grande quantidade de trechos ilegíveis;
- solicitação manual do usuário.

Uma página `printed` sem sinais de baixa qualidade pode aceitar o Gemini como resultado principal. O usuário sempre pode encaminhá-la ao computador depois.

A classificação é uma sugestão de roteamento, não uma verdade permanente. O usuário pode corrigir o tipo do caderno ou da página.

## 8. Resultados e precedência

Resultados de provedores diferentes não devem sobrescrever uns aos outros. Uma nova tabela `ocr_results` preserva, no mínimo:

- página e trabalho;
- mecanismo `gemini` ou `desktop`;
- modelo e versão;
- hash da origem;
- texto bruto;
- avisos estruturados;
- tipo de conteúdo detectado;
- métricas de confiança disponíveis;
- data de criação;
- estado `preliminary`, `candidate`, `accepted` ou `rejected`;
- dispositivo responsável, quando local.

A precedência efetiva é:

```text
corrected_text
> resultado local aceito
> resultado Gemini aceito
> resultado preliminar
> texto nativo quando aplicável
```

Páginas com texto nativo suficiente não precisam de resultado OCR. Correção manual nunca é substituída automaticamente por novo processamento.

## 9. Fila para o computador

### 9.1 Modelo pull

O worker inicia conexões HTTPS de saída. Ele não recebe push do navegador e não expõe porta pública.

Fluxo:

1. o site cria ou reencaminha um trabalho para `desktop`;
2. o Supabase mantém o trabalho em `waiting_desktop`;
3. o worker autenticado consulta trabalhos compatíveis;
4. o worker reivindica um trabalho com lease e ID de dispositivo;
5. o backend fornece acesso temporário à página preparada;
6. o worker valida o hash da origem;
7. o modelo local produz texto e avisos;
8. o worker envia o resultado com modelo, versão e hash;
9. o backend valida lease e origem antes de aceitar;
10. a PWA recebe a atualização por consulta ou realtime;
11. o usuário revisa ou aceita o resultado.

O computador desligado não é erro. A fila permanece aguardando indefinidamente ou até cancelamento explícito.

### 9.2 Origem do trabalho

O worker não recebe refresh token do Google Drive. A preparação de OCR continua produzindo uma imagem temporária privada por página no Supabase Storage. Uma Edge Function dedicada retorna URL assinada de curta duração somente para o trabalho reivindicado.

A página temporária permanece até que todas as rotas obrigatórias terminem ou sejam canceladas. A limpeza precisa considerar Gemini preliminar e processamento local para não apagar a origem antes do worker.

Cada trabalho guarda `source_sha256`. Resultado produzido para uma versão anterior é rejeitado e o trabalho é recriado para a nova origem.

### 9.3 Lease e heartbeat

Somente um dispositivo pode processar o mesmo trabalho por vez. O claim atribui:

- `claimed_by_device_id`;
- `lease_started_at`;
- `lease_expires_at`;
- `attempt_count`;
- nonce de conclusão vinculado ao claim.

O worker renova o lease enquanto o modelo estiver ativo. Se ele cair, o lease expira e o trabalho retorna à fila sem perder resultados já persistidos.

## 10. Pareamento e autenticação do worker

O computador nunca recebe `service_role`, chave Gemini ou refresh token do Drive.

Pareamento planejado:

1. `fichario-worker pair` cria um segredo aleatório e mostra um código curto;
2. o usuário abre Configurações no Fichário já autenticado;
3. o usuário informa ou confirma o código e nomeia o dispositivo;
4. uma Edge Function aprova o pareamento para o único usuário autorizado;
5. o worker recebe uma credencial longa, aleatória e exibida uma única vez;
6. somente o hash da credencial fica no banco;
7. a credencial local fica no Secret Service/keyring do sistema;
8. o dispositivo aparece na lista de dispositivos e pode ser revogado.

A credencial é limitada às Edge Functions do worker. Ela não concede acesso SQL direto, não substitui sessão do navegador e não pode administrar conta ou Drive.

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

Todas validam allowlist, dispositivo ativo, escopo da operação, propriedade da página e formato estrito do payload.

## 11. Worker no CachyOS

O worker roda como serviço de usuário do systemd, não como root.

Responsabilidades:

- pareamento e armazenamento seguro da credencial;
- descoberta de capacidades de CPU/GPU;
- download e validação de modelos;
- consulta da fila;
- claim, heartbeat, processamento e conclusão;
- spool local de resultados ainda não enviados;
- logs sem conteúdo das páginas;
- atualização explícita do próprio worker.

Backends planejados:

```text
auto
vulkan
cpu
rocm-experimental
```

A RX 6600 não pode ser tratada como compatível com ROCm até validação no sistema real. `auto` tenta apenas backends aprovados por benchmark e sempre mantém CPU como fallback funcional. O primeiro release usa concorrência máxima de um trabalho.

O worker pode armazenar temporariamente o texto de resultado e metadados em um spool com permissão `0600`. Imagens baixadas são apagadas após conclusão ou falha; não entram em backup, logs ou cache permanente.

## 12. Interface

Configurações globais de OCR:

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

Painel do computador:

- dispositivos pareados e revogação;
- online, offline, ocupado ou incompatível;
- versão do worker;
- backend e modelo ativos;
- último heartbeat;
- fila aguardando computador;
- trabalhos em processamento, falhos e concluídos;
- ação “Enviar ao computador”;
- ação “Usar Gemini agora” quando permitido;
- ação “Cancelar processamento local”.

O estado offline não deve ser apresentado como falha. A UI informa que o trabalho será retomado quando o computador estiver disponível.

## 13. Falhas e recuperação

- **computador desligado:** mantém `waiting_desktop`;
- **worker cai durante inferência:** lease expira e o trabalho volta à fila;
- **modelo ausente:** baixa e valida antes de reivindicar ou devolve retry seguro;
- **checksum inválido:** remove o artefato e bloqueia o modelo, não a página;
- **origem alterada:** rejeita resultado obsoleto e cria novo trabalho;
- **upload do resultado falha:** preserva resultado no spool e repete somente a conclusão;
- **credencial revogada:** encerra processamento após o item atual ou imediatamente conforme política de segurança;
- **Gemini indisponível:** páginas explicitamente manuscritas continuam elegíveis ao computador;
- **worker incompatível:** mantém item na fila e exibe motivo, sem fallback pago;
- **resultado local pior:** preserva ambos e permite aceitar o Gemini ou a correção manual.

## 14. Segurança e privacidade

- Cloudflare recebe apenas arquivos públicos do aplicativo e dos modelos;
- originais ficam no Google Drive;
- páginas temporárias ficam no Supabase privado;
- URLs de fonte têm curta duração e são vinculadas a trabalho e dispositivo;
- credencial do worker é revogável e armazenada por hash no servidor;
- nenhuma chave administrativa fica no computador;
- nenhum servidor doméstico é exposto;
- conteúdo de página não entra em logs;
- resultados são aceitos somente com lease, nonce e hash da origem;
- modelos exigem licença registrada e checksums;
- atualização de modelo não reprocessa páginas automaticamente;
- service worker da PWA não armazena modelos nem conteúdo privado.

## 15. Testes obrigatórios

### Cloudflare

- build estático reproduzível;
- fallback SPA sem reescrever assets;
- `_headers` aplicado;
- HTTPS e redirect para origem canônica;
- PWA instalável;
- nenhuma variável secreta no bundle;
- rollback para deployment anterior;
- partes de modelo abaixo de 25 MiB e hashes válidos.

### Roteamento

- texto nativo não chama OCR;
- caderno manuscrito pula Gemini;
- `printed` confiável conclui com Gemini;
- `handwritten`, `mixed` e `unknown` entram na fila local;
- override manual vence classificação;
- resultado preliminar não apaga resultado aceito.

### Worker

- pareamento de uso único;
- revogação imediata;
- dispositivo de outro usuário recusado;
- claim exclusivo;
- lease expirado retomável;
- heartbeat prolonga lease;
- URL expirada recusada;
- hash de origem divergente rejeitado;
- conclusão idempotente;
- queda de rede preserva spool;
- worker offline não perde trabalho;
- logs não contêm texto ou bytes privados;
- CPU funciona sem GPU;
- RX 6600 registrada somente após benchmark real.

## 16. Critérios de aceitação

```text
Cloudflare Pages production deploy: PASS
Origem canônica e redirects: PASS
Headers e PWA pós-deployment: PASS
Distribuição de modelo sem R2 obrigatório: PASS
Pareamento e revogação do computador: PASS
Fila pull sem porta pública: PASS
Lease, heartbeat e retomada: PASS
Fonte temporária e hash validados: PASS
Gemini geral + roteamento manuscrito: PASS
Resultados múltiplos preservados: PASS
Correção manual mantém precedência: PASS
CPU local: PASS
RX 6600: PASS ou limitação documentada
Nenhum conteúdo privado na Cloudflare: PASS
Nenhuma cobrança automática: PASS
```

## 17. Ordem de implementação

1. migrar e validar o frontend estático no Cloudflare Pages;
2. criar o projeto Pages de artefatos e o contrato de manifesto fragmentado;
3. separar resultados OCR do estado único atual;
4. adicionar tipos de conteúdo e política de roteamento;
5. criar tabelas de dispositivo, pareamento e leases locais;
6. implementar Edge Functions exclusivas do worker;
7. criar o worker CPU-first e serviço systemd de usuário;
8. validar download, checksum, spool e retomada;
9. integrar um modelo de manuscrito candidato;
10. executar benchmark com páginas reais e RX 6600;
11. atualizar staging, privacidade, operação gratuita e gates de release.

A implementação deve ser dividida em planos independentes para hospedagem Cloudflare e OCR desktop, embora ambos obedeçam a este design canônico.
