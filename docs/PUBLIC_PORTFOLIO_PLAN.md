# Versão pública de portfólio — plano completo

**Status:** planejamento; esta branch não altera o runtime.  
**Branch:** `plan/public-portfolio`.  
**Objetivo:** publicar o Fichário Digital completo para terceiros poderem usar e avaliar o projeto, sem tratá-lo como SaaS comercial nem dimensioná-lo para alto tráfego.  
**Base inicial:** `main` em `0f3357c5cda628e7b9b7921a3eb3db506e7204b7`.  
**Revisão:** 19 de agosto de 2026.

## 1. Escopo correto

A versão pública **não é uma demo limitada**. Ela deve oferecer a mesma experiência funcional do Fichário Digital normal:

- criar conta e entrar;
- conectar o próprio Google Drive;
- importar imagens e PDFs;
- preservar originais no Drive;
- extrair texto nativo de PDFs;
- executar OCR quando necessário;
- organizar biblioteca, cadernos, hierarquia e tags;
- usar busca textual, fuzzy e semântica;
- abrir o documento original e destacar ocorrências;
- revisar OCR;
- usar filas, retomada, cancelamento e processamento assíncrono;
- consultar estados de processamento;
- exportar os dados suportados;
- usar PWA, responsividade, acessibilidade e demais recursos do produto normal.

A diferença é operacional: trata-se de um **site público de portfólio com baixa expectativa de tráfego**, não de um serviço comercial que promete escala, SLA, suporte ou armazenamento ilimitado.

## 2. Não objetivos

Não planejar nesta etapa:

- pagamentos, planos ou cobrança;
- organizações, equipes ou compartilhamento entre contas;
- SLA ou suporte comercial;
- alta disponibilidade multi-região;
- filas dimensionadas para milhares de usuários concorrentes;
- capacidade elástica paga;
- moderação complexa de conteúdo;
- analytics de marketing invasivo;
- transformar o Google Drive do autor em armazenamento de terceiros;
- permitir que usuários públicos usem a cota, o worker desktop ou os secrets da instância pessoal.

O planejamento deve, porém, impedir que um visitante acidental ou malicioso cause custo, vazamento ou indisponibilidade fácil.

## 3. Arquitetura recomendada: mesmo código, ambientes separados

A recomendação é **não abrir a instância pessoal atual diretamente**. O código pode continuar único, mas a versão pública deve ter infraestrutura e credenciais próprias.

```text
Repositório único
│
├── perfil privado
│   ├── Supabase privado existente
│   ├── credenciais Google existentes
│   ├── Gemini de maior qualidade
│   └── worker desktop pessoal
│
└── perfil público/portfolio
    ├── Supabase público dedicado
    ├── OAuth Google próprio
    ├── providers/cotas próprias
    ├── Azure OCR como rota pública preferencial
    └── sem worker desktop pessoal
```

### Motivos

1. um erro de RLS ou de função pública não alcança os dados pessoais existentes;
2. a quota OCR pública não consome a quota privada;
3. revogar ou derrubar o ambiente público não afeta o uso pessoal;
4. testes destrutivos e migrations podem ser validados separadamente;
5. credenciais OAuth e origins ficam mais simples de auditar;
6. a versão pública pode usar providers de qualidade/custo diferentes sem condicionais espalhadas pelo produto.

Se no futuro a manutenção de dois projetos se mostrar desnecessária, a arquitetura pode ser consolidada; o primeiro lançamento deve favorecer isolamento.

## 4. Perfis de deployment

Criar um conceito explícito de perfil de deployment, resolvido apenas por configuração confiável de ambiente.

Exemplo:

```text
APP_DEPLOYMENT_PROFILE=private | public_portfolio
```

O perfil não pode ser selecionado por query string, header do usuário ou parâmetro de request.

### `private`

Preserva o comportamento atual:

- allowlist fail-closed;
- providers atuais;
- worker desktop quando habilitado;
- política pessoal de processamento;
- credenciais e projeto atuais.

### `public_portfolio`

Habilita:

- cadastro público;
- contas comuns ativas por padrão depois da validação exigida;
- providers públicos independentes;
- limites de proteção conservadores;
- textos legais mínimos;
- nenhuma dependência do computador pessoal do autor.

O restante da UI e das funcionalidades deve continuar igual, salvo diferenças necessárias de conta, limites e provider.

## 5. Cadastro e autenticação pública

A maior mudança funcional em relação ao estado privado é substituir a allowlist manual por onboarding self-service **somente no ambiente público**.

### Requisitos

- cadastro por e-mail ou provedor suportado pelo Supabase;
- confirmação de e-mail quando aplicável;
- login e logout;
- recuperação de acesso;
- criação automática do registro de aplicação do usuário;
- status de conta: `active`, `suspended`, `deleted` (ou equivalente);
- impedir que o frontend possa ativar a si próprio por uma RPC privilegiada;
- preservar `auth.uid()` como autoridade de ownership.

### `app_users`

No ambiente privado, `app_users` continua funcionando como allowlist.

No ambiente público, `app_users` passa a representar o estado da conta e deve ser criado automaticamente por trigger/RPC segura após o cadastro.

`is_authorized_user()` pode ser generalizado para uma verificação de conta ativa, sem remover a proteção das policies existentes.

### Antiabuso simples

Como a expectativa de uso é baixa, não é necessário criar uma plataforma anti-fraude. Ainda assim:

- usar os controles de rate limit disponíveis no Auth;
- exigir confirmação de e-mail se isso reduzir abuso sem prejudicar muito a experiência;
- limitar criação excessiva de contas por mecanismos do provedor;
- nunca confiar apenas no frontend para quotas ou autorização.

## 6. Isolamento de dados

A versão pública deve preservar o modelo de segurança atual baseado em ownership.

### Obrigatório antes do lançamento

Auditar todas as tabelas, views, RPCs, Storage policies e Edge Functions para provar:

```text
usuário A != usuário B
=> A não lê, busca, enumera, altera, deleta, processa ou obtém URL de recurso de B
```

Isso inclui informação indireta, como:

- contagem de documentos;
- existência de IDs;
- embeddings;
- texto OCR;
- resultados de busca;
- jobs e batches;
- telemetria de uso;
- tokens/estado do Drive;
- nomes de arquivos;
- signed URLs.

### Teste de segurança obrigatório

Criar E2E com duas contas reais de staging:

1. A importa um documento;
2. B tenta acessar IDs conhecidos de A por todas as superfícies públicas;
3. B tenta pesquisa exata e semântica por conteúdo exclusivo de A;
4. B tenta obter original/thumbnail/signed URL;
5. B tenta mutações e chamadas de RPC com IDs de A;
6. todas falham sem revelar conteúdo ou metadados sensíveis.

## 7. Google Drive no ambiente público

A versão pública deve manter o modelo Drive-first completo: cada pessoa conecta **o próprio Google Drive**.

### Separação obrigatória

Criar credenciais OAuth específicas para o deployment público:

```text
PUBLIC_GOOGLE_CLIENT_ID=<portfolio>
GOOGLE_CLIENT_ID=<portfolio>
GOOGLE_CLIENT_SECRET=<portfolio>
GOOGLE_DRIVE_REDIRECT_URI=<portfolio>
```

Não reutilizar refresh tokens nem client secrets da instância pessoal quando a separação puder ser feita.

### Fluxos a validar

- OAuth start/callback;
- PKCE e `state` de uso único;
- conexão e reconexão;
- Picker;
- criação da pasta gerenciada;
- upload retomável;
- importação por referência/range;
- change feed;
- conflitos;
- exclusão Drive-first;
- revogação da integração;
- uma conta nunca obtém token ou IDs privados de outra.

O escopo deve permanecer mínimo (`drive.file`) salvo decisão arquitetural posterior explicitamente documentada.

## 8. Estratégia de OCR para o portfolio público

O deployment público deve usar uma rota de OCR independente da privada e favorecer **franquia/robustez sobre qualidade máxima**, porque seu papel principal é permitir avaliação funcional do projeto.

### Decisão inicial

Usar Azure como primeira opção do perfil público, atrás da camada genérica de provider já planejada em `AZURE_OCR_FALLBACK_IMPLEMENTATION.md`.

O plano atual do repositório para Azure Vision Read v3.2 já descreve:

- adapter isolado;
- operação assíncrona `POST` + polling;
- geometria por palavra;
- normalização para o contrato interno;
- rate limiting;
- derivação específica para limites de tamanho/formato;
- telemetria e falhas sanitizadas.

### Importante: lifecycle do Azure

Em agosto de 2026, a documentação oficial da Microsoft continua permitindo Azure Vision no tier gratuito F0 e informa 20 chamadas/minuto para o free tier da Read API, mas também declara que a API OCR Read v3.2 é legado e recomenda Document Intelligence Read para documentos digitais/digitalizados.

Portanto:

- **não acoplar o produto a `azure_vision`**;
- implementar `OcrProvider` genérico primeiro;
- manter Azure Vision v3.2 como candidato inicial de alta franquia somente enquanto o F0 continuar vantajoso;
- antes de implementação/deploy, revalidar quota, lifecycle e disponibilidade regional;
- se Document Intelligence ou outro OCR gratuito passar a oferecer melhor combinação de franquia e estabilidade, trocar apenas o adapter/configuração;
- nenhum provider público pode fazer fallback silencioso para SKU pago.

### Roteamento recomendado por perfil

Privado, inicialmente:

```text
Gemini primário
 -> Gemini fallback
   -> Azure fallback quando/como aprovado
     -> fila persistente
```

Público:

```text
Azure/public OCR provider
 -> segundo provider gratuito opcional, se configurado
   -> fila persistente
```

Por padrão, **não usar a chave Gemini privada como fallback da versão pública**.

Se Gemini for necessário para garantir alguma capacidade específica, usar projeto/chave exclusivos do ambiente público e quota independente.

### Qualidade

Resultados Azure podem marcar `needs_review` com mais frequência sem ser considerado erro do produto. O objetivo é manter:

- transcrição útil;
- highlight geométrico funcional;
- busca textual/fuzzy operacional;
- estados de revisão honestos.

A interface não deve prometer que todos os providers entregam qualidade idêntica.

## 9. Busca semântica e embeddings

A versão pública deve manter busca semântica completa.

O provider de embeddings também deve ser isolado por deployment quando houver API externa envolvida.

Estratégia:

1. preservar o contrato interno atual de embeddings e pgvector;
2. usar credencial/projeto público próprio para o provider atual, se a franquia for suficiente;
3. não reutilizar secret privado por conveniência;
4. se houver necessidade de trocar o modelo na versão pública, validar dimensionalidade, compatibilidade de índice e necessidade de re-embedding;
5. nunca misturar embeddings produzidos por modelos incompatíveis no mesmo índice sem versão explícita.

O planejamento não aprova uma troca de modelo de embedding sem benchmark. O requisito é isolamento de quota e paridade funcional.

## 10. Filas e limites de proteção

Baixa expectativa de tráfego permite limites simples, mas eles devem existir no servidor.

### Objetivo

Evitar que um único visitante ou script consuma toda a franquia gratuita em minutos.

### Controles mínimos

- limite de uploads/importações concorrentes por conta;
- limite de jobs OCR concorrentes por conta;
- scheduler global por provider;
- rate limit respeitando RPM/RPS oficial com margem;
- tamanho máximo operacional para upload público;
- quantidade máxima de páginas por documento público, se necessária para proteção;
- teto de bytes temporários no Storage;
- backoff e fila persistente quando provider estiver sem capacidade;
- circuit breaker quando a quota gratuita acabar;
- nenhuma transição automática para billing.

### Filosofia

Os limites devem ser generosos o suficiente para um recrutador/visitante testar documentos reais e restritivos o bastante para evitar abuso óbvio.

Não transformar a UI em painel de quotas. Mostrar mensagens simples como:

- `O processamento está aguardando disponibilidade.`
- `Este arquivo é grande demais para a versão pública.`

Valores finais devem ser calibrados com o free tier real antes do deploy e mantidos em configuração, não hardcoded na interface.

## 11. Retenção e limpeza

Mesmo com baixo tráfego, usuários públicos podem abandonar dados.

### Google Drive

O original é propriedade do próprio usuário e permanece no Drive dele segundo a semântica atual.

### Supabase

Definir retenção para dados auxiliares do ambiente público:

- derivados temporários continuam sendo removidos após processamento terminal quando possível;
- imports abandonados devem ser recuperados ou limpos por job seguro;
- sessões e staging expirados devem ser coletados;
- uma conta excluída deve ter metadados e derivados removidos após a política definida;
- nunca apagar arquivo no Drive sem passar pelo fluxo Drive-first autorizado.

Não criar limpeza global que ignore ownership.

## 12. Exclusão de conta e revogação

Uma versão acessível publicamente precisa de um fluxo mínimo de encerramento de conta.

A interface deve permitir:

- desconectar Google Drive;
- revogar credenciais/tokens armazenados;
- solicitar exclusão da conta;
- remover metadados e derivados pertencentes ao usuário;
- invalidar sessões;
- deixar claro o comportamento dos arquivos já existentes no Google Drive.

A exclusão deve ser idempotente e testada contra falha parcial.

## 13. Privacidade, termos e UX pública

Não é necessário reintroduzir os antigos consentimentos repetitivos.

Adicionar páginas curtas e estáveis:

- `Privacidade`;
- `Termos de uso`/`Uso experimental`;
- contato/repositório.

A UI deve informar de forma concisa que:

- o projeto é um portfolio/experimento pessoal;
- não há SLA;
- arquivos podem ser processados por providers externos conforme a política;
- o usuário controla os originais no próprio Drive;
- o serviço pode impor limites e ficar temporariamente sem processamento quando as franquias gratuitas acabarem.

Consentimentos específicos só devem aparecer quando tecnicamente/legalmente necessários, não em toda navegação.

## 14. Landing pública sem reduzir o produto

A raiz pública pode apresentar o projeto antes do login, mas depois do cadastro o usuário entra no **produto real**, não numa demo.

Estrutura sugerida:

```text
/
├── apresentação curta
├── screenshots/fluxos reais
├── stack e diferenciais
├── link para GitHub
├── Entrar
└── Criar conta

/app/*
└── aplicação completa autenticada
```

O marketing deve ser leve: o objetivo é permitir que quem recebe o link entenda rapidamente o projeto e o teste.

## 15. Configuração e secrets

Separar variáveis por ambiente. Nenhum secret privado deve ser copiado automaticamente para o portfolio.

### Frontend público

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
PUBLIC_GOOGLE_CLIENT_ID
PUBLIC_GOOGLE_PICKER_API_KEY
PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER
PUBLIC_DEPLOYMENT_PROFILE=public_portfolio
```

### Backend público

```text
APP_ORIGIN
APP_DEPLOYMENT_PROFILE=public_portfolio
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_DRIVE_REDIRECT_URI
AZURE_VISION_ENDPOINT
AZURE_VISION_KEY
OCR_PUBLIC_PROVIDER=azure_vision
OCR_PUBLIC_RPM=<revalidated>
OCR_PUBLIC_MAX_IMAGE_BYTES=<revalidated>
```

Além dos secrets do provider de embeddings público, se necessário.

### Nunca expor ao frontend

- service role;
- Azure key;
- Gemini key;
- Google client secret;
- refresh tokens;
- worker credentials;
- qualquer secret da instância privada.

## 16. Banco e migrations

O projeto público deve nascer de migrations reproduzíveis, não de clone manual do banco privado.

Procedimento:

1. criar projeto Supabase público vazio;
2. aplicar todas as migrations versionadas;
3. executar pgTAP/gates;
4. não copiar linhas de usuários/documentos da produção pessoal;
5. configurar apenas dados estruturais necessários;
6. validar RLS antes de cadastrar usuários reais.

Qualquer migration nova para o modo público deve continuar compatível com o perfil privado ou ser explicitamente protegida por uma estratégia de configuração que não fragmente o schema sem necessidade.

## 17. Observabilidade mínima

Não é necessário um painel SaaS completo.

Registrar o suficiente para diagnosticar:

- usuários ativos agregados;
- imports iniciados/concluídos/falhos;
- jobs OCR por provider;
- erros de quota/rate limit;
- tamanho de fila;
- bytes temporários;
- falhas de OAuth;
- erros de Edge Functions;
- chamadas/uso de embeddings quando disponível.

Nunca registrar texto OCR, conteúdo de documentos, tokens ou respostas brutas de providers em telemetria geral.

## 18. Segurança específica para publicação

Antes do release público, revisar especialmente:

- funções `SECURITY DEFINER`;
- grants para `anon` e `authenticated`;
- policies de Storage;
- CORS;
- validação de origin;
- JWT em Edge Functions;
- URLs assinadas;
- parâmetros de RPC com IDs fornecidos pelo cliente;
- OAuth callback/state/PKCE;
- endpoints que usam service role;
- SSRF em providers externos e importação;
- limites de payload;
- logs e sanitização de erros;
- possibilidade de chamar workers/queues sem ownership;
- secrets presentes em builds e Actions.

Manter scanner de secrets e gates existentes.

## 19. Testes obrigatórios

### Paridade funcional

No ambiente público de staging, testar o mesmo fluxo real exigido da aplicação privada:

1. cadastro;
2. login;
3. conexão Google Drive;
4. import de imagem;
5. import de PDF textual;
6. import de PDF digitalizado;
7. OCR real pelo provider público;
8. persistência por página;
9. biblioteca/cadernos/tags;
10. busca exata;
11. fuzzy;
12. busca semântica;
13. highlight sobre documento;
14. revisão;
15. cancelamento e retomada;
16. exclusão Drive-first;
17. logout/login e persistência;
18. desconexão do Drive;
19. exclusão de conta.

### Multiusuário

Executar com pelo menos duas contas diferentes e provar isolamento em todos os fluxos.

### Provider público

- sucesso real Azure/provider escolhido;
- manuscrito em português;
- imagem degradada;
- geometria/highlight;
- 429;
- timeout;
- 5xx;
- quota esgotada;
- arquivo acima do limite do provider;
- fila e retry sem loop;
- nenhum fallback para cobrança;
- nenhum uso da chave privada.

### Gates de código

Manter no mesmo SHA, conforme scripts disponíveis no repositório:

```bash
pnpm format:check
pnpm check
pnpm lint
pnpm test:unit
pnpm check:edge
pnpm check:offline
pnpm test:db
pnpm build
pnpm test:e2e
```

Além dos workflows reais específicos de staging/deploy já existentes.

## 20. Deploy e domínios

Recomendação:

```text
portfolio/public -> domínio principal do Fichário
private          -> subdomínio/endereço não divulgado ou deployment separado
```

Os nomes exatos podem ser decididos na implementação.

O ambiente público deve ter:

- Cloudflare Pages próprio ou configuração de ambiente própria;
- Supabase próprio;
- OAuth redirect próprio;
- secrets próprios;
- staging público separado antes de produção.

Deploy da versão pública não pode alterar automaticamente a infraestrutura privada.

## 21. Plano de implementação

### Fase 0 — inventário e contratos

- [ ] mapear toda superfície que chama `is_authorized_user()`;
- [ ] listar Edge Functions e RPCs com assumptions de conta única/allowlist;
- [ ] inventariar secrets externos e separar por perfil;
- [ ] confirmar quais recursos dependem do Gemini além de OCR;
- [ ] confirmar limites atuais do provider público escolhido;
- [ ] definir limites operacionais iniciais do portfolio.

### Fase 1 — deployment profile

- [ ] introduzir `APP_DEPLOYMENT_PROFILE` validado fail-closed;
- [ ] preservar comportamento privado por default;
- [ ] adicionar testes para os dois perfis;
- [ ] remover condicionais de provider espalhadas e centralizar configuração.

### Fase 2 — Auth público

- [ ] implementar self-service signup/login;
- [ ] auto-provisionar `app_users` somente no perfil público;
- [ ] status de conta e suspensão;
- [ ] recuperação de acesso;
- [ ] exclusão de conta;
- [ ] testes de RLS com duas contas.

### Fase 3 — infraestrutura pública

- [ ] novo projeto Supabase;
- [ ] migrations limpas;
- [ ] novo OAuth Google;
- [ ] novo host/origin;
- [ ] secrets separados;
- [ ] staging público.

### Fase 4 — OCR provider abstraction

- [ ] concluir interface genérica `OcrProvider`;
- [ ] encapsular Gemini atual sem regressão;
- [ ] implementar adapter público Azure ou substituto revalidado;
- [ ] scheduler/rate limit específico do provider;
- [ ] geometria, telemetria e erros comuns;
- [ ] impedir fallback público para secret privado.

### Fase 5 — embeddings públicos

- [ ] separar credencial/projeto de embedding;
- [ ] manter mesmo contrato/index quando possível;
- [ ] validar busca semântica real;
- [ ] garantir que quota pública não afete privada.

### Fase 6 — limites e operação

- [ ] limites server-side de concorrência/tamanho;
- [ ] circuit breaker gratuito;
- [ ] limpeza de staging abandonado;
- [ ] mensagens UX simples para limite/quota;
- [ ] observabilidade sanitizada.

### Fase 7 — landing e acabamento público

- [ ] landing curta;
- [ ] entrar/criar conta;
- [ ] privacidade e termos mínimos;
- [ ] manter app completo após login;
- [ ] revisar mobile/PWA/acessibilidade/animações.

### Fase 8 — validação final

- [ ] todos os gates locais;
- [ ] migrations + pgTAP em projeto limpo;
- [ ] fluxo real end-to-end público;
- [ ] duas contas e ataques cross-tenant;
- [ ] OAuth real;
- [ ] OCR real;
- [ ] busca semântica real;
- [ ] falhas/quota/retry;
- [ ] confirmar billing desabilitado/SKU gratuito;
- [ ] confirmar que nenhuma credencial privada está no deployment público;
- [ ] revisão manual completa da UX.

## 22. Definição de pronto

A versão pública só deve ser considerada pronta quando uma pessoa sem acesso prévio ao projeto puder:

1. abrir o site;
2. entender o que é;
3. criar uma conta;
4. conectar o próprio Drive;
5. importar um documento real;
6. aguardar processamento;
7. encontrá-lo por busca textual/fuzzy/semântica;
8. abrir o original e ver a ocorrência marcada;
9. organizar e revisar o documento;
10. voltar em outra sessão e encontrar seus próprios dados;
11. nunca conseguir acessar dados de outra conta;
12. fazer tudo isso sem consumir secrets, storage ou quotas da instância pessoal.

O site continua sendo um projeto de portfólio mesmo oferecendo a aplicação inteira. A baixa expectativa de tráfego permite evitar complexidade de SaaS, mas não justifica compartilhar secrets pessoais nem afrouxar isolamento de dados.

## 23. Relação com documentação existente

Este arquivo é o documento canônico para a versão pública de portfólio.

Ele deve ser lido junto com:

- `CURRENT_STATUS.md` — estado da aplicação privada/main;
- `PROJECT_SPEC.md` — arquitetura do produto;
- `AZURE_OCR_FALLBACK_IMPLEMENTATION.md` — detalhes do adapter Azure;
- `FREE_TIER_OPERATIONS.md` — política de operação sem cobrança;
- `GOOGLE_DRIVE_SETUP.md` — integração Drive;
- `DEPLOYMENT.md` — deploy;
- `TESTING.md` — gates e validação;
- `OCR_FAILURE_MATRIX.md` — semântica de falhas OCR.

Enquanto esta branch for apenas de planejamento, nenhum item acima deve ser descrito como já implementado na versão pública.