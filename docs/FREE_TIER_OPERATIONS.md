# Operação 100% gratuita

**Última verificação das franquias externas:** 6 de agosto de 2026  
**Política interna de OCR atualizada:** 6 de agosto de 2026

Este documento define as regras para manter o Fichário Virtual em R$ 0. Valores e franquias externas podem mudar; por isso, a aplicação deve falhar de forma segura quando uma cota termina, nunca migrar automaticamente para cobrança.

## 1. Política obrigatória

1. Não vincular faturamento ao projeto da Gemini Developer API.
2. Manter o Supabase no plano Free.
3. Manter Cloudflare Pages no plano Free.
4. Não ativar Cloudflare R2 por padrão.
5. Não iniciar testes gratuitos de planos pagos.
6. Não cadastrar cartão apenas para aumentar limites.
7. Não implementar fallback automático para API paga.
8. Pausar trabalhos ao receber erros de cota do provedor.
9. Preservar arquivo e estado para retomada posterior.
10. Não impor franquia diária artificial de OCR dentro do Fichário.
11. Revisar este documento antes de cada implantação relevante.
12. Exibir no aplicativo um painel informativo de uso e estado das cotas.
13. Não enviar conteúdo privado para Cloudflare Pages ou host de modelos.
14. Não obrigar o tablet a baixar modelos destinados ao computador.
15. Permitir que páginas elegíveis aguardem o computador sem custo de API.
16. Preservar PDFs originais intactos e dividir ou comprimir somente artefatos temporários de processamento.

## 2. Supabase Free

Referência oficial: https://supabase.com/pricing

Na última verificação registrada, o plano Free possuía franquias para banco, Storage, egress e invocações de Edge Functions. Os valores exatos precisam ser consultados novamente antes de cada release.

Referências:

- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/storage/uploads/file-limits

### Regras internas

- Edge Functions orquestram autenticação, rede, validação e banco.
- Renderização de PDF e transformação de imagem ficam no navegador quando possível.
- OCR pesado não roda dentro de Edge Function.
- Arquivos permanentes ficam no Google Drive.
- Storage Supabase guarda somente temporários, fallback e migração.
- O bucket possui MIME e tamanho explícitos.
- Avisos de capacidade aparecem antes de esgotamento.
- Ao atingir limite, novas importações temporárias são bloqueadas ou aguardam limpeza; não há upgrade automático.
- Páginas destinadas ao computador permanecem temporárias apenas pelo período necessário ao trabalho.
- Artefatos derivados de PDFs grandes são removidos somente após persistência segura do resultado ou cancelamento confirmado.

### Projeto pausado

O aplicativo deve reconhecer indisponibilidade do Supabase e mostrar mensagem segura. Nenhum dado local pendente deve ser apagado nesse estado.

O worker desktop também entra em espera e não trata projeto pausado como falha permanente de página.

## 3. Gemini Developer API

Referências oficiais:

- https://ai.google.dev/gemini-api/docs/pricing?hl=pt-br
- https://ai.google.dev/gemini-api/docs/billing?hl=pt-BR
- https://ai.google.dev/gemini-api/docs/rate-limits?hl=pt-br
- https://ai.google.dev/gemini-api/docs/document-processing?hl=pt-BR
- https://ai.google.dev/gemini-api/docs/files?hl=pt-br

Regras:

- criar projeto sem faturamento vinculado;
- gerar chave exclusiva;
- guardar a chave somente no Supabase;
- configurar modelo por `OCR_MODEL_PRIMARY`;
- escolher versão estável explicitamente disponível no nível gratuito na data do deployment;
- registrar modelo e data em `docs/DEPLOYMENT.md`;
- não usar alias que possa trocar silenciosamente para outra política;
- não ativar modelo pago como fallback.

### Controles permitidos

```text
OCR simultâneo Gemini:          1 ou 2, conforme estabilidade medida
Intervalo após erro 429:        Retry-After ou política conservadora
Tentativas automáticas extras:  finitas por lote
Limite diário interno:          nenhum
Reprocessamento desktop:        conforme fila e disponibilidade local
Fallback pago:                  proibido
```

A cota real do Gemini é a única autoridade de capacidade do provedor. O Fichário pode contar páginas, lotes, chamadas e tentativas para telemetria, mas esses contadores não podem bloquear uma chamada que ainda seria aceita.

### Economia de chamadas

- PDF com texto nativo não chama Gemini.
- PDF misto envia somente páginas necessárias.
- Caderno marcado como manuscrito pode ir direto ao computador.
- Classificação automática ocorre na mesma resposta da transcrição Gemini.
- PDF escaneado curto pode usar uma chamada quando seguro.
- PDF longo ou denso usa lotes adaptativos.
- Resultado continua persistido por página.
- Omissão, duplicação ou truncamento não contam como sucesso integral.

### PDFs grandes e limites por chamada

Na verificação de 6 de agosto de 2026, a documentação oficial informava:

```text
PDF por chamada ou upload: até 50 MB ou 1.000 páginas
Aplicação: inline e Files API
Custo visual aproximado: 258 tokens de entrada por página
```

Esses números são limites do artefato enviado ao Gemini, não do documento lógico armazenado na biblioteca.

Regras operacionais:

- o original pode permanecer como um único PDF no Google Drive mesmo quando exceder o limite de uma chamada;
- o sistema divide automaticamente as páginas que precisam de OCR;
- lotes iniciais permanecem conservadores, normalmente em torno de 20 a 40 páginas para documentos densos;
- a Files API não elimina o limite de 50 MB por PDF;
- um arquivo pode caber na entrada e ainda estourar o limite de saída da transcrição;
- compressão é aplicada somente a cópias temporárias;
- dividir é preferível a destruir legibilidade de manuscritos com compressão agressiva;
- truncamento, omissão, duplicação, timeout relacionado ao tamanho ou resposta inválida causam divisão do lote afetado, não reinício do documento;
- o mapeamento para o número original de cada página é obrigatório;
- a fragmentação não elimina RPM, TPM, RPD, limite de saída ou tempo de inferência.

O teto atual de 20 MB na importação de PDF é uma incompatibilidade transitória da implementação. Ele não deve ser tratado como limite arquitetural nem substituído por um teto fixo de 50 MB. O fluxo Drive-first deve separar o limite do documento original do limite dos artefatos de OCR.

A decisão detalhada está em:

- `docs/superpowers/specs/2026-08-06-oversized-pdf-splitting-and-compression-design.md`.

### Estados de cota

- `retryable`: limite curto ou falha temporária;
- `blocked_quota`: cota real indisponível;
- `waiting_desktop`: página aguardando computador, não cota;
- `needs_review`: resultado incerto;
- `failed`: erro permanente de arquivo, segurança ou configuração.

Quando a cota Gemini termina, o usuário pode:

- aguardar renovação;
- encaminhar página compatível ao computador;
- manter resultado preliminar;
- corrigir manualmente.

Nenhuma dessas ações ativa cobrança.

## 4. Cloudflare Pages Free

Referências oficiais:

- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/
- https://developers.cloudflare.com/pages/get-started/direct-upload/

Na verificação de 6 de agosto de 2026, a documentação do Pages informava, no plano Free:

- até 500 builds por mês;
- um build concorrente;
- timeout de build de 20 minutos;
- até 20.000 arquivos por site;
- até 25 MiB por asset;
- suporte a integração Git e Direct Upload.

Esses números são externos e podem mudar. O gate de release precisa revisar a documentação oficial novamente.

### Projeto da PWA

- integração Git com `main`;
- build estático em `build/`;
- somente variáveis públicas;
- sem Pages Functions para OCR;
- sem conteúdo autenticado no cache;
- sem upload de documentos;
- sem Image Optimization obrigatória;
- sem add-on pago;
- previews não usam dados reais de produção.

### Projeto dos modelos

O caminho padrão sem assinatura de cobrança usa outro projeto Pages por Direct Upload.

- cada parte de modelo possui até 20 MiB;
- versões são imutáveis;
- checksums são obrigatórios;
- licença e origem são obrigatórias;
- somente o computador baixa modelos;
- modelos não entram no Git principal nem no precache da PWA;
- atualização de modelo é explícita;
- se Pages deixar de atender ao volume, reavaliar antes de ativar outro produto.

O uso de partes é uma decisão operacional para permanecer abaixo do limite por asset e evitar R2 obrigatório.

## 5. Cloudflare R2

Referências oficiais:

- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/billing/understand/usage-based-billing/

Na verificação de 6 de agosto de 2026, R2 possuía franquia mensal incluída, mas continuava sendo produto de cobrança por uso e exigia ativação de assinatura. Excedentes de armazenamento ou operações podiam gerar cobrança.

Por isso:

- R2 fica desativado no MVP;
- não criar assinatura apenas para hospedar poucos modelos;
- não cadastrar método de pagamento em nome da política de custo zero;
- não armazenar conteúdo privado em R2;
- não usar R2 como fallback automático do Pages;
- não afirmar “gratuito sem risco” apenas porque existe franquia incluída.

R2 só pode ser ativado depois de uma decisão explícita que documente:

- necessidade comprovada;
- consumo esperado;
- risco de excedente;
- responsável pelo billing;
- alertas e revisão;
- procedimento de desligamento;
- alternativa caso a assinatura seja suspensa.

Mesmo se ativado, R2 guardará apenas modelos públicos e licenças.

## 6. Google Drive

O Drive é o armazenamento permanente do usuário e pode depender da franquia pessoal da conta Google. O Fichário não compra espaço, não ativa Google One e não cria billing automático.

Regras:

- escopo `drive.file`;
- somente arquivos criados ou escolhidos explicitamente;
- refresh token backend;
- sem leitura ampla da conta;
- painel de capacidade informa limitações observadas sem prometer franquia;
- falta de espaço pausa upload e preserva fila;
- não migrar automaticamente para outro storage pago;
- PDF original grande permanece intacto e único no Drive;
- artefatos fragmentados ou comprimidos não substituem o original.

## 7. Worker desktop

O worker usa recursos do computador do usuário e não cria custo de nuvem por inferência.

Regras:

- serviço de usuário, não root;
- conexão HTTPS de saída;
- nenhuma porta pública;
- CPU como fallback obrigatório;
- concorrência inicial `1`;
- modelos públicos com licença e checksum;
- cache local reaproveitado;
- computador desligado mantém fila aguardando;
- spool guarda resultado temporário, não imagem permanente;
- atualização explícita;
- sem mineração, telemetria externa ou execução de código remoto;
- sem download automático de modelo no tablet;
- lotes locais preservam integridade e resultado por página;
- falha local devolve somente as páginas afetadas à fila.

### RX 6600

A GPU não é considerada suporte garantido até benchmark real. O projeto não compra GPU em nuvem e não ativa provedor pago se Vulkan ou ROCm falhar.

Caminhos permitidos:

```text
CPU:               obrigatório
Vulkan:            candidato após teste
ROCm experimental: somente teste documentado
GPU em nuvem:      fora do MVP
```

## 8. PDF e bibliotecas locais

`@firecrawl/pdf-inspector-wasm` e PDF.js rodam no navegador e evitam OCR desnecessário. O projeto deve preservar licenças e versões fixadas.

O fluxo de PDFs grandes também exige uma biblioteca ou rotina de reescrita capaz de extrair subconjuntos de páginas e, quando necessário, gerar cópias comprimidas. A escolha final precisa ser reproduzível, licenciada e testada no tablet e no computador.

O worker pode usar runtime local de inferência e bibliotecas de imagem, desde que:

- licença seja compatível;
- versão seja fixada;
- pacote seja reproduzível;
- modelo e runtime não baixem código arbitrário;
- CPU continue funcional;
- o original nunca seja alterado pela preparação de OCR.

## 9. Painel de uso

A tela Configurações deve mostrar:

- páginas analisadas hoje;
- lotes e chamadas Gemini;
- tentativas e erros de cota;
- trabalhos aguardando computador;
- dispositivo online ou offline;
- páginas concluídas localmente;
- tamanho médio de lote;
- tamanho e páginas do PDF original;
- quantidade de artefatos temporários;
- bytes antes e depois de compressão temporária;
- bisseções de lote realizadas;
- páginas omitidas ou truncadas;
- armazenamento temporário estimado;
- modelo Gemini configurado;
- modelo local instalado;
- backend local ativo;
- versão do worker;
- estado da distribuição de modelos;
- aviso de que R2 está desativado;
- data da última revisão das franquias.

Os valores são informativos. Não apresentar contador local como “páginas restantes” salvo quando vier de cota real e confiável.

## 10. Variáveis e segredos

### Frontend público

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

### Supabase secrets

```text
APP_ORIGIN
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_QUALITY
OCR_PROMPT_VERSION
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

`OCR_MODEL_QUALITY` continua opcional e sem fallback automático.

Limites externos revisados podem ser mantidos em uma configuração central versionada, mas não devem ser apresentados como segredo nem duplicados em vários módulos.

### Worker

A credencial fica no keyring. O arquivo de configuração contém somente origem, preferência de backend e parâmetros não secretos.

Nunca expor:

```text
SUPABASE_SERVICE_ROLE_KEY
DRIVE_REFRESH_TOKEN
GEMINI_API_KEY
OCR_WORKER_DEVICE_TOKEN
```

### Incompatibilidades transitórias

A implementação atual ainda:

- exige `OCR_DAILY_HARD_LIMIT` e bloqueia localmente em `claim_ocr_job`;
- limita importação de PDF a 20 MB;
- processa Gemini página por página;
- não possui divisão, compressão temporária ou bisseção automática de lotes.

Isso contradiz a política aprovada e precisa ser corrigido antes de registrar a nova arquitetura como `PASS`.

## 11. Revisão antes de release

- confirmar Supabase Free;
- confirmar Cloudflare Pages Free;
- confirmar que R2 continua desativado;
- confirmar projeto Gemini sem billing;
- verificar modelo e rate limits ativos;
- verificar novamente limites oficiais de PDF, entrada e saída;
- confirmar ausência de franquia diária interna;
- confirmar que o documento lógico não herda o limite de uma chamada;
- confirmar nenhum secret no bundle;
- testar `429`, truncamento e falta de Storage;
- testar PDF acima de 50 MB e acima de 1.000 páginas com fixtures sintéticas;
- testar divisão, compressão temporária, bisseção e mapeamento de páginas;
- confirmar que o hash e os bytes do original permanecem inalterados;
- testar worker offline, lease expirado e spool;
- testar que tablet não baixa modelos;
- revisar limites oficiais de Pages;
- revisar tamanho e quantidade dos artefatos públicos;
- confirmar nenhum conteúdo privado em Cloudflare;
- atualizar a data deste documento.

## 12. Plano de saída

Se algum serviço deixar de atender gratuitamente:

- **Cloudflare Pages:** mover build estático e partes públicas para outro host gratuito compatível;
- **projeto de modelos:** usar releases públicos, host autorizado ou instalação manual, preservando checksums;
- **Supabase:** exportar PostgreSQL e temporários; avaliar outro Postgres ou instalação pessoal;
- **Gemini:** usar fila desktop ou outro adaptador explicitamente aprovado;
- **Google Drive:** exportar metadados e originais sem migração automática paga.

Nenhuma migração é automática. O aplicativo continua permitindo visualizar, pesquisar e exportar documentos já processados enquanto o serviço afetado estiver indisponível.

Arquitetura detalhada:

- `docs/superpowers/specs/2026-08-06-cloudflare-pages-and-desktop-ocr-design.md`;
- `docs/superpowers/specs/2026-08-06-provider-only-ocr-quota-and-adaptive-batching-design.md`;
- `docs/superpowers/specs/2026-08-06-oversized-pdf-splitting-and-compression-design.md`.
