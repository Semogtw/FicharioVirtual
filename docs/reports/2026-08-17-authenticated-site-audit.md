# Auditoria autenticada do site — 17 de agosto de 2026

## Resultado executivo

A auditoria autenticada do Fichário Virtual foi executada contra o site publicado
em `https://fichario-virtual.pages.dev/`, usando a conta de teste autorizada pelo
proprietário. Os fluxos de login, importação, OCR, navegação, busca lexical,
normalização, busca semântica, filtro por caderno, rotas autenticadas e layout
móvel foram exercitados.

O produto está operacional nos fluxos executados, mas a busca semântica não foi
aprovada para qualidade de produção: uma consulta negativa retornou documentos
sem relação evidente. O relatório é evidência de uma execução real, não uma
garantia de funcionamento universal ou de 100% de cobertura.

## Identificação e escopo

- snapshot auditado: `origin/main` em `7d84408cde3ec172caa2d43490e3849a6661c9d8`;
- site auditado: `https://fichario-virtual.pages.dev/`;
- conta: conta de teste autorizada, sem registrar credenciais neste documento;
- navegador: Chromium no Browser do Codex;
- viewport móvel adicional: `390x844`;
- arquivos usados: PDF sintético, PDF técnico local e imagem local;
- nenhum arquivo do checkout principal foi alterado durante a auditoria.

## Evidência automatizada local

Executada em worktree descartável baseado no `origin/main`:

```text
pnpm install --frozen-lockfile: PASS (pnpm 10.34.5)
pnpm verify: PASS
  - Prettier/ESLint: PASS
  - svelte-check: 0 erros, 0 warnings
  - Vitest: 323 arquivos, 1.377 testes aprovados
  - build estático, CSP e PWA: PASS
pnpm test:e2e: PASS (8/8 testes no Chromium/tablet)
contrato HTTP do deployment: PASS
UI publicada anônima + service-worker reload: PASS
gates locais de segurança: PASS, exceto o pin de workflow abaixo
```

O `pnpm test:source:offline` falhou de forma determinística somente por causa
do SHA incompleto em `.github/workflows/verify-adaptive-visual-staging.yml:188`.
O pin permanece sem correção neste checkpoint, conforme solicitado; a mudança
necessária está documentada para uma etapa posterior.

## Evidência manual publicada

### Login e estado inicial

- login concluído com sucesso;
- estado inicial observado: 8 documentos, 39 páginas e 6 páginas para revisão;
- nenhuma mensagem de erro no console durante a sessão.

### Importações

Foram criados três documentos de teste, que permanecem na conta para inspeção:

1. `fichario-audit-semantic-variety`: PDF sintético de 3 páginas, contendo
   marcador exato, acentos, números, paráfrase semântica, tabela e layout
   rotacionado;
2. `0----pc_trabalho_TODOS_2023`: PDF técnico local;
3. `questoesparte2`: imagem local com texto matemático.

Resultados:

- PDF sintético: importado, 3 páginas prontas;
- PDF técnico: importado e concluído;
- imagem: originalmente ficou em `Aguardando leitura`, mas o OCR assíncrono
  terminou depois; a fila ficou vazia e o documento passou a `Pronto`;
- a imagem original permaneceu acessível enquanto o OCR estava pendente;
- não houve reenvio ou duplicação manual dos arquivos.

### Buscas

| Caso                                             | Resultado observado                                  |
| ------------------------------------------------ | ---------------------------------------------------- |
| marcador exato `FICHARIO_AUDIT_2026_08_17_ALPHA` | 1 documento correto, 1 ocorrência na página 1        |
| `arborizacao urbana` sem acento                  | fixture correto, selo `Texto + sentido`              |
| `Multiplicadores de Lagrange`                    | imagem correta, selo `Texto + sentido + página`      |
| paráfrase sobre cidades arborizadas e calor      | busca semântica ativa; fixture retornado por sentido |
| filtro pelo caderno `teste`                      | nenhum documento fora do caderno vazou               |
| negativo `receita de bolo de chocolate`          | 11 documentos retornados por sentido                 |

## Achados

### F-01 — P1: precisão semântica insuficiente

A consulta negativa `receita de bolo de chocolate` retornou 11 documentos,
incluindo o PDF sintético de arborização, a imagem de exercícios e documentos
de OCR/staging. Os cartões exibiram `Por sentido` ou `Sentido + página`.

Isso demonstra que o caminho semântico está operacional, mas o limiar/ranking
atual não separa adequadamente consultas sem relação do corpus desta conta.
O resultado não deve ser tratado como prova de qualidade semântica de produção.

Mudança necessária:

- adicionar corpus sintético temporário com consultas positivas, negativas,
  lexicais e paráfrases;
- medir Recall@1/3, MRR e taxa de falso positivo por consulta negativa;
- calibrar limiar, fallback e/ou política de precisão usando essa medição;
- executar cleanup do corpus temporário e publicar o recibo do benchmark.

Não foi aplicada uma alteração de ranking especulativa neste checkpoint.

### F-02 — P1: marcação visual possivelmente enganosa em resultado semântico

Ao abrir o resultado semântico do PDF sintético, a UI desenhou marcas geométricas
em mais de uma página. Algumas marcas tinham títulos `com` e `apenas`, que são
stopwords ou fragmentos literais da consulta, e não evidência semântica clara.

Mudança necessária:

- distinguir `matchMode` semântico de match lexical na camada de highlight;
- não desenhar highlight lexical quando o resultado é somente semântico;
- quando houver evidência textual real, destacar somente tokens e páginas
  retornados pelo índice correspondente;
- criar um teste de contrato para impedir highlight inventado em resultado
  `semantic`/`visual`.

### F-03 — P1: gate de CI quebrado

O workflow usava:

```yaml
supabase/setup-cli@3c2f5e2ae34c34aea4fa41551a30e30af803
```

O valor não era um SHA completo. O valor correto, já usado pelas demais etapas
do workflow, é:

```yaml
supabase/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf
```

O pin não foi alterado nesta etapa. `Validate current head` continua falhando
no gate offline e os fluxos de app real, busca real e visual permanecem
`skipped`.

### F-04 — P2: texto da interface está desatualizado

A tela publicada afirma `Busca textual sem banco vetorial no MVP`, enquanto o
caminho atual usa busca semântica textual e possui canal visual em `shadow`.

Mudança necessária: substituir o texto por uma descrição que corresponda aos
modos realmente disponíveis, sem prometer que o canal visual está ativo quando
ele permanece em `shadow`.

### F-05 — P2: estado de OCR precisa de SLA explícito

A imagem levou mais de 30 segundos para sair de `Aguardando leitura`, embora
tenha terminado corretamente depois. O fluxo é funcional, mas a UI/documentação
deve explicar o estado pendente, o intervalo esperado de polling e o caminho de
recuperação quando um worker não estiver disponível.

## Rotas e responsividade

As rotas autenticadas abaixo carregaram com título, `h1`, conteúdo visível e sem
alertas:

```text
/ /library/ /notebooks/ /import/ /import/pdf/
/review/ /review/drafts/ /coverage/
/drive/ /drive/jobs/ /drive/conflicts/
/settings/ /settings/usage/ /settings/computers/
/settings/computers/queue/ /search/
```

No viewport `390x844`, a página inicial e a busca OCR carregaram sem overflow
horizontal (`scrollWidth` observado: 375px) e sem erros de console.

## Limites não comprovados nesta execução

- OAuth real do Google Drive, Picker e importação de arquivo remoto;
- pareamento e execução em computador local de OCR;
- permissão física de câmera e digitalização real;
- análise de cobertura com provedor externo real;
- instalação/atualização PWA em dispositivo físico;
- exclusão dos três documentos de teste, que foi deliberadamente evitada.

## Estado após a auditoria

Os três documentos de teste permanecem na conta. A remoção deve ser feita em
ação separada e explícita, pois é destrutiva. O checkout principal local continua
intacto; este relatório foi preparado a partir de um worktree limpo baseado no
`origin/main`, sem correção de código ou workflow.
