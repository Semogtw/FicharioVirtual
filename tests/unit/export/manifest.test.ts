import { describe, expect, it } from 'vitest';
import { exportFilename, parseExportManifest } from '../../../src/lib/export/manifest';

const manifest = {
	schemaVersion: 1,
	exportedAt: '2026-08-02T06:00:00.000Z',
	notebooks: [
		{
			id: 'notebook-1',
			name: 'Biologia',
			description: null,
			coverStyle: 'linen',
			createdAt: '2026-08-01T00:00:00.000Z',
			updatedAt: '2026-08-02T00:00:00.000Z'
		}
	],
	documents: [
		{
			id: 'document-1',
			title: 'Mitose',
			kind: 'pdf',
			status: 'ready',
			originalFilename: 'mitose.pdf',
			sha256: 'a'.repeat(64),
			notebookId: 'notebook-1',
			createdAt: '2026-08-01T00:00:00.000Z',
			updatedAt: '2026-08-02T00:00:00.000Z',
			tags: ['citologia'],
			pages: [
				{
					id: 'page-1',
					pageNumber: 1,
					nativeText: 'Texto nativo',
					ocrRawText: null,
					correctedText: null,
					effectiveText: 'Texto nativo',
					extractionSource: 'native_pdf',
					warnings: [],
					status: 'ready',
					wasManuallyReviewed: false,
					updatedAt: '2026-08-02T00:00:00.000Z'
				}
			]
		}
	]
};

describe('export manifest', () => {
	it('accepts the versioned portable payload without storage paths', () => {
		const parsed = parseExportManifest(manifest);
		expect(parsed.documents[0]?.pages[0]?.effectiveText).toBe('Texto nativo');
		expect(JSON.stringify(parsed)).not.toContain('storage_path');
	});

	it('rejects unknown schema versions and malformed arrays', () => {
		expect(() => parseExportManifest({ ...manifest, schemaVersion: 2 })).toThrow(
			'Invalid export manifest'
		);
		expect(() => parseExportManifest({ ...manifest, documents: {} })).toThrow(
			'Invalid export manifest'
		);
	});

	it('creates a stable UTC JSON filename', () => {
		expect(exportFilename('2026-08-02T06:07:08.000Z')).toBe('fichario-2026-08-02T06-07-08Z.json');
	});
});
