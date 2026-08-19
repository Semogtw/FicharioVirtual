import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/checks/check-real-app-actions.mjs', 'utf8');

describe('real deployed action contract', () => {
	it('cleans synthetic documents through the production deletion path before notebooks', () => {
		expect(source).toContain("client.functions.invoke('delete-document'");
		expect(source).toContain('await cleanupDocuments(client);');
		expect(source).toContain('await cleanupNotebooks(client);');
		expect(source.indexOf('await cleanupDocuments(client);')).toBeLessThan(
			source.indexOf('await cleanupNotebooks(client);')
		);
	});

	it('validates the original-first product without resurrecting manual review', () => {
		expect(source).toContain("stage('document-original-first', 'running');");
		expect(source).toContain('Removed manual review editor is visible');
		expect(source).toContain('Removed review semantics are visible in document detail');
		expect(source).toContain("stage('mobile-responsive-sweep', 'running');");
	});
});
