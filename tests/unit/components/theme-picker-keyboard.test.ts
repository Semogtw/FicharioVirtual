import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/ThemePicker.svelte', 'utf8');

describe('theme picker keyboard navigation', () => {
	it('implements roving focus and arrow-key navigation for the radio group', () => {
		expect(source).toContain('tabindex={activeTheme === theme.id ? 0 : -1}');
		expect(source).toContain('onkeydown={(event) => navigateTheme(event, theme.id)}');
		expect(source).toContain("event.key === 'ArrowRight'");
		expect(source).toContain("event.key === 'ArrowLeft'");
		expect(source).toContain("event.key === 'Home'");
		expect(source).toContain("event.key === 'End'");
		expect(source).toContain('nextButton?.focus()');
	});
});
