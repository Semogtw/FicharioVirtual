import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const database = readFileSync('src/lib/import/resume-database.ts', 'utf8');
const imageStore = readFileSync('src/lib/import/resume-store.ts', 'utf8');
const pdfStore = readFileSync('src/lib/pdf/resume-store.ts', 'utf8');

describe('resume database account isolation', () => {
	it('queries the IndexedDB userId index before materializing resumable files', () => {
		expect(database).toContain("store.index('userId').getAll(userId)");
		expect(imageStore).toContain('store.list(ownerId)');
		expect(pdfStore).toContain('store.list(ownerId)');
	});
});
