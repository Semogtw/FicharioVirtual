# Premium motion pass validation scope

O pacote visual deve ser aceito somente se os gates automáticos confirmarem:

- formatação, lint, `svelte-check`, testes unitários e build;
- gates de fonte offline;
- Playwright em Chromium;
- Edge Functions e banco local permanecendo sem regressão em relação ao HEAD base.

As animações são progressivas: ausência de View Transitions API ou preferência por movimento reduzido mantém a navegação funcional sem depender dos efeitos visuais.
