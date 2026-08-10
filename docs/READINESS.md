# Prontidão do Fichário Virtual

_Atualizado em 10 de agosto de 2026._

Esta página não publica porcentagem global. Prontidão significa evidência reproduzível no mesmo SHA, não quantidade de arquivos implementados.

## Matriz atual

| Dimensão                     | Código                                          | Evidência externa                                                                        | Estado                                    |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| Produto privado              | Implementado                                    | CI completo `f87e1edc` / run `31333367357`                                               | Bloqueado para release                    |
| OCR Gemini por lotes         | Implementado e corrigido                        | `process-ocr` provider + parser HTTP 200 em `31333418948`; runtime `ACTIVE v19`          | Fronteira aprovada                        |
| Quota exclusiva do provedor  | Implementada                                    | `429 gemini_daily_quota` observado na chamada direta protegida                           | Evidenciada                               |
| Google Drive-first           | Implementado                                    | Conta Google real ainda pendente                                                         | Não promovido                             |
| Picker até 50 MiB            | Implementado                                    | Navegadores reais pendentes                                                              | Não promovido                             |
| Picker acima de 50 MiB       | Implementado por referência/ranges              | PDF grande real pendente                                                                 | Não promovido                             |
| Recuperação crash copy→stage | Implementada com `appProperties`                | Contratos no CI; interrupção real pendente                                               | Não promovida                             |
| Lease de descritores         | Implementado e conectado ao orquestrador        | Banco local no CI; duas sessões reais pendentes                                          | Não promovido                             |
| Cloudflare Pages             | Infra + pipeline staging implementados          | Projeto provisionado; artifact/gates prontos; primeiro Direct Upload real ainda pendente | Preparado para primeiro deploy de staging |
| Worker desktop               | Runtime local e plano de controle implementados | Hardware/modelo e pareamento web reais pendentes                                         | Implementado, não validado em hardware    |
| RX 6600                      | Caminho de benchmark planejado                  | Benchmark Vulkan/ROCm/CPU pendente                                                       | Não validada                              |

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
- exceções `verify_jwt=false` limitadas ao callback OAuth, ao resgate de pareamento e ao endpoint do worker, cada uma com autenticação própria no código;
- callback OAuth protegido por origem, `state` de uso único e PKCE;
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

### Desktop OCR local

O worker já não é apenas uma fronteira backend. O repositório contém:

- dispositivos com credencial própria, revogação e autenticação por digest;
- claim/source/renew/complete protegidos por lease e conclusão idempotente;
- configuração local fail-closed e diretórios XDG privados;
- SQLite de spool transacional, dead letter e reenvio antes de buscar trabalho novo;
- download HTTPS de fonte com MIME, tamanho e SHA-256 vinculados ao lease;
- renovação de lease durante inferências longas;
- polling/backoff e shutdown por sinal;
- credencial no Secret Service via `secret-tool`;
- lock imutável de modelo e verificação de digest;
- backend `OllamaOcrEngine` restrito a loopback;
- instalador de desenvolvimento e unidade `systemd --user` sem root;
- comandos de configuração, modelo, pareamento, status e despareamento;
- tela **Configurações > Computadores** para listar, atualizar, revogar e renomear dispositivos.

Isso ainda não equivale a benchmark aprovado. Modelo padrão, backend e desempenho precisam ser validados no hardware alvo, e o pareamento web precisa de smoke real sem depender de token manual.

### Cloudflare e artifact de deployment

- projetos Pages `fichario-virtual` e `fichario-models` já existem;
- `fichario-virtual` usa production branch `main`, build estático para `build/`, cache de build e Node 22 na configuração do projeto;
- auto-deploy Git continua desligado durante desenvolvimento concorrente;
- preview do Pages possui URL + publishable key do Supabase staging;
- production do Pages não possui URL/chave de backend: isso é fail-closed deliberado porque ainda não existe Supabase de produção;
- nenhum segredo backend deve ser cadastrado no Pages;
- `_headers` libera somente as origens adicionais atualmente exigidas pelo loader do Google Picker e pelo tráfego browser do Drive;
- contrato de deployment exige essas origens;
- o build valida o `_headers` realmente emitido;
- fallback SPA, manifesto e service worker são verificados;
- artifact schema 2 inclui manifesto, `SHA256SUMS`, snapshot mínimo de package/lock e todos os verificadores usados no deploy;
- `check-deployment-artifact.mjs` exige cobertura exata de checksum, rejeita extras inesperados, symlinks e traversal;
- o empacotador compartilhado `tools/deploy/package-static-artifact.sh` é staging-only e usa timestamp reproduzível derivado de `SOURCE_DATE_EPOCH` ou do próprio commit, evitando que o relógio do runner altere o manifesto;
- um gate offline dedicado impede regressão para timestamp dependente do relógio;
- o workflow `Build deployable Fichário staging artifact` é manual, usa somente o environment `staging` e produz `fichario-static-<sha>-staging`;
- o workflow `Deploy validated staging artifact to Cloudflare Pages` é manual, artifact-only, usa `staging-deploy` e não faz checkout/rebuild;
- o deploy baixa somente o artifact do run e SHA informados, revalida manifesto e checksums e publica na branch Pages `staging`;
- Wrangler fica pinado e recebe o SHA validado como `--commit-hash`;
- o workflow consome `pages-deploy-detailed`, confere projeto, ambiente, production branch configurada, SHA, deployment ID e URL;
- o gate HTTP roda contra a URL única devolvida pelo deployment, usando checker carregado dentro do artifact e coberto por SHA-256;
- gates offline impedem reintroduzir checkout/rebuild, SHA frouxo, publicação sem checksum ou referências prematuras a infraestrutura de produção inexistente;
- **não existe workflow de artifact/deploy de produção habilitado no estado atual**; produção só deve voltar ao pipeline depois de backend, environments, credenciais e contrato próprios existirem;
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
- `4a5c1f4` / run `31386594216`: frontend + source + Edge passaram novamente; os passos restantes ainda precisavam de recibo terminal no momento da observação;
- a sequência posterior removeu suporte prematuro a produção, tornou o artifact staging self-verifying, extraiu um empacotador único e adicionou guard de timestamp reproduzível.

Não usar recibos parciais ou cancelados como substituto de um CI completo do SHA que for promovido. Eles mostram somente os gates que efetivamente chegaram a terminar.

## Pendências funcionais em código

As grandes fronteiras do site, Drive-first, OCR e worker desktop já possuem implementação. As pendências principais que ainda justificam código são encontradas conforme os gates e smokes reais revelarem diferenças entre contrato e ambiente. Em particular:

- completar qualquer integração de pareamento web do worker que ainda exija token manual no fluxo real;
- definir, após benchmark, um perfil/modelo local suportado em vez de assumir antecipadamente CPU, Vulkan ou ROCm;
- manter o pipeline de produção ausente enquanto não houver backend e configuração de produção reais;
- corrigir regressões descobertas pelos gates do SHA candidato, sem tratar cancelamentos por commits novos como PASS ou falha funcional.

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
- ainda não existe backend Supabase de produção; produção deve continuar ausente do pipeline executável.

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

### Worker desktop

- parear um computador real pelo fluxo web;
- confirmar armazenamento/rotação da credencial no keyring real;
- interromper processo/rede durante claim e complete e comprovar retomada pelo spool;
- validar modelo e backend em hardware real;
- medir CPU e, quando aplicável, Vulkan/ROCm na RX 6600;
- documentar o perfil suportado com base em benchmark, não em hipótese.

### Cloudflare

Ainda faltam:

- confirmar/provisionar em `staging-deploy` um `CLOUDFLARE_API_TOKEN` de escopo mínimo e `CLOUDFLARE_ACCOUNT_ID` sem revelar valores;
- gerar um artifact staging do SHA candidato final;
- executar o primeiro workflow `Deploy validated staging artifact to Cloudflare Pages`;
- obter PASS automático do checker contra a URL única retornada pelo Wrangler;
- executar smoke real de autenticação/PWA/Drive;
- atualizar `APP_ORIGIN` quando a origem escolhida estiver estável;
- criar domínio canônico e redirects somente depois do preview;
- ensaiar rollback;
- criar backend, environments, credenciais e contratos de produção antes de reintroduzir um caminho de deploy de produção.

## Critérios de promoção

```text
CI funcional completo histórico `f87e1edc` / `31333367357`: PASS
Supabase fix `31333367356`: PASS
Sonda OCR `31333418948`: PASS para fronteira provider/parser
Cleanup `31333977753`: PASS
Cloudflare Pages: projetos e build base provisionados
Preview Pages: Supabase staging configurado
Production Pages: backend ausente por fail-closed
Artifact schema 2 + checksums + verificadores pinados: PASS em código
Empacotador staging compartilhado + timestamp reproduzível: PASS em código
Workflow staging artifact-only + identidade Wrangler + gate HTTP exato: PASS em código
Gate offline dos workflows e da reprodutibilidade: PASS em código; recibo terminal do SHA candidato ainda necessário
Credenciais Cloudflare em staging-deploy: PENDING até confirmação operacional
Primeiro Direct Upload: PENDING
Gate HTTP real: PENDING
CI global terminal do SHA candidato final: PENDING
Fluxo OCR normal com persistência: PENDING
Tipos gerados pelo schema implantado: PENDING
OAuth drive.file real: PENDING
Picker/ranges e crash recovery reais: PENDING
Pareamento/worker/hardware reais: PENDING
Backend e ambientes de produção: PENDING
Celular e tablet: PENDING ou risco registrado
Nenhum conteúdo privado na Cloudflare: requisito obrigatório
```

O worker desktop pode ser tratado como marco operacional posterior se a release declarar explicitamente a limitação. A ausência de defeitos conhecidos não substitui os recibos acima.
