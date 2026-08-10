import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('theme CSS tokens', () => {
	it('defines all editorial palettes and semantic translucent channels', () => {
		const tokens = readFileSync('src/lib/design/tokens.css', 'utf8');
		expect(tokens).toContain(":root[data-theme='rose']");
		expect(tokens).toContain(":root[data-theme='mist']");
		expect(tokens).toContain(":root[data-theme='lavender']");
		for (const token of [
			'--paper-rgb',
			'--surface-rgb',
			'--ink-rgb',
			'--line-rgb',
			'--accent-rgb',
			'--archive-rgb',
			'--success',
			'--success-rgb',
			'--warning',
			'--warning-rgb',
			'--danger-rgb',
			'--archive-strong',
			'--muted-strong',
			'--selection'
		]) {
			expect(tokens).toContain(token);
		}
		expect(tokens).toContain('--success: var(--archive)');
		expect(tokens).toContain('--success-rgb: var(--archive-rgb)');
		expect(tokens).toContain('--warning: var(--accent)');
		expect(tokens).toContain('--warning-rgb: var(--accent-rgb)');
	});

	it('keeps primary application surfaces free from fixed original-palette overlays', () => {
		const primarySurfaces = [
			'src/lib/components/AppShell.svelte',
			'src/lib/components/MobileNavigation.svelte',
			'src/lib/components/ThemePicker.svelte',
			'src/lib/components/TopSearch.svelte',
			'src/lib/components/DocumentCard.svelte',
			'src/lib/components/EmptyState.svelte',
			'src/routes/+page.svelte',
			'src/routes/settings/+page.svelte',
			'src/routes/settings/computers/+page.svelte',
			'src/routes/settings/computers/queue/+page.svelte'
		];
		const offenders = primarySurfaces.filter((path) => {
			const source = readFileSync(path, 'utf8');
			return /rgb\((?:166 94 67|83 106 91|252 250 246|247 244 238|221 215 204|32 33 36|155 63 54)\s*\//.test(
				source
			);
		});
		expect(offenders).toEqual([]);
	});
});
