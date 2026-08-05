# Editorial Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add four persistent light editorial palettes, including Rosa Pastel, with an accessible settings picker and complete browser validation.

**Architecture:** A typed theme module owns catalog, persistence, DOM application and cross-tab synchronization. CSS semantic tokens switch through a root `data-theme` attribute, while a focused Svelte component exposes the selection UI in Settings.

**Tech Stack:** SvelteKit 5, Svelte 5, TypeScript, CSS custom properties, Vitest, Playwright Chromium.

## Global Constraints

- Preserve the current typography, spacing, radii, shadows and editorial visual language.
- Keep all palettes light and low-saturation.
- Include exactly `Arquivo`, `Rosa Pastel`, `Azul Neblina` and `Lavanda Papel`.
- Persist the choice locally and synchronize it between browser tabs.
- Theme failures must never block authentication, imports or startup.
- Use semantic CSS variables rather than theme-specific component conditionals.
- Do not add dependencies or backend schema changes.

---

### Task 1: Theme domain and lifecycle

**Files:**

- Create: `src/lib/theme/theme.ts`
- Create: `tests/unit/theme/theme.test.ts`
- Modify: `src/hooks.client.ts`
- Create: `tests/unit/hooks/client-theme.test.ts`

**Interfaces:**

- Produces: `ThemeId`, `ThemeDefinition`, `THEMES`, `DEFAULT_THEME`, `THEME_STORAGE_KEY`, `isThemeId`, `readStoredTheme`, `applyTheme`, `selectTheme`, `initializeTheme`.
- Consumes: browser-like storage, document and window interfaces so unit tests remain in the Node environment.

- [x] Write failing tests for valid IDs, invalid stored values, persistence, DOM/meta application and storage-event synchronization.
- [x] Run `pnpm vitest run tests/unit/theme/theme.test.ts tests/unit/hooks/client-theme.test.ts` and confirm failure because the theme module and hook integration do not exist.
- [x] Implement the minimal typed theme module and call `initializeTheme()` at the beginning of the client hook.
- [x] Re-run the focused tests and confirm they pass.

### Task 2: Semantic color palettes

**Files:**

- Modify: `src/lib/design/tokens.css`
- Modify: `src/lib/design/global.css`
- Modify: Svelte/CSS files containing hard-coded current-palette colors under `src/`.
- Create: `tests/unit/theme/theme-tokens.test.ts`

**Interfaces:**

- Consumes: root values selected by `data-theme`.
- Produces: semantic tokens and four complete palettes used by every component.

- [x] Write a failing source-contract test requiring the four selectors, semantic RGB channels and no remaining hard-coded current palette overlays.
- [x] Run `pnpm vitest run tests/unit/theme/theme-tokens.test.ts` and confirm the expected failure.
- [x] Add the four palettes and replace current-palette literals with semantic variables.
- [x] Re-run the focused test and then `pnpm check`.

### Task 3: Accessible theme picker

**Files:**

- Create: `src/lib/components/ThemePicker.svelte`
- Modify: `src/routes/settings/+page.svelte`
- Create: `tests/unit/components/theme-picker.test.ts`

**Interfaces:**

- Consumes: `THEMES`, `readStoredTheme`, `selectTheme`, and theme-change browser events.
- Produces: an accessible radio group with immediate persistent selection.

- [x] Write a failing component source-contract test for the radio group, four theme options, swatches and Settings integration.
- [x] Run `pnpm vitest run tests/unit/components/theme-picker.test.ts` and confirm the picker is missing.
- [x] Implement the picker and responsive Settings integration.
- [x] Re-run the focused tests and `pnpm check`.

### Task 4: Browser persistence and screenshots

**Files:**

- Create: `tests/e2e/theme.spec.ts`
- Create: `tools/capture-theme-ui.mjs`

**Interfaces:**

- Consumes: the built static PWA, mocked Supabase HTTP boundary and real Chromium localStorage/storage events.
- Produces: browser proof and PNG screenshots of the real UI.

- [x] Write a Playwright test selecting Rosa Pastel, checking `data-theme`, persisted storage, checked state and meta theme-color after reload.
- [x] Run `pnpm exec playwright test tests/e2e/theme.spec.ts --project=chromium-tablet` and confirm failure before the UI exists.
- [x] Complete only the minimum production corrections exposed by Playwright.
- [x] Re-run the focused Playwright test until green.
- [x] Add the capture script for Settings and Home on desktop and mobile using Rosa Pastel.
- [x] Run the capture script and inspect all generated screenshots.

### Task 5: Full verification and documentation

**Files:**

- Modify: `docs/CURRENT_STATUS.md`
- Create: `docs/checkpoints/2026-08-05-editorial-themes.md`

**Interfaces:**

- Consumes: exact focused and full gate results.
- Produces: an evidence-backed project status update.

- [x] Run `pnpm lint`.
- [x] Run `pnpm check`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [x] Run `pnpm exec playwright test tests/e2e/theme.spec.ts --project=chromium-tablet`.
- [x] Document the exact result counts without claiming unexecuted external staging gates.
