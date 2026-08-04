import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/+page.svelte', 'utf8');

describe('home dashboard partial recovery', () => {
	it('offers a background retry when only one dashboard source failed', () => {
		expect(source).toContain('let refreshing = $state(false);');
		expect(source).toContain('const hasContent = usage !== null || documentsAvailable;');
		expect(source).toContain('if (hasContent) refreshing = true;');
		expect(source).toContain('aria-busy={loading || refreshing}');
		expect(source).toContain('{#if warning}');
		expect(source).toContain('<div class="warning" role="status">');
		expect(source).toContain('<p>{warning}</p>');
		expect(source).toContain('disabled={loading || refreshing}');
		expect(source).toContain('onclick={() => void loadDashboard()}');
		expect(source).toContain("{refreshing ? 'Atualizando…' : 'Tentar atualizar novamente'}");
	});

	it('does not erase previously valid sections when a background source fails', () => {
		expect(source).not.toContain('else usage = null;');
		expect(source).not.toMatch(/else \{\s*recentDocuments = \[\];\s*documentsAvailable = false;/);
		expect(source).toContain('if (hasContent) {');
		expect(source).toContain("warning = 'Não foi possível atualizar o resumo agora.';");
	});
});
