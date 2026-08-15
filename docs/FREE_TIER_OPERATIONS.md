# Operação 100% gratuita

**Última verificação externa registrada:** 15 de agosto de 2026  
**Implementação OCR ativa:** Gemini 3.1 Flash-Lite principal + Gemini 3.5 Flash-Lite fallback; Azure ainda é somente plano documentado.

Este documento define as regras para manter o Fichário Virtual em R$ 0. Franquias externas podem mudar; a aplicação deve falhar de forma segura quando um serviço deixa de aceitar uso e nunca migrar automaticamente para cobrança.

## 1. Política obrigatória

1. Não vincular faturamento ao projeto da Gemini Developer API.
2. Manter Supabase no plano Free.
3. Manter Cloudflare Pages no plano Free.
4. Não ativar Cloudflare R2 por padrão.
5. Não iniciar teste gratuito de plano pago.
6. Não cadastrar cartão apenas para aumentar limites.
7. Não implementar fallback automático para API paga.
8. Preservar arquivo, páginas concluídas e estado quando uma quota real termina.
9. Não impor franquia diária artificial de OCR.
10. Tratar contadores locais apenas como telemetria.
11. Não enviar conteúdo privado para Cloudflare Pages ou host público de modelos.
12. Não obrigar tablet ou celular a baixar modelos destinados ao computador.
13. Permitir que trabalhos aguardem serviço externo ou computador sem perda.
14. Revisar franquias e billing antes de cada implantação relevante.
15. Qualquer recurso Azure usado automaticamente deve permanecer explicitamente no SKU F0; nunca fazer upgrade programático para S0/S1.

## 2. Autoridades de armazenamento e processamento

### Google Drive

- armazena os originais permanentes;
- usa somente `drive.file` no MVP;
- arquivos são criados ou escolhidos conscientemente;
- falta de espaço pausa upload e preserva fila;
- o Fichário não compra Google One nem migra automaticamente para storage pago.

### Supabase

- Auth, PostgreSQL, RLS, filas, resultados, busca e sincronização;
- Storage privado somente para derivados temporários, fallback e migração;
- Edge Functions orquestram autenticação, validação, rede e banco;
- OCR pesado não roda localmente dentro da Edge Function;
- indisponibilidade ou projeto pausado não apagam trabalho pendente.

### Cloudflare Pages

- hospeda somente frontend estático e artefatos públicos;
- não recebe documentos, OCR, tokens, sessões ou metadados privados;
- um projeto separado pode distribuir partes públicas de modelos;
- R2 permanece desativado enquanto o caminho Pages atender ao volume.

### Computador confiável

- rota futura de inferência local sem custo de API;
- conexão HTTPS somente de saída;
- nenhuma porta pública;
- CPU como fallback obrigatório;
- cache e spool temporários;
- sem service-role, chave Gemini ou refresh token do Drive.

O worker desktop continua aprovado em arquitetura, mas não faz parte da implementação de lotes Gemini concluída nesta etapa.

## 3. OCR externo ativo: Gemini Developer API

Referências operacionais permanecem registradas em `docs/DEPLOYMENT.md`, `docs/OCR_STAGING.md` e `docs/OCR_FAILURE_MATRIX.md`.

Configuração atual relevante:

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_FALLBACK
OCR_PROMPT_VERSION
OCR_MODEL_PRIMARY_RPM
OCR_MODEL_FALLBACK_RPM
OCR_PROVIDER_MAX_QUEUE_WAIT_MS
```

Controles técnicos opcionais:

```text
OCR_BATCH_MAX_PAGES=40
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

Os modelos padrão do runtime são Gemini 3.1 Flash-Lite como principal e Gemini 3.5 Flash-Lite como fallback. Os limites locais de RPM mantêm margem abaixo da capacidade nominal configurada; não representam franquia diária.

### Política de quota

A quota real do provider é a única autoridade para capacidade disponível.

O Fichário pode registrar:

- páginas;
- lotes;
- chamadas;
- tentativas;
- erros temporários;
- bloqueios reais de quota;
- média de páginas por chamada;
- provider/modelo/rota efetivamente usados.

Esses contadores não podem impedir uma chamada que ainda seria aceita pelo provider, salvo rate limiting técnico necessário para não exceder RPM/concorrência.

Estados relevantes:

- `retryable`: falha curta, timeout ou rate limit temporário;
- `blocked_quota`: quota real indisponível e identificada com segurança;
- `waiting_desktop`: trabalho aguardando computador, quando essa rota existir;
- `needs_review`: resultado incerto;
- `failed`: erro permanente de arquivo, segurança ou configuração.

Nenhum estado ativa billing.

## 4. Terceiro fallback planejado: Azure Vision Read F0

A especificação completa está em `docs/AZURE_OCR_FALLBACK_IMPLEMENTATION.md`.

A ordem aprovada para implementação é:

```text
Gemini 3.1 Flash-Lite
  -> Gemini 3.5 Flash-Lite
    -> Azure Vision Read
      -> fila persistente
```

Azure **ainda não está ativo**. Não adicionar secrets Azure à produção como se a feature já estivesse implementada.

### Limites externos verificados em 15/08/2026

Para Azure Vision no tier F0, a página oficial de preços informa:

- 5.000 transações gratuitas por mês;
- 20 transações por minuto.

Para Read v3.2, a documentação oficial informa ainda:

- processamento assíncrono por `POST` + polling;
- uma imagem por chamada, sem batch multi-imagem;
- imagens F0 abaixo de 4 MB;
- suporte a JPEG, PNG, BMP, PDF e TIFF;
- caixas de linhas/palavras e confidence por palavra;
- português impresso e manuscrito suportados.

A Microsoft também informa que Read v3.2 não recebe mais atualizações e recomenda Document Intelligence Read para documentos. Mesmo assim, o primeiro adapter planejado permanece Azure Vision Read porque o pipeline já trabalha com páginas renderizadas individuais e a franquia F0 do Azure Vision é substancialmente maior para o papel de terceiro fallback.

### Por que não Document Intelligence F0 inicialmente

A verificação de 15/08/2026 encontrou para Document Intelligence F0:

- 500 páginas gratuitas por mês;
- documento de até 4 MB;
- somente as duas primeiras páginas analisadas em uma solicitação;
- 1 analyze transaction por segundo.

Isso deve ser reavaliado antes da implementação. Se pricing/lifecycle mudar, o adapter precisa poder trocar de edição Azure sem mudar o orquestrador.

### Garantia de custo

- criar o recurso explicitamente como F0;
- não implementar upgrade automático;
- não trocar para SKU pago quando a franquia acabar;
- não usar contador local como substituto da resposta real do provider;
- quando Azure não aceitar mais trabalho, devolver o job para a fila persistente;
- revisar visualmente o SKU no portal antes de habilitar produção.

## 5. Particularidades Azure que afetam o free tier

### 5.1 Página maior que 4 MB

O teto Gemini atual não deve cair para 4 MB. Se Azure precisar receber uma página maior que o seu limite F0:

- criar derivação temporária provider-specific;
- preservar original e derivação Gemini;
- reduzir tamanho de modo conservador;
- preferir teto operacional abaixo de 4.000.000 bytes;
- se não for seguro reduzir, não chamar Azure e manter a página na fila aguardando Gemini.

### 5.2 WebP

Read v3.2 não deve ser assumido compatível com WebP. Se a derivação atual estiver em WebP, produzir JPEG/PNG temporário somente para Azure.

### 5.3 Polling

Read v3.2 é assíncrono. Polling precisa de intervalo, concurrency e timeout próprios; nunca abrir `Promise.all` irrestrito para dezenas de páginas. O rate limiter de submissão e o scheduler de polling devem impedir tempestade de requests.

### 5.4 Geometria

Azure fornece caixas de palavra nativas em pixels. O adapter deve normalizá-las para o contrato persistido `0..10000`, sem alterar schema de página. Isso permite aproveitar Azure como fallback sem criar uma segunda implementação de highlight.

## 6. OCR por lotes implementado

A implementação ativa inclui:

- assinatura de claim sem argumento diário local;
- remoção da assinatura antiga por migration;
- manifestos em `ocr_batches`;
- vínculo ordenado de páginas em `ocr_jobs`;
- uma chamada Gemini para várias páginas;
- resultado persistido por página;
- telemetria separada de páginas, lotes, chamadas e tentativas;
- RLS e escrita de manifestos apenas por RPC;
- transições terminais idempotentes;
- rate limit temporário separado de quota diária real;
- Gemini 3.1 Flash-Lite principal e Gemini 3.5 Flash-Lite fallback.

O segredo diário antigo não é lido pelo código atual e deve permanecer removido:

```bash
supabase secrets unset OCR_DAILY_HARD_LIMIT
```

Azure não muda essa política provider-only.

## 7. Economia de chamadas

- PDF com texto nativo não chama provider OCR.
- PDF misto envia somente páginas necessárias.
- Classificação e transcrição preliminar não exigem chamadas separadas.
- PDF visual usa páginas renderizadas em lotes adaptativos no Gemini.
- Lotes normais Gemini começam em até 40 páginas.
- Conteúdo denso pode começar em lotes menores.
- Resultado continua persistido por página.
- Páginas válidas não são repetidas quando outra página falha.
- Quando Azure for implementado, somente páginas ainda pendentes depois dos dois Gemini poderão chegar a ele.
- Azure processará páginas individualmente; não tentar emular batch concatenando imagens.

## 8. PDFs grandes

O arquivo lógico continua independente do limite de uma chamada de provider.

Regras implementadas:

- original permanece único e intacto no Drive;
- texto nativo é extraído antes do OCR;
- somente páginas visuais recebem derivados;
- bytes acumulados limitam cada chamada Gemini;
- páginas grandes recebem derivação conservadora quando necessário;
- omissão, duplicação ou JSON truncado provocam divisão do subconjunto afetado;
- uma página isolada que continua falhando permanece pendente, sem loop;
- cancelamento preserva páginas concluídas;
- retomada usa o mesmo executor adaptativo.

Quando Azure entrar, ele receberá a página derivada e nunca exigirá quebrar o original lógico em novos documentos.

## 9. Compressão segura

O Fichário não recomprime o original.

“Compressão” significa produzir imagem temporária quando necessário para um provider. A transformação:

- afeta somente a página derivada;
- reduz dimensão e qualidade de forma conservadora;
- preserva o arquivo original e seu hash;
- não é aplicada a páginas que já cabem;
- não autoriza degradação agressiva de manuscritos, fórmulas ou cores relevantes.

A implementação Azure poderá exigir uma segunda derivação abaixo de 4 MB; isso não altera esta regra.

## 10. Cloudflare Pages e R2

Cloudflare Pages continua sendo o host estático preferencial.

Regras:

- integração Git com `main`;
- output `build/`;
- somente variáveis públicas;
- sem Pages Functions para OCR;
- sem conteúdo autenticado em cache;
- sem upload de documentos;
- previews sem dados reais.

R2 permanece fora do MVP por envolver assinatura e cobrança por uso. Só pode ser ativado por decisão explícita com necessidade, estimativa, risco, alertas e procedimento de desligamento.

## 11. Painel de uso

A tela de Configurações deve mostrar telemetria real, não promessa de franquia restante.

Atual:

- páginas analisadas;
- lotes;
- chamadas Gemini;
- tentativas;
- tamanho médio de lote;
- bloqueios reais de quota;
- pendências, revisão e falhas.

Quando Azure for implementado:

- chamadas/páginas por provider;
- rota `fallback_azure_after_gemini`;
- 429/indisponibilidade Azure;
- quantidade de páginas que exigiram derivação Azure;
- revisão/confidence agregada sem conteúdo textual.

Não apresentar contador local como “páginas restantes”.

## 12. Variáveis e segredos

### Frontend

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

### Supabase — ativos

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_FALLBACK
OCR_PROMPT_VERSION
OCR_MODEL_PRIMARY_RPM
OCR_MODEL_FALLBACK_RPM
OCR_PROVIDER_MAX_QUEUE_WAIT_MS
OCR_BATCH_MAX_PAGES
OCR_BATCH_MAX_BYTES
OCR_REQUEST_TIMEOUT_MS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_DRIVE_REDIRECT_URI
```

### Supabase — planejados para Azure, somente quando runtime existir

```text
AZURE_VISION_ENDPOINT
AZURE_VISION_KEY
OCR_AZURE_MODEL
OCR_AZURE_RPM
OCR_AZURE_MAX_IMAGE_BYTES
OCR_AZURE_POLL_INTERVAL_MS
OCR_AZURE_POLL_TIMEOUT_MS
OCR_AZURE_FALLBACK_ENABLED
```

Nunca expor:

```text
SUPABASE_SERVICE_ROLE_KEY
DRIVE_REFRESH_TOKEN
GEMINI_API_KEY
AZURE_VISION_KEY
OCR_WORKER_DEVICE_TOKEN
```

## 13. Gates antes de release

No mesmo SHA:

```bash
pnpm format:check
pnpm check
pnpm lint
pnpm test:unit
pnpm check:edge
pnpm check:offline
pnpm test:db
pnpm build
pnpm test:e2e
```

Também são obrigatórios para OCR:

- migrations em Supabase limpo;
- smoke Gemini real;
- lote multipágina real;
- PDF textual com zero chamadas OCR;
- hash do original inalterado;
- cancelamento e retomada;
- celular e tablet;
- confirmação de billing desativado.

Antes de Azure ficar `active`, adicionar:

- protocolo Azure loopback POST + polling;
- smoke Azure real em staging;
- confirmação do recurso F0;
- página acima de 4 MB;
- WebP convertido para formato Azure suportado;
- manuscrito em português;
- geometria/highlight sobre bitmap real;
- 429/5xx/timeout Azure retornando à fila;
- nenhum secret/body OCR em logs/telemetria.

Procedimentos relacionados:

- `docs/AZURE_OCR_FALLBACK_IMPLEMENTATION.md`;
- `docs/DEPLOYMENT.md`;
- `docs/OCR_STAGING.md`;
- `docs/OCR_FAILURE_MATRIX.md`.

## 14. Plano de saída

Se um serviço deixar de atender gratuitamente:

- **Cloudflare Pages:** mover frontend e artefatos públicos para host estático gratuito compatível;
- **Supabase:** exportar PostgreSQL e temporários;
- **Gemini:** tentar somente providers gratuitos explicitamente configurados; caso contrário preservar fila;
- **Azure F0:** desabilitar o adapter e preservar fila; nunca promover para SKU pago automaticamente;
- **Google Drive:** exportar originais e metadados sem migração paga automática;
- **projeto de modelos:** usar host público autorizado ou instalação manual com checksum.

Nenhuma migração é automática e nenhum fallback ativa cobrança.