# Editorial Themes Design

## Goal

Add a persistent color-theme system to the Fichário Virtual while preserving the current editorial, paper-like visual language. The feature must include the existing palette and three additional light palettes, including a pastel pink theme.

## Scope

The feature changes colors only. Typography, spacing, radii, shadows, information hierarchy, navigation structure and component behavior remain unchanged.

The available themes are:

1. **Arquivo** — the existing warm paper, terracotta and archive-green palette.
2. **Rosa Pastel** — blush paper, dusty rose accents and muted mauve archive tones.
3. **Azul Neblina** — cool paper, mist blue accents and desaturated blue-green archive tones.
4. **Lavanda Papel** — pale lavender paper, soft violet accents and grey-purple archive tones.

All themes remain light, calm and low-saturation so the product keeps the same identity rather than becoming a collection of unrelated skins.

## Architecture

### Theme catalog and browser lifecycle

Create `src/lib/theme/theme.ts` as the single source of truth for:

- theme identifiers and display metadata;
- storage key and default theme;
- validation of persisted values;
- application of `data-theme` to the root `<html>` element;
- synchronization of the browser `theme-color` meta tag;
- persistence in `localStorage`;
- cross-tab synchronization through the `storage` event.

The client hook initializes the theme before session and queue startup. Invalid or unavailable browser storage must fall back safely to `Arquivo` without preventing application startup.

### CSS tokens

Keep semantic variables such as `--paper`, `--surface`, `--ink`, `--archive` and `--accent`. Add RGB-channel variants for translucent overlays and a small number of missing semantic tokens such as `--archive-strong`, `--muted-strong` and `--selection`.

The default values remain on `:root`. Additional palettes are selected with `:root[data-theme='rose']`, `:root[data-theme='mist']` and `:root[data-theme='lavender']`.

Existing components that embed current palette RGB values directly will be converted to semantic variables so every palette remains coherent across the shell, cards, imports, review states and login page.

### Settings user interface

Create `src/lib/components/ThemePicker.svelte` and place it near the top of the Settings page.

The picker uses an accessible radio group. Each option shows:

- theme name;
- short description;
- four real palette swatches;
- visible selected state.

Choosing an option applies it immediately and persists it. The current option is restored after refresh and updates when another tab changes the theme.

## Error handling

- Missing `localStorage`, blocked storage or malformed persisted values use `Arquivo`.
- Applying a theme must not throw if the theme-color meta tag is absent.
- A storage event with an invalid value is ignored and resolves to the default palette.
- Theme initialization must never block authentication or queue initialization.

## Testing

- Unit tests cover validation, fallback, persistence, root dataset changes, meta theme-color updates and storage-event synchronization.
- Source-contract tests verify that theme initialization occurs in the client hook and the Settings page includes the picker.
- Playwright verifies selecting Rosa Pastel, persistence after reload, root attribute, checked state and meta theme color.
- The full lint, type-check, unit, build and relevant Playwright gates run before completion.
- Final Playwright screenshots show the real Rosa Pastel theme on Settings and Home at desktop and mobile sizes with only backend responses mocked.
