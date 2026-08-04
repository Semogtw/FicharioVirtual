import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/+page.svelte', 'utf8');

describe('home dashboard', () => {
	it('loads real usage totals and recent documents through validated services', () => {
		expect(source).toContain("import DocumentCard from '$lib/components/DocumentCard.svelte';");
		expect(source).toContain("import { listDocuments } from '$lib/services/documents';");
		expect(source).toContain("import { loadUsageOverview } from '$lib/services/usage';");
		expect(source).toContain('Promise.all([loadUsageOverview(), listDocuments({ limit: 6 })])');
		expect(source).toContain('usage.totals.documents');
		expect(source).toContain('usage.totals.pages');
		expect(source).toContain('usage.totals.reviewPages');
		expect(source).toContain('{#each recentDocuments as document (document.id)}');
		expect(source).toContain('<DocumentCard {document} />');
		expect(source).not.toContain('<strong>0</strong>');
	});

	it('ignores stale dashboard loads and offers an explicit retry', () => {
		expect(source).toContain("import { RequestVersion } from '$lib/services/request-version';");
		expect(source).toContain('const dashboardRequests = new RequestVersion();');
		expect(source).toContain('dashboardRequests.isCurrent(version)');
		expect(source).toContain('onclick={() => void loadDashboard()}');
		expect(source).toContain('onDestroy(() => {');
	});
});
