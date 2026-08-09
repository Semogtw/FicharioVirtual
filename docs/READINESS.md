# Prontidão do Fichário Virtual

_Atualizado em 9 de agosto de 2026._

Esta página não publica porcentagem global. Prontidão significa evidência reproduzível no mesmo SHA, não quantidade de arquivos implementados.

## Matriz atual

| Dimensão                     | Código                                   | Evidência externa                                                                 | Estado                 |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| Produto privado              | Implementado                             | CI completo `f87e1edc` / run `31333367357`                                       | Bloqueado para release |
| OCR Gemini por lotes         | Implementado e corrigido                 | `process-ocr` provider + parser HTTP 200 em `31333418948`; runtime `ACTIVE v19`   | Fronteira aprovada     |
| Quota exclusiva do provedor  | Implementada                             | `429 gemini_daily_quota` observado na chamada direta protegida                    | Evidenciada            |
| Google Drive-first           | Implementado                             | Conta Google real ainda pendente                                                   | Não promovido          |
| Picker até 50 MiB            | Implementado                             | Navegadores reais pendentes                                                       | Não promovido          |
| Picker acima de 50 MiB       | Implementado por referência/ranges       | PDF grande real pendente                                                          | Não promovido          |
| Recuperação crash copy→stage | Implementada com `appProperties`         | Contratos no CI; interrupção real pendente                                        | Não promovida          |
| Lease de descritores         | Implementado e conectado ao orquestrador | Banco local no CI; duas sessões reais pendentes                                   | Não promovido          |
| Cloudflare Pages             | Runbook e gates implementados            | Deployment real pendente                                                          | Não implantado         |
| Worker desktop               | Fronteira backend implementada           | Worker local e hardware pendentes                                                 | Não iniciado           |
| RX 6600                      | Não implementada                         | Benchmark pendente                                                                | Não validada           |

## Evidência presente no repositório

### Produto e segurança

- SvelteKit estático e responsivo;
- autenticação por allowlist fail-closed;
- biblioteca, cadernos, tags, busca, revisão e exportação;
- RLS e Storage privado;
- PWA com cache restrito ao shell público;
- URLs assinadas curtas;
- Edge Functions com CORS fail-closed e `Cache-Control: no-store`;
- JWT explícito em `supabase/config.toml`;
- somente o callback OAuth sem JWT de gateway;
- callback protegido por origem, `state` de uso único e PKCE;
- gates que proíbem secrets no frontend e workflows com escrita automática no repositório;
- recibo CI completo do SHA `f87e1edc` (run `31333367357`) com frontend, source/offline, Chromium, Deno/Edge e banco local aprovados;
- deploy do mesmo SHA `31333367356` concluído com sucesso;
- sonda protegida `31333418948`: chamada anônima rejeitada com 401, `STAGING_SERVICE_ROLE_KEY` validado como presente sem revelar valor e `process-ocr` retornando `provider_ok` HTTP 200;
- cleanup `31333977753` concluído: `process-ocr` `ACTIVE v19`, sonda temporária ausente e funções não relacionadas preservadas.

### Importação e OCR

- importação cancelável e retomável de imagens e PDFs;
- SHA-256, miniaturas, preparação local e deduplicação;
- texto nativo preservado sem OCR;
- PDF misto envia somente páginas visuais;
- original local enviado ao Drive por upload retomável;
- derivados mantidos abaixo de 12 MiB por rerenderização conservadora;
- lotes Gemini multipágina;
- persistência por página;
- divisão seletiva para omissão, duplicação e truncamento;
- retomada sem repetir páginas aceitas;
- contador local sem autoridade de bloqueio;
- telemetria de páginas, lotes, chamadas e tentativas;
- compatibilidade com chamada unitária antiga.

### Google Drive-first e PDFs grandes

- OAuth start, callback e token efêmero;
- refresh token armazenado somente no backend;
- escopo `drive.file`;
- pasta `Fichário Digital` e pastas aninhadas;
- upload retomável;
- Google Picker explícito;
- download direto com limite técnico de 50 MiB;
- PDFs externos acima de 50 MiB copiados para área controlada e processados por referência sem download integral;
- transporte por ranges com validação estrita e PDF.js `PDFDataRangeTransport`;
- inspeção sequencial e renderização seletiva somente das páginas que precisam de OCR;
- identidade física da cópia verificada antes da leitura;
- `appProperties` privadas permitem reconciliar a cópia se o navegador morrer entre `files.copy` e staging no banco;
- descritores de página persistidos em lotes limitados por quantidade e bytes, sem transformar tamanho de RPC em limite lógico do PDF;
- lease renovável por tentativa, com takeover somente após expiração;
- renovação forte imediatamente antes do upload de cada derivado compartilhado;
- abandono/cleanup condicionado à confirmação de ownership da tentativa;
- RPCs legados de publicação direta revogados para `authenticated`;
- finalização atômica continua delegada ao finalizador endurecido;
- recuperação de resposta perdida após commit preservada;
- feed paginado de mudanças;
- checkpoint depois da persistência;
- ausência e reconexão sem perda de OCR;
- fila idempotente, lease, retry e conflito;
- executor de criação, atualização, movimento e exclusão;
- telas de conexão, jobs, conflitos e migração;
- migração de originais legados com rollback;
- migrations, pgTAP, contratos TypeScript e testes unitários;
- gates Deno e de segurança para as funções Drive.

### Cloudflare e artifacts

- adapter estático;
- `_headers` versionado;
- fallback SPA documentado;
- artifact implantável com manifest e checksums;
- verificador pós-deployment;
- projeto separado de modelos documentado;
- R2 desativado por padrão;
- nenhum documento privado destinado à Cloudflare.

## Pendências funcionais em código

### Worker desktop

Ainda faltam:

- worker local e integração de produção com as tabelas/Edge Functions de dispositivos;
- credencial no keyring local;
- serviço systemd do usuário;
- backend CPU funcional;
- cache e verificação de modelos;
- spool local e retomada;
- UI de dispositivos e fila;
- benchmark Vulkan e RX 6600.

O worker nunca deve receber service-role, chave Gemini ou refresh token do Drive.

## Pendências de evidência

### CI do mesmo SHA

O recibo [`31333367357`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333367357) do SHA `f87e1edc47268b4e0d2ea0742dac690c96d93646` terminou com **success** e executou frontend, source/offline, Chromium, Deno/Edge e Supabase local + pgTAP. Runs posteriores cancelados por pushes de cleanup/housekeeping não devem ser promovidos a PASS; o checkpoint final deve citar o novo recibo terminal depois da documentação.

### Supabase

- deploy do fix `31333367356`: **success**;
- sonda OCR `31333418948`: **success**, com `process-ocr` `provider_ok` HTTP 200 e tentativa direta separada em `429 gemini_daily_quota`;
- cleanup `31333977753`: **success**; remoção explícita somente de `ocr-boundary-probe`;
- consulta posterior: `process-ocr` `ACTIVE v19`, `ocr-boundary-probe` ausente, funções Drive/desktop preservadas;
- `STAGING_SERVICE_ROLE_KEY` foi validado como não vazio pelo job protegido; nenhum valor foi exposto;
- `GEMINI_API_KEY` está configurada em nível suficiente para uma chamada real bem-sucedida via `process-ocr`; nenhum valor foi exposto;
- o fluxo normal de OCR com página/job, Storage e persistência real ainda precisa de smoke antes de release.

### Google Drive

- configurar projeto Google Cloud e redirect URI final;
- executar OAuth com a conta autorizada;
- validar criação ou reconexão da raiz;
- testar upload retomável, Picker, mudanças, ausência e conflito;
- testar PDF real acima de 50 MiB por ranges;
- matar/recarregar o navegador entre cópia e staging e confirmar reconciliação por `appProperties`;
- abrir duas sessões e validar expiração/takeover do lease sem remoção/sobrescrita stale de derivados;
- executar migração e rollback com originais reais;
- confirmar que tokens não aparecem em logs, URL ou navegador.

### Gemini

A fronteira request/provider/parser foi validada em staging. O diagnóstico reproduziu HTTP 400 com `responseFormat` e com schema em `generationConfig`; após mover o contrato JSON para o prompt e manter apenas `responseMimeType: application/json`, `process-ocr` obteve HTTP 200 e `provider_ok`.

Ainda faltam o fluxo normal de página/job com persistência, lote visual multipágina real, PDF textual confirmando zero chamadas, cancelamento/retomada no produto e confirmação administrativa de billing/fallback pago desativado.

### Cloudflare e dispositivos

- criar projetos Pages;
- configurar origem canônica e redirects;
- validar headers, fallback, PWA e rollback;
- instalar em celular e tablet;
- testar PDF grande em hardware real;
- manter conteúdo privado fora da Cloudflare.

## Critérios de promoção

```text
Validate current head `f87e1edc` / `31333367357`: PASS
Deploy do fix `31333367356`: PASS
Sonda OCR `31333418948`: PASS para fronteira provider/parser (`process-ocr` HTTP 200)
Cleanup `31333977753`: PASS; `process-ocr` ACTIVE v19; probe ausente
Workflow de deploy permanente: manual-only (`9ff4975`)
Fluxo OCR normal com persistência: PENDING
Tipos gerados pelo schema implantado: PENDING
OAuth drive.file real: PENDING
Picker/ranges e crash recovery reais: PENDING
Cloudflare produção: PENDING
Celular e tablet: PENDING ou risco registrado
Nenhum conteúdo privado na Cloudflare: requisito obrigatório
```

O worker desktop pode ser tratado como marco posterior se a release declarar explicitamente essa limitação. A ausência de defeitos conhecidos não substitui os recibos acima.
