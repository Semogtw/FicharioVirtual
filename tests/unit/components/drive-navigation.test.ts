import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellPath = 'src/lib/components/AppShell.svelte';
const mobilePath = 'src/lib/components/MobileNavigation.svelte';

describe('Drive recovery navigation', () => {
	it('adds Google Drive to the desktop navigation', () => {
		const source = readFileSync(shellPath, 'utf8');

		expect(source).toContain("{ href: '/drive/', label: 'Drive', mark: '☁' }");
	});

	it('keeps recovery reachable from the mobile navigation', () => {
		const source = readFileSync(mobilePath, 'utf8');

		expect(source).toContain('href="/drive/"');
		expect(source).toContain('<small>Drive</small>');
		expect(source).toContain('grid-template-columns: repeat(5, 1fr)');
	});
});
