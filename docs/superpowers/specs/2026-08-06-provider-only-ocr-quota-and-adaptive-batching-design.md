# OCR sem limite interno e processamento adaptativo

**Data:** 6 de agosto de 2026  
**Status:** decisão aprovada; implementação pendente  
**Escopo:** cotas, roteamento híbrido, agrupamento de páginas e integração com PDFs grandes

## 1. Objetivo

O Fichário Virtual é de uso pessoal por uma única conta autorizada. O aplicativo não deve impor uma franquia diária artificial de páginas ou tentativas de OCR. A capacidade de cada mecanismo deve ser determinada pelas cotas reais do provedor ou pelos recursos disponíveis no computador confiável, mantendo somente controles técnicos de concorrência, backoff, segurança e retomada.

A arquitetura deve reduzir o desperdício de requisições. PDFs não devem ser enviados obrigatoriamente página por página quando várias páginas puderem ser processadas com integridade em um único lote.

A política detalhada para arquivos maiores que o limite de uma chamada está em:

- `docs/superpowers/specs/2026-08-06-oversized-pdf-splitting-and-compression-design.md`.

## 2. Estado atual que será substituído

A implementação existente:

- cria um trabalho Gemini por página;
- envia uma imagem de página por chamada;
- exige `OCR_DAILY_HARD_LIMIT`;
- incrementa `usage_daily.ocr_pages` antes de cada tentativa;
- bloqueia localmente o trabalho ao atingir o limite configurado;
- mantém um único resultado efetivo por página;
- não possui manifesto de lote compartilhado com o worker desktop;
- não divide automaticamente PDFs acima dos limites do provedor.

Até a implementação desta decisão, a documentação operacional deve distinguir claramente o comportamento atual do comportamento desejado.

## 3. Decisão sobre cotas

### 3.1 Autoridade da capacidade

Para chamadas Gemini, a API configurada é a única autoridade de cota. O aplicativo deve respeitar `429`, `Retry-After`, indisponibilidade temporária e bloqueio de cota do provedor, mas não antecipar essas respostas com teto diário próprio.

Para o worker desktop, a capacidade depende de dispositivo online, memória, modelo, backend e fila. Trabalhos em `waiting_desktop` não representam cota esgotada nem falha permanente.

### 3.2 Contadores locais

Contadores locais continuam permitidos somente para:

- informar páginas, lotes, chamadas e tentativas;
- diagnosticar falhas e consumo anormal;
- mostrar histórico de uso;
- auxiliar a escolha do tamanho de lote;
- medir tempo, qualidade e uso temporário de armazenamento;
- impedir repetição infinita por erro de implementação.

Esses contadores não podem recusar uma chamada válida apenas por terem atingido um número diário definido pelo Fichário.

### 3.3 Controles que permanecem

- uma ou duas chamadas Gemini simultâneas, conforme estabilidade medida;
- concorrência inicial `1` no worker desktop;
- limite finito de tentativas automáticas por lote;
- backoff exponencial com jitter;
- respeito a `Retry-After` quando fornecido;
- pausa explícita em cota real do provedor;
- lease e heartbeat no processamento local;
- retomada sem reenviar o arquivo original ao Drive;
- ausência de billing e fallback pago automático.

## 4. Texto nativo e roteamento

O aplicativo continua inspecionando o PDF localmente. Páginas com texto nativo suficiente são extraídas e indexadas sem Gemini ou worker local.

PDFs mistos enviam somente páginas que realmente precisam de reconhecimento visual.

Cadernos e páginas podem declarar:

```text
automatic
printed
handwritten
mixed
```

A preferência mais específica vence:

```text
página > caderno > configuração global
```

Roteamento inicial:

- `printed`: Gemini por padrão;
- `handwritten`: computador por padrão, sem chamada Gemini obrigatória;
- `mixed`: computador por padrão;
- `automatic`: inspeção e classificação determinam a rota.

Quando Gemini processar uma página automática, classificação e transcrição preliminar devem compartilhar a mesma resposta. Não existe chamada separada apenas para classificação.

## 5. Unidade de resultado e unidade de processamento

A unidade persistente de resultado continua sendo a página. Resultados Gemini, desktop e correção manual ficam separados e registram mecanismo, modelo, versão e hash da origem.

A unidade de processamento pode ser:

- imagem avulsa;
- PDF curto inteiro;
- PDF temporário com páginas contíguas;
- PDF temporário contendo apenas páginas selecionadas;
- lote explícito destinado ao worker desktop.

Cada resposta de lote precisa identificar:

- `page_id` estável;
- número original da página;
- transcrição correspondente;
- avisos e classificação por página;
- páginas ausentes, duplicadas ou truncadas;
- versão do prompt, modelo e mecanismo.

Nenhuma resposta parcial pode ser tratada como sucesso integral.

## 6. Lotes adaptativos

A primeira implementação usa política conservadora:

- imagem avulsa: uma imagem por chamada ou trabalho;
- PDF escaneado curto: documento inteiro quando estiver dentro dos limites seguros de arquivo, entrada e saída;
- PDF longo ou denso: lotes iniciais em torno de 20 a 40 páginas;
- PDF misto: lotes formados apenas por páginas sem texto suficiente;
- manuscrito denso, fórmulas ou saída longa: lotes menores;
- páginas simples: lotes maiores somente após testes de integridade.

O número de 20 a 40 páginas é ponto de partida, não franquia nem constante permanente. O planejador deve considerar tamanho, quantidade de páginas, densidade estimada, limite de saída, rota, memória e histórico de falhas.

Enviar o PDF inteiro é permitido quando seguro, mas não é obrigatório para documentos grandes. Um arquivo pode caber no limite de entrada e ainda produzir saída truncada.

## 7. PDFs acima dos limites de uma chamada

O documento lógico não herda o limite de uma única chamada Gemini. O original permanece intacto no Google Drive e o sistema cria artefatos temporários menores.

Na verificação de 6 de agosto de 2026, a Gemini documentava máximo de 50 MB ou 1.000 páginas por PDF, tanto inline quanto pela Files API. Esses valores precisam ser revistos antes de release e não devem ser confundidos com o limite do documento armazenado.

Regras:

- dividir automaticamente quando bytes, páginas ou saída estimada ultrapassarem margem segura;
- comprimir apenas artefatos temporários e de forma conservadora;
- nunca recomprimir ou substituir o original no Drive;
- preservar mapeamento exato para números originais;
- em truncamento, omissão, duplicação ou timeout ligado ao tamanho, dividir apenas o lote afetado ao meio;
- retry reenvia o menor subconjunto necessário;
- Gemini e desktop podem processar partes diferentes do mesmo PDF.

A fragmentação permite processar documentos maiores, mas não elimina RPM, TPM, RPD, limite de saída ou tempo de inferência.

## 8. Modelos e manuscritos

### 8.1 Gemini

`OCR_MODEL_PRIMARY` continua sendo o modelo Gemini ativo para conteúdo geral, páginas impressas, classificação e transcrição preliminar. Ele também pode ler manuscritos, mas a arquitetura não exige que toda página manuscrita consuma Gemini.

### 8.2 Worker desktop

Manuscritos, conteúdo misto, páginas difíceis ou reprocessamentos explícitos podem usar um modelo local mais pesado no computador confiável. O modelo definitivo depende de benchmark com páginas reais da usuária, licença, precisão, memória e funcionamento em CPU.

O worker local:

- consulta a fila por HTTPS de saída;
- não expõe porta pública;
- usa lease e heartbeat;
- valida hash da origem;
- registra dispositivo, modelo, versão e backend;
- preserva resultado separado do Gemini.

### 8.3 `OCR_MODEL_QUALITY`

`OCR_MODEL_QUALITY` permanece configuração opcional e não autoriza fallback automático. Ela só pode ser ativada com política explícita, staging, benchmark e confirmação de custo zero.

Um modelo especializado só deve ser promovido se superar a rota atual em amostras representativas. Especialização declarada pelo fornecedor, isoladamente, não é suficiente.

## 9. Persistência, precedência e retomada

- resultados continuam armazenados por página;
- um lote possui ID, páginas, tentativa, rota e estado próprios;
- sucesso parcial persiste somente páginas validadas;
- páginas omitidas ou duplicadas voltam à fila;
- retry reenvia somente o menor lote necessário;
- correção manual nunca é substituída automaticamente;
- resultado desktop aceito pode superar resultado Gemini aceito;
- arquivo original não é reenviado ao Drive durante retry;
- temporários só são limpos após persistência segura ou cancelamento confirmado.

Precedência canônica:

```text
corrected_text
> resultado desktop aceito
> resultado Gemini aceito
> resultado preliminar
> texto nativo quando aplicável
```

## 10. Alterações de implementação necessárias

1. remover `OCR_DAILY_HARD_LIMIT` como configuração obrigatória;
2. retirar bloqueio diário de `claim_ocr_job` ou substituí-lo por telemetria não bloqueante;
3. manter `usage_daily` apenas como histórico informativo;
4. separar resultados por mecanismo em estrutura persistente;
5. criar contrato de lote associado estritamente às páginas;
6. criar manifesto compartilhado por Gemini e desktop;
7. adaptar cliente Gemini para PDF inteiro ou subconjuntos;
8. implementar planejador adaptativo e divisão automática;
9. criar compressão temporária versionada e conservadora;
10. implementar bisseção de lotes problemáticos;
11. preservar compatibilidade com imagem avulsa;
12. adaptar retomada, revisão, progresso, limpeza e testes;
13. testar truncamento, omissão, duplicação, `429`, timeout e sucesso parcial;
14. testar documentos acima de 50 MB e de 1.000 páginas com fixtures sintéticas;
15. atualizar runbooks e remover exemplos que exigem limite diário local.

## 11. Critérios de aceitação

- nenhuma página é recusada apenas por contador diário interno;
- uma resposta `429` pausa e preserva o trabalho;
- PDF textual não chama OCR;
- PDF misto chama OCR somente para páginas necessárias;
- PDF escaneado de várias páginas usa menos chamadas que páginas quando seguro;
- documento maior que o limite de uma chamada permanece único no Drive;
- usuário não precisa dividir PDF manualmente;
- compressão nunca altera o original;
- nenhuma página desaparece silenciosamente de resposta em lote;
- falha de lote não exige reupload nem reinício do documento;
- painel separa páginas, lotes, chamadas Gemini e trabalhos desktop;
- manuscrito pode ir direto ao computador;
- Gemini e desktop preservam resultados separados;
- não existe fallback pago ou ativação automática de billing.

## 12. Fora de escopo

Esta especificação não escolhe definitivamente o modelo local, não fixa tamanho máximo universal para o documento lógico e não garante quantidade constante de páginas por lote. Esses pontos dependem de implementação, memória disponível, testes no tablet e computador e limites vigentes dos serviços.
