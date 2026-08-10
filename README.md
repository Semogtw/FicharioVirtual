<div align="center">

# 📚 Fichário Virtual

### Seus materiais organizados. Todo o conteúdo pesquisável.

Transforme **fotos, capturas de tela e PDFs** em um fichário digital fácil de organizar, consultar e pesquisar — inclusive quando o texto está dentro de uma imagem ou escrito à mão.

**Privado · Pesquisável · Multiplataforma · Integrado ao Google Drive**

</div>

---

## ✨ O que é

O **Fichário Virtual** reúne materiais que normalmente ficam espalhados entre pastas, fotos, prints e PDFs em uma biblioteca única.

Você pode separar tudo em cadernos, usar tags e pesquisar pelo **conteúdo dos documentos**, não apenas pelo nome do arquivo. Quando necessário, o Fichário extrai o texto automaticamente com OCR para que páginas digitalizadas e anotações também possam ser encontradas pela busca.

Os arquivos originais continuam no seu **Google Drive**, enquanto o Fichário cuida da organização, pesquisa e experiência de leitura.

## 💡 O que você pode fazer

|                                             |                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| 📁 **Organizar seus materiais**             | Agrupe documentos em cadernos, use tags e organize vários itens de uma vez.             |
| 🔎 **Pesquisar dentro dos arquivos**        | Encontre palavras e trechos presentes em PDFs, imagens, prints e páginas digitalizadas. |
| ✍️ **Ler conteúdo manuscrito ou escaneado** | O OCR transforma conteúdo visual em texto pesquisável e revisável.                      |
| 📄 **Aproveitar o texto de PDFs**           | PDFs que já possuem texto utilizam o conteúdo original sem OCR desnecessário.           |
| ☁️ **Manter os originais no Drive**         | Seus documentos permanecem no Google Drive em vez de ficarem presos à aplicação.        |
| 📝 **Revisar e corrigir resultados**        | O texto reconhecido pode ser conferido e corrigido quando necessário.                   |
| 📱 **Usar em diferentes telas**             | A interface é uma PWA pensada para computador, tablet e celular.                        |
| 📦 **Exportar seus dados**                  | Metadados e informações do fichário podem ser exportados de forma portátil.             |

## 🚀 Do arquivo à busca

### 1. Adicione

Importe uma imagem ou PDF do dispositivo ou conecte seus arquivos do Google Drive.

### 2. Organize

Escolha o caderno, aplique tags e deixe o Fichário preparar o conteúdo para pesquisa.

### 3. Encontre

Pesquise uma palavra, assunto ou trecho e encontre o material correspondente mesmo quando o texto originalmente estava dentro de uma imagem.

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

A ideia é que o fichário complemente seus arquivos — não que se torne um lugar do qual seja difícil retirá-los depois.

## 🛠️ Desenvolvimento

O projeto é construído principalmente com **SvelteKit, TypeScript, Supabase, Google Drive e tecnologias de OCR**.

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
- [Estado atual](docs/CURRENT_STATUS.md)
- [Prontidão para release](docs/READINESS.md)
- [Plano de implementação](docs/IMPLEMENTATION_PLAN.md)
- [Especificação do projeto](docs/PROJECT_SPEC.md)

> O Fichário Virtual está em desenvolvimento ativo. Para acompanhar o que já foi validado e o que ainda está sendo preparado para release, consulte o [estado atual do projeto](docs/CURRENT_STATUS.md).
