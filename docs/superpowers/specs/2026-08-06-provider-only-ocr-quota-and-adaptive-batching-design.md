# OCR sem limite interno e processamento adaptativo

**Data:** 6 de agosto de 2026  
**Status:** decisão aprovada; implementação pendente  
**Escopo:** estratégia de OCR, cotas, agrupamento de PDFs e escolha de modelo

## 1. Objetivo

O Fichário Virtual é de uso pessoal por uma única conta autorizada. O aplicativo não deve impor uma franquia diária artificial de páginas ou tentativas de OCR. A capacidade disponível deve ser determinada exclusivamente pelas cotas reais do provedor configurado, mantendo apenas controles técnicos de concorrência, backoff, segurança e retomada.

A arquitetura também deve reduzir o desperdício de requisições. PDFs não devem ser enviados obrigatoriamente página por página quando várias páginas puderem ser processadas com segurança em uma única chamada.

## 2. Estado atual que será substituído

A implementação existente:

- cria um trabalho de OCR por página;
- envia uma imagem de página por chamada ao Gemini;
- exige `OCR_DAILY_HARD_LIMIT`;
- incrementa `usage_daily.ocr_pages` antes de cada tentativa;
- bloqueia localmente o trabalho ao atingir o limite configurado;
- usa somente `OCR_MODEL_PRIMARY` na Edge Function;
- mantém `OCR_MODEL_QUALITY` apenas como configuração reservada, sem rota de execução ativa.

Até a implementação desta decisão, a documentação operacional deve distinguir claramente o comportamento atual do comportamento desejado.

## 3. Decisão sobre cotas

### 3.1 Autoridade da cota

A API configurada é a única autoridade para limites de uso. O aplicativo deve respeitar respostas como `429`, `Retry-After`, indisponibilidade temporária e bloqueio de cota do provedor, mas não antecipar essas respostas com um teto diário próprio.

### 3.2 Contadores locais

Contadores locais continuam permitidos somente para:

- informar páginas, lotes, chamadas e tentativas processadas;
- diagnosticar falhas e consumo anormal;
- mostrar histórico de uso;
- auxiliar a escolha do tamanho de lote;
- impedir repetição infinita por erro de implementação.

Esses contadores não podem recusar uma chamada válida apenas por terem atingido um número diário definido pelo Fichário.

### 3.3 Controles que permanecem

- no máximo uma ou duas chamadas simultâneas, conforme estabilidade medida;
- limite finito de tentativas automáticas por lote;
- backoff exponencial com jitter;
- respeito a `Retry-After` quando fornecido;
- pausa explícita em cota do provedor;
- retomada sem reenviar o arquivo original;
- ausência de billing e de fallback pago automático.

## 4. Estratégia para PDFs

### 4.1 Texto nativo primeiro

O aplicativo continua inspecionando o PDF localmente. Páginas com texto nativo suficiente são extraídas e indexadas sem chamar o Gemini.

PDFs mistos devem enviar somente as páginas que realmente precisam de reconhecimento visual.

### 4.2 Unidade de processamento

A unidade persistente de resultado continua sendo a página, mas a unidade de chamada ao provedor passa a poder ser um lote de páginas.

Cada resposta de lote deve identificar explicitamente:

- número ou ID estável de cada página;
- transcrição correspondente;
- avisos por página;
- páginas ausentes, duplicadas ou truncadas;
- versão do prompt e modelo usado.

Nenhuma resposta parcial pode ser tratada como sucesso integral do lote.

### 4.3 Lotes adaptativos

A primeira implementação deve usar uma política conservadora:

- imagem avulsa: uma imagem por chamada;
- PDF escaneado curto: documento inteiro quando estiver dentro dos limites seguros de arquivo, entrada e saída;
- PDF longo ou denso: lotes iniciais de aproximadamente 20 a 40 páginas;
- PDF misto: lotes formados apenas pelas páginas sem texto suficiente;
- páginas com escrita muito densa, fórmulas ou saída longa: lotes menores;
- páginas simples e pouco densas: lotes maiores, desde que os testes comprovem integridade.

O número de 20 a 40 páginas é ponto de partida, não uma franquia nem uma constante permanente. O planejador deve considerar tamanho do arquivo, quantidade de páginas, densidade estimada, limite de saída do modelo, histórico de truncamento e falhas recentes.

### 4.4 PDFs inteiros

Enviar o PDF inteiro é permitido quando seguro, pois reduz o consumo de requisições. Não deve ser obrigatório para documentos grandes porque aumenta o risco de:

- resposta truncada;
- perda de granularidade na retomada;
- reprocessamento integral após uma única falha;
- dificuldade de verificar páginas omitidas;
- estouro de tempo ou de saída.

## 5. Estratégia de modelos

### 5.1 Modelo ativo

O Gemini configurado em `OCR_MODEL_PRIMARY` é o mecanismo ativo para todo conteúdo visual que precisa de OCR, incluindo:

- texto impresso;
- texto manuscrito;
- anotações mistas;
- títulos, listas, símbolos e fórmulas que possam ser representadas em texto.

Não existe atualmente um provedor ou modelo especializado em manuscritos conectado ao fluxo de produção.

### 5.2 `OCR_MODEL_QUALITY`

`OCR_MODEL_QUALITY` foi reservado para uma eventual segunda passagem de maior qualidade. Ele não representa hoje um OCR manuscrito separado e não é lido pela Edge Function `process-ocr`.

A variável só deve se tornar ativa após:

- benchmark com amostras reais de escrita da usuária;
- comparação de precisão, latência e consumo de cota;
- definição explícita de quando reprocessar;
- teste de staging com o mesmo schema de saída;
- garantia de que não haverá troca silenciosa para modelo pago.

Se ativada, a segunda passagem deve ser explícita e seletiva, por exemplo para páginas marcadas como ilegíveis, com muitos avisos ou enviadas manualmente para nova leitura. Ela pode usar outro modelo Gemini ou outro provedor gratuito compatível, mas nunca deve ser chamada automaticamente sem política documentada.

### 5.3 Critério para modelo especializado

Um modelo especializado em manuscritos só deve ser adicionado se superar o Gemini principal em um conjunto representativo de páginas reais e continuar compatível com privacidade, custo zero, cotas e implantação. Especialização declarada pelo fornecedor, isoladamente, não é critério suficiente.

## 6. Persistência e retomada

- resultados continuam armazenados por página;
- um lote possui ID, intervalo/lista de páginas, tentativa e estado próprios;
- sucesso parcial persiste apenas páginas validadas e recoloca as restantes na fila;
- páginas omitidas ou duplicadas invalidam a parte afetada;
- retry reenvia somente o menor lote necessário;
- correção manual continua substituindo o OCR efetivo na busca;
- o arquivo original permanente não é reenviado ao Drive durante retry.

## 7. Alterações de implementação necessárias

1. remover `OCR_DAILY_HARD_LIMIT` como configuração obrigatória;
2. retirar o bloqueio diário de `claim_ocr_job` ou substituí-lo por telemetria não bloqueante;
3. manter `usage_daily` apenas como histórico informativo, renomeando métricas quando necessário;
4. criar contrato de lote com resultado estritamente associado às páginas;
5. adaptar o cliente Gemini para PDF completo ou conjunto de páginas;
6. criar planejador adaptativo de lotes;
7. preservar compatibilidade com imagem avulsa;
8. adaptar retomada, revisão, progresso e testes;
9. testar truncamento, omissão, duplicação, 429, timeout e sucesso parcial;
10. atualizar runbooks e remover exemplos que exigem limite diário local.

## 8. Critérios de aceitação

- nenhuma página é recusada apenas por um contador diário interno;
- uma resposta `429` do provedor pausa e preserva o trabalho;
- PDF textual não chama OCR;
- PDF misto chama OCR somente para páginas necessárias;
- PDF escaneado de múltiplas páginas usa menos chamadas que páginas quando seguro;
- nenhuma página pode desaparecer silenciosamente de uma resposta em lote;
- falha de um lote não exige reupload do original;
- o painel separa páginas, lotes, chamadas e tentativas;
- manuscrito e impresso usam o Gemini principal por padrão;
- `OCR_MODEL_QUALITY` permanece inativo até benchmark e política explícita;
- não existe fallback pago ou ativação automática de billing.

## 9. Fora de escopo desta decisão

Esta especificação não implementa as mudanças, não escolhe definitivamente um segundo modelo e não garante uma quantidade fixa de páginas por chamada. Esses pontos dependem de código, testes com documentos reais e das cotas vigentes no projeto Gemini.
