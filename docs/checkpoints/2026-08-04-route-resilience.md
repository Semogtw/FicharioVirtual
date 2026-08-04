# Checkpoint de resiliência das rotas — 2026-08-04

## Identificação

- Branch: `main`
- Source commit: `788f170409a323adb8d5b45e83d615f7c1f8d31f`
- Trigger da toolchain: `Semogtw/Offline-Toolchains@63799e383a5d2b07ba96dae486e528541766c6ab`
- Recibo exato: `Semogtw/Offline-Toolchains#28`
- Estado exato no momento do documento: `PENDING`

Este checkpoint consolida o hardening posterior aos checkpoints de contratos, sessão e timestamps de 2026-08-03.

## Evidência local fresca

Executado no workspace offline com o source commit reproduzido:

```text
Prettier: PASS
ESLint: PASS
svelte-check: PASS — 0 erros, 0 warnings
Vitest: PASS — 460 testes em 102 arquivos
build estático/PWA: PASS
5 gates offline de fonte: PASS
6 módulos Edge via Deno offline: PASS
Playwright Chromium: PASS — 3/3
```

Não foram executados banco local, staging Supabase, OCR real ou host publicado. Esses gates permanecem `NOT RUN`.

## Mudanças consolidadas

### 1. Ordenação e ciclo de vida

Respostas assíncronas antigas deixam de publicar dados, erro ou loading quando:

- uma tentativa mais nova foi iniciada;
- a query ou parâmetro da rota mudou;
- a tela foi desmontada;
- uma recarga autoritativa substituiu paginação ou retry anterior.

A proteção foi aplicada a home, busca, biblioteca, uso, cadernos, documento, revisão, rascunhos, tags, organização e importação.

### 2. Falhas parciais recuperáveis

Fontes independentes não bloqueiam conteúdo válido:

- home preserva totais ou documentos recentes e permite atualização em segundo plano;
- biblioteca mantém documentos quando o catálogo de cadernos falha;
- organização mantém renomeação quando opções de caderno falham;
- detalhe de caderno mantém metadados e ação de importar quando a lista de documentos falha;
- rascunhos locais permanecem visíveis sem localização remota;
- tags não fingem associação vazia após falha.

### 3. Exclusão mútua de ações

Operações incompatíveis não atravessam o mesmo estado:

- exportação e logout;
- retomada OCR e exclusão de documento;
- criação, renomeação, exclusão e associação de tags;
- mutações bloqueadas enquanto a coleção necessária ainda não foi confirmada.

### 4. Conclusão de domínio separada da navegação

Uma falha em `goto()` não reclassifica uma operação concluída:

- autenticação confirmada;
- sessão encerrada;
- documento excluído.

Cada tela apresenta estado final e link de recuperação quando a navegação automática falha.

### 5. Importação com intenção preservada

O parâmetro `notebook`:

- aceita somente UUID válido;
- é preservado entre abas de imagens e PDF;
- atualiza a URL ao trocar o seletor;
- só é aplicado quando o caderno foi confirmado;
- nunca cai silenciosamente para “Sem caderno” após falha de listagem;
- pode ser removido explicitamente quando o destino não existe.

### 6. Rascunhos locais escaláveis

- resolução remota em lotes de no máximo 100 IDs;
- cancelamento entre lotes quando a carga fica obsoleta;
- armazenamento local continua utilizável durante indisponibilidade remota;
- UI distingue “não localizado ainda” de “não existe no servidor”.

### 7. Contratos e validação

Além das rotas, os serviços foram endurecidos com parsers estritos e validação de entrada para documentos, cadernos, tags, busca, revisão, uso, exportação, sessão e OCR.

## Limites deste checkpoint

`PASS` local não prova:

- RLS, Storage ou migrations no ambiente remoto;
- execução real do provedor OCR;
- comportamento em rede móvel e dispositivos de memória limitada;
- headers do host final;
- backup, rollback, billing e limites gratuitos operacionais.

O status exato deve ser atualizado somente quando a issue da toolchain registrar um run bem-sucedido para o source commit acima.
