# Desktop worker local cycle foundation — 2026-08-09

## Contexto

A fronteira remota do OCR desktop já possuía pareamento, autenticação por dispositivo, claim/renew/source/complete, lease e conclusão idempotente no Supabase. Este checkpoint inicia a implementação efetiva do processo local sem declarar um backend OCR/modelo como pronto antes da validação em hardware real.

## Implementado neste checkpoint

### Configuração, estado e API já presentes na linha de base

- configuração local fail-closed;
- diretórios XDG privados;
- SQLite de spool transacional com arquivo `0600`;
- contrato local espelhando exatamente o payload de conclusão da Edge Function;
- cliente HTTP estrito para `claim`, `renew`, `source` e `complete`;
- reenvio idempotente suportado pelo contrato persistido do servidor.

### Download seguro da fonte

Adicionado `tools/desktop-worker/source.mjs`:

- aceita somente descritor de fonte limitado e previamente validável;
- exige URL HTTPS sem credentials ou fragmento;
- usa `redirect: error` e não envia a credencial do worker à URL assinada;
- exige HTTP 200 e MIME exato `image/webp` ou `image/jpeg`;
- valida `Content-Length` quando presente;
- limita bytes também durante streaming, sem confiar apenas em headers;
- calcula SHA-256 incremental e exige igualdade com o hash vinculado ao lease no servidor;
- grava primeiro em arquivo temporário `0600` dentro de diretório `0700`;
- faz promoção por rename apenas após tamanho e hash válidos;
- remove arquivo parcial em qualquer falha.

Cobertura adicionada em `tests/unit/desktop-worker/source.test.ts` para sucesso, permissões, tamanho declarado divergente, excesso durante streaming, hash divergente, MIME divergente e URL não HTTPS.

### Entrega e retomada do spool

Adicionado `tools/desktop-worker/delivery.mjs`:

- tenta novamente resultados já calculados antes de buscar novo trabalho;
- incrementa contador de tentativa antes do envio;
- marca como aceito somente após receipt validado pelo cliente;
- aceita receipt `idempotentReplay` quando a resposta anterior foi perdida depois do commit;
- preserva resultado pendente em falha de rede ou rejeição do servidor;
- expõe somente códigos/HTTP status seguros no resumo da falha;
- continua tentando resultados independentes do spool quando um deles é rejeitado.

Cobertura adicionada em `tests/unit/desktop-worker/delivery.test.ts`.

### Ciclo local composto

Adicionado `tools/desktop-worker/runner.mjs` com um ciclo seguro:

1. reenvia o spool pendente;
2. não reivindica trabalho novo enquanto existir resultado computado sem confirmação remota;
3. remove resultados aceitos antigos conforme a retenção configurada;
4. reivindica um job;
5. solicita a fonte vinculada ao lease;
6. baixa e verifica a fonte;
7. chama um engine OCR injetável;
8. valida a saída pelo mesmo contrato de conclusão aceito pelo backend;
9. grava o resultado no spool antes da transmissão;
10. remove os bytes da imagem local mesmo quando a transmissão final falha;
11. envia a conclusão e mantém o spool caso a rede/servidor não confirme.

O engine continua deliberadamente injetável. Nenhum backend CPU/Vulkan/modelo foi marcado como pronto neste checkpoint.

Cobertura adicionada em `tests/unit/desktop-worker/runner.test.ts` para idle, bloqueio por spool pendente, ciclo completo, falha de entrega após processamento e saída de engine inválida.

## Validação executada nesta sessão

Sem checkout do repositório do app e sem depender de GitHub Actions do app:

- `source.mjs`: `node --check` no Node 22.16.0 — PASS;
- smoke local do download: bytes, `0700/0600`, SHA-256 e cleanup — PASS;
- `delivery.mjs`: smoke local de rejeição + entrega independente — PASS;
- `runner.mjs`: `node --check` e smoke do ciclo completo — PASS.

Os testes Vitest versionados ainda devem ser executados pelo toolchain completo antes de promover o checkpoint como recibo de CI do mesmo SHA. Se for necessário um workflow/check-out para isso, usar `Semogtw/Offline-Toolchains`, conforme a política do projeto.

## Invariantes preservadas

- nenhum `service_role`, `GEMINI_API_KEY` ou refresh token do Drive entra no worker;
- a credencial do dispositivo não é enviada para a URL assinada da fonte;
- bytes privados não entram no spool;
- resultado calculado é persistido localmente antes da tentativa terminal de rede;
- uma falha de upload não autoriza buscar trabalho novo e acumular leases;
- nenhum fallback pago é ativado;
- CPU/Vulkan/ROCm não são declarados validados sem backend real e benchmark.

## Próximos passos de código

1. implementar renovação de lease durante inferência longa, sem depender do relógio local para autoridade final;
2. adicionar loop contínuo com polling/backoff e shutdown por sinal;
3. implementar armazenamento da credencial no Secret Service/keyring sem argv, `.env` ou arquivo plano;
4. implementar backend CPU funcional e manifesto verificável de modelo;
5. adicionar unidade systemd do usuário;
6. integrar UI de dispositivos/fila somente depois que o processo local estiver funcional;
7. executar o gate completo pelo `Offline-Toolchains` e registrar SHA/recibo terminal.
