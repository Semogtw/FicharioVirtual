# Runtime local do Desktop OCR Worker

> Estado em 2026-08-10: a implementação local existe e está integrada ao plano de controle remoto, inclusive com pareamento web por código de uso único e limpeza local explícita depois de revogação web. O backend implementado hoje continua sendo Ollama. **Chandra OCR 2 foi selecionado como candidato recomendado**, com alvo `llama.cpp` + Vulkan na RX 6600, mas a integração e a validação em hardware real ainda estão pendentes. O plano técnico e os gates de precisão ficam em [`CHANDRA_OCR2_DESKTOP_INTEGRATION.md`](./CHANDRA_OCR2_DESKTOP_INTEGRATION.md).

## O que já existe

O runtime local implementa o ciclo outbound-only do worker:

1. carrega configuração não secreta, metadados do dispositivo e model lock;
2. obtém a credencial pelo Secret Service;
3. reenvia resultados pendentes do spool antes de buscar trabalho novo;
4. reivindica job com lease;
5. baixa fonte por URL assinada HTTPS;
6. valida MIME, tamanho e SHA-256;
7. renova lease durante inferência longa;
8. executa backend OCR local;
9. grava resultado no SQLite antes da transmissão terminal;
10. remove imagem privada temporária;
11. conclui job idempotentemente;
12. preserva falhas retryable e dead letters.

O backend funcional atual é `OllamaOcrEngine`. Ele aceita Ollama somente em loopback (`127.0.0.1` ou `::1`), exige digest SHA-256 fixado, recusa modelo remoto/cloud e confirma capability `vision` antes de transmitir bytes privados ao processo local.

O backend planejado para Chandra é **`llama_cpp`**, também somente local/loopback, usando `llama.cpp` com Vulkan. Ele ainda não existe em código e não deve ser confundido com o backend Ollama atual.

## Dependências de runtime

### Backend implementado hoje

O host precisa fornecer:

- Linux com `systemd --user`;
- Node.js 22 ou mais recente;
- Secret Service acessível por `/usr/bin/secret-tool`;
- Ollama local em loopback;
- modelo de visão já presente localmente no Ollama.

### Alvo Chandra OCR 2

Depois da implementação planejada, o perfil RX 6600 deve usar:

- `llama.cpp`/`llama-server` de versão fixada;
- Vulkan realmente usando a RX 6600;
- Chandra OCR 2 GGUF e projetor visual fixados por SHA-256;
- concorrência `1`;
- execução híbrida CPU/GPU permitida;
- nenhuma troca silenciosa de precisão após OOM.

A hierarquia de validação passa a ser:

```text
Referência de qualidade, se couber:
F16/BF16 + mmproj BF16
GPU + CPU híbrido

Provável perfil de produção:
Q8_0 + mmproj BF16

Fallback de memória:
Q6_K + mmproj BF16
ou maior precisão de projetor validada
```

**Q8 não é declarado melhor apenas porque o checkpoint Chandra em maior precisão lidera benchmarks.** Q8 e Q6 precisam provar no corpus do Fichário que preservam essa vantagem contra o melhor concorrente local viável.

ROCm não é requisito. CPU pode participar de offload/fallback explícito, mas não deve ser confundida com validação Vulkan.

O instalador atual não instala pacotes do sistema, não usa `sudo`/`doas` e não habilita o serviço automaticamente.

## Instalação de desenvolvimento

Use:

```bash
bash tools/desktop-worker/install-user-service-v2.sh
```

Ele instala módulos em `~/.local/lib/fichario-worker`, comandos em `~/.local/bin` e a unit `fichario-ocr-worker.service` no escopo do usuário. Executa somente `systemctl --user daemon-reload`; não inicia o worker.

Esse instalador **ainda não instala Chandra/llama.cpp**. O plano prevê instalador separado durante a validação.

## 1. Criar configuração

```bash
fichario-worker-config https://SEU-APP-ORIGIN
```

O comando cria `config.json` com permissões privadas e criação `no-clobber`.

## 2. Fixar um modelo local

### Fluxo atual — Ollama

Instale previamente um modelo de visão no Ollama e execute:

```bash
fichario-worker-model NOME_DO_MODELO_LOCAL
```

O comando consulta somente o Ollama loopback, exige modelo local, rejeita metadados remotos, confirma `vision` e grava `model.json` com digest SHA-256. O worker revalida esse digest durante o processamento.

### Fluxo alvo — Chandra OCR 2

**Não aponte o comando atual para um GGUF de Chandra como se a integração já existisse.** O model lock v1 aceita apenas `backend: ollama` e não representa pesos, projetor visual, precisão, prompt profile e versão do runtime separadamente.

A implementação planejada deve evoluir para algo equivalente a:

```bash
fichario-worker-model chandra-ocr-2 --backend llama_cpp --quality max
```

`--quality max` não deve significar automaticamente Q8. Deve resolver para **o perfil com melhor qualidade já validado neste hardware e no corpus do Fichário**.

Exemplos válidos depois do benchmark:

```text
F16 híbrido é estável e qualidade/tempo justificam -> F16 híbrido
Q8 é equivalente em qualidade e muito mais eficiente -> Q8 + mmproj BF16
Q8 perde para concorrente local -> concorrente vira padrão
Q8 OOM -> testar Q6
nenhum perfil validado -> readyToRun=false para Chandra
```

A seleção e os gates estão detalhados em [`CHANDRA_OCR2_DESKTOP_INTEGRATION.md`](./CHANDRA_OCR2_DESKTOP_INTEGRATION.md).

## 3. Parear o dispositivo

O fluxo preferido não manipula access token do navegador no computador.

1. abra **Configurações > Computadores**;
2. clique em **Gerar código**;
3. copie o comando exibido;
4. ajuste somente o nome do computador, se desejado;
5. execute no host e informe o código quando solicitado.

```bash
fichario-worker-pair-code \
  https://SEU-PROJETO.supabase.co/functions/v1/desktop-ocr-worker \
  "Desktop principal"
```

O código não vai em `argv`: o CLI o lê em prompt ou por uma linha em stdin para automação controlada. O código possui 64 bits de aleatoriedade, fica armazenado no banco apenas por SHA-256, expira em 10 minutos e é de uso único.

A credencial permanente é gerada no próprio worker:

- 32 bytes aleatórios localmente;
- somente o SHA-256 é enviado ao resgate;
- credencial bruta vai para Secret Service;
- `device.json` guarda apenas metadados não secretos;
- access token da sessão web não é persistido;
- credencial bruta não é devolvida pelo servidor.

O comando legado `fichario-worker-pair` permanece apenas para compatibilidade e usa access token efêmero.

## 4. Conferir estado local

```bash
fichario-worker-status
```

A saída informa somente estado agregado:

- readiness de config/device/model/keyring;
- origem pública e endpoint do worker;
- rótulo do dispositivo;
- modelo/digest fixados;
- contagem de `pending`, `accepted` e `rejected`;
- códigos seguros de dead letter.

O comando não imprime credencial, browser token, texto OCR, URL assinada, caminho privado ou payload do spool.

Quando model lock v2/Chandra existir, o status deve expor somente metadados públicos úteis:

```text
backend
model
weightsPrecision
mmprojPrecision
promptProfile
executionProfile
hardwareValidation
```

Sem paths locais ou segredos.

## 5. Habilitar o serviço

Somente depois de `fichario-worker-status` indicar `readyToRun: true` para o backend efetivamente configurado:

```bash
systemctl --user enable --now fichario-ocr-worker.service
systemctl --user status fichario-ocr-worker.service
journalctl --user -u fichario-ocr-worker.service
```

Enquanto Chandra não estiver integrado e validado, `readyToRun` do runtime atual não significa “Chandra pronto”.

## 6. Revogar, limpar ou desparear

A tela **Configurações > Computadores** permite revogar um dispositivo. Depois de revogar no site:

```bash
fichario-worker-forget --after-web-revoke
```

O comando é local-only:

1. remove credencial do Secret Service;
2. remove `device.json`;
3. não chama o servidor.

A tela pode remover da lista apenas dispositivo já revogado.

O fluxo legado combinado ainda existe:

```bash
fichario-worker-unpair
```

Ele solicita access token web efêmero, revoga remotamente e somente depois limpa estado local.

Para novas instalações, preferir pareamento por código + revogação web + `fichario-worker-forget --after-web-revoke`.

## Fronteiras de segurança

O runtime local não deve receber ou armazenar:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `GEMINI_API_KEY`;
- refresh token do Google Drive;
- access token persistente da sessão web;
- imagem privada no SQLite;
- segredo em argv, logs ou unit file.

O endpoint `desktop-ocr-worker` usa autorização própria por dispositivo e nunca recebe credenciais Gemini/Google.

A futura instância `llama-server` deve:

- bindar somente em loopback;
- usar artefatos fixados por hash;
- rejeitar endpoint remoto;
- não usar Hugging Face Inference, Ollama Cloud, API Datalab ou outro serviço como fallback silencioso;
- não alterar quantização/modelo automaticamente por falta de memória.

## Estado de validação

O código e os testes atuais cobrem download verificado, spool/idempotência/dead letters, renovação de lease, polling/backoff/shutdown, Secret Service, model lock v1, Ollama loopback, pareamento, revoke, limpeza local, systemd, gestão web de dispositivos e status agregado.

**Decisão já tomada:** Chandra OCR 2 é o candidato recomendado para OCR local de alta qualidade, priorizando livros digitalizados e escrita à mão contemporânea.

**Ainda não validado:** backend `llama_cpp`, model lock v2, Vulkan na RX 6600, Chandra F16/BF16 híbrido, Q8_0 + mmproj BF16, Q6_K, consumo de VRAM/RAM, perda real por quantização, comparação contra concorrentes locais e E2E de staging.

Antes de chamar o perfil Chandra de operacionalmente pronto, faltam:

- exercício real do Secret Service no CachyOS;
- revisão de licença/proveniência;
- backend `llama_cpp` e model lock v2;
- inferência real na RX 6600;
- tentativa F16/BF16 híbrida como controle, se a memória permitir;
- benchmark Q8_0 + mmproj BF16;
- Q6_K somente se necessário;
- comparação com o melhor concorrente local viável;
- benchmark com livros, scans degradados, handwriting contemporâneo, conteúdo misto, tabelas e matemática;
- validação de memória, latência, estabilidade e temperatura;
- E2E staging com documento privado controlado;
- recibo verde do probe de staging;
- UI detalhada da fila/estado desktop.

Até essas etapas terminarem, `readyToRun` significa apenas que o estado local necessário para o backend implementado existe — não é selo de benchmark, Chandra, Vulkan ou produção.