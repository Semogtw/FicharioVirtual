import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localMediaCacheBudgetBytes } from '../../../src/lib/pwa/media-preview-cache';

const MEBIBYTE = 1024 * 1024;
const viewer = readFileSync('src/lib/components/DocumentMediaViewer.svelte', 'utf8');
const imageUpload = readFileSync('src/lib/import/upload.ts', 'utf8');

describe('local media preview cache', () => {
	it('keeps a bounded cache that scales with the browser storage quota', () => {
		expect(localMediaCacheBudgetBytes()).toBe(256 * MEBIBYTE);
		expect(localMediaCacheBudgetBytes(100 * MEBIBYTE)).toBe(64 * MEBIBYTE);
		expect(localMediaCacheBudgetBytes(4 * 1024 * MEBIBYTE)).toBe(
			Math.floor(4 * 1024 * MEBIBYTE * 0.08)
		);
		expect(localMediaCacheBudgetBytes(100 * 1024 * MEBIBYTE)).toBe(512 * MEBIBYTE);
	});

	it('opens cached PDF pages before loading page metadata or touching Drive', () => {
		const cacheLookup = viewer.indexOf('publishCachedPdfSummaries(');
		const metadataLookup = viewer.indexOf('loadRequestedDetails(', cacheLookup);
		expect(cacheLookup).toBeGreaterThan(-1);
		expect(metadataLookup).toBeGreaterThan(cacheLookup);
		expect(viewer).toContain('readLocalMediaPreview');
		expect(viewer).toContain('writeLocalMediaPreview');
		expect(viewer).toContain('cachePdfPreview(page, blob)');
	});

	it('stores a compact representation instead of copying downloaded image originals', () => {
		expect(viewer).toContain('createLocalImagePreview(blob)');
		expect(viewer).not.toContain('writeLocalMediaPreview(key, blob);\n\t\tconst pageDriveFileId');
		expect(imageUpload).toContain('input.prepared.image');
		expect(imageUpload).toContain('warmImportedImagePreview');
		expect(imageUpload).not.toContain('input.prepared.original\n\t);');
	});
});
