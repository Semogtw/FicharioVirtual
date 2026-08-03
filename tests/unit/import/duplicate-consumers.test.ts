import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const imageUpload = readFileSync(
	new URL('../../../src/lib/import/upload.ts', import.meta.url),
	'utf8'
);
const pdfUpload = readFileSync(new URL('../../../src/lib/pdf/upload.ts', import.meta.url), 'utf8');

describe('duplicate response consumers', () => {
	it('uses the strict parser for image imports', () => {
		expect(imageUpload).toContain('parseDuplicateDocumentId(duplicateResult.data)');
		expect(imageUpload).not.toContain('new DuplicateImageError(duplicate.id)');
	});

	it('uses the strict parser for PDF imports', () => {
		expect(pdfUpload).toContain('parseDuplicateDocumentId(data)');
		expect(pdfUpload).not.toContain('return data?.id ?? null');
	});
});
