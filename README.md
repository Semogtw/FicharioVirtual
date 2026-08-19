<div align="center">

# 📚 Fichário Virtual

### Seus materiais organizados. Todo o conteúdo pesquisável — por palavras ou por sentido.

Transforme **fotos, capturas de tela e PDFs** em um fichário digital fácil de organizar, consultar e pesquisar — inclusive quando o texto está dentro de uma imagem, escrito à mão ou usa palavras diferentes das que você pesquisou.

**Privado · Pesquisável · Multiplataforma · Integrado ao Google Drive**

</div>

---

## ✨ O que é

O **Fichário Virtual** reúne materiais que normalmente ficam espalhados entre pastas, fotos, prints e PDFs em uma biblioteca única.

Você pode separar tudo em cadernos, usar tags e pesquisar pelo **conteúdo dos documentos**, não apenas pelo nome do arquivo. Quando necessário, o Fichário extrai o texto automaticamente com OCR para que páginas digitalizadas e anotações também possam ser encontradas.

A busca combina correspondência textual, tolerância a erros de OCR e **busca semântica opcional**, capaz de encontrar páginas relacionadas pelo significado mesmo quando elas não repetem exatamente as palavras pesquisadas.

Os arquivos originais continuam no seu **Google Drive**, enquanto o Fichário cuida da organização, pesquisa e experiência de leitura.

## 💡 O que você pode fazer

|                                             |                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 📁 **Organizar seus materiais**             | Agrupe documentos em cadernos, use tags e organize vários itens de uma vez.                                      |
| 🔎 **Pesquisar dentro dos arquivos**        | Encontre palavras e trechos presentes em PDFs, imagens, prints e páginas digitalizadas.                          |
| 🧠 **Encontrar conteúdo pelo sentido**      | A busca semântica pode localizar materiais relacionados ao conceito pesquisado, mesmo com vocabulário diferente. |
| 🔤 **Lidar melhor com erros de OCR**        | A busca fuzzy tolera pequenas diferenças, acentos e erros comuns de reconhecimento de texto.                     |
| ✨ **Ver onde a busca encontrou**           | Trechos relevantes são exibidos e correspondências textuais podem ser destacadas ao abrir o material.            |
| 🎯 **Verificar cobertura de assuntos**      | Compare uma lista de tópicos ou uma ementa com seu fichário e veja o que já possui material relacionado.         |
| ✍️ **Ler conteúdo manuscrito ou escaneado** | O OCR transforma conteúdo visual em texto pesquisável automaticamente.                                           |
| 📄 **Aproveitar o texto de PDFs**           | PDFs que já possuem texto utilizam o conteúdo original sem OCR desnecessário.                                    |
| ☁️ **Manter os originais no Drive**         | Seus documentos permanecem no Google Drive em vez de ficarem presos à aplicação.                                 |
| 📱 **Usar em diferentes telas**             | A interface é uma PWA pensada para computador, tablet e celular.                                                 |
| 📦 **Exportar seus dados**                  | Metadados e informações do fichário podem ser exportados de forma portátil.                                      |

## 🔍 Uma busca feita para documentos reais

Nem todo material está perfeitamente digitado — e nem sempre você lembra as mesmas palavras usadas no documento. Por isso, o Fichário combina diferentes formas de encontrar conteúdo:

- **busca textual** para palavras, frases e trechos exatos;
- **busca fuzzy** para pequenas diferenças e erros típicos de OCR;
- **busca semântica** para encontrar conteúdo relacionado pelo significado;
- **resultados híbridos**, combinando os sinais textual e semântico quando ambos encontram a mesma página;
- **trechos relevantes e destaque de correspondências** para facilitar a localização do conteúdo dentro do material.

Por exemplo, uma pesquisa por **“conservação de energia em um sistema”** pode encontrar uma anotação que explica a relação entre calor, trabalho e energia interna mesmo que aquela frase exata não apareça na página.

A camada semântica é opcional. Se ela estiver desativada, indisponível ou sem cota, a pesquisa textual/fuzzy continua funcionando normalmente sobre o conteúdo pesquisável do fichário.

## 🎯 Cobertura de assuntos

Além de pesquisar livremente, o Fichário pode comparar uma **ementa, unidade ou lista de assuntos** com os materiais já armazenados.

Você pode digitar os tópicos ou extraí-los de uma foto, conferir a lista e verificar quais assuntos estão **cobertos**, **parcialmente cobertos** ou ainda **não foram encontrados**, sempre com acesso às páginas usadas como evidência.

Essa análise pode usar a mesma combinação de busca textual/fuzzy e relação semântica da pesquisa global.

## 🚀 Do arquivo à busca

### 1. Adicione

Importe uma imagem ou PDF do dispositivo ou conecte seus arquivos do Google Drive.

### 2. Organize

Escolha o caderno, aplique tags e deixe o Fichário preparar o conteúdo para pesquisa.

### 3. Encontre

Pesquise uma palavra, assunto ou ideia e encontre o material correspondente mesmo quando o texto estava dentro de uma imagem, contém um pequeno erro de OCR ou usa outra forma de expressar o mesmo conceito.

## 🗂️ Feito para materiais reais

O Fichário Virtual foi pensado para lidar com uma biblioteca que mistura diferentes tipos de conteúdo:

- 📸 fotos de quadro, folhas e anotações;
- 🖼️ capturas de tela;
- 📑 PDFs digitais com texto selecionável;
- 📄 PDFs escaneados;
- ✏️ páginas manuscritas;
- 📚 documentos longos com páginas de tipos diferentes.

A aplicação tenta aproveitar primeiro o texto que já existe no arquivo e usa OCR somente onde ele realmente é necessário.

## 🔐 Seus arquivos continuam seus

Os documentos originais permanecem no **Google Drive**. O Fichário usa os serviços de backend para manter a organização, os índices de pesquisa e os resultados de processamento necessários para a experiência do aplicativo.

Recursos que precisam de processamento externo, como OCR e busca semântica, são acionados somente quando necessários. No uso privado atual, a interface não exige confirmações repetidas por arquivo ou pesquisa; os detalhes sobre o que pode ser processado permanecem disponíveis em **Configurações → Privacidade e dados**. Se a camada semântica estiver indisponível, a busca textual/fuzzy continua funcionando normalmente.

A ideia é que o fichário complemente seus arquivos — não que se torne um lugar do qual seja difícil retirá-los depois.

## 🛠️ Desenvolvimento

O projeto é construído principalmente com **SvelteKit, TypeScript, Supabase, Google Drive e tecnologias de OCR e busca semântica**.

Para executar localmente:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Requisitos principais: **Node.js 22.12+** e **pnpm 10+**.

Os testes, serviços externos e configuração completa de desenvolvimento estão documentados separadamente.

## 📖 Documentação

O README é somente a apresentação do projeto. Estado de desenvolvimento, decisões técnicas, planos, testes e procedimentos operacionais ficam em [`docs/`](docs/README.md).

- [Documentação completa](docs/README.md)
- [Busca híbrida, OCR e correspondências](docs/SEARCH_OCR_MATCHING.md)
- [Busca e cobertura semântica](docs/SEMANTIC_COVERAGE.md)
- [Cobertura de assuntos por unidade](docs/UNIT_TOPIC_COVERAGE.md)
- [Estado atual](docs/CURRENT_STATUS.md)
- [Prontidão para release](docs/READINESS.md)
- [Plano de implementação](docs/IMPLEMENTATION_PLAN.md)
- [Especificação do projeto](docs/PROJECT_SPEC.md)

> O Fichário Virtual está em desenvolvimento ativo. Para acompanhar o que já foi validado e o que ainda está sendo preparado para release, consulte o [estado atual do projeto](docs/CURRENT_STATUS.md).
