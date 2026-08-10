# Pré-processamento de imagens para OCR

**Status:** `ocr_clean_v1` implementado para importação de imagens/fotos; validação visual e rollout de staging ainda são gates de promoção  
**Última revisão:** 10 de agosto de 2026

## 1. Objetivo

O Fichário prepara imagens antes do OCR para aumentar a proporção de informação útil apresentada ao Gemini ou a um backend local, sem transformar o pré-processamento em uma fonte silenciosa de perda de texto.

A regra principal é:

> O arquivo enviado pelo usuário é a fonte de verdade. O OCR recebe um derivado reproduzível e versionado; o original nunca é sobrescrito pelo derivado.

O pré-processamento não é um filtro estético. Ele deve corrigir apenas problemas visuais com sinais suficientemente fortes e permanecer conservador quando houver dúvida.

## 2. Perfil atual: `ocr_clean_v1`

A implementação atual roda no navegador, no `image-worker.ts`, usando `OffscreenCanvas`. O trabalho pesado não bloqueia a thread principal da interface e continua sujeito ao limite de concorrência do preparador de imagens.

A cadeia atual é:

```text
arquivo original
    │
    ├─ decode + orientação EXIF
    │
    ├─ resize conservador
    │
    ├─ análise de luminância em amostra <= 512×512
    │     ├─ margens inativas
    │     ├─ inclinação pequena
    │     ├─ contraste global
    │     └─ variação de iluminação
    │
    ├─ transformações aprovadas pelo analisador
    │     ├─ auto-crop conservador
    │     ├─ deskew entre -4° e +4°
    │     ├─ normalização leve de iluminação
    │     └─ contraste leve
    │
    ├─ WebP, com JPEG como fallback de encoder
    │
    └─ thumbnail derivado da imagem preparada
```

### 2.1 Orientação

A orientação armazenada na imagem é respeitada no decode por `createImageBitmap(..., { imageOrientation: 'from-image' })`.

Isso corrige orientação baseada em metadados sem exigir uma segunda cópia do arquivo nem modificar a fonte original.

### 2.2 Auto-crop

`ocr_clean_v1` não tenta recortar qualquer quadrilátero que pareça uma folha. Nesta versão, o crop procura somente margens claramente inativas ao redor do conteúdo.

O crop:

- adiciona padding antes de cortar;
- exige remoção material de margens;
- recusa cortes excessivos;
- mantém o frame inteiro quando a confiança é insuficiente.

O objetivo é remover espaço inútil sem arriscar cortar uma anotação próxima à borda.

### 2.3 Deskew

O analisador testa ângulos pequenos entre `-4°` e `+4°`, em passos discretos, usando concentração de projeções de pixels escuros como sinal de alinhamento de linhas.

A rotação só é aceita quando:

- existe quantidade mínima de foreground;
- o candidato melhora materialmente o score em relação a `0°`;
- o ângulo está dentro da faixa segura.

Uma foto com perspectiva forte não deve ser "corrigida" por este mecanismo; esse é um problema diferente.

### 2.4 Iluminação e sombras

A imagem é dividida conceitualmente em uma grade de regiões. O background claro de cada região é estimado e interpolado para aplicar uma compensação suave de iluminação.

A correção é limitada e misturada ao pixel original. Ela existe para reduzir gradientes de luz/sombra em papel claro, não para transformar qualquer imagem em papel branco artificial.

### 2.5 Contraste

O contraste é ajustado apenas quando a faixa de luminância indica benefício provável. O ganho e o blend são limitados.

Não há, em `ocr_clean_v1`:

- binarização preto/branco obrigatória;
- threshold adaptativo agressivo;
- sharpen forte;
- remoção de cor por padrão;
- denoise destrutivo.

Essas técnicas podem eliminar acentos, lápis fraco, linhas finas, marca-texto, sinais matemáticos e outras informações relevantes para VLMs.

## 3. Fallback seguro

Falha na etapa específica de limpeza não deve transformar uma imagem válida em uma falha de importação.

Se a análise ou transformação falhar depois do decode:

```text
ocr_clean_v1 falha
       │
       └─ usar resize/reencode padrão
          fallbackToStandard = true
```

Esse fallback é registrado na proveniência e na telemetria.

Falhas reais de decode/encode continuam sendo tratadas como falhas da preparação.

## 4. Preservação do original

### 4.1 Upload direto ao Supabase

Uma imagem passa a ter objetos distintos:

```text
<user>/<document>/source.<ext>     # bytes enviados pelo usuário
<user>/<document>/prepared.<ext>   # derivado usado pelo OCR/viewer atual
<user>/<document>/thumbnail.<ext>
```

`documents.storage_path` continua apontando para o derivado preparado para manter compatibilidade com o fluxo existente.

`documents.source_storage_path` aponta para o arquivo bruto.

Também são preservados dois hashes:

- `documents.sha256`: hash do derivado preparado, mantendo a semântica de deduplicação já usada pelo fluxo;
- `documents.source_sha256`: hash do arquivo bruto.

A exclusão do documento remove fonte, derivado, thumbnail e derivados temporários associados.

### 4.2 Google Drive

No modo Drive-first, o arquivo que fica no Drive é novamente o arquivo bruto enviado pelo usuário, com seu nome original.

O derivado `ocr_clean_v1` não substitui o arquivo no Drive. Ele é enviado temporariamente ao Storage como fonte de OCR da página:

```text
Google Drive
└─ scan-original.png

Supabase Storage temporário
├─ ocr.webp
└─ thumbnail.jpg
```

Depois que o OCR conclui, o mecanismo existente de limpeza pode remover o derivado temporário sem perder a fonte original.

## 5. Proveniência persistida

Cada página de imagem pode carregar:

```text
ocr_preprocessing_profile
ocr_preprocessing_version
ocr_preprocessing_auto_crop
ocr_preprocessing_retained_permille
ocr_preprocessing_deskew_mdeg
ocr_preprocessing_illumination
ocr_preprocessing_contrast
ocr_preprocessing_fallback
ocr_preprocessing_source_width
ocr_preprocessing_source_height
ocr_preprocessing_prepared_width
ocr_preprocessing_prepared_height
ocr_preprocessing_original_bytes
ocr_preprocessing_prepared_bytes
```

Os campos são booleanos, inteiros ou identificadores allowlisted. Eles não contêm imagem, texto OCR, prompt ou URL privada.

Os RPCs de importação versionados são:

```text
create_image_import_v2
create_drive_image_import_v2
```

Os RPCs anteriores permanecem disponíveis para compatibilidade durante o rollout.

## 6. Telemetria

A telemetria de provedor já existente é enriquecida automaticamente com a proveniência de pré-processamento da página.

O enriquecimento ocorre no banco, antes do insert em `ocr_provider_page_metrics`; portanto o Gemini, um backend desktop futuro ou outro provedor podem compartilhar a mesma taxonomia sem duplicar lógica de persistência.

O RPC:

```text
get_ocr_preprocessing_overview(window_days)
```

agrega por perfil/versão:

- páginas processadas;
- páginas com `needsReview`;
- quantidade que recebeu auto-crop;
- quantidade que recebeu deskew;
- quantidade com normalização de iluminação;
- quantidade com contraste;
- fallbacks para preparação padrão;
- bytes originais e preparados;
- retenção média de área;
- warnings médios.

Tokens oficiais continuam pertencendo ao evento/batch do provedor. O pré-processamento não cria uma atribuição fictícia de tokens exatos por página.

## 7. Como provar que o pré-processamento ajuda

O perfil não deve ser considerado melhor apenas porque a imagem parece mais limpa.

A validação alvo usa as mesmas fontes em duas variantes:

```text
fonte
├─ controle: preparação padrão/original compatível
└─ candidato: ocr_clean_v1

mesmo modelo OCR
mesmo prompt
mesma resolução-alvo compatível
mesma referência/ground truth quando disponível
```

Métricas úteis:

- CER/WER quando houver ground truth;
- omissões e alucinações críticas;
- `needsReview`;
- warnings;
- correções humanas posteriores;
- tokens por batch/100 páginas;
- latência;
- bytes do derivado;
- taxa de fallback;
- falhas de importação.

A promoção de uma transformação exige melhora ou neutralidade de qualidade nas classes em que ela é ativada. Uma economia de bytes não justifica perda de conteúdo.

## 8. Limitações deliberadas de v1

`ocr_clean_v1` ainda não implementa:

- detecção robusta de quatro cantos da folha;
- correção de perspectiva/homografia;
- dewarp de página curva/lombada;
- remoção especializada de bleed-through;
- binarização adaptativa especializada para OCR clássico;
- classificação local pré-rota que escolha um perfil diferente por tipo de página;
- preprocessing dos derivados renderizados de PDFs escaneados.

Esses itens devem entrar como perfis/versões posteriores, não como mudança silenciosa de `ocr_clean_v1`.

### PDFs escaneados

O fluxo de PDF já preserva o PDF original e renderiza apenas páginas que precisam de OCR. Portanto a integração futura pode aplicar a mesma preparação aos blobs renderizados sem alterar o PDF fonte.

Não ativar isso até o perfil de imagens estar validado e o contrato de proveniência por página de PDF estar implementado, para não perder a capacidade de comparar resultados.

## 9. Gates de rollout

Antes de promover `ocr_clean_v1` para produção:

```text
frontend/type-check: PASS
unit tests de análise/contrato/upload: PASS
database migrations em banco limpo: PASS
migration aplicada em fichario-staging: PASS
RLS/policies após migration: PASS
importação Supabase imagem real: PASS
importação Drive imagem real: PASS
source != prepared comprovado por hash/path: PASS
delete remove source + prepared + thumbnail: PASS
OCR usa prepared e mantém source recuperável: PASS
telemetria recebe preprocessing_profile/version: PASS
A/B em corpus representativo: PENDING até amostra real
perspectiva/dewarp: fora do escopo de v1
```

Enquanto A/B real ainda estiver pendente, os thresholds devem continuar conservadores e o fallback deve permanecer ativo.
