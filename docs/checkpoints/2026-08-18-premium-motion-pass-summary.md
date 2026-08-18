# Premium motion implementation summary

Implementado em `feat/premium-continuity-motion`:

1. `AnimatedNumber.svelte` para os três totais do dashboard.
2. View Transitions no shell com superfície compartilhada para o card de documento selecionado.
3. Fallback de entrada de rota preservado para navegadores sem suporte.
4. Painéis transitórios do dashboard e a Fila passam a animar também ao sair.
5. Regras globais de `prefers-reduced-motion` cobrem as novas View Transitions.
