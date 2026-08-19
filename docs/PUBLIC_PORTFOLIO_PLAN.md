# Versão pública de portfólio — plano completo

**Status:** planejamento aprovado para implementação.  
**Branch de planejamento:** `plan/public-portfolio`.  
**Objetivo:** tornar o Fichário Digital completo acessível a terceiros, mantendo uma única aplicação e uma única infraestrutura principal, com roteamento de serviços por perfil de usuário.  
**Base inicial:** `main` em `0f3357c5cda628e7b9b7921a3eb3db506e7204b7`.  
**Revisão:** 19 de agosto de 2026.

## 1. Escopo

A versão pública **não é uma demo**. Qualquer usuário cadastrado deve poder usar as funcionalidades normais do Fichário:

- criar conta, entrar e sair;
- conectar o próprio Google Drive;
- importar imagens e PDFs reais;
- preservar originais no Drive;
- extrair texto nativo de PDFs;
- executar OCR quando necessário;
- organizar biblioteca, cadernos, hierarquia e tags;
- usar busca textual, fuzzy e semântica;
- abrir o documento original e destacar ocorrências;
- revisar OCR;
- usar filas, retomada, cancelamento e processamento assíncrono;
- consultar estados de processamento;
- exportar dados suportados;
- usar PWA, responsividade, acessibilidade e demais recursos normais.

O produto continua sendo um projeto pessoal de portfólio, com expectativa de baixo tráfego. Não há objetivo de oferecer SLA, escala comercial, pagamentos ou suporte de SaaS.

## 2. Decisão arquitetural principal

Não manter duas cópias da aplicação, dois bancos ou dois Supabase apenas para diferenciar o uso pessoal do público.

A arquitetura alvo é:

```text
Fichário Digital
│
├── mesmo frontend
├── mesmo Supabase Auth
├── mesmo PostgreSQL + RLS
├── mesmo Storage privado
├── mesmas filas
├── mesmo Google Drive OAuth
│
└── perfil server-side do usuário
    │
    ├── owner
    │   ├── Gemini OCR principal
    │   ├── Gemini fallback
    │   ├── embeddings de maior qualidade/configuração pessoal
    │   └── worker desktop permitido
    │
    └── public
        ├── OCR público de maior franquia, inicialmente Azure
        ├── fallback gratuito opcional
        ├── embeddings públicos configurados
        └── worker desktop pessoal proibido
```

A diferença entre usuário pessoal e usuário público é **quais recursos o backend permite consumir**, não onde a aplicação roda.

## 3. Perfil de usuário

`public.app_users` deixa de representar somente uma allowlist manual e passa a representar o estado da conta dentro do Fichário.

Campos planejados:

```text
user_id
is_active
provider_profile = owner | public
created_at
updated_at
```

O nome `provider_profile` é deliberadamente simples. Se no futuro houver necessidade, pode ser decomposto em `ocr_profile`, `embedding_profile` e permissões específicas.

### `owner`

Perfil confiável, destinado à conta pessoal/autorizada:

- mantém o comportamento atual de Gemini;
- pode usar fallback Gemini configurado;
- pode usar worker desktop quando habilitado;
- pode receber novas capacidades premium/pessoais sem oferecê-las automaticamente a visitantes.

### `public`

Perfil padrão para novos cadastros:

- usa o provider público de OCR;
- não usa a chave Gemini pessoal como fallback;
- não pode reivindicar jobs do worker desktop pessoal;
- continua com todas as funcionalidades do produto;
- pode ter limites operacionais de proteção, sem transformar o produto numa demo.

### Autoridade

O frontend **nunca** escolhe o perfil nem o provider.

É proibido aceitar algo como:

```json
{ "provider": "gemini" }
```

ou:

```json
{ "profile": "owner" }
```

em requests de usuário.

A Edge Function deve obter `auth.uid()`, ler o perfil confiável no banco e derivar internamente o plano de execução.

## 4. Migração da allowlist para cadastro público

A função `is_authorized_user()` pode continuar existindo e continuar protegendo as RLS policies. O significado passa a ser:

```text
usuário autenticado + app_users.is_active = true
```

Isso preserva a maior parte do banco existente.

### Contas existentes

Na migration inicial:

- contas que já existem em `app_users` são preservadas e recebem `provider_profile = owner`;
- nenhuma conta existente perde acesso;
- depois do deploy o administrador pode reclassificar qualquer conta confiável como `public` se desejar.

### Novas contas

A criação do registro de aplicação acontece na primeira sessão autenticada válida por uma RPC idempotente `SECURITY DEFINER` sem argumentos de usuário ou perfil:

```text
ensure_current_app_user()
 -> usa somente auth.uid()
 -> cria app_users apenas se ainda não existir
 -> is_active = true
 -> provider_profile = public
```

A RPC não aceita `user_id`, `provider_profile` nem flags de privilégio do cliente. `ON CONFLICT DO NOTHING` preserva contas existentes: um `owner` não é rebaixado e uma conta inativa não consegue reativar a si própria. O retorno só confirma perfis ativos conhecidos.

Essa abordagem foi escolhida em vez de um trigger global em `auth.users` porque mantém a fronteira vinculada a uma sessão autenticada, evita acoplamento desnecessário com fixtures/migrations que criam usuários de teste e continua garantindo que o self-service só possa produzir `public`.

Desativar uma conta continua sendo possível com `is_active = false`.

## 5. Cadastro e autenticação

Implementar self-service no frontend usando Supabase Auth:

- cadastro por e-mail e senha;
- confirmação de e-mail conforme configuração do projeto;
- login;
- logout;
- recuperação de senha em etapa posterior da mesma entrega;
- mensagens de erro simples;
- nenhum passo manual de allowlist.

O fluxo esperado é:

```text
Criar conta
 -> Supabase Auth
 -> se houver sessão imediata: ensure_current_app_user()
 -> se exigir confirmação: confirmar e-mail e abrir a primeira sessão
 -> ensure_current_app_user() cria app_users(public)
 -> conectar Google Drive
 -> usar o Fichário completo
```

`loadAuthorizedSession()` continua conferindo que a conta está ativa e executa o enrollment idempotente antes da verificação. O nome interno de funções antigas pode ser refatorado depois; não é necessário reescrever toda a sessão para a primeira entrega.

## 6. Google Drive

Não separar OAuth por perfil apenas porque o site é público.

Todos os usuários usam o mesmo OAuth client do Fichário e cada usuário autoriza **o próprio Google Drive**. Os refresh tokens continuam separados por `user_id` e protegidos no backend.

Requisitos:

- preservar escopo mínimo `drive.file`;
- nunca usar o Drive do owner para armazenar arquivos de terceiros;
- continuar com PKCE e `state` de uso único;
- RLS/contratos devem impedir leitura do token/estado de outro usuário;
- Picker, upload retomável, ranges, change feed, conflitos e exclusão Drive-first permanecem iguais.

## 7. Roteamento de OCR por perfil

Criar uma camada server-side pequena e testável que transforme um perfil em uma rota de providers.

Contrato conceitual:

```ts
type ProviderProfile = 'owner' | 'public';

type OcrRoute = {
	providers: readonly OcrProviderId[];
	desktopAllowed: boolean;
};
```

Rota inicial:

```text
owner:
Gemini principal
 -> Gemini fallback
   -> Azure fallback opcional
     -> fila persistente

public:
Azure/public provider
 -> fallback gratuito opcional
   -> fila persistente
```

A implementação deve ser fail-closed:

- perfil inválido não vira `owner`;
- falha ao consultar perfil não libera Gemini;
- usuário sem registro ativo não processa OCR;
- provider público indisponível não cai silenciosamente na chave pessoal.

## 8. Azure como provider público inicial

A documentação existente em `AZURE_OCR_FALLBACK_IMPLEMENTATION.md` continua sendo a referência técnica do adapter Azure.

A versão pública muda somente sua posição no roteamento: para `public`, Azure deixa de ser terceiro fallback e passa a ser candidato principal.

O adapter deve continuar genérico e isolado porque o lifecycle de serviços Azure pode mudar.

Requisitos já aprovados:

- nenhuma chave Azure no frontend;
- `POST` + polling quando a edição escolhida for assíncrona;
- geometria convertida para o contrato interno atual;
- uma página Azure por operação quando exigido pelo serviço;
- scheduler próprio;
- transformação temporária provider-specific para tamanho/formato;
- erros sanitizados;
- nenhuma ativação automática de SKU pago;
- telemetria por provider.

Antes de ativar Azure em produção, revalidar preços, limites F0 e serviço recomendado pela Microsoft. A aplicação deve depender da interface interna, não de tipos Azure espalhados pelo orquestrador.

## 9. Embeddings e busca semântica

Busca semântica continua disponível para usuários públicos.

A mesma ideia de perfil deve ser aplicada a qualquer API externa de embeddings se a cota pessoal precisar ser protegida.

Primeira etapa:

- manter o pipeline atual;
- introduzir uma decisão server-side de perfil antes de compartilhar uma chave pessoal com usuários públicos;
- se for necessário trocar o modelo público, versionar explicitamente modelo/dimensão;
- nunca misturar vetores incompatíveis no mesmo índice sem versão.

A implementação de OCR por perfil não deve bloquear a entrega inicial de cadastro; embeddings podem receber o mesmo mecanismo em uma etapa imediatamente posterior.

## 10. Worker desktop

O computador pessoal nunca deve se tornar infraestrutura pública involuntária.

Regra server-side:

```text
provider_profile = owner  -> pode usar desktop, se dispositivo autorizado
provider_profile = public -> desktop proibido
```

Essa regra deve ser aplicada no banco/worker claim, não apenas escondendo a UI.

## 11. Isolamento multiusuário

A arquitetura atual já usa `auth.uid() = user_id` e Storage privado por pasta de UID. A abertura de cadastro exige transformar isso em gate formal de release.

Teste obrigatório com duas contas A e B:

1. A importa um documento real;
2. B tenta ler documento, páginas, tags, notebooks, OCR, embeddings e jobs de A;
3. B tenta obter signed URLs de A;
4. B tenta mutações com IDs de A;
5. B tenta busca textual/fuzzy/semântica por conteúdo exclusivo de A;
6. B tenta acionar OCR/reprocessamento usando IDs de A;
7. todas as superfícies falham sem revelar conteúdo sensível.

Também auditar todas as funções `SECURITY DEFINER` e qualquer uso de `service_role` em Edge Functions.

## 12. Limites simples de proteção

O projeto não precisa de infraestrutura de SaaS, mas um visitante não deve conseguir drenar toda a franquia em minutos.

Controles mínimos server-side:

- rate limiting global por provider;
- concorrência limitada por conta para jobs caros;
- tamanho máximo operacional de request já existente preservado;
- opcionalmente teto generoso de páginas/import concorrente para perfil público;
- backoff e fila persistente;
- circuit breaker quando o free tier acabar;
- nenhuma migração automática para billing.

Os limites devem ser calibrados para permitir uso real. Eles existem contra abuso evidente, não para criar uma experiência artificialmente limitada.

## 13. Exclusão, retenção e privacidade

Antes de divulgar o link publicamente:

- permitir desconectar Drive;
- permitir solicitar exclusão de conta;
- invalidar tokens/sessões;
- remover metadados e derivados do Supabase de forma idempotente;
- deixar claro que os originais permanecem no Drive do próprio usuário conforme o fluxo existente;
- manter limpeza de temporários e imports abandonados.

Adicionar páginas simples de Privacidade e Termos/Uso experimental, sem reintroduzir telas repetitivas de consentimento.

## 14. Landing pública

A raiz pode apresentar o projeto, mas depois do login o usuário entra no produto real.

Estrutura:

```text
/
├── apresentação do projeto
├── screenshots/funcionalidades
├── stack e diferenciais
├── GitHub
├── Entrar
└── Criar conta

/app/*
└── Fichário completo
```

A landing não deve duplicar a aplicação nem usar dados falsos como substituto do produto.

## 15. Telemetria

Registrar provider e perfil de execução sem registrar conteúdo privado.

Mínimo desejado:

- `provider_profile` efetivo;
- provider/modelo usado;
- chamadas/páginas;
- rate limit/quota;
- fallback;
- latência;
- bytes processados;
- necessidade de revisão.

Isso permite comparar Gemini pessoal e Azure público e decidir futuramente se o provider público precisa mudar.

## 16. Sequência de implementação

### Fase 1 — fundação de conta/perfil

1. adicionar `provider_profile` a `app_users`;
2. preservar contas existentes como `owner`;
3. criar RPC idempotente de auto-enrollment que só produz `public`;
4. função/RPC de leitura server-side do perfil;
5. testes pgTAP de enrollment, RLS e fail-closed;
6. adicionar cadastro no serviço de Auth;
7. adicionar UI de cadastro.

### Fase 2 — roteamento OCR

1. criar tipos genéricos de provider/profile;
2. resolver perfil por `auth.uid()` dentro da Edge Function;
3. encapsular rota Gemini atual como `owner` sem regressão;
4. implementar adapter Azure;
5. colocar Azure como principal para `public`;
6. impedir fallback public -> Gemini pessoal;
7. telemetria por rota;
8. testes unitários e integração.

### Fase 3 — recursos adicionais por perfil

1. bloquear worker desktop para `public` no backend;
2. revisar embeddings externos e separar quota se necessário;
3. calibrar limites públicos simples;
4. painel/telemetria operacional mínima.

### Fase 4 — readiness público

1. E2E de cadastro;
2. E2E A vs B;
3. Drive real com duas contas;
4. importação real e OCR Azure;
5. busca textual/fuzzy/semântica;
6. highlight real;
7. cancelamento/retomada;
8. exclusão/desconexão;
9. revisão de secrets/logs;
10. páginas públicas e documentação.

## 17. Gates de segurança

A versão pública não está pronta enquanto qualquer item abaixo falhar:

- usuário pode escolher provider por request;
- perfil desconhecido recebe rota owner;
- public pode usar chave Gemini pessoal;
- public pode reivindicar worker desktop;
- B consegue observar recurso de A;
- Edge Function confia em `user_id` enviado pelo cliente quando poderia usar `auth.uid()`;
- service role contorna ownership sem validação explícita;
- secret aparece no bundle, log ou resposta;
- provider sem quota ativa billing automaticamente.

## 18. Definição de pronto

A versão pública está pronta quando:

- qualquer pessoa consegue criar uma conta válida;
- novos usuários recebem `provider_profile = public` automaticamente na primeira sessão autenticada;
- contas pessoais selecionadas permanecem `owner`;
- ambos usam o mesmo frontend, Supabase, banco e Google OAuth;
- cada usuário usa somente o próprio Drive e os próprios dados;
- todas as funcionalidades normais continuam disponíveis;
- OCR de `owner` mantém a rota Gemini atual;
- OCR de `public` usa a rota pública configurada sem tocar na quota pessoal;
- worker pessoal permanece inacessível a `public`;
- testes de isolamento A/B passam;
- fluxos reais de importação, OCR, busca e highlight passam;
- a aplicação continua fail-closed em falhas de perfil/provider.

## 19. Primeira entrega de código

A implementação deve começar sem alterar de uma vez todo o `process-ocr`:

1. migration de perfil + auto-enrollment;
2. helper server-side puro para validar e resolver `owner | public`;
3. testes desse helper;
4. integração de leitura do perfil no OCR mantendo Gemini para `owner`;
5. somente depois inserir Azure na rota `public`.

Essa ordem permite fazer commits pequenos, manter o comportamento atual intacto e provar a fronteira de autorização antes de acrescentar um novo provider.
