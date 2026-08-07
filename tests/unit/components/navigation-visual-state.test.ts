import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appShellSource = readFileSync('src/lib/components/AppShell.svelte', 'utf8');
const mobileNavigationSource = readFileSync('src/lib/components/MobileNavigation.svelte', 'utf8');

describe('navigation visual state', () => {
	it('marks the current destination for desktop and mobile navigation', () => {
		expect(appShellSource).toContain("aria-current={isCurrent(item.href) ? 'page' : undefined}");
		expect(appShellSource).toContain('class:active={isCurrent(item.href)}');
		expect(mobileNavigationSource).toContain(
			"aria-current={isCurrent(item.href) ? 'page' : undefined}"
		);
		expect(mobileNavigationSource).toContain('class:active={isCurrent(item.href)}');
	});

	it('uses one reusable SVG icon component instead of platform-dependent unicode marks', () => {
		expect(appShellSource).toContain("import NavigationIcon from './NavigationIcon.svelte';");
		expect(mobileNavigationSource).toContain(
			"import NavigationIcon from './NavigationIcon.svelte';"
		);
		expect(appShellSource).not.toMatch(/[⌂▤▥＋✓☁⚙]/u);
		expect(mobileNavigationSource).not.toMatch(/[⌂▤▥＋✓☁⚙]/u);
	});
});
