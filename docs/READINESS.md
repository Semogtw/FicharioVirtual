# Prontidão do Fichário Virtual

_Atualizado em 10 de agosto de 2026._

Esta página não publica porcentagem global. Prontidão significa evidência reproduzível no mesmo SHA, não quantidade de arquivos implementados.

## Matriz atual

| Dimensão                     | Código                                   | Evidência externa                                                                                         | Estado                         |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Produto privado              | Implementado                             | CI completo `f87e1edc` / run `31333367357`                                                               | Bloqueado para release         |
| OCR Gemini por lotes         | Implementado e corrigido                 | `process-ocr` provider + parser HTTP 200 em `31333418948`; runtime `ACTIVE v19`                          | Fronteira aprovada             |
| Quota exclusiva do provedor  | Implementada                             | `429 gemini_daily_quota` observado na chamada direta protegida                                           | Evidenciada                    |
| Google Drive-first           | Implementado                             | Conta Google real ainda pendente                                                                          | Não promovido                  |
| Picker até 50 MiB            | Implementado                             | Navegadores reais pendentes                                                                               | Não promovido                  |
| Picker acima de 50 MiB       | Implementado por referência/ranges       | PDF grande real pendente                                                                                  | Não promovido                  |
| Recuperação crash copy→stage | Implementada com `appProperties`         | Contratos no CI; interrupção real pendente                                                                | Não promovida                  |
| Lease de descritores         | Implementado e conectado ao orquestrador | Banco local no CI; duas sessões reais pendentes                                                           | Não promovido                  |
| Cloudflare Pages             | Infra + pipeline de promoção implementados | projeto provisionado; artifact/gates prontos; primeiro Direct Upload real ainda pendente                | Preparado para primeiro deploy |
| Worker desktop               | Fronteira backend implementada           | Worker local e hardware pendentes                                                                         | Não iniciado                   |
| RX 6600                      | Não implementada                         | Benchmark pendente                                                                                        | Não validada                   |

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
- gates que proíbem secrets no frontend e workflows inseguros;
- recibo CI completo do SHA `f87e1edc` / run `31333367357` com frontend, source/offline, Chromium, Deno/Edge e banco local aprovados;
- deploy Supabase do mesmo checkpoint concluído em `31333367356`;
- sonda protegida `31333418948`: chamada anônima rejeitada, service-role presente sem revelar valor e `process-ocr` retornando `provider_ok` HTTP 200;
- cleanup `31333977753`: `process-ocr` `ACTIVE v19`, sonda temporária removida e funções não relacionadas preservadas.

### Importação, OCR e Drive-first

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
- telemetria de páginas, lotes, chamadas e tentativas;
- OAuth start/callback e token efêmero;
- refresh token somente no backend;
- escopo `drive.file`;
- Google Picker explícito;
- PDF externo grande por cópia controlada + ranges sem download integral;
- `PDFDataRangeTransport` com validação estrita;
- reconciliação por `appProperties` se o navegador morrer entre cópia e staging;
- leases renováveis e takeover somente após expiração;
- renovação forte antes do upload de derivado compartilhado;
- finalização atômica e recuperação de resposta perdida;
- feed paginado de mudanças, reconexão, fila idempotente e conflitos;
- migrations, pgTAP, contratos TypeScript e gates Deno/segurança.

### Cloudflare e artifact de deployment

- projetos Pages `fichario-virtual` e `fichario-models` já existem;
- `fichario-virtual` usa production branch `main`, build estático para `build/`, cache de build e Node 22;
- auto-deploy Git continua desligado durante desenvolvimento concorrente;
- preview do Pages possui URL + publishable key do Supabase staging;
- production do Pages não possui URL/chave de backend: isso é fail-closed deliberado porque ainda não existe Supabase de produção;
- nenhum segredo backend foi cadastrado no Pages;
- `_headers` libera somente as origens adicionais atualmente exigidas pelo loader do Google Picker e pelo tráfego browser do Drive;
- contrato de deployment exige essas origens;
- o build valida o `_headers` realmente emitido;
- fallback SPA, manifesto e service worker são verificados;
- artifact schema 2 inclui manifesto, `SHA256SUMS`, snapshot mínimo de package/lock e o checker HTTP do mesmo SHA;
- `check-deployment-artifact.mjs` exige cobertura exata de checksum, rejeita extras inesperados, symlinks e traversal;
- o workflow `Deploy validated artifact to Cloudflare Pages` é manual, artifact-only e não faz checkout/rebuild;
- staging publica usando credenciais de `staging-deploy`; produção é reservada para `production-deploy`;
- produção ainda exige `CLOUDFLARE_PRODUCTION_DEPLOY_ENABLED=true` no environment protegido, além de um artifact `production` válido;
- Wrangler fica pinado e recebe o SHA validado como `--commit-hash`;
- o workflow consome `pages-deploy-detailed`, confere projeto, ambiente, production branch, SHA, deployment ID e URL;
- o gate HTTP roda contra a URL única devolvida pelo deployment, usando o checker carregado dentro do artifact e coberto por SHA-256;
- produção também testa o alias `fichario-virtual.pages.dev`;
- um gate offline específico impede regressões que reintroduzam checkout/rebuild, SHA frouxo ou publicação sem checksum;
- projeto separado de modelos permanece documentado e R2 continua desativado por padrão.

## Checkpoints de deploy já produzidos

### `baac227473c0613b2ffd0de9c7e52ad738def040`

Foi usado como primeiro snapshot reproduzível enquanto a `main` recebia features paralelas:

- workspace gerado pelo repo `Offline-Toolchains`;
- fragmentos, archive, `package.json` e lockfile verificados por SHA-256;
- `build/` gerado com Supabase staging real;
- artifact staging passou `test:deployment:artifact`;
- gates específicos de deployment passaram;
- não contém URL/chave fake de desenvolvimento.

Esse SHA **não é release aprovado**: seu CI global permaneceu vermelho por regressões paralelas de OCR/desktop/viewer.

### Checkpoints posteriores do pipeline

O pipeline de deploy foi endurecido em commits posteriores. Nos recibos observados durante esse trabalho:

- `146591a` / run `31385276495`: frontend + source gates passaram antes de execução posterior ser cancelada por commits novos;
- `1af2ed0` / run `31385577030`: frontend + source + Edge passaram; banco ainda executava quando commits novos interromperam o recibo;
- `26e768d` / run `31386249873`: frontend + source + Edge passaram e Supabase CLI foi instalado; banco estava executando quando a `main` avançou;
- `4a5c1f4` / run `31386594216`: frontend + source + Edge passaram novamente, confirmando inclusive o gate de isolamento `staging-deploy` / `production-deploy`; os passos restantes ainda precisavam de recibo terminal no momento desta atualização.

Não usar esses recibos parciais como substituto de um CI completo do SHA que for promovido. Eles servem para mostrar que o caminho de deployment novo está passando pelos gates que de fato chegaram a executar.

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

O recibo funcional [`31333367357`](https://github.com/Semogtw/FicharioVirtual/actions/runs/31333367357) do SHA `f87e1edc47268b4e0d2ea0742dac690c96d93646` terminou com **success** e continua sendo a evidência funcional completa mais forte já registrada.

Para a promoção do site, o SHA candidato final precisa obter recibo terminal equivalente depois das mudanças de deployment atuais. Não misturar um artifact novo com recibo verde de SHA antigo.

### Supabase

- deploy do fix `31333367356`: **success**;
- sonda OCR `31333418948`: **success**, com `process-ocr` `provider_ok` HTTP 200 e tentativa direta separada em `429 gemini_daily_quota`;
- cleanup `31333977753`: **success**;
- `process-ocr` permanece registrado como `ACTIVE v19` no checkpoint consultado;
- o fluxo normal de OCR com página/job, Storage e persistência real ainda precisa de smoke antes de release;
- antes do host real, `APP_ORIGIN` precisa apontar para a origem correta do rollout;
- ainda não existe backend Supabase de produção, portanto artifact e promoção `production` devem continuar bloqueados.

### Google Drive

- configurar projeto Google Cloud e redirect URI final;
- executar OAuth com a conta autorizada;
- validar criação/reconexão da raiz;
- testar upload retomável, Picker, mudanças, ausência e conflito;
- testar PDF real acima de 50 MiB por ranges;
- interromper/recarregar entre cópia e staging e confirmar reconciliação por `appProperties`;
- abrir duas sessões e validar expiração/takeover do lease;
- executar migração/rollback com originais reais;
- confirmar que tokens não aparecem em logs, URL ou navegador;
- cadastrar o trio público do Picker de forma atômica quando as credenciais Google forem provisionadas;
- no preview real, verificar se o Picker exige origem adicional de `frame-src`; ampliar CSP somente com evidência da origem exata bloqueada.

### Gemini

A fronteira request/provider/parser foi validada em staging. Ainda faltam o fluxo normal de página/job com persistência, lote visual multipágina real, PDF textual confirmando zero chamadas, cancelamento/retomada no produto e confirmação administrativa de billing/fallback pago desativado.

### Cloudflare

Ainda faltam:

- provisionar em `staging-deploy` um `CLOUDFLARE_API_TOKEN` de escopo mínimo e `CLOUDFLARE_ACCOUNT_ID`;
- gerar um artifact staging do SHA candidato final;
- executar o primeiro workflow `Deploy validated artifact to Cloudflare Pages`;
- obter PASS automático do checker contra a URL única retornada pelo Wrangler;
- executar smoke real de autenticação/PWA/Drive;
- atualizar `APP_ORIGIN` quando a origem escolhida estiver estável;
- criar domínio canônico e redirects somente depois do preview;
- ensaiar rollback;
- criar ambientes/backend/configuração de produção antes de habilitar `production-deploy`.

O conector administrativo Cloudflare consegue configurar o projeto e emitir o JWT temporário do serviço de upload, mas a camada de integração não permite usar esse JWT como autenticação dos endpoints `/pages/assets/*`. Uma sonda com token novo e os headers esperados pelo Wrangler continua retornando `403` / código Cloudflare `8000013` (`Authorization failed`). Não exportar ou persistir o JWT para tentar contornar essa fronteira.

## Critérios de promoção

```text
CI funcional completo histórico `f87e1edc` / `31333367357`: PASS
Supabase fix `31333367356`: PASS
Sonda OCR `31333418948`: PASS para fronteira provider/parser
Cleanup `31333977753`: PASS
Cloudflare Pages: projetos e build base provisionados
Preview Pages: Supabase staging configurado
Production Pages: backend ausente por fail-closed
Artifact schema 2 + checksums + checker pinado: PASS em código
Workflow artifact-only + identidade Wrangler + gate HTTP exato: PASS em código
Gate offline do workflow de promoção: PASS nos recibos que chegaram ao source gate
Credenciais Cloudflare em staging-deploy: PENDING
Primeiro Direct Upload: PENDING
Gate HTTP real: PENDING
CI global terminal do SHA candidato final: PENDING
Fluxo OCR normal com persistência: PENDING
Tipos gerados pelo schema implantado: PENDING
OAuth drive.file real: PENDING
Picker/ranges e crash recovery reais: PENDING
Backend e ambientes de produção: PENDING
Celular e tablet: PENDING ou risco registrado
Nenhum conteúdo privado na Cloudflare: requisito obrigatório
```

O worker desktop pode ser tratado como marco posterior se a release declarar explicitamente essa limitação. A ausência de defeitos conhecidos não substitui os recibos acima.
