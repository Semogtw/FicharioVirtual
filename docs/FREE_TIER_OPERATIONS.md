# Operação 100% gratuita

**Última verificação:** 2 de agosto de 2026

Este documento define as regras para manter o Fichário Virtual em R$ 0. Valores e franquias externas podem mudar; por isso, a aplicação deve falhar de forma segura quando uma cota termina, nunca migrar automaticamente para cobrança.

## 1. Política obrigatória

1. Não vincular faturamento ao projeto da Gemini Developer API.
2. Manter o Supabase no plano Free.
3. Manter a Vercel no plano Hobby pessoal e não comercial.
4. Não iniciar testes gratuitos de planos pagos.
5. Não cadastrar cartão apenas para aumentar limites.
6. Não implementar fallback automático para API paga.
7. Pausar trabalhos ao receber erros de cota.
8. Preservar arquivo e estado para retomada posterior.
9. Revisar este documento antes de cada implantação relevante.
10. Exibir no aplicativo um painel de uso e estado das cotas.

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
- Renderização de PDF e transformação de imagem ficam no navegador.
- Arquivos importados pelo aplicativo terão limite próprio de 20 MB para PDF e 12 MB para imagem antes da preparação.
- O bucket terá limite de MIME e tamanho explícitos.
- Avisos de capacidade aparecem em 70%, 85% e 95% do Storage estimado.
- Ao atingir o limite, novas importações são bloqueadas até exportação ou limpeza.

### Capacidade aproximada

Com páginas preparadas entre 400 e 900 KB, 1 GB comporta aproximadamente 1.100 a 2.500 imagens. PDFs variam muito; o painel deve mostrar os documentos que mais ocupam espaço em vez de prometer um número fixo.

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

### Limites internos iniciais

```text
OCR simultâneo:                 2
Intervalo após erro 429:        conforme Retry-After ou 60 s
Tentativas automáticas extras:  2
Limite diário interno:          100 páginas
Reprocessamento de qualidade:   1 simultâneo
```

O limite diário é de segurança e pode ser reduzido conforme a cota real mostrada no AI Studio. Ele não deve ser aumentado acima da franquia ativa.

### Estados de cota

- `retryable`: limite curto de minuto ou falha temporária;
- `blocked_quota`: limite diário ou acesso gratuito indisponível;
- `needs_review`: duas respostas inválidas;
- `failed`: erro permanente de arquivo ou configuração.

O cliente nunca deve entrar em repetição infinita.

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

PDF.js é usado somente para renderizar páginas sem texto e para o visualizador. Ambos são carregados sob demanda e não geram custo externo.

## 6. Painel de uso no aplicativo

A tela Configurações deve mostrar:

- páginas enviadas ao OCR hoje;
- chamadas com erro de cota;
- trabalhos pendentes e bloqueados;
- armazenamento estimado;
- tamanho dos maiores documentos;
- modelo OCR configurado;
- versão do prompt;
- aviso de privacidade do provedor gratuito;
- estado de consentimento;
- data da última revisão das franquias.

O painel não precisa consultar APIs administrativas privadas dos provedores. Pode combinar contadores internos com valores configurados.

## 7. Variáveis e segredos

### Frontend público

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

### Supabase Edge Function secrets

```text
GEMINI_API_KEY
OCR_MODEL_PRIMARY
OCR_MODEL_QUALITY
OCR_PROMPT_VERSION
OCR_DAILY_HARD_LIMIT
```

`GEMINI_API_KEY` nunca deve aparecer em `.env.example` como valor real, no frontend, em commits ou em logs.

## 8. Revisão periódica

Antes de cada release:

- confirmar que Supabase ainda está em Free;
- confirmar que Vercel ainda está em Hobby;
- confirmar que o projeto Gemini não tem billing account;
- verificar o modelo e os rate limits ativos no AI Studio;
- confirmar ausência de secrets no bundle;
- testar comportamento ao simular `429` e falta de Storage;
- atualizar a data no início deste documento.

## 9. Plano de saída

Se algum serviço deixar de ser gratuito:

- **Vercel:** migrar o build estático para Cloudflare Pages, GitHub Pages ou outro host gratuito compatível.
- **Supabase:** exportar PostgreSQL e Storage; avaliar outro Postgres/Storage gratuito ou instalação pessoal.
- **Gemini:** implementar outro `OcrProvider`, mantendo `OcrResultV1` e o restante do sistema inalterados.

Nenhuma migração é automática. O aplicativo continua permitindo visualizar, pesquisar e exportar documentos já processados enquanto o serviço afetado estiver indisponível.
