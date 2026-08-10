# Fichário Desktop OCR Worker

**Status:** runtime e plano de controle implementados em código; validação operacional de hardware/modelo ainda pendente  
**Última revisão:** 10 de agosto de 2026  
**Sistema de referência para validação futura:** CachyOS com RX 6600

Este documento descreve o estado atual do Desktop OCR Worker. O worker usa somente conexões HTTPS de saída; nenhuma porta doméstica precisa ser publicada. Detalhes de instalação e comandos ficam em [`DESKTOP_OCR_WORKER_LOCAL_RUNTIME.md`](./DESKTOP_OCR_WORKER_LOCAL_RUNTIME.md).

## 1. O que já existe

A rota desktop deixou de ser apenas uma arquitetura. O repositório contém:

- dispositivos com credencial própria e autenticação por digest;
- pareamento web por código de uso único;
- credencial permanente gerada no próprio computador e guardada no Secret Service;
- claim exclusivo, source, renew e complete protegidos por lease;
- download privado por URL assinada curta com MIME, tamanho e SHA-256 verificados;
- conclusão idempotente;
- SQLite local para spool, retry e dead letter;
- reenvio do spool antes de buscar novo trabalho;
- polling/backoff e shutdown por sinal;
- lock imutável de modelo;
- backend `OllamaOcrEngine` limitado a loopback;
- empacotamento de desenvolvimento e `systemd --user` sem root;
- comandos de configuração, modelo, pareamento, status e limpeza local;
- tela **Configurações > Computadores** para parear, listar, atualizar, renomear, revogar e remover dispositivos já revogados;
- testes unitários, gates estáticos, Deno e pgTAP para as fronteiras implementadas.

`readyToRun` significa somente que config, dispositivo, credencial e modelo fixado existem localmente. Não é um selo de benchmark nem de produção.

## 2. Fluxo atual

```text
PWA
└── cria/roteia trabalho elegível para desktop

Supabase
└── mantém trabalho até um dispositivo autorizado reivindicá-lo

Worker
├── autentica com credencial própria
├── reenvia spool pendente
├── reivindica um trabalho com lease
├── recebe origem privada temporária
├── verifica MIME, tamanho e SHA-256
├── renova o lease durante inferência longa
├── executa OCR local
├── grava o resultado no spool antes da conclusão remota
├── remove a imagem temporária local
└── conclui o trabalho de forma idempotente

PWA
└── recebe o resultado persistido para uso/revisão
```

O navegador não envia bytes diretamente ao computador. O worker puxa somente trabalhos do usuário associado à sua credencial.

## 3. Pareamento preferido

O fluxo novo não transfere o access token da sessão web para o computador.

No site:

1. abrir **Configurações > Computadores**;
2. escolher **Gerar código**;
3. copiar o comando exibido;
4. ajustar somente o nome do computador, se desejado.

No host do worker:

```bash
fichario-worker-pair-code \
  https://SEU-PROJETO.supabase.co/functions/v1/desktop-ocr-worker \
  "Desktop principal"
```

O comando solicita o código depois de iniciar, evitando colocá-lo em `argv` ou no histórico normal do shell.

### Garantias do código

- 64 bits de aleatoriedade criptográfica;
- armazenamento no banco somente por SHA-256;
- validade de 10 minutos;
- uso único;
- criar um novo código invalida o anterior ainda não consumido;
- replay é rejeitado.

### Garantias da credencial permanente

O próprio worker:

1. gera 32 bytes aleatórios localmente;
2. calcula o SHA-256;
3. envia somente o digest junto ao resgate do código;
4. recebe a identidade do dispositivo, sem receber a credencial bruta de volta;
5. grava a credencial bruta no Secret Service;
6. grava em `device.json` apenas metadados não secretos.

O servidor nunca precisa conhecer a credencial bruta nesse fluxo.

O comando legado `fichario-worker-pair` continua temporariamente disponível para compatibilidade e usa um access token efêmero do usuário. Não é o caminho recomendado para novas instalações.

## 4. Revogação, limpeza local e remoção

A tela web permite revogar um dispositivo. A revogação:

- torna a credencial remota inutilizável;
- impede novos claims/renew/completes autenticados por aquele dispositivo;
- reencaminha trabalhos `processing` associados ao dispositivo conforme o contrato do backend;
- preserva o registro revogado no histórico da tela até remoção explícita.

Depois de revogar pelo site, o host pode apagar Secret Service + `device.json` sem access token web:

```bash
fichario-worker-forget --after-web-revoke
```

O nome do flag é deliberadamente explícito: esse comando **não** revoga o servidor; ele confirma que a revogação já ocorreu no site e limpa apenas o estado local.

Na tela, um dispositivo revogado também pode ser **Removido da lista**. A RPC de remoção é owner-scoped e rejeita dispositivos ativos. Antes de apagar o dispositivo ela remove os registros de pairing consumidos ligados a ele, preservando as constraints do banco.

O comando legado `fichario-worker-unpair` permanece disponível para o fluxo combinado revoke remoto + limpeza local e ainda solicita access token efêmero.

## 5. Armazenamento local

Estrutura usada pelo runtime:

```text
~/.config/fichario-worker/
├── config.json
├── device.json        # sem credencial secreta
└── model.json

~/.local/state/fichario-worker/
└── worker.db          # spool/dead letter; sem imagem original
```

Diretórios privados usam permissões restritivas e a credencial permanece no Secret Service via `secret-tool`.

Não colocar credencial em:

- `.env`;
- `argv`;
- histórico do shell;
- logs;
- unit file;
- repositório;
- backup sem criptografia.

## 6. Instalação de desenvolvimento

O instalador atual é:

```bash
bash tools/desktop-worker/install-user-service-v2.sh
```

Ele instala módulos sob `~/.local/lib/fichario-worker`, comandos em `~/.local/bin`, instala `fichario-ocr-worker.service` no escopo do usuário e executa apenas `systemctl --user daemon-reload`.

Depois de configurar, parear e fixar um modelo:

```bash
fichario-worker-status
systemctl --user enable --now fichario-ocr-worker.service
systemctl --user status fichario-ocr-worker.service
journalctl --user -u fichario-ocr-worker.service
```

O instalador não usa `sudo`/`doas` e não inicia o serviço automaticamente.

## 7. Backend local atual

O backend implementado é `OllamaOcrEngine`.

Ele:

- aceita Ollama somente em `127.0.0.1` ou `::1`;
- exige um modelo de visão já presente localmente;
- confirma capability `vision` antes de enviar bytes privados ao Ollama;
- fixa o digest SHA-256 do modelo;
- recusa troca silenciosa da tag para outro conteúdo;
- não usa endpoint cloud/remoto do Ollama.

Nenhum modelo é declarado padrão ou recomendado antes de benchmark, licença e proveniência serem aprovados no hardware alvo.

## 8. Lease, origem e conclusão

A credencial do dispositivo acessa a Edge Function `desktop-ocr-worker`, que possui autenticação própria e não recebe credenciais Gemini/Google.

O backend implementa:

- `claim`: escolhe um trabalho compatível e cria lease exclusivo;
- `source`: resolve a página do lease e entrega URL assinada curta;
- `renew`: renova o lease dentro dos limites do servidor;
- `complete`: valida binding, resultado e ownership antes de persistir.

A decisão de validade do lease é do servidor, não do relógio do PC.

Antes da inferência, o cliente valida:

- HTTPS da origem;
- MIME permitido;
- limite de bytes;
- SHA-256 ligado ao lease.

Resultado calculado é escrito no spool antes da transmissão terminal, permitindo retomada depois de falha de rede/processo.

## 9. Spool e retomada

O SQLite local mantém estado transacional de resultados já calculados. O runtime:

1. tenta reenviar pendências antes de reivindicar trabalho novo;
2. preserva retryable failures;
3. move rejeições permanentes para dead letter com código seguro;
4. não guarda a imagem original no banco local;
5. remove temporários privados depois que já não são necessários.

A conclusão remota é idempotente para permitir replay seguro do mesmo resultado.

## 10. Logs e privacidade

Logs podem conter somente informações operacionais sanitizadas, como transição de estado, duração, versão, backend/modelo público e códigos de erro seguros.

Não registrar:

- texto OCR;
- bytes/miniaturas;
- URLs assinadas completas;
- credenciais ou headers de autorização;
- nomes de documentos;
- caminhos privados do Drive;
- payload integral do spool.

## 11. Interface web atual

**Configurações > Computadores** já oferece:

- geração do código de pareamento;
- comando copiável para o host;
- lista de dispositivos;
- nome do dispositivo;
- estado `Ativo`/`Revogado`;
- último contato;
- data de pareamento/revogação;
- capacidades públicas limitadas: backend, modelo e concorrência quando informados;
- renomear dispositivo ativo;
- revogar dispositivo ativo com confirmação;
- remover da lista somente depois da revogação, também com confirmação.

A UI não exibe credencial, digest privado ou campos arbitrários de capabilities.

Ainda falta uma interface detalhada da **fila desktop** mostrando trabalhos aguardando/processando, dispositivo atual e ações operacionais do trabalho.

## 12. Fronteiras de segurança

O worker local não recebe nem armazena:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `GEMINI_API_KEY`;
- refresh token do Google Drive;
- access token persistente da sessão web;
- imagem privada dentro do SQLite.

`desktop-ocr-pair` usa `verify_jwt=false` no gateway somente porque o resgate do código precisa acontecer antes de o dispositivo ter identidade. Dentro da função:

- somente `action: redeem` segue sem bearer do usuário;
- a RPC de resgate é `service_role`-only;
- código, expiração e uso único são verificados no backend;
- demais caminhos legados continuam autenticando explicitamente o usuário.

A tabela de pairing codes usa RLS habilitado **e forçado** e não é superfície direta do cliente.

## 13. Validação automatizada

O repositório cobre em testes/gates:

- autenticação por digest;
- ownership e revogação;
- código de uso único e replay;
- segredo permanente gerado localmente;
- Secret Service adapter;
- download limitado + hash;
- leases e renovação;
- conclusão idempotente;
- spool/dead letter;
- loop/polling/backoff/shutdown;
- Ollama loopback e model lock;
- empacotamento systemd;
- gestão web de dispositivos;
- rename e remoção pós-revogação;
- pgTAP das RPCs;
- probe de staging do pareamento real, versionado para rodar depois do deploy validado.

O probe de staging cria código via conta autenticada, resgata sem Authorization/JWT usando somente publishable key, verifica que nenhuma credencial é retornada, rejeita replay, lista o dispositivo pelo owner, revoga e remove a fixture.

## 14. O que ainda falta

Pendências reais antes de declarar o Desktop OCR Worker operacionalmente pronto:

1. obter um checkpoint CI verde do SHA atual e promover as migrations/Edge Functions para staging;
2. executar o novo probe de pareamento contra staging e guardar o recibo terminal;
3. exercitar `/usr/bin/secret-tool` em uma sessão CachyOS real;
4. escolher um modelo de visão com licença/proveniência aceitáveis;
5. executar inferência real e benchmark CPU;
6. validar separadamente qualquer caminho Vulkan/ROCm desejado, sem promovê-lo antes do benchmark;
7. executar processamento desktop end-to-end contra staging com documento privado controlado;
8. implementar UI detalhada de fila/estado desktop;
9. registrar memória, latência, estabilidade, temperatura e qualidade no hardware alvo;
10. decidir quando remover o pareamento legado baseado em access token após o fluxo novo estar comprovado em staging/hardware.

## 15. Critério de prontidão

| Item                                         | Estado                                     |
| -------------------------------------------- | ------------------------------------------ |
| Pareamento por código de uso único           | implementado; staging real pendente        |
| Credencial longa somente local + hash remoto | implementado                               |
| Secret Service                               | implementado; sessão real pendente         |
| Revogação web                                | implementado                               |
| Limpeza local pós-revogação web              | implementado                               |
| Remoção owner-scoped de dispositivo revogado | implementado                               |
| Nenhuma porta pública doméstica              | implementado por arquitetura outbound-only |
| Claim exclusivo + lease/renew                | implementado/testado                       |
| Origem privada curta + SHA-256               | implementado/testado                       |
| Spool retomável + conclusão idempotente      | implementado/testado                       |
| Ollama loopback + model lock                 | implementado/testado                       |
| CPU em hardware real                         | pendente                                   |
| RX 6600 / Vulkan / ROCm                      | pendente                                   |
| Fila desktop detalhada na PWA                | pendente                                   |
| E2E staging com documento privado            | pendente                                   |

A documentação não deve converter um item operacional pendente em `PASS` apenas porque o código correspondente existe. O release continua condicionado a CI, staging e validação no dispositivo real.
