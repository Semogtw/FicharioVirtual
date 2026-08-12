import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const picker = readFileSync('src/lib/components/ThemePicker.svelte', 'utf8');
const settings = readFileSync('src/routes/settings/+page.svelte', 'utf8');

describe('theme picker', () => {
	it('renders an accessible four-option palette selector with real swatches', () => {
		expect(picker).toContain('role="radiogroup"');
		expect(picker).toContain('aria-checked={activeTheme === theme.id}');
		expect(picker).toContain('{#each THEMES as theme (theme.id)}');
		expect(picker).toContain('{#each theme.swatches as swatch}');
		expect(picker).toContain('selectTheme(theme.id)');
	});

	it('places appearance controls near the top of Settings', () => {
		expect(settings).toContain("import ThemePicker from '$lib/components/ThemePicker.svelte';");
		expect(settings).toContain('<ThemePicker />');
		expect(settings).toContain('Baixar meus dados');
		expect(settings.indexOf('<ThemePicker />')).toBeLessThan(settings.indexOf('Baixar meus dados'));
	});
});
