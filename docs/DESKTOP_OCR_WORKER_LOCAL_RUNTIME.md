# Runtime local do Desktop OCR Worker

> Estado em 2026-08-10: a implementação local existe e está integrada ao plano de controle remoto, mas ainda não é considerada validada em hardware real. Este documento descreve o fluxo atual de desenvolvimento/instalação sem promover CPU, Vulkan, ROCm ou um modelo específico como pronto antes de benchmark real.

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

## Dependências de runtime

O host precisa fornecer:

- Linux com sessão de usuário compatível com `systemd --user`;
- Node.js 22 ou mais recente;
- Secret Service acessível por `/usr/bin/secret-tool`;
- Ollama local acessível apenas via loopback para o backend atual;
- um modelo de visão já instalado localmente no Ollama.

O instalador não instala pacotes do sistema, não usa `sudo`/`doas` e não habilita o serviço automaticamente.

## Instalação de desenvolvimento

Use o instalador completo atual:

```bash
bash tools/desktop-worker/install-user-service-v2.sh
```

Ele instala os módulos em `~/.local/lib/fichario-worker`, os comandos em `~/.local/bin` e a unit `fichario-ocr-worker.service` no escopo do usuário. O comando executa somente `systemctl --user daemon-reload`; não inicia o worker.

## 1. Criar configuração

```bash
fichario-worker-config https://SEU-APP-ORIGIN
```

O comando cria `config.json` com permissões privadas e defaults conservadores. Ele usa criação `no-clobber`: um arquivo existente não é truncado nem substituído.

## 2. Fixar um modelo local

Instale previamente um modelo de visão no Ollama e então execute:

```bash
fichario-worker-model NOME_DO_MODELO_LOCAL
```

O comando consulta somente o Ollama loopback, exige que o modelo esteja presente localmente, rejeita metadados de modelo remoto, confirma `vision` e grava `model.json` com o digest SHA-256 encontrado. O worker revalida esse digest durante o processamento; trocar silenciosamente a tag não troca o modelo aceito pelo worker.

Nenhum modelo é declarado padrão ou recomendado neste documento até haver benchmark/licença/proveniência validados no hardware alvo.

## 3. Parear o dispositivo

O pareamento precisa temporariamente de um access token válido da sessão web do usuário. Esse token é bootstrap efêmero e **não pertence ao runtime do worker**.

```bash
fichario-worker-pair \
  https://SEU-PROJETO.supabase.co/functions/v1/desktop-ocr-worker \
  "Desktop principal"
```

O comando solicita o access token em prompt oculto quando executado em TTY. Também aceita exatamente uma linha por stdin para automação controlada. Não passe o token em argv, variável de ambiente, `.env`, arquivo de configuração ou unit do systemd.

Após o servidor criar o dispositivo:

- a credencial do worker é gravada diretamente no Secret Service;
- `device.json` guarda somente metadados não secretos;
- o access token do navegador não é persistido;
- se o keyring ou `device.json` falhar, o cliente tenta revogar imediatamente o dispositivo remoto recém-criado com um timeout independente e limpa qualquer segredo local parcial.

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

## 5. Habilitar o serviço

Somente depois de `fichario-worker-status` indicar `readyToRun: true`:

```bash
systemctl --user enable --now fichario-ocr-worker.service
```

Para acompanhar o serviço use as ferramentas normais do systemd. O próprio worker limita seus eventos a status/códigos sanitizados; IDs de job, texto OCR, caminhos e segredos não fazem parte do callback normal de status.

## 6. Desparear

```bash
fichario-worker-unpair
```

O comando solicita novamente um access token web efêmero. O fluxo é deliberadamente ordenado:

1. revoga o dispositivo remoto usando a identidade autenticada do usuário;
2. o backend reencaminha leases `processing` daquele dispositivo;
3. somente após o revoke remoto confirmado o cliente limpa a credencial no Secret Service;
4. por último remove `device.json`.

Se o revoke remoto falhar, o estado local permanece intacto. Se a limpeza local falhar depois de um revoke remoto, `device.json` é preservado para permitir repetir o revoke idempotente e concluir a limpeza.

## Fronteiras de segurança

O runtime local não deve receber ou armazenar:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `GEMINI_API_KEY`;
- refresh token do Google Drive;
- access token persistente da sessão web;
- imagem privada no SQLite;
- segredo em argv, logs ou unit file.

O endpoint de pareamento usa `service_role` somente no servidor para registrar a credencial derivada. A action de revoke roda pelo cliente autenticado do próprio usuário e pela RPC user-scoped `revoke_ocr_worker_device`.

## Estado de validação

O código e os testes automatizados cobrem download verificado, spool/idempotência/dead letters, renovação de lease, polling/backoff/shutdown, Secret Service adapter, model lock, Ollama loopback, pareamento/rollback, revoke, systemd packaging e status agregado.

Ainda faltam antes de chamar o worker de operacionalmente pronto:

- exercício real do Secret Service em uma sessão CachyOS com `/usr/bin/secret-tool`;
- instalação e inferência real com modelo de visão escolhido;
- benchmark CPU e, separadamente, qualquer caminho Vulkan/ROCm pretendido;
- validação de memória, latência, estabilidade e temperatura no hardware alvo;
- validação end-to-end contra staging com documento privado real/controlado;
- UI web para pareamento, dispositivos, fila e revoke sem precisar manipular access token manualmente;
- decisão documentada de modelo padrão baseada em licença, proveniência, qualidade e benchmark.

Até essas etapas serem concluídas, `readyToRun` significa apenas que o estado local necessário existe — não é um selo de benchmark ou produção.
