import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('tools/checks/check-real-app-actions.mjs', 'utf8');

describe('real deployed action cleanup contract', () => {
	it('removes synthetic documents through the authenticated deletion contract before notebooks', () => {
		expect(source).toContain("client.functions.invoke('delete-document'");
		expect(source).toContain('body: { documentId: id }');
		expect(source).toContain("client.rpc('delete_notebook'");
	});

	it('gives background processing and queue completion enough time to settle', () => {
		expect(source).toContain('waitForUsableDocument(client, documentId, timeoutMs = 180_000)');
		expect(source).toContain('waitForQueueTerminal(page, filename, timeoutMs = 180_000)');
	});
});
