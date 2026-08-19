# Premium motion continuity pass — 2026-08-18

Este passe fecha os refinamentos de movimento que ficaram após a primeira revisão visual:

- View Transitions progressivas para navegação interna, com fallback para a animação de rota existente.
- O card de documento selecionado compartilha a superfície de transição com a rota de documento, criando continuidade card → documento sem depender da conclusão do carregamento remoto.
- Contadores do resumo da página inicial interpolam mudanças numericamente e mantêm o valor final como única informação exposta à tecnologia assistiva.
- Avisos/erros transitórios do dashboard e o painel global da fila têm entrada e saída suaves.
- `prefers-reduced-motion` continua autoritativo, inclusive sobre View Transitions.

Validação esperada: `pnpm verify`, gates offline e Playwright pelo workflow do repositório.
