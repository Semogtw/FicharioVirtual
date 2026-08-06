# Operação 100% gratuita

**Última verificação das franquias externas:** 2 de agosto de 2026  
**Política interna de OCR atualizada:** 6 de agosto de 2026

Este documento define as regras para manter o Fichário Virtual em R$ 0. Valores e franquias externas podem mudar; por isso, a aplicação deve falhar de forma segura quando uma cota termina, nunca migrar automaticamente para cobrança.

## 1. Política obrigatória

1. Não vincular faturamento ao projeto da Gemini Developer API.
2. Manter o Supabase no plano Free.
3. Manter a Vercel no plano Hobby pessoal e não comercial.
4. Não iniciar testes gratuitos de planos pagos.
5. Não cadastrar cartão apenas para aumentar limites.
6. Não implementar fallback automático para API paga.
7. Pausar trabalhos ao receber erros de cota do provedor.
8. Preservar arquivo e estado para retomada posterior.
9. Não impor uma franquia diária artificial de OCR dentro do Fichário.
10. Revisar este documento antes de cada implantação relevante.
11. Exibir no aplicativo um painel informativo de uso e estado das cotas.

## 2. Supabase Free

Referência oficial: https://supabase.com/pricing

Na data de verificação, o plano Free inclui:

- 500 MB de banco por projeto;
- 1 GB de Storage;
- 5 GB de egress e 5 GB de egress em cache;
- 500.000 invocações de Edge Functions;
- até 50 MB por arquivo;
- dois projetos ativos por organização;
- pausa após uma semana de inatividade.

Limites relevantes das Edge Functions:

- 256 MB de memória;
- 150 segundos de duração no plano Free;
- 2 segundos de CPU por requisição;
- até 100 funções no projeto;
- bundle menor quando implantado pela Management API do que pela CLI.

Referências:

- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/storage/uploads/file-limits

### Regras internas

- A Edge Function somente orquestra autenticação, rede e banco.
- Renderização de PDF e transformação de imagem ficam no navegador quando necessário.
- Arquivos importados pelo aplicativo terão limite próprio de 20 MB para PDF e 12 MB para imagem antes da preparação até que os fluxos Drive e OCR por PDF sejam validados para valores maiores.
- O bucket terá limite de MIME e tamanho explícitos.
- Avisos de capacidade aparecem em 70%, 85% e 95% do Storage estimado.
- Ao atingir o limite, novas importações temporárias são bloqueadas até exportação ou limpeza.

### Capacidade aproximada

Com páginas preparadas entre 400 e 900 KB, 1 GB comporta aproximadamente 1.100 a 2.500 imagens temporárias ou persistidas pela arquitetura antiga. PDFs variam muito; o painel deve mostrar os documentos que mais ocupam espaço em vez de prometer um número fixo.

### Projeto pausado

O aplicativo deve reconhecer indisponibilidade do Supabase e mostrar:

> O arquivo está temporariamente adormecido por inatividade. Restaure o projeto no painel do Supabase e tente novamente.

Nenhum dado local pendente deve ser apagado nesse estado.

## 3. Gemini Developer API

Referências oficiais:

- https://ai.google.dev/gemini-api/docs/pricing?hl=pt-br
- https://ai.google.dev/gemini-api/docs/billing?hl=pt-BR
- https://ai.google.dev/gemini-api/docs/rate-limits?hl=pt-br

Na data de verificação:

- contas novas podem começar no nível gratuito;
- somente determinados modelos ficam disponíveis gratuitamente;
- os limites variam por modelo e projeto;
- cotas são avaliadas por RPM, TPM e RPD;
- conteúdo enviado no nível gratuito pode ser usado para melhorar produtos do Google;
- vincular uma conta de faturamento ativa muda o projeto para um nível pago.

### Configuração obrigatória

- Criar o projeto sem faturamento vinculado.
- Gerar uma chave exclusiva para este aplicativo.
- Guardar a chave apenas em segredo do Supabase.
- Configurar o modelo por `OCR_MODEL_PRIMARY`, nunca diretamente no código.
- Escolher um modelo multimodal rápido explicitamente disponível no nível gratuito no dia da implantação.
- Registrar a data e o modelo selecionado em `docs/DEPLOYMENT.md`.

### Controles internos permitidos

```text
OCR simultâneo:                 1 ou 2, conforme estabilidade medida
Intervalo após erro 429:        conforme Retry-After ou política conservadora
Tentativas automáticas extras:  finitas por lote
Limite diário interno:          nenhum
Reprocessamento de qualidade:   inativo até benchmark e política explícita
```

A cota real do projeto Gemini é a única autoridade de capacidade. O Fichário pode contar páginas, lotes, chamadas, tokens estimados e tentativas para telemetria, mas esses contadores não podem bloquear uma chamada que ainda seja aceita pelo provedor.

O cliente nunca deve entrar em repetição infinita. O número de tentativas por lote continua finito, mesmo sem franquia diária interna.

### PDFs e economia de requisições

- PDF com texto nativo não chama o Gemini.
- PDF misto envia somente páginas sem texto suficiente.
- PDF escaneado curto pode ser enviado inteiro quando os limites seguros de entrada, saída, arquivo e tempo permitirem.
- PDF longo ou denso usa lotes adaptativos, inicialmente em torno de 20 a 40 páginas.
- O resultado continua persistido por página, mesmo quando várias páginas compartilham a mesma chamada.
- Páginas omitidas, duplicadas ou truncadas não podem ser tratadas como sucesso integral.

O tamanho do lote não é uma franquia. Ele deve variar para reduzir requisições sem comprometer integridade, retomada ou limite de saída.

### Modelos e manuscritos

`OCR_MODEL_PRIMARY` é o único modelo ativo no fluxo atual e atende texto impresso, manuscrito e conteúdo misto.

`OCR_MODEL_QUALITY` existe como configuração reservada, mas não é lido pela Edge Function `process-ocr` e não representa hoje um OCR especializado em manuscritos. Ele só pode ser ativado após benchmark com páginas reais, teste de staging, política explícita de reprocessamento e confirmação de que não haverá cobrança ou fallback silencioso.

Um modelo especializado em manuscritos só deve ser integrado se superar o Gemini principal em um conjunto representativo da escrita da usuária e continuar compatível com custo zero, privacidade e implantação.

### Estados de cota

- `retryable`: limite curto de minuto ou falha temporária;
- `blocked_quota`: cota real do provedor ou acesso gratuito indisponível;
- `needs_review`: respostas inválidas, truncadas ou conteúdo incerto;
- `failed`: erro permanente de arquivo ou configuração.

## 4. Vercel Hobby

Referências oficiais:

- https://vercel.com/docs/plans/hobby
- https://vercel.com/pricing

Na data de verificação, Hobby é gratuito para projetos pessoais e não comerciais. Entre os recursos publicados estão CDN, deploy automático, 100 GB mensais de transferência rápida, 1 milhão de Edge Requests e recursos limitados de Functions.

O Fichário Virtual usará a Vercel principalmente para arquivos estáticos. Banco, OCR e arquivos privados não passam por Vercel Functions.

### Regras internas

- Não ativar Pro Trial.
- Não usar Vercel Blob para a biblioteca.
- Não depender de Image Optimization; miniaturas são geradas pelo cliente.
- Usar build estático.
- Manter dados privados fora do bundle e dos logs de build.
- Se o plano Hobby atingir uma franquia, aguardar renovação ou migrar o frontend para outro host gratuito; não fazer upgrade automático.

## 5. pdf-inspector e PDF.js

O `pdf-inspector` tem licença MIT e roda no navegador via WebAssembly. Ele evita OCR quando o PDF já contém texto e identifica páginas específicas que precisam de leitura automática.

Referência: https://github.com/firecrawl/pdf-inspector

PDF.js é usado para renderização seletiva, visualização e preparação de páginas quando o fluxo de PDF completo não for adequado. Ambos são carregados sob demanda e não geram custo externo.

## 6. Painel de uso no aplicativo

A tela Configurações deve mostrar:

- páginas analisadas hoje;
- lotes e chamadas enviados ao OCR hoje;
- tentativas e chamadas com erro de cota;
- trabalhos pendentes e bloqueados pelo provedor;
- tamanho médio dos lotes;
- armazenamento estimado;
- tamanho dos maiores documentos;
- modelo OCR principal configurado;
- estado inativo ou ativo do modelo de qualidade;
- versão do prompt;
- aviso de privacidade do provedor gratuito;
- estado de consentimento;
- data da última revisão das franquias.

Os valores são informativos. O painel não deve apresentar um contador local como “páginas restantes”, salvo quando esse número vier de uma cota real e confiável do provedor.

O painel não precisa consultar APIs administrativas privadas dos provedores. Pode combinar contadores internos com limites verificados manualmente no AI Studio, deixando clara a origem de cada valor.

## 7. Variáveis e segredos

### Frontend público

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

### Supabase Edge Function secrets desejados

```text
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_QUALITY
OCR_PROMPT_VERSION
```

`OCR_MODEL_QUALITY` é opcional e permanece sem efeito enquanto não houver fluxo de qualidade aprovado.

### Incompatibilidade transitória da implementação atual

A implementação existente ainda exige `OCR_DAILY_HARD_LIMIT` e bloqueia localmente em `claim_ocr_job`. Isso contradiz a política aprovada neste documento e deve ser removido por migration e alteração da Edge Function antes de declarar a mudança concluída.

Enquanto essa implementação não for corrigida, não registrar a ausência do limite interno como `PASS` e não tratar um valor artificialmente alto como solução definitiva.

`GEMINI_API_KEY` nunca deve aparecer em `.env.example` como valor real, no frontend, em commits ou em logs.

## 8. Revisão periódica

Antes de cada release:

- confirmar que Supabase ainda está em Free;
- confirmar que Vercel ainda está em Hobby;
- confirmar que o projeto Gemini não tem billing account;
- verificar o modelo e os rate limits ativos no AI Studio;
- confirmar que não existe franquia diária bloqueante criada pelo Fichário;
- confirmar ausência de secrets no bundle;
- testar comportamento ao simular `429`, truncamento e falta de Storage;
- testar integridade de lote com página omitida ou duplicada;
- atualizar a data no início deste documento.

## 9. Plano de saída

Se algum serviço deixar de ser gratuito:

- **Vercel:** migrar o build estático para Cloudflare Pages, GitHub Pages ou outro host gratuito compatível.
- **Supabase:** exportar PostgreSQL e Storage; avaliar outro Postgres/Storage gratuito ou instalação pessoal.
- **Gemini:** implementar outro `OcrProvider`, mantendo o contrato de resultado por página e o restante do sistema inalterados.

Nenhuma migração é automática. O aplicativo continua permitindo visualizar, pesquisar e exportar documentos já processados enquanto o serviço afetado estiver indisponível.

A decisão detalhada está em `docs/superpowers/specs/2026-08-06-provider-only-ocr-quota-and-adaptive-batching-design.md`.
