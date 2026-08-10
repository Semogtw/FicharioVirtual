# Checkpoint — Desktop OCR worker local runtime

Data: 2026-08-10

## Entregas consolidadas

O `main` contém agora uma implementação local completa o bastante para testes de integração do Desktop OCR Worker:

- download HTTPS de fonte assinada com limite, MIME e SHA-256 vinculados ao lease;
- remoção rápida da imagem após inferência;
- SQLite spool privado para resultados calculados;
- replay idempotente antes de novo claim;
- dead letter transacional para `desktop_ocr_completion_rejected` permanente;
- claim/source/complete com contrato fechado;
- renovação de lease durante inferência;
- polling serial, backoff e shutdown por `AbortSignal`;
- Secret Service via `/usr/bin/secret-tool`, sem segredo em argv/env/arquivo;
- `device.json` não secreto e schema fechado;
- runtime composto sem credencial serializável;
- backend Ollama exclusivamente loopback;
- model lock por digest SHA-256 e rejeição de modelos Ollama remotos;
- structured OCR output com warnings limitados e mensagens locais fixas;
- pareamento com browser JWT efêmero e credencial do device somente no keyring;
- rollback remoto do pareamento se o commit local falhar;
- revoke autenticado user-scoped que reencaminha leases do device;
- CLI de config/model/pair/unpair/status;
- status local agregado sem OCR, path, signed URL ou segredo;
- serviço `systemd --user` e instalador que não habilita/inicia automaticamente.

## Correção de hardening

A primeira unit usava `ProtectSystem=strict`, o que pode conflitar com as escritas necessárias em SQLite/cache/XDG sem uma whitelist explícita. Para o próximo teste real foi adicionada a unit `packaging/systemd/fichario-ocr-worker-safe.service` com `ProtectSystem=full`, preservando as demais restrições relevantes enquanto mantém o home do usuário gravável.

O instalador de referência para o próximo teste real é:

```bash
bash tools/desktop-worker/install-user-service-safe.sh
```

Os instaladores anteriores permanecem apenas como histórico temporário até a próxima limpeza/refatoração; não devem ser usados como fonte de verdade operacional.

## Evidência automatizada já obtida

No toolchain externo do `Offline-Toolchains`, o snapshot `a5ef8fda5eb9968ee9caabbe01f90e64e40210bc` teve:

- `svelte-check`: 0 erros / 0 warnings;
- testes unitários: aprovados;
- build: aprovado;
- E2E: aprovado;
- checks de Edge Functions: aprovados;
- Supabase local: 434 testes SQL / 2568 assertions aprovados;
- único gate vermelho: Prettier em dois arquivos de pairing daquele snapshot, posteriormente alterados novamente.

Um gate posterior foi disparado para `d9608aaa25eea762d946fe9c3916f738355fa7ef`, já incluindo o rollback de pairing/revoke. O código continuou avançando depois desse SHA, então é necessário um novo gate para o HEAD contendo status, unpair e a unit de systemd corrigida.

## Dependências/validações ainda abertas

Esses itens não bloqueiam desenvolvimento de código, mas impedem declarar produção pronta:

1. `/usr/bin/secret-tool` não existe no ambiente de codificação desta sessão; integração real com Secret Service precisa rodar em sessão Linux/CachyOS.
2. Nenhum modelo OCR/vision foi promovido a padrão; falta avaliação de licença, proveniência, qualidade e desempenho.
3. Falta inferência real em Ollama com imagem controlada e digest fixado.
4. Falta benchmark CPU e qualquer caminho Vulkan/ROCm pretendido.
5. Falta E2E real do worker local contra staging, incluindo lease renewal e replay após falha de rede.
6. Falta UI web para parear/revogar dispositivos sem manipular manualmente o access token do navegador.
7. Os instaladores históricos devem ser consolidados após o próximo gate, mantendo somente o instalador seguro como caminho canônico.

## Próximos passos de código

- validar HEAD completo no `Offline-Toolchains`;
- corrigir formatter/testes apontados pelo recibo novo;
- consolidar instalador/unit antigos;
- adicionar UI de gestão de dispositivos e bootstrap de pairing;
- executar integração real em CachyOS quando o runtime tiver Secret Service + Ollama disponíveis.
