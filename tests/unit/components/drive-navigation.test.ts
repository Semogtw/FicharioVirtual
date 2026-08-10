import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellPath = 'src/lib/components/AppShell.svelte';
const mobilePath = 'src/lib/components/MobileNavigation.svelte';

describe('Drive recovery navigation', () => {
	it('adds Google Drive to the desktop navigation', () => {
		const source = readFileSync(shellPath, 'utf8');

		expect(source).toContain("{ href: '/drive/', label: 'Drive', icon: 'drive' }");
		expect(source).toContain('<NavigationIcon name={item.icon}');
	});

	it('keeps recovery and coverage reachable from the mobile navigation', () => {
		const source = readFileSync(mobilePath, 'utf8');

		expect(source).toContain("{ href: '/coverage/', label: 'Cobertura', icon: 'coverage' }");
		expect(source).toContain("{ href: '/drive/', label: 'Drive', icon: 'drive' }");
		expect(source).toContain('href={item.href}');
		expect(source).toContain('{item.label}');
		expect(source).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))');
	});
});