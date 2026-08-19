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

	it('keeps every major area reachable without overcrowding the mobile bar', () => {
		const source = readFileSync(mobilePath, 'utf8');

		expect(source).toContain("{ href: '/notebooks/', label: 'Cadernos', icon: 'notebooks' }");
		expect(source).toContain("{ href: '/coverage/', label: 'Cobertura', icon: 'coverage' }");
		expect(source).toContain("{ href: '/drive/', label: 'Google Drive', icon: 'drive' }");
		expect(source).toContain("{ href: '/settings/', label: 'Configurações', icon: 'settings' }");
		expect(source).toContain('<summary aria-label="Abrir mais opções de navegação">');
		expect(source).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
	});
});
