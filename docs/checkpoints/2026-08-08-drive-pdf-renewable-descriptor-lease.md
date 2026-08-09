# Checkpoint — lease renovável de descritores para PDF grande do Drive

_Data: 2026-08-08_  
_Branch: `main`_

## Objetivo desta continuação

Fechar a etapa que estava em RED no commit `88149abe3ff1db3e827c8e84bab93bb9a097d16e`: conectar o staging paginado de descritores ao orquestrador de PDFs grandes, tornar a tentativa renovável e impedir que uma sessão stale publique ou remova derivados pertencentes a uma tentativa mais nova.

## Estado anterior confirmado

A recuperação distribuída da janela `files.copy` → `stage_drive_pdf_reference` já estava integrada por marcação privada em `appProperties` e reconciliação no mesmo escopo `drive.file`. A descrição antiga em `docs/CURRENT_STATUS.md` dizendo que essa janela ainda estava aberta estava desatualizada.

O débito real era posterior: havia infraestrutura inicial de staging paginado e um teste RED exigindo ownership/lease renovável, mas a migration, o cliente e o orquestrador ainda não formavam um protocolo único.

## Implementado

### Banco e ownership

- `drive_pdf_reference_imports` agora carrega `descriptor_attempt_id`, `descriptor_expected_page_count` e `descriptor_attempt_expires_at`;
- `drive_pdf_reference_page_staging` persiste o descritor bruto por documento/página/tentativa;
- `begin_drive_pdf_reference_descriptor_attempt` adquire ou retoma ownership;
- `renew_drive_pdf_reference_descriptor_attempt` renova somente uma tentativa ainda ativa;
- `stage_drive_pdf_reference_descriptor_batch` aceita no máximo 100 descritores e rejeita payload JSONB acima de 4 MiB;
- retries idênticos da mesma página são idempotentes; mutation de uma página já persistida é rejeitada;
- `finalize_drive_pdf_reference_descriptor_attempt` exige exatamente `1..expected_page_count`, reconstrói o array ordenado e delega ao finalizador atômico endurecido;
- a atribuição do retorno escalar `jsonb` ao leased finalizer foi tornada explícita em migration corretiva;
- `abandon_drive_pdf_reference_descriptor_attempt` retorna `true` somente quando a tentativa informada ainda era a proprietária e foi efetivamente limpa;
- takeover de lease expirado limpa o staging da tentativa anterior antes de instalar o novo owner.

### Superfície de segurança

Depois que o lease passou a ser o caminho ativo, foram revogados de `authenticated`:

- `finalize_drive_pdf_reference_import(uuid,jsonb,integer)`;
- `stage_drive_pdf_reference_page_batch(uuid,jsonb)`;
- `finalize_staged_drive_pdf_reference_import(uuid,integer,integer)`.

Esses contratos antigos permanecem acessíveis somente ao `service_role` quando necessário para manutenção/gates internos. O navegador publica pelo RPC leased.

### Cliente e orquestrador

- `acquireDrivePdfReferenceDescriptorLease` expõe `renew`, `renewIfNeeded`, `stageAndFinalize` e `abandon`;
- respostas de begin/renew/stage e abandono são validadas antes de atualizar estado local;
- o lease usa margem preventiva de dois minutos;
- o orquestrador adquire ownership depois da inspeção/plano e antes de qualquer derivado OCR;
- há renovação preventiva ao redor do trabalho longo;
- há renovação **forte** imediatamente antes de cada upload de derivado, evitando que uma renderização longa permita um write depois da perda do lease;
- publicação usa staging em lotes + finalizer leased; o finalizador direto fica somente como fallback de dependências legadas de teste;
- recuperação de resposta perdida depois do commit foi preservada;
- em falha pré-publicação, derivados são removidos apenas quando `abandon()` devolve `true`; `false` ou erro preserva os objetos porque ownership pode ter mudado.

### Limites de transporte sem limite lógico do documento

O staging do navegador deixou de dividir apenas por quantidade. Cada lote respeita simultaneamente:

- no máximo 100 descritores no protocolo;
- batch padrão de 64 descritores;
- no máximo 3 MiB de JSON UTF-8 no cliente;
- no máximo 4 MiB de JSONB no banco.

Isso mantém margem para overhead do PostgreSQL e evita que páginas com muito texto nativo estourem o RPC, sem impor teto lógico ao número total de páginas do PDF.

## Testes/gates adicionados ou atualizados

- teste unitário do cliente de lease renovável;
- teste de integração do orquestrador com aquisição antes do render, renovação forte antes do upload, publicação leased e cleanup ownership-safe;
- teste unitário de batching por bytes com descritores text-heavy;
- teste-fonte das migrations de lease, limite de payload, finalizer escalar e revogação de bypasses;
- pgTAP de privilégios atualizado para a superfície leased;
- pgTAP de finalização atualizado para publicar pelo lease;
- gate do finalizador endurecido preservado como teste interno depois da revogação browser-facing;
- novo pgTAP comportamental cobre aquisição, concorrente bloqueado, idempotência, mutation rejeitada, renew, takeover de lease expirado e abandono stale/owner.

## Commits relevantes desta continuação

- `3aaa6a2` — plano de implementação;
- `02de9ee` — migration base do lease renovável;
- `ca2e1ac` / `a9c70e5` — especificação e cliente de lease;
- `50ad466` — integração inicial no orquestrador;
- `54e9ad9` / `839a4df` — batching por bytes;
- `ef7922a` — revogação dos bypasses legados;
- `4be6e9a`, `0c04a36`, `ef8c772` — gates pgTAP atualizados;
- `dd895ab` / `56bdc54` — renovação forte imediatamente antes do upload;
- `1b972f0` / `74020dc` — finalização escalar segura;
- `a8b4d20` — pgTAP comportamental de ownership/takeover;
- `8179ba6` / `097ba39` — documentação canônica sincronizada.

## Validação que NÃO foi executada nesta sessão

O ambiente local disponível nesta conversa não consegue resolver `github.com`. Por isso não foi possível obter um checkout atualizável, instalar dependências e executar `pnpm verify:full`/Supabase local aqui.

Isso deve ser tratado como gate pendente, não como falha de arquitetura e tampouco como PASS implícito. O último recibo completo conhecido continua sendo o SHA `50897346272269642d95d75aa249f6a96b9479f6`, anterior a esta sequência.

## Próximos passos prioritários

1. executar o gate completo do HEAD atual usando o runner/toolchain já previsto para o projeto;
2. corrigir qualquer falha determinística encontrada, mantendo commits pequenos;
3. aplicar todas as migrations em Supabase staging limpo e rodar o pgTAP novo;
4. regenerar `src/lib/types/database.ts` a partir desse schema real — o arquivo atual continua explicitamente provisório;
5. validar conta Google real: PDF >50 MiB, crash copy→stage, ranges, reload e duas sessões concorrentes;
6. validar Gemini real e dispositivos;
7. somente então atualizar a evidência de release/readiness.

## Invariantes que não devem regredir

- escopo Google continua `drive.file`;
- refresh token nunca vai ao navegador;
- limites de lote são limites de transporte, não do documento lógico;
- tentativa stale nunca remove derivados quando ownership é ambígua ou pertence a outro attempt;
- nenhum RPC browser-facing pode contornar o leased finalizer;
- resposta perdida depois do commit continua recuperável;
- release não é declarada pronta sem gates, staging e dispositivos no mesmo SHA.
