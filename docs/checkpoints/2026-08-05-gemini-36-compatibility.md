# Checkpoint — compatibilidade com Gemini 3.6

_Data: 2026-08-05_  
_Branch: `main`_  
_Checkpoint de código integralmente validado: `09e444d9303415d3a0246f5e87710533e3326afd`_  
_Workflow: `Validate current head`, run `30980939759`_

## Contexto

A revisão final das integrações externas identificou uma mudança publicada pelo provedor em julho de 2026: os modelos Gemini 3.6 Flash, Gemini 3.5 Flash-Lite e lançamentos futuros não devem receber os parâmetros de amostragem `temperature`, `top_p` ou `top_k`.

O cliente OCR ainda enviava `temperature: 0`. Embora o provedor pudesse ignorar o valor em alguns modelos, a documentação de migração informa que gerações futuras podem responder HTTP 400 quando esses campos forem enviados.

## Teste vermelho

O contrato do cliente Gemini passou a exigir que `generationConfig` não contenha:

```text
temperature
topP
topK
```

Antes da correção, o teste falhou exatamente porque encontrou `temperature: 0`. O teste vermelho foi preservado no commit `c31190537ea56886ac4013510e697dc97d66715f`.

## Correção

O commit `09e444d9303415d3a0246f5e87710533e3326afd` removeu somente `temperature` do payload. Permaneceram inalterados:

- imagem inline com MIME validado;
- prompt versionado;
- limite de saída;
- saída estruturada JSON;
- schema estrito de texto e avisos;
- chave da API apenas no header;
- classificação de transporte, HTTP, quota e resposta inválida.

O cliente já não enviava `top_p` nem `top_k`.

## Modelo recomendado para staging

Use uma versão estável explícita:

```text
OCR_MODEL_PRIMARY=gemini-3.6-flash
```

Não use `gemini-flash-latest`, porque esse alias pode mudar de versão. `gemini-3.5-flash-lite` pode ser avaliado depois como alternativa econômica para extração documental de alto volume, mas somente após o mesmo smoke test OCR e uma decisão explícita de custo/qualidade.

## Evidência

Validação local:

```text
cliente Gemini: 5/5
cliente + delegação + fault injection: 18/18
Prettier e ESLint: PASS
svelte-check: PASS — 0 erros e 0 avisos
Vitest: PASS — 560 testes em 131 arquivos
build estático/PWA: PASS
Playwright Chromium: PASS — 4/4 E2E
Edge Functions com Deno: PASS — 6 módulos
gates offline de fonte: PASS
```

Validação integral no GitHub:

```text
SHA: 09e444d9303415d3a0246f5e87710533e3326afd
Run: 30980939759
Conclusion: success
```

## Limite do checkpoint

Nenhuma chamada paga ou real ao Gemini foi executada. A compatibilidade do payload está coberta localmente e pelo CI; disponibilidade, quota, qualidade e custo do modelo somente serão comprovados por `Verify OCR staging` no projeto externo.
