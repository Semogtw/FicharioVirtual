# Fichário Virtual

Biblioteca pessoal pesquisável para fotos, capturas de tela e PDFs de anotações manuscritas ou digitadas.

O projeto será uma PWA otimizada para tablet e desktop. O dispositivo cuida da interface, preparação de imagens e inspeção de PDFs; o reconhecimento manuscrito é executado por uma API externa gratuita. O alvo principal é um Samsung Galaxy Tab S6 Lite, portanto a prioridade é velocidade percebida e fluidez, sem tentar reduzir cada dependência ao mínimo absoluto.

## Objetivos

- Importar fotos, imagens e PDFs.
- Extrair texto nativo de PDFs sem consumir OCR.
- Reconhecer escrita manual sem executar modelos locais.
- Pesquisar por palavra ou frase, tolerando acentos e pequenos erros de OCR.
- Abrir o documento original diretamente na página encontrada.
- Permitir correção manual da transcrição.
- Funcionar com uma única conta e dados privados.
- Permanecer 100% gratuito, sem faturamento automático ou fallback pago.
- Ter uma interface editorial agradável, sem aparência de chatbot ou demonstração de IA.

## Arquitetura planejada

- **Frontend/PWA:** SvelteKit + TypeScript, hospedado na Vercel Hobby.
- **Backend:** Supabase Free para Auth, PostgreSQL, Storage e Edge Functions.
- **OCR:** Gemini Developer API no nível gratuito, encapsulada por um adaptador substituível.
- **PDFs:** `pdf-inspector` em WebAssembly para classificar e extrair texto; PDF.js apenas para renderizar páginas que realmente exigem OCR.
- **Busca:** PostgreSQL Full Text Search, `unaccent` e `pg_trgm`; sem banco vetorial no MVP.

## Documentação

- [Especificação do produto e arquitetura](docs/PROJECT_SPEC.md)
- [Plano detalhado de implementação](docs/IMPLEMENTATION_PLAN.md)
- [Operação sem custos e limites](docs/FREE_TIER_OPERATIONS.md)

## Estado

O repositório está na fase de especificação. A implementação deve começar pela fundação da PWA, banco e autenticação, antes de integrar o OCR.

## Princípios

1. **Recuperar o documento é mais importante que gerar respostas sofisticadas.**
2. **Texto nativo nunca deve ser enviado ao OCR sem necessidade.**
3. **Nenhum serviço pode gerar cobrança automaticamente.**
4. **O usuário sempre mantém o arquivo original e pode exportar seus dados.**
5. **Recursos pesados são carregados apenas quando a tarefa exige.**
6. **A interface deve parecer um fichário digital profissional, não um produto genérico de IA.**
