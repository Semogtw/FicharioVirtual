import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const routesRoot = join(process.cwd(), 'src', 'routes');
const verifierSources = [
	'tools/checks/check-real-app-flows.mjs',
	'tools/checks/check-real-app-actions.mjs',
	'tools/checks/check-real-app-exhaustive.mjs'
]
	.map((file) => readFileSync(file, 'utf8'))
	.join('\n');

function staticPageRoutes(directory = routesRoot): string[] {
	const entries = readdirSync(directory, { withFileTypes: true });
	const hasPage = entries.some(
		(entry) => entry.isFile() && (entry.name === '+page.svelte' || entry.name === '+page.ts')
	);
	const relativeDirectory = relative(routesRoot, directory);
	const segments = relativeDirectory ? relativeDirectory.split(sep) : [];
	const isStatic = segments.every(
		(segment) => !segment.startsWith('[') && !segment.startsWith('(')
	);
	const current = hasPage && isStatic ? [`/${segments.length > 0 ? `${segments.join('/')}/` : ''}`] : [];
	const children = entries
		.filter((entry) => entry.isDirectory())
		.flatMap((entry) => staticPageRoutes(join(directory, entry.name)));
	return [...current, ...children];
}

describe('real deployed route coverage', () => {
	it('mentions every static user-facing page in a real Playwright verifier', () => {
		const routes = staticPageRoutes().filter((route) => route !== '/');
		expect(routes.length).toBeGreaterThan(0);
		for (const route of routes) {
			expect(verifierSources, `${route} is missing from the real deployed flow verifiers`).toContain(
				route
			);
		}
	});

	it('covers the dynamic document and notebook page families', () => {
		expect(verifierSources).toContain('/documents/${');
		expect(verifierSources).toContain('/notebooks/${');
	});
});
