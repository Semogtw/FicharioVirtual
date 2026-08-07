import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentPath = 'src/lib/components/ui/native-select/NativeSelect.svelte';
const adoptedRoutes = [
	'src/routes/library/+page.svelte',
	'src/routes/search/+page.svelte',
	'src/routes/import/+page.svelte',
	'src/routes/import/pdf/+page.svelte',
	'src/routes/library/organize/+page.svelte',
	'src/routes/import/drive/+page.svelte'
];

describe('shadcn-style native select primitive', () => {
	it('keeps native select semantics while centralizing the visual treatment', () => {
		const source = readFileSync(componentPath, 'utf8');

		expect(source).toContain('<select');
		expect(source).toContain('appearance: none');
		expect(source).toContain('aria-hidden="true"');
		expect(source).toContain('var(--surface-strong)');
		expect(source).toContain('var(--line-strong)');
	});

	it.each(adoptedRoutes)('%s uses the shared primitive instead of styling a raw select', (path) => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain("$lib/components/ui/native-select/NativeSelect.svelte");
		expect(source).not.toContain('<select');
	});
});
