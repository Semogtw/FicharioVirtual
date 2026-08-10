# Runtime local do Desktop OCR Worker

> Estado em 2026-08-10: a implementação local existe e está integrada ao plano de controle remoto, inclusive com pareamento web por código de uso único e limpeza local explícita depois de revogação web. O backend implementado hoje continua sendo Ollama. **Chandra OCR 2 foi selecionado como candidato recomendado**, com alvo `llama.cpp` + Vulkan na RX 6600, mas essa integração e a validação em hardware real ainda estão pendentes. Este documento não promove CPU, Vulkan, ROCm ou Chandra a `PASS` antes do benchmark real. O plano técnico completo está em [`CHANDRA_OCR2_DESKTOP_INTEGRATION.md`](./CHANDRA_OCR2_DESKTOP_INTEGRATION.md).

## O que já existe

O runtime local implementa o ciclo outbound-only do worker:

1. carrega configuração não secreta, metadados do dispositivo e lock imutável do modelo;
2. obtém a credencial do dispositivo pelo Secret Service;
3. reenvia resultados já calculados no spool antes de reivindicar novo trabalho;
4. reivindica um job e recebe um lease limitado;
5. baixa a imagem por URL assinada HTTPS, sem reutilizar a credencial do worker;
6. valida MIME, limite de bytes e SHA-256 vinculado ao lease;
7. renova o lease durante inferências longas;
8. executa o backend OCR local;
9. grava o resultado calculado no SQLite antes da transmissão terminal;
10. remove a imagem privada local;
11. conclui o job de forma idempotente;
12. preserva falhas retryable no spool e resultados permanentemente rejeitados em dead letter local.

O backend funcional atualmente implementado é `OllamaOcrEngine`. Ele só aceita Ollama HTTP em loopback (`127.0.0.1` ou `::1`), exige um digest SHA-256 previamente fixado, recusa entradas de modelo remoto/cloud e confirma capability `vision` antes de transmitir os bytes privados ao processo local do Ollama.

O backend planejado para Chandra é **`llama_cpp`**, também somente local/loopback, usando `llama.cpp` com Vulkan. Ele ainda não existe em código e não deve ser confundido com o backend Ollama atual.

## Dependências de runtime

### Backend implementado hoje

O host precisa fornecer:

- Linux com sessão de usuário compatível com `systemd --user`;
- Node.js 22 ou mais recente;
- Secret Service acessível por `/usr/bin/secret-tool`;
- Ollama local acessível apenas via loopback;
- um modelo de visão já instalado localmente no Ollama.

### Alvo Chandra OCR 2

Depois da implementação descrita no plano de Chandra, o perfil RX 6600 deve substituir a dependência de Ollama por:

- `llama.cpp`/`llama-server` de versão fixada;
- backend Vulkan funcional e realmente usando a RX 6600;
- Chandra OCR 2 GGUF com pesos e projetor visual fixados por SHA-256;
- quantização Q8_0 como primeira tentativa;
- Q6_K somente se Q8_0 não couber ou não permanecer estável;
- concorrência `1`.

ROCm não é requisito. CPU pode continuar existindo como fallback explícito, mas não deve ser confundida com uma validação Vulkan bem-sucedida.

O instalador atual não instala pacotes do sistema, não usa `sudo`/`doas` e não habilita o serviço automaticamente.

## Instalação de desenvolvimento

Use o instalador completo atual:

```bash
bash tools/desktop-worker/install-user-service-v2.sh
```

Ele instala os módulos em `~/.local/lib/fichario-worker`, os comandos em `~/.local/bin` e a unit `fichario-ocr-worker.service` no escopo do usuário. O comando executa somente `systemctl --user daemon-reload`; não inicia o worker.

Esse instalador **ainda não instala Chandra/llama.cpp**. O plano prevê um instalador separado durante a fase de validação, antes de integrar o runtime aprovado ao fluxo principal.

## 1. Criar configuração

```bash
fichario-worker-config https://SEU-APP-ORIGIN
```

O comando cria `config.json` com permissões privadas e defaults conservadores. Ele usa criação `no-clobber`: um arquivo existente não é truncado nem substituído.

## 2. Fixar um modelo local

### Fluxo atual — Ollama

Instale previamente um modelo de visão no Ollama e então execute:

```bash
fichario-worker-model NOME_DO_MODELO_LOCAL
```

O comando consulta somente o Ollama loopback, exige que o modelo esteja presente localmente, rejeita metadados de modelo remoto, confirma `vision` e grava `model.json` com o digest SHA-256 encontrado. O worker revalida esse digest durante o processamento; trocar silenciosamente a tag não troca o modelo aceito pelo worker.

### Fluxo alvo — Chandra OCR 2

**Não tente apontar o comando atual para um GGUF de Chandra como se essa integração já existisse.** O model lock v1 aceita apenas `backend: ollama` e não representa separadamente pesos, projetor visual, quantização, prompt profile e versão do runtime.

A implementação planejada deve evoluir para algo equivalente a:

```bash
fichario-worker-model chandra-ocr-2 --backend llama_cpp --quality max
```

No perfil RX 6600, `--quality max` deve significar:

```text
Q8_0 se validado no hardware
↓ caso Q8_0 falhe por memória/estabilidade
Q6_K se validado
↓
nenhum perfil validado => readyToRun deve permanecer falso
```

A seleção e os gates estão detalhados em [`CHANDRA_OCR2_DESKTOP_INTEGRATION.md`](./CHANDRA_OCR2_DESKTOP_INTEGRATION.md).

## 3. Parear o dispositivo

O fluxo preferido não manipula access token do navegador no computador.

1. abra **Configurações > Computadores** no Fichário Virtual;
2. clique em **Gerar código**;
3. copie o comando exibido pelo site e ajuste somente o rótulo do computador;
4. execute o comando no host do worker;
5. quando solicitado, cole o código de uso único.

Formato do comando:

```bash
fichario-worker-pair-code \
  https://SEU-PROJETO.supabase.co/functions/v1/desktop-ocr-worker \
  "Desktop principal"
```

O código não vai em `argv`: o CLI o lê em prompt ou aceita exatamente uma linha por stdin para automação controlada. O código possui 64 bits de aleatoriedade criptográfica, fica armazenado no banco apenas por SHA-256, expira em 10 minutos, é consumido uma única vez e a criação de um novo código invalida o anterior ainda não usado.

A credencial permanente do worker também não é produzida pelo navegador nem retornada pelo servidor nesse fluxo. O próprio worker gera 32 bytes aleatórios localmente, envia somente o SHA-256 ao endpoint de resgate e, após a confirmação:

- grava a credencial bruta diretamente no Secret Service;
- grava em `device.json` somente metadados não secretos;
- nunca recebe nem persiste access token da sessão web;
- nunca envia a credencial permanente bruta ao servidor;
- se a gravação local falhar depois do resgate remoto, limpa qualquer segredo local parcial e retorna `desktop_ocr_pair_local_commit_failed_revoke_required`; nesse caso o dispositivo remoto aparece na tela web e deve ser revogado por lá.

O comando legado `fichario-worker-pair` permanece temporariamente disponível para compatibilidade e ainda usa um access token efêmero da sessão web. Não é mais o caminho recomendado para instalações novas.

## 4. Conferir estado local

```bash
fichario-worker-status
```

A saída informa somente estado agregado:

- readiness de config/device/model/keyring;
- origem pública do app e endpoint público do worker;
- rótulo do dispositivo;
- modelo/digest fixados;
- contagem de resultados `pending`, `accepted` e `rejected`;
- contagem por código seguro de dead letter.

O comando não imprime credencial do dispositivo, browser token, texto OCR, URL assinada, caminho da imagem ou payload do spool.

Quando o model lock v2/Chandra for implementado, o status também deve expor apenas metadados públicos úteis — backend, modelo, quantização, prompt profile e estado de validação do hardware — sem revelar paths locais ou segredos.

## 5. Habilitar o serviço

Somente depois de `fichario-worker-status` indicar `readyToRun: true`:

```bash
systemctl --user enable --now fichario-ocr-worker.service
```

Para acompanhar o serviço:

```bash
systemctl --user status fichario-ocr-worker.service
journalctl --user -u fichario-ocr-worker.service
```

O próprio worker limita seus eventos a status/códigos sanitizados; IDs completos de job, texto OCR, caminhos e segredos não fazem parte do callback normal de status.

Enquanto Chandra não estiver integrado e validado, `readyToRun` continua descrevendo apenas o runtime atualmente implementado; não deve ser interpretado como “Chandra pronto”.

## 6. Revogar, limpar ou desparear

A tela **Configurações > Computadores** permite revogar um dispositivo sem copiar token para o host. A revogação é user-scoped, invalida a credencial remota e reencaminha leases `processing` daquele dispositivo.

Depois de revogar no site, faça a limpeza local sem access token:

```bash
fichario-worker-forget --after-web-revoke
```

Esse comando é deliberadamente **local-only**. O flag confirma que a revogação remota já foi feita e então:

1. remove a credencial do Secret Service;
2. remove `device.json`;
3. não chama o servidor nem finge ter revogado o dispositivo remotamente.

A tela também permite **Remover da lista** um dispositivo já revogado. Essa remoção é server-side, owner-scoped e não substitui a limpeza local acima.

O comando legado ainda existe para o fluxo combinado remoto + limpeza local:

```bash
fichario-worker-unpair
```

Ele solicita um access token web efêmero e é deliberadamente ordenado:

1. revoga o dispositivo remoto usando a identidade autenticada do usuário;
2. o backend reencaminha leases `processing` daquele dispositivo;
3. somente após o revoke remoto confirmado o cliente limpa a credencial no Secret Service;
4. por último remove `device.json`.

Para novas instalações, prefira pareamento por código + revogação no site + `fichario-worker-forget --after-web-revoke`.

## Fronteiras de segurança

O runtime local não deve receber ou armazenar:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `GEMINI_API_KEY`;
- refresh token do Google Drive;
- access token persistente da sessão web;
- imagem privada no SQLite;
- segredo em argv, logs ou unit file.

No pareamento preferido, `desktop-ocr-pair` fica público apenas no gateway para permitir `action: redeem`. A Edge Function aceita essa ação sem JWT somente com o código curto; a RPC de resgate é `service_role`-only, o código é verificado por hash/expiração/consumo e o digest da credencial local é o único material persistido. Os caminhos legados de pair/revoke continuam validando explicitamente o bearer token do usuário dentro da função.

O endpoint `desktop-ocr-worker` usa esquema de autorização próprio por dispositivo e nunca recebe credenciais Gemini/Google.

A futura instância `llama-server` deve obedecer à mesma fronteira: bind somente em loopback, sem Hugging Face Inference, Ollama Cloud, API da Datalab ou outro endpoint remoto como fallback silencioso.

## Estado de validação

O código e os testes automatizados cobrem download verificado, spool/idempotência/dead letters, renovação de lease, polling/backoff/shutdown, Secret Service adapter, model lock v1, Ollama loopback, pareamento legado/rollback, pareamento por código com segredo gerado localmente, revoke, limpeza local pós-revogação web, systemd packaging, gestão web de dispositivos e status agregado.

**Decisão já tomada:** Chandra OCR 2 é o candidato recomendado para o OCR local de alta qualidade do Fichário, priorizando livros digitalizados e escrita à mão contemporânea.

**Ainda não validado:** Chandra Q8_0/Q6_K, backend `llama_cpp`, model lock v2, Vulkan na RX 6600, consumo de VRAM/RAM, qualidade do GGUF contra o checkpoint oficial e E2E de staging.

Ainda faltam antes de chamar o worker de operacionalmente pronto:

- exercício real do Secret Service em uma sessão CachyOS com `/usr/bin/secret-tool`;
- revisão de licença e proveniência do checkpoint/quantização Chandra escolhidos;
- implementação do backend `llama_cpp` e model lock v2;
- instalação e inferência real com Chandra na RX 6600;
- benchmark Q8_0 e Q6_K somente se necessário;
- validação de memória, latência, estabilidade e temperatura no hardware alvo;
- benchmark de qualidade com livros, scans degradados, handwriting contemporâneo, conteúdo misto, tabelas e matemática;
- validação end-to-end do pareamento por código + processamento contra staging com documento privado real/controlado;
- recibo verde do probe de staging automatizado para pareamento/replay/revoke/delete;
- UI de fila/estado detalhado do processamento desktop.

Até essas etapas serem concluídas, `readyToRun` significa apenas que o estado local necessário para o backend implementado existe — não é um selo de benchmark, Chandra, Vulkan ou produção.
