# Fichário Desktop OCR Worker

**Status:** arquitetura aprovada; implementação pendente  
**Última revisão:** 6 de agosto de 2026  
**Sistema de referência:** CachyOS com RX 6600

Este documento define como o computador recebe trabalhos do Fichário, executa OCR local e devolve os resultados. O worker usa apenas conexões HTTPS de saída; nenhuma porta doméstica precisa ser publicada.

## 1. Finalidade

O worker processa páginas que não devem depender apenas do Gemini, principalmente:

- manuscritos;
- páginas com conteúdo misto;
- fórmulas ou layout difícil;
- resultados Gemini com muitos avisos;
- páginas enviadas manualmente para segunda leitura;
- lotes que o usuário deseja processar sem consumir cota do provedor.

O computador pode ficar desligado. Trabalhos aguardam no Supabase e são retomados quando o worker volta a ficar online.

## 2. Fluxo resumido

```text
PWA
└── cria trabalho desktop no Supabase

Supabase
└── waiting_desktop

Worker
├── consulta a fila
├── reivindica um item com lease
├── baixa página temporária por URL curta
├── confere SHA-256
├── executa modelo local
├── envia resultado e metadados
└── remove a imagem temporária local

PWA
└── mostra o resultado para revisão
```

O navegador não envia bytes diretamente ao computador. O worker puxa somente trabalhos autorizados e reivindicados.

## 3. Estados esperados

```text
waiting_desktop
processing_desktop
retryable_desktop
completed
needs_review
failed
canceled
```

Interpretação:

- `waiting_desktop`: nenhum computador compatível reivindicou o item;
- `processing_desktop`: um dispositivo possui lease ativo;
- `retryable_desktop`: falha temporária preservou o trabalho;
- `completed`: resultado válido foi persistido;
- `needs_review`: resultado existe, mas requer revisão humana;
- `failed`: falha permanente ou política bloqueante;
- `canceled`: cancelamento explícito do usuário.

Computador offline não altera um trabalho para `failed`.

## 4. Pareamento

### 4.1 Primeiro uso

Comando planejado:

```bash
fichario-worker pair
```

O worker:

1. gera um segredo criptograficamente aleatório;
2. cria uma solicitação de pareamento de curta duração;
3. mostra um código curto e a URL do Fichário;
4. aguarda aprovação.

No site:

1. abrir **Configurações > Computadores de OCR**;
2. escolher **Parear computador**;
3. confirmar o código;
4. dar um nome ao dispositivo;
5. revisar capacidades informadas;
6. aprovar.

A Edge Function entrega uma credencial longa apenas uma vez. O servidor guarda somente o hash dessa credencial.

### 4.2 Armazenamento local

A credencial deve ficar no Secret Service/keyring do usuário. Não gravar token em:

- arquivo `.env`;
- argumentos do processo;
- histórico do shell;
- logs;
- repositório;
- unidade compartilhada;
- backup sem criptografia.

### 4.3 Revogação

O site permite revogar cada dispositivo. Depois da revogação:

- novos claims são recusados;
- heartbeats são recusados;
- resultados ainda não enviados não são aceitos;
- o worker remove a credencial do keyring ao receber a resposta de revogação;
- trabalhos retornam à fila após expiração do lease.

## 5. Operação como serviço de usuário

O worker roda sem root por uma unidade systemd do usuário.

Comandos planejados:

```bash
systemctl --user enable --now fichario-ocr-worker.service
systemctl --user status fichario-ocr-worker.service
journalctl --user -u fichario-ocr-worker.service
```

A unidade deve:

- iniciar depois da rede;
- reiniciar após falha com intervalo conservador;
- usar diretórios pertencentes ao usuário;
- limitar permissões de arquivos;
- não executar shell arbitrário recebido da rede;
- não carregar modelos não aprovados pelo manifesto.

O worker não precisa de `loginctl enable-linger` para o MVP. Ele pode operar apenas enquanto a sessão do usuário estiver ativa. Habilitar execução sem sessão exige decisão separada.

## 6. Diretórios locais

Localização recomendada:

```text
~/.config/fichario-worker/
├── config.json
└── device.json sem credencial secreta

~/.cache/fichario-worker/
├── models/
└── downloads/

~/.local/state/fichario-worker/
├── worker.db
└── spool/
```

Permissões:

```text
Diretórios privados: 0700
Arquivos privados:   0600
```

A credencial permanece no keyring, não nesses arquivos.

## 7. Configuração

Contrato planejado de `config.json`:

```json
{
  "schemaVersion": 1,
  "appOrigin": "https://app.example.com",
  "backendPreference": ["vulkan", "cpu"],
  "maxConcurrency": 1,
  "pollIntervalSeconds": 30,
  "idlePollIntervalSeconds": 300,
  "modelChannel": "stable",
  "keepCompletedSpoolHours": 24
}
```

Regras:

- `appOrigin` precisa ser HTTPS e não pode conter credentials, query ou fragmento;
- `maxConcurrency` começa em `1`;
- polling ocioso aumenta para reduzir requisições;
- `rocm-experimental` não entra na preferência padrão;
- a configuração nunca contém token;
- valores desconhecidos são rejeitados fail-closed.

## 8. Descoberta de capacidades

No início, o worker registra:

- arquitetura de CPU;
- memória disponível aproximada;
- sistema operacional e versão;
- backends de inferência disponíveis;
- identificação da GPU quando acessível;
- versão do worker;
- formatos de modelo suportados.

Esses dados servem para compatibilidade e diagnóstico. Não registrar nomes de arquivos pessoais, texto OCR ou lista de aplicativos.

Backends:

```text
auto
vulkan
cpu
rocm-experimental
```

Política:

- CPU é o fallback obrigatório;
- Vulkan pode ser preferido depois de teste funcional;
- ROCm na RX 6600 é experimental e nunca requisito do MVP;
- um backend que falhar repetidamente fica desativado até nova validação;
- mudança de backend não troca silenciosamente o modelo aceito.

## 9. Modelos

### 9.1 Instalação

Comando planejado:

```bash
fichario-worker models install <model-id>@<version>
```

Passos:

1. baixar manifesto por HTTPS;
2. validar schema e versão mínima do worker;
3. verificar licença permitida;
4. baixar partes individualmente;
5. verificar tamanho e SHA-256 de cada parte;
6. remontar em arquivo temporário;
7. verificar SHA-256 total;
8. testar carregamento sem processar conteúdo privado;
9. promover atomicamente para o cache;
10. registrar instalação no banco local.

### 9.2 Atualização

Atualização é explícita. O worker pode informar que há versão recomendada, mas não substitui automaticamente um modelo em uso durante um trabalho.

Uma versão instalada permanece disponível para reproduzir resultados anteriores.

### 9.3 Remoção

Não remover modelo referenciado por um trabalho no spool ou por uma tentativa em execução. A remoção apaga somente artefatos públicos do modelo, nunca resultados do Fichário.

## 10. Consulta e claim

O worker consulta uma Edge Function dedicada, autenticando-se com a credencial do dispositivo.

A resposta de listagem contém apenas metadados mínimos:

```text
job_id
page_id
priority
content_type
required_capabilities
source_sha256
estimated_pixels
created_at
```

Não inclui texto anterior ou URL de origem antes do claim.

O claim retorna:

```text
job_id
claim_nonce
lease_expires_at
source_url temporária
source_sha256
mime_type
model_policy
```

Somente um dispositivo pode possuir claim ativo. O backend rejeita claims concorrentes e não depende do relógio local do computador para decidir validade.

## 11. Download da página

A origem é uma página preparada em Supabase Storage privado, acessível por URL curta e vinculada ao trabalho.

O worker:

1. baixa para arquivo temporário com permissão `0600`;
2. limita tamanho antes e durante o download;
3. rejeita MIME não permitido;
4. calcula SHA-256;
5. compara com `source_sha256`;
6. decodifica com limites de pixels;
7. não mantém a imagem depois da conclusão.

O worker não recebe refresh token nem access token persistente do Google Drive.

## 12. Heartbeat e lease

Durante inferência longa, o worker envia heartbeat com:

```text
job_id
claim_nonce
stage
progress aproximado
worker_version
model_id
model_version
```

`progress` é informativo e não pode estender indefinidamente um trabalho preso. O backend impõe duração máxima por tentativa e número finito de renovações.

Se o heartbeat falhar:

- o worker tenta restabelecer rede;
- não inicia outro trabalho;
- conclui localmente se for seguro;
- guarda o resultado no spool;
- tenta enviar antes da expiração;
- se o lease expirar, pede novo claim antes de enviar.

## 13. Resultado

Payload mínimo:

```json
{
  "jobId": "uuid",
  "claimNonce": "valor-opaco",
  "sourceSha256": "hash",
  "engine": "desktop",
  "backend": "vulkan",
  "modelId": "modelo-estavel",
  "modelVersion": "versao-imutavel",
  "text": "transcricao",
  "warnings": [],
  "contentType": "handwritten",
  "needsReview": true,
  "processingStartedAt": "timestamp",
  "processingFinishedAt": "timestamp"
}
```

O backend valida:

- dispositivo ativo;
- claim e nonce;
- lease válido ou política explícita de revalidação;
- propriedade do trabalho;
- hash da origem;
- modelo permitido;
- limites de texto e avisos;
- timestamps coerentes;
- ausência de campos extras.

Resultado inválido não altera o texto aceito da página.

## 14. Spool e retomada

O spool local existe para resultados já calculados cuja transmissão falhou. Ele guarda:

- payload de resultado;
- hash da origem;
- ID do trabalho;
- versão do modelo;
- estado de envio.

Não guarda a imagem original depois que o resultado foi calculado.

Na reinicialização:

1. enviar resultados pendentes ainda válidos;
2. confirmar aceitação idempotente;
3. remover entradas confirmadas depois da janela configurada;
4. somente então buscar novos trabalhos.

O banco local usa transações e permissões `0600`.

## 15. Logs

Logs permitidos:

- ID abreviado do trabalho;
- transição de estado;
- modelo e backend;
- duração;
- tamanhos em bytes;
- códigos de erro seguros;
- versão do worker.

Logs proibidos:

- texto transcrito;
- bytes ou miniaturas;
- URLs assinadas completas;
- credenciais;
- headers de autorização;
- nomes de documentos;
- caminhos do Google Drive.

## 16. Falhas

| Falha | Comportamento |
| --- | --- |
| Sem rede | mantém trabalho ou spool e repete com backoff |
| Computador desligado | fila permanece aguardando |
| Modelo ausente | instala modelo antes do claim ou informa incompatibilidade |
| Checksum inválido | apaga download, bloqueia versão e não processa |
| Falta de memória | reduz backend/tamanho quando permitido ou devolve retry seguro |
| GPU falha | tenta CPU somente se a política do trabalho permitir |
| Lease expira | solicita novo claim antes de concluir |
| Origem mudou | descarta resultado obsoleto e limpa temporário |
| Credencial revogada | para novos trabalhos e remove token local |
| Resultado rejeitado | preserva spool e registra motivo seguro |
| Processo cai | systemd reinicia; lease expira se necessário |

Nenhuma falha ativa API paga automaticamente.

## 17. Interface no site

A página **Configurações > Computadores de OCR** mostra:

- nome do dispositivo;
- estado online/offline/ocupado/revogado;
- último heartbeat;
- versão do worker;
- CPU/GPU e backends aprovados;
- modelo ativo;
- fila atribuível;
- ação de revogar;
- ação de renomear;
- histórico de erros sem conteúdo privado.

A fila mostra:

- aguardando computador;
- dispositivo atual;
- tempo de processamento;
- motivo de roteamento;
- resultado preliminar Gemini, quando existir;
- ações para usar Gemini, reenviar, cancelar ou revisar.

## 18. Validação na RX 6600

O benchmark precisa usar um conjunto representativo e anonimizado de páginas reais:

- texto cursivo em português;
- letra de forma;
- páginas com marca-texto;
- fórmulas e símbolos;
- fotografias inclinadas;
- iluminação irregular;
- conteúdo misto.

Registrar para cada modelo/backend:

- taxa de erro de caracteres e palavras quando mensurável;
- quantidade de correções manuais;
- tempo por página;
- pico de RAM e VRAM;
- falhas de carregamento;
- estabilidade em lote;
- qualidade em acentos e pontuação;
- licença e tamanho do modelo.

A RX 6600 só aparece como `PASS` quando um backend local conclui o conjunto sem corrupção, travamentos recorrentes ou dependência não suportada. CPU continua sendo o caminho funcional mínimo.

## 19. Instalação e atualização

O pacote do worker deve ser versionado e reproduzível. Antes de release:

- checksums do executável/pacote;
- assinatura ou proveniência do artifact;
- changelog;
- compatibilidade com schema do servidor;
- migration de config e spool testada;
- rollback para versão anterior;
- atualização nunca automática durante processamento.

O worker informa incompatibilidade quando o servidor exige versão maior. Ele não tenta interpretar contratos desconhecidos.

## 20. Critério de prontidão

```text
Pareamento de uso único: PASS
Token somente no keyring: PASS
Revogação: PASS
Nenhuma porta pública: PASS
Claim exclusivo: PASS
Lease e heartbeat: PASS
URL curta e hash da origem: PASS
Modelo com licença e checksum: PASS
Spool retomável: PASS
Conclusão idempotente: PASS
Logs sem conteúdo: PASS
CPU funcional: PASS
RX 6600: PASS ou limitação registrada
Worker offline sem perda: PASS
Resultado local preservado separadamente: PASS
Correção manual com precedência: PASS
```

Este runbook descreve o comportamento alvo. Até que os itens sejam implementados e testados, nenhuma interface ou comando aqui deve ser apresentado ao usuário como disponível.
