# Checkpoint — Desktop OCR Worker: pareamento web sem JWT no host

_Data: 2026-08-10_  
_Branch: `main`_

## Objetivo

Remover do caminho normal de instalação a necessidade de copiar um access token da sessão web para o computador do Desktop OCR Worker, sem deslocar `service_role` ou credenciais permanentes para o cliente.

## Fluxo implementado

1. O usuário autenticado abre **Configurações > Computadores**.
2. `create_ocr_worker_pairing_code()` gera 8 bytes aleatórios, apresenta `XXXX-XXXX-XXXX-XXXX`, persiste somente SHA-256 e define expiração de 10 minutos.
3. Criar um novo código remove qualquer código anterior ainda não consumido do mesmo usuário.
4. O site mostra o endpoint correto e o comando `fichario-worker-pair-code`, mas mantém o código fora de `argv`.
5. O worker lê o código por prompt/stdin, gera localmente 32 bytes aleatórios para sua credencial permanente e calcula SHA-256.
6. `desktop-ocr-pair` aceita `action: redeem` sem JWT de navegador e envia o digest para a RPC service-only `redeem_ocr_worker_pairing_code`.
7. A RPC bloqueia a linha do código, exige hash válido, não expirado e não consumido, registra o dispositivo para o dono original do código e marca o código como consumido na mesma transação.
8. A Edge Function retorna somente metadados do dispositivo. A credencial permanente bruta nunca é retornada pelo servidor nesse fluxo.
9. O worker grava a credencial bruta no Secret Service e `device.json` recebe somente metadados não secretos.
10. Se a persistência local falhar depois do resgate remoto, o segredo parcial é limpo e o erro sanitizado exige revogar o dispositivo pela tela web.

## Split de autenticação da Edge Function

`desktop-ocr-pair` agora usa `verify_jwt = false` no gateway porque o resgate por código não possui JWT. A própria função mantém a fronteira explícita:

- `action: redeem`: sem browser JWT; exige código curto válido e atravessa exclusivamente RPC `service_role`;
- `action: revoke`: exige bearer token, resolve `auth.getUser()` e usa a RPC user-scoped;
- pareamento legado: exige bearer token e continua existindo temporariamente para compatibilidade.

O endpoint principal `desktop-ocr-worker` continua separado, `verify_jwt = false` e autenticado pelo esquema dedicado `FicharioWorker <deviceId>.<credential>`.

## Persistência e privilégios

A tabela `ocr_worker_pairing_codes`:

- tem RLS habilitada;
- não concede acesso direto a `anon` ou `authenticated`;
- guarda `code_hash`, nunca o código bruto;
- vincula `user_id`, expiração, consumo e `device_id` final;
- permite criação somente pela RPC autenticada `create_ocr_worker_pairing_code()`;
- permite resgate somente pela RPC `service_role` `redeem_ocr_worker_pairing_code(...)`.

## Gestão web adicional

A mesma trilha adicionou:

- listagem de computadores em Configurações;
- revogação user-scoped com requeue de leases do dispositivo;
- rename de dispositivo ativo via RPC owner-scoped;
- geração do código de pareamento e instruções copiáveis;
- comando `fichario-worker-forget --after-web-revoke` para apagar Secret Service + `device.json` depois de uma revogação feita no site, sem JWT no host.

O flag de confirmação é deliberado: o comando de limpeza local não deve fingir que revogou o dispositivo remoto.

## Compatibilidade

`fichario-worker-pair` e `fichario-worker-unpair` permanecem temporariamente disponíveis com o bootstrap legado por access token. Instalações novas devem usar o par:

```bash
fichario-worker-pair-code https://SEU-PROJETO.supabase.co/functions/v1/desktop-ocr-worker "Meu computador"
# após revogar no site, se quiser remover o estado local:
fichario-worker-forget --after-web-revoke
```

## Testes versionados

Foram adicionados/atualizados:

- pgTAP para criação, invalidação, consumo, replay e binding do digest da credencial;
- unit tests do serviço web para código e rename;
- unit tests do worker garantindo que a credencial bruta fica local e só o digest cruza a rede;
- unit tests do CLI de pairing code;
- unit tests da limpeza local pós-revogação;
- teste estático da Edge Function distinguindo `redeem` service-only e `revoke` user-scoped;
- `check-desktop-worker-boundary.mjs` atualizado para a nova divisão de autenticação.

## Gate e continuidade

Os pushes acionam `Validate current head`. Runs cancelados por um SHA mais novo não contam como PASS nem como falha. O trabalho só deve citar PASS quando o workflow terminal verde corresponder ao SHA atual ou a um checkpoint explicitamente identificado.

Ainda faltam, independentemente do gate de código:

- deploy/migrations no staging e teste real de um código gerado pela PWA;
- `secret-tool` real em CachyOS;
- modelo local escolhido com licença/proveniência verificadas;
- inferência E2E e benchmark CPU;
- avaliação Vulkan/ROCm separada;
- UI detalhada de fila/telemetria sanitizada do worker;
- validação de revogação/limpeza local em máquina real.
