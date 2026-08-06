import { describe, expect, it } from 'vitest';
import {
	deleteStoredImageImport,
	listStoredImageImports,
	parseStoredImageImport,
	saveStoredImageImport,
	type ImportResumeStore,
	type StoredImageImportRecord
} from '../../../src/lib/import/resume-store';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const resumeKey = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-08-04T18:00:00.000Z';

function record(overrides: Partial<StoredImageImportRecord> = {}): StoredImageImportRecord {
	return {
		version: 1,
		id: 'local-image-1',
		userId,
		sessionId,
		resumeKey,
		file: new File(['image'], 'page.jpg', { type: 'image/jpeg', lastModified: 1 }),
		mode: 'standard',
		notebookId: null,
		status: 'queued',
		preparedBytes: null,
		result: null,
		error: null,
		updatedAt: timestamp,
		...overrides
	};
}

class MemoryStore implements ImportResumeStore {
	readonly records = new Map<string, unknown>();

	async put(value: StoredImageImportRecord) {
		this.records.set(value.id, value);
	}

	async list() {
		return [...this.records.values()];
	}

	async delete(id: string) {
		this.records.delete(id);
	}
}

describe('parseStoredImageImport', () => {
	it('accepts exact File-backed records and freezes public metadata', () => {
		const result = parseStoredImageImport(record());

		expect(result.file).toBeInstanceOf(File);
		expect(result.resumeKey).toBe(resumeKey);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('accepts legacy and Drive published pages so OCR resumes without another upload', () => {
		const legacy = parseStoredImageImport(
			record({
				status: 'waiting',
				result: {
					documentId: '50000000-0000-4000-8000-000000000001',
					pageId: '50000000-0000-4000-8000-000000000002',
					ocrJobId: '50000000-0000-4000-8000-000000000003',
					sha256: 'a'.repeat(64),
					storagePath: `${userId}/document/original.webp`,
					thumbnailPath: `${userId}/document/thumbnail.webp`
				}
			})
		);
		const drive = parseStoredImageImport(
			record({
				status: 'waiting',
				result: {
					documentId: '50000000-0000-4000-8000-000000000011',
					pageId: '50000000-0000-4000-8000-000000000012',
					ocrJobId: '50000000-0000-4000-8000-000000000013',
					sha256: 'b'.repeat(64),
					storagePath: 'drive:1AbCdEfGhIjKlMnOpQrStUvWxYz_123456',
					thumbnailPath: `${userId}/document/thumbnail.webp`
				}
			})
		);

		expect(legacy.result?.pageId).toBe('50000000-0000-4000-8000-000000000002');
		expect(drive.result?.storagePath).toBe('drive:1AbCdEfGhIjKlMnOpQrStUvWxYz_123456');
	});

	it('rejects unsupported versions, unsafe files, extra keys and malformed results', () => {
		expect(() => parseStoredImageImport({ ...record(), version: 2 })).toThrow(
			'Invalid stored image import'
		);
		expect(() => parseStoredImageImport({ ...record(), file: new Blob(['x']) })).toThrow(
			'Invalid stored image import'
		);
		expect(() => parseStoredImageImport({ ...record(), extra: true })).toThrow(
			'Invalid stored image import'
		);
		expect(() =>
			parseStoredImageImport({
				...record(),
				result: { pageId: 'bad' }
			})
		).toThrow('Invalid stored image import');
		expect(() =>
			parseStoredImageImport(
				record({
					result: {
						documentId: '50000000-0000-4000-8000-000000000011',
						pageId: '50000000-0000-4000-8000-000000000012',
						ocrJobId: '50000000-0000-4000-8000-000000000013',
						sha256: 'b'.repeat(64),
						storagePath: 'drive:bad id',
						thumbnailPath: `${userId}/document/thumbnail.webp`
					}
				})
			)
		).toThrow('Invalid stored image import');
	});
});

describe('resume store operations', () => {
	it('filters by owner and returns the oldest resumable item first', async () => {
		const store = new MemoryStore();
		store.records.set('newer', record({ id: 'newer', updatedAt: '2026-08-04T19:00:00.000Z' }));
		store.records.set(
			'other',
			record({ id: 'other', userId: otherUserId, updatedAt: '2026-08-04T17:00:00.000Z' })
		);
		store.records.set('older', record({ id: 'older', updatedAt: '2026-08-04T16:00:00.000Z' }));

		const result = await listStoredImageImports(userId, store);

		expect(result.map((item) => item.id)).toEqual(['older', 'newer']);
	});

	it('persists and deletes validated records', async () => {
		const store = new MemoryStore();
		await saveStoredImageImport(record(), store);
		expect(store.records.has('local-image-1')).toBe(true);

		await deleteStoredImageImport('local-image-1', store);
		expect(store.records.size).toBe(0);
	});
});
