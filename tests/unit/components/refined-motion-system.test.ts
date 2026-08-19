import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync('src/lib/design/tokens.css', 'utf8');
const globalCss = readFileSync('src/lib/design/global.css', 'utf8');
const shell = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
const nativeSelect = readFileSync(
	'src/lib/components/ui/native-select/NativeSelect.svelte',
	'utf8'
);
const themePicker = readFileSync('src/lib/components/ThemePicker.svelte', 'utf8');

describe('refined motion system', () => {
	it('defines slower layered timings and easing curves centrally', () => {
		for (const token of ['--motion-slow', '--motion-page', '--ease-soft', '--ease-in-out']) {
			expect(tokens).toContain(token);
		}
	});

	it('animates route entry without animating query-only updates', () => {
		expect(shell).toContain('{#key page.url.pathname}');
		expect(shell).toContain('route-content-enter');
		expect(shell).toContain('var(--motion-page)');
	});

	it('adds soft status and staggered collection entrances', () => {
		expect(globalCss).toContain('@keyframes ui-soft-enter');
		expect(globalCss).toContain('@keyframes ui-list-enter');
		expect(globalCss).toContain('.document-card');
		expect(globalCss).toContain('.queue-panel li:nth-child(3)');
	});

	it('keeps motion accessibility opt-out authoritative', () => {
		expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)');
		expect(globalCss).toContain('animation-duration: 0.01ms !important');
		expect(globalCss).toContain('transition-duration: 0.01ms !important');
	});

	it('removes hard-coded snap timings from recurring controls', () => {
		expect(nativeSelect).not.toContain('120ms ease');
		expect(themePicker).not.toContain('120ms ease');
		expect(nativeSelect).toContain('var(--ease-emphasized)');
		expect(themePicker).toContain('class:visible={activeTheme === theme.id}');
	});
});
