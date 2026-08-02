# Validação integral do HEAD — 2 de agosto de 2026

## Resultado

O commit `cccce3f819b1e72dcf41f2342f04a476a8bbf150` foi validado com sucesso pelo workflow `Validate current head`, run `30770283157`.

O recibo persistente está na issue `#1`, `[CI] Fichário current HEAD validation`.

## Gates executados

- instalação com `pnpm install --frozen-lockfile`;
- Prettier e ESLint;
- `svelte-check` com zero erros e zero warnings;
- 120 testes unitários;
- build estático SvelteKit;
- validação dos artefatos PWA gerados;
- gates offline de segurança, migrations, RPCs, toolchain e rotas dinâmicas;
- 3 testes E2E no Chromium;
- type-check das Edge Functions com Deno;
- inicialização e reset da stack Supabase local;
- aplicação limpa de 27 migrations;
- 54 testes pgTAP;
- teste real de concorrência no claim OCR;
- conclusão OCR idempotente, rejeição de replay divergente e reconciliação após perda de resposta;
- bloqueio por cota e liberação na virada do dia UTC.

## Defeitos corrigidos durante a validação

1. O bootstrap de `get_usage_overview` usava `uploading`, valor que não pertence ao enum `processing_status`.
2. As funções autenticadas de busca, exportação e revisão dependiam de helpers puros sem permissão de execução para `authenticated`.
3. Repetir exatamente uma conclusão OCR já confirmada retornava `false`, impedindo reconciliação idempotente depois de perda da resposta.
4. A configuração local do Supabase ainda usava a seção depreciada `[inbucket]` em vez de `[local_smtp]`.

## Estado da evidência

Esta validação cobre o comportamento local e reproduzível do código, do build, do navegador, das Edge Functions e do banco.

Ela não substitui os gates externos restantes:

- staging Supabase remoto com Auth, RLS, Storage e Edge Functions reais;
- OCR real com credencial Gemini e testes de falha controlada;
- instalação e atualização PWA no host HTTPS final;
- testes de memória e PDFs representativos em tablet e celular;
- validação operacional dos limites gratuitos sem billing.
