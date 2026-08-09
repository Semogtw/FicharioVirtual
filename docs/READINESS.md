# Prontidão do Fichário Virtual

_Atualizado em 9 de agosto de 2026._

Esta página não publica porcentagem global. Prontidão significa evidência reproduzível no mesmo SHA, não quantidade de arquivos implementados.

## Matriz atual

| Dimensão                     | Código                                   | Evidência externa                                                          | Estado                 |
| ---------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| Produto privado              | Implementado                             | CI completo `b39e3eb`; HEAD `651f6cc` com recibo OCR terminal desconhecido | Bloqueado para release |
| OCR Gemini por lotes         | Implementado                             | Staging real pendente                                                      | Não promovido          |
| Quota exclusiva do provedor  | Implementada                             | `429` real pendente                                                        | Não promovida          |
| Google Drive-first           | Implementado                             | Conta Google real pendente                                                 | Não promovido          |
| Picker até 50 MiB            | Implementado                             | Navegadores reais pendentes                                                | Não promovido          |
| Picker acima de 50 MiB       | Implementado por referência/ranges       | CI `b39e3eb` verde; PDF grande real pendente                               | Não promovido          |
| Recuperação crash copy→stage | Implementada com `appProperties`         | Contratos no CI; interrupção real pendente                                 | Não promovida          |
| Lease de descritores         | Implementado e conectado ao orquestrador | Banco local no CI; duas sessões reais pendentes                            | Não promovido          |
| Cloudflare Pages             | Runbook e gates implementados            | Deployment real pendente                                                   | Não implantado         |
| Worker desktop               | Fronteira backend implementada           | Worker local e hardware pendentes                                          | Não iniciado           |
| RX 6600                      | Não implementada                         | Benchmark pendente                                                         | Não validada           |

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
- recibo CI completo do SHA `b39e3eb` (run `31296404993`) com lint, tipos, Vitest, build, source/offline, Deno e banco local aprovados; o E2E passou após um retry;
- HEAD `651f6cc` com instrumentação sanitizada de diagnósticos Gemini; testes direcionados 11/11.

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

Obrigatório:

```text
Prettier/ESLint
Svelte/TypeScript
Vitest
Deno
source/offline gates
Supabase local + pgTAP
build
Chromium E2E
```

O recibo [`Validate current head`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31296404993) do SHA `b39e3eb55caec06a4cd40aa20833634c32a463d3` terminou com sucesso em 9 de agosto de 2026. Ele registra 236 arquivos/938 testes Vitest, source/offline, Deno e 35 arquivos/434 testes de banco. O E2E teve 4 testes aprovados e 1 flake na primeira tentativa, aprovado no retry; a flakiness permanece uma ressalva.

No HEAD `651f6cc`, o deploy `31297694093` terminou com sucesso e registra `process-ocr` `ACTIVE`. O `Verify OCR staging` `31297743219` foi aprovado no environment `staging`, mas seu estado terminal e artifact estão `UNKNOWN` por indisponibilidade da API do GitHub; não há aprovação de OCR. Os testes direcionados passaram 11/11. A suíte local completa permanece `BLOCKED` somente pelo fixture desktop não rastreado.

### Supabase

- No SHA `b39e3eb`, `Deploy Supabase staging` (`31296564374`) e `Verify Supabase staging` (`31296568886`) terminaram com sucesso, enquanto `Verify OCR staging` (`31296573162`) falhou. No HEAD `651f6cc`, `Deploy Supabase staging` (`31297694093`) terminou com `process-ocr` `ACTIVE`; `Verify OCR staging` (`31297743219`) tem environment aprovado, mas estado terminal/artifact `UNKNOWN`, sem aprovação de OCR.
- O `Verify Supabase staging` verde mais recente é o run `31296568886` do SHA `b39e3eb` e cobriu somente Auth, RLS e Storage; ele não aprova OCR ou serviços reais.
- aplicar todas as migrations em banco limpo;
- executar pgTAP completo, incluindo o novo teste de ownership/takeover do lease;
- confirmar que `authenticated` não executa os finalizadores legados revogados;
- regenerar `src/lib/types/database.ts` pelo schema implantado;
- comparar o tipo gerado com o espelho versionado;
- verificar bucket, RLS e funções no projeto real.

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

- smoke real de imagem sintética;
- lote visual multipágina;
- PDF textual com zero chamadas;
- omissão, duplicação e truncamento;
- rate limit temporário e quota diária real;
- cancelamento e retomada;
- confirmação administrativa de billing desativado.

### Cloudflare e dispositivos

- criar projetos Pages;
- configurar origem canônica e redirects;
- validar headers, fallback, PWA e rollback;
- instalar em celular e tablet;
- testar PDF grande em hardware real;
- manter conteúdo privado fora da Cloudflare.

## Critérios de promoção

```text
Validate current head no SHA `b39e3eb`: PASS com ressalva de flakiness E2E
Verify OCR staging no SHA `651f6cc`: environment aprovado; estado terminal/artifact UNKNOWN
Supabase limpo e pgTAP: PASS
Tipos gerados pelo schema implantado: PASS
OAuth drive.file real: PASS
Pasta Fichário Digital: PASS
Upload retomável: PASS
Picker até 50 MiB: PASS
Picker acima de 50 MiB por ranges: PASS
Crash copy→stage reconciliado: PASS
Lease/takeover de descritores em duas sessões: PASS
Feed de mudanças: PASS
Ausência, reconexão e conflitos: PASS
Migração e rollback: PASS
OCR Gemini multipágina real: PASS
Quota temporária e diária: PASS
Cloudflare produção: PASS
Headers, fallback e PWA: PASS
Celular e tablet: PASS ou risco registrado
Nenhum conteúdo privado na Cloudflare: PASS
Billing desativado, backup e rollback: PASS
```

O worker desktop pode ser tratado como marco posterior se a release declarar explicitamente essa limitação. A ausência de defeitos conhecidos não substitui os recibos acima.
