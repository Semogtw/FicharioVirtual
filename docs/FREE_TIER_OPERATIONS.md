# Operação 100% gratuita

**Última verificação externa registrada:** 11 de agosto de 2026  
**Implementação OCR atualizada:** 11 de agosto de 2026

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
10. Tratar contadores de consumo locais apenas como telemetria; o limitador compartilhado de RPM é um mecanismo de cadência, não uma quota de uso.
11. Não enviar conteúdo privado para Cloudflare Pages ou host público de modelos.
12. Não obrigar tablet ou celular a baixar modelos destinados ao computador.
13. Permitir que trabalhos aguardem serviço externo ou computador sem perda.
14. Revisar franquias e billing antes de cada implantação relevante.

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

## 3. Gemini Developer API

Referências oficiais operacionais permanecem registradas em `docs/DEPLOYMENT.md` e `docs/OCR_STAGING.md`.

Configuração de runtime:

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY=gemini-3.1-flash-lite
OCR_MODEL_FALLBACK=gemini-3.5-flash-lite
OCR_PROMPT_VERSION=1
```

Controles técnicos opcionais com os defaults atuais:

```text
OCR_MODEL_PRIMARY_RPM=12
OCR_MODEL_FALLBACK_RPM=12
OCR_PROVIDER_MAX_QUEUE_WAIT_MS=20000
OCR_BATCH_MAX_PAGES=40
OCR_BATCH_MAX_BYTES=12582912
OCR_REQUEST_TIMEOUT_MS=120000
```

Esses valores controlam cadência, páginas por chamada, memória e duração. Eles não representam franquia diária nem tentam prever RPD restante.

### Roteamento gratuito atual

- `gemini-3.1-flash-lite` recebe a primeira tentativa normal de OCR;
- a cadência é reservada globalmente no banco por modelo, de modo que Edge Function isolates concorrentes compartilham o mesmo orçamento de RPM;
- o default de 12 RPM preserva margem abaixo do limite observado para os dois Flash-Lite;
- se a próxima vaga segura estiver próxima, a execução aguarda por até 20 segundos;
- se a fila local exceder essa espera, o trabalho volta para retry sem chamar a Gemini e sem consumir o fallback;
- somente um `429` realmente retornado pelo provedor após essa proteção autoriza uma tentativa no `gemini-3.5-flash-lite`;
- o fallback tem seu próprio limitador global de 12 RPM;
- falhas comuns de rede, timeout ou `5xx` seguem o plano normal de retry, sem trocar silenciosamente de modelo;
- nenhuma rota ativa billing ou modelo pago.

### Política de quota

A quota real do Gemini é a única autoridade para a capacidade diária do provedor. O Fichário não cria um teto artificial de RPD.

O Fichário pode registrar:

- páginas;
- lotes;
- chamadas;
- tentativas;
- modelo efetivamente chamado;
- rota primária ou fallback;
- erros temporários;
- bloqueios reais de quota;
- média de páginas por chamada.

Esses contadores de telemetria não podem transformar uma estimativa local em bloqueio diário. A única antecipação permitida é o espaçamento técnico de RPM para evitar produzir `429` por concorrência própria.

Estados relevantes:

- `retryable`: falha curta, timeout, fila local cheia ou rate limit temporário;
- `blocked_quota`: quota real indisponível;
- `waiting_desktop`: trabalho aguardando computador, quando essa rota existir;
- `needs_review`: resultado incerto;
- `failed`: erro permanente de arquivo, segurança ou configuração.

Nenhum estado ativa billing.

## 4. OCR por lotes implementado

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
- tabela de estado e RPC de reserva global de RPM acessíveis somente por `service_role`;
- rate limit temporário separado de quota diária real;
- fallback gratuito explícito 3.1 Flash-Lite → 3.5 Flash-Lite somente após `429` do provedor.

O segredo diário antigo não é lido pelo código atual e deve ser removido do painel depois do rollout:

```bash
supabase secrets unset OCR_DAILY_HARD_LIMIT
```

A ausência de teto diário interno e o limitador de RPM só recebem `PASS` operacional depois de migrations, CI e staging no mesmo SHA.

## 5. Economia de chamadas

- PDF com texto nativo não chama Gemini.
- PDF misto envia somente páginas necessárias.
- Classificação e transcrição preliminar não exigem chamadas separadas.
- PDF visual usa páginas renderizadas em lotes adaptativos.
- Lotes normais começam em até 40 páginas.
- Conteúdo denso começa em até 20 páginas.
- Resultado continua persistido por página.
- Páginas válidas não são repetidas quando outra página falha.
- O limitador conta uma chamada por lote, não uma chamada por página.

O número do lote é ajustável e não é quota.

## 6. PDFs grandes

Na verificação externa registrada em 6 de agosto de 2026, a documentação da Gemini indicava limite de 50 MB ou 1.000 páginas por PDF enviado. Esse é um limite do artefato de uma chamada, não do documento lógico armazenado no Drive.

Regras implementadas:

- teto artificial de 20 MB removido da importação local;
- original permanece único e intacto no Drive;
- texto nativo é extraído antes do OCR;
- somente páginas visuais recebem derivados;
- bytes acumulados limitam cada chamada;
- página derivada acima de 12 MiB recebe uma segunda renderização conservadora;
- omissão, duplicação ou JSON truncado provocam divisão do subconjunto afetado;
- uma página isolada que continua falhando permanece pendente, sem loop;
- cancelamento preserva páginas concluídas;
- retomada usa o mesmo executor adaptativo.

Fragmentar não elimina RPM, TPM, RPD, limite de saída ou tempo de inferência.

### Google Picker

O download direto pelo navegador aceita até 50 MiB e verifica tamanho antes de transferir o arquivo.

Esse valor:

- não é limite do documento lógico;
- não é limite dos lotes de OCR;
- não impede upload local retomável ao Drive;
- ainda exige conclusão do fluxo por referência ou cópia para arquivos externos maiores que 50 MiB.

## 7. Compressão segura

O Fichário não recomprime o original.

“Compressão” nesta implementação significa produzir uma segunda imagem temporária da página quando a primeira ultrapassa o limite técnico seguro. A transformação:

- afeta somente a página derivada;
- reduz dimensão e qualidade de forma conservadora;
- preserva o arquivo original e seu hash;
- não é aplicada a páginas que já cabem;
- não autoriza degradação agressiva de manuscritos, fórmulas ou cores relevantes.

## 8. Cloudflare Pages e R2

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

## 9. Painel de uso

A tela de Configurações mostra:

- páginas analisadas;
- lotes;
- chamadas Gemini;
- tentativas;
- tamanho médio de lote;
- bloqueios reais de quota;
- pendências, revisão e falhas;
- trabalhos futuros do computador, quando implementados;
- data da última revisão operacional.

Não apresentar contador local como “páginas restantes”.

## 10. Variáveis e segredos

### Frontend

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
```

### Supabase

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_FALLBACK
OCR_MODEL_QUALITY
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

`OCR_MODEL_QUALITY` continua opcional. O fallback automático gratuito é configurado separadamente por `OCR_MODEL_FALLBACK`, tem modelo explicitamente versionado e só é acionado após `429` real do provedor.

Nunca expor:

```text
SUPABASE_SERVICE_ROLE_KEY
DRIVE_REFRESH_TOKEN
GEMINI_API_KEY
OCR_WORKER_DEVICE_TOKEN
```

## 11. Gates antes de release

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

Também são obrigatórios:

- migrations em Supabase limpo;
- smoke Gemini real;
- lote multipágina real;
- verificação do roteamento principal 3.1 Flash-Lite;
- verificação do limitador global de RPM;
- verificação controlada do fallback 3.5 Flash-Lite quando houver fixture/sonda de `429`;
- PDF textual com zero chamadas;
- fixtures acima de 50 MB e 1.000 páginas;
- hash do original inalterado;
- cancelamento e retomada;
- celular e tablet;
- confirmação de billing desativado.

Os procedimentos estão em:

- `docs/DEPLOYMENT.md`;
- `docs/OCR_STAGING.md`;
- `docs/checkpoints/2026-08-06-provider-only-ocr-large-pdf-implementation.md`.

## 12. Plano de saída

Se um serviço deixar de atender gratuitamente:

- **Cloudflare Pages:** mover frontend e artefatos públicos para host estático gratuito compatível;
- **Supabase:** exportar PostgreSQL e temporários;
- **Gemini:** pausar fila, usar o outro Flash-Lite somente nas condições explicitamente previstas, correção manual ou rota desktop explicitamente aprovada;
- **Google Drive:** exportar originais e metadados sem migração paga automática;
- **projeto de modelos:** usar host público autorizado ou instalação manual com checksum.

Nenhuma migração é automática e nenhum fallback ativa cobrança.
