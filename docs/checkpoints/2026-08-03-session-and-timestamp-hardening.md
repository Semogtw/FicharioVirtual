# Checkpoint de sessão e contratos temporais — 2026-08-03

## Escopo

Este checkpoint registra o hardening aplicado diretamente à `main` após o checkpoint de contratos anterior.

O conjunto cobre:

- normalização fail-closed das fronteiras de autenticação;
- prevenção de corridas entre inicialização, login e eventos de sessão;
- rejeição com `AbortError` de autenticações supersedidas, impedindo navegação obsoleta;
- prevenção de autorização duplicada durante um login explícito;
- validação RFC 3339 compartilhada para timestamps recebidos ou usados como filtros/cursores;
- rejeição de datas impossíveis, formatos locais ambíguos, timestamps sem zona e texto excedente;
- adoção do contrato temporal em documentos, cadernos, detalhes de documento, fila de revisão, localização de rascunhos, tags, painel de uso e organização de documentos.

## Checkpoint funcional

Aplicação:

```text
94023a463f49d081626842938e6e1c24a1fa1f36
```

Toolchain:

```text
a3cafd6e690c6d981aec5eb1959f204089977846
```

Workflow exato da toolchain:

```text
run 30858004533
status: success
source: 94023a463f49d081626842938e6e1c24a1fa1f36
```

## Evidência local

O workspace portátil derivado da toolchain foi validado com:

```text
Prettier: PASS
ESLint: PASS
svelte-check: 0 erros, 0 warnings
Vitest: 78 arquivos de teste, PASS
build estático: PASS
validação PWA: PASS
cinco gates offline de fonte: PASS
seis módulos Edge com Deno/cache offline: PASS
Playwright Chromium tablet: 3/3 PASS
```

O contrato temporal isolado possui 14 casos cobrindo UTC, offsets, microssegundos, ano bissexto, datas impossíveis, horas/minutos/segundos inválidos, ausência de zona, fração excessiva e offset inválido.

## Limites do checkpoint

Os gates dependentes de Docker e de um Supabase local completo não fazem parte do bundle portátil e não foram executados neste checkpoint. Continuam necessários:

- aplicação das migrations em banco limpo;
- testes pgTAP;
- concorrência e replay OCR exercitados contra PostgreSQL/Supabase local;
- validações remotas de Auth, RLS, Storage, Edge Functions, Gemini e host HTTPS.

Nenhum desses limites invalida os gates locais acima, mas eles impedem classificar o sistema como pronto para release externa.
