# Checkpoint — reatividade multiaba e preparação externa

_Data: 2026-08-05_  
_Branch: `main`_  
_Checkpoint integralmente validado: `2c9ed12bace23412ae35dde0f246d85b9ff97d2c`_  
_Workflow: `Validate current head`, run `30979143410`, job `92219621128`_

## Objetivo

Fechar as últimas lacunas codificáveis conhecidas antes da configuração de staging, host HTTPS e dispositivos físicos. O trabalho concentrou-se em uma prova real de navegador para concorrência entre abas, numa falha de reatividade descoberta por essa prova e num runbook único para a operação externa restante.

## Defeito encontrado

As filas Svelte inseriam um objeto comum em um array criado com `$state` e continuavam a mutar a referência original durante preparação, upload, OCR e restauração. No navegador, o array passa a expor uma referência proxificada; mutações posteriores no objeto cru não atualizavam necessariamente a interface.

O novo E2E reproduziu o efeito com duas abas reais: apenas uma execução concluía upload e OCR, mas a aba vencedora continuava exibindo `Na fila`. Portanto, a exclusão mútua estava correta, enquanto a projeção visual do estado estava obsoleta.

## Correção

Foram adicionados helpers explícitos nas duas filas:

- `appendImportItem`, para imagens;
- `appendPdfImportItem`, para PDFs.

Cada helper insere o item e devolve a referência efetivamente armazenada no array reativo. Inclusão e restauração passam a executar toda continuação assíncrona através dessa referência proxificada.

Um contrato unitário estrutural impede que os caminhos voltem a processar silenciosamente o objeto cru depois da inserção no `$state`.

## Prova multiaba no navegador

O cenário `tests/e2e/import-multitab.spec.ts` usa:

- um único `BrowserContext` Chromium;
- duas páginas na rota real de importação;
- um registro real no IndexedDB `fichario-resume`;
- `BroadcastChannel` e Web Locks do navegador;
- filas e código de produção;
- mocks somente na fronteira HTTP do Supabase.

O teste exige:

- um único consentimento;
- uma única criação de metadados;
- uma única chamada OCR;
- dois uploads de Storage correspondentes à imagem preparada e à miniatura;
- exatamente uma aba exibindo `Importação concluída`;
- remoção do registro local concluído;
- nenhuma chamada remota inesperada.

O teste vermelho foi preservado antes da correção.

## Configuração externa documentada

`docs/EXTERNAL_SETUP_RUNBOOK.md` agora concentra, em ordem operacional:

1. criação do projeto Supabase de staging;
2. migrations e geração de tipos;
3. duas contas de teste e allowlist fail-closed;
4. environment protegido no GitHub;
5. gate remoto de RLS e Storage;
6. secrets e deploy das Edge Functions;
7. build do artifact estático;
8. publicação em host HTTPS;
9. gate do host;
10. smoke test OCR real;
11. matriz em celular e tablet;
12. billing, backup e rollback.

O runbook não contém valores de segredo e reforça que chaves Gemini e service-role não pertencem ao frontend nem ao GitHub Actions.

## Evidência integral

No SHA `2c9ed12bace23412ae35dde0f246d85b9ff97d2c`, o run `30979143410` passou:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS — 0 erros e 0 avisos
Vitest: PASS — 560 testes em 131 arquivos
build estático/PWA: PASS
gates offline de fonte: PASS — 31 migrations e 13 RPCs frontend
Playwright Chromium: PASS — 4/4 E2E
Edge Functions com Deno: PASS
Supabase local: PASS — 76 testes de banco
```

Artifacts publicados:

```text
source: fichario-source-2c9ed12bace23412ae35dde0f246d85b9ff97d2c
source digest: sha256:e2697c14c830a4701c31f273b0036a1e38757ee7672f70d098261a70b4058b8f
browser: playwright-evidence-2c9ed12bace23412ae35dde0f246d85b9ff97d2c
browser digest: sha256:ae5b4d0f6b910f82e83b19d6e34ac8cc6281bf58f52298527cd241f185f717a4
```

Não foram gerados artifact de falha de frontend nem patch de reparo do Prettier.

## Auditoria final codificável

A auditoria não encontrou `TODO`, `FIXME` ou testes ignorados que representassem uma feature conhecida incompleta. Um E2E multiaba específico de PDF foi prototipado localmente, mas o worker PDF.js/WASM tornou o teardown instável e incapaz de distinguir de forma confiável falha de produto de falha do harness. O teste experimental não foi incorporado. A fila PDF permanece coberta pelo mesmo contrato estrutural, por testes unitários e pelo mecanismo compartilhado exercitado no E2E de imagem.

## Trabalho restante

O trabalho conhecido restante é externo ao checkout:

- projeto Supabase de staging e duas contas de teste;
- Edge Functions e secrets reais de staging;
- modelo e quota reais do provedor OCR;
- host HTTPS e headers do ambiente publicado;
- testes em celular e tablet físicos;
- confirmação de billing gratuito, backup e rollback;
- decisão entre staging prolongado, release privada e produção.

Esses itens devem seguir `docs/EXTERNAL_SETUP_RUNBOOK.md`. Nenhum deles deve ser marcado como `PASS` antes da execução no ambiente correspondente.
