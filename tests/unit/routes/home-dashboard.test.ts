import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/+page.svelte', 'utf8');

describe('home dashboard', () => {
	it('loads real usage totals and recent documents through validated services', () => {
		expect(source).toContain("import AnimatedNumber from '$lib/components/AnimatedNumber.svelte';");
		expect(source).toContain("import DocumentCard from '$lib/components/DocumentCard.svelte';");
		expect(source).toContain("import { listDocuments } from '$lib/services/documents';");
		expect(source).toContain("import { loadUsageOverview } from '$lib/services/usage';");
		expect(source).toMatch(
			/Promise\.allSettled\(\[[\s\S]*loadUsageOverview\(\)[\s\S]*listDocuments\(\{ limit: 6 \}\)[\s\S]*\]\)/
		);
		expect(source).toContain('<AnimatedNumber value={usage?.totals.documents ?? null} />');
		expect(source).toContain('<AnimatedNumber value={usage?.totals.pages ?? null} />');
		expect(source).toContain('<AnimatedNumber value={usage?.totals.reviewPages ?? null} />');
		expect(source).toContain('{#each recentDocuments as document (document.id)}');
		expect(source).toContain('<DocumentCard {document} />');
		expect(source).not.toContain('<strong>0</strong>');
	});

	it('keeps each dashboard section available when only the other source fails', () => {
		expect(source).toContain("usageResult.status === 'fulfilled'");
		expect(source).toContain("documentsResult.status === 'fulfilled'");
		expect(source).toContain('let documentsAvailable = $state(false);');
		expect(source).toContain('Parte do resumo não pôde ser atualizada.');
		expect(source).toContain('Os documentos recentes não puderam ser carregados.');
	});

	it('ignores stale dashboard loads and offers an explicit retry', () => {
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const dashboardRequests = new RequestVersion();');
		expect(source).toContain('dashboardRequests.isCurrent(version)');
		expect(source).toContain('onclick={() => void loadDashboard()}');
		expect(source).toContain('onDestroy(() => {');
	});
});
