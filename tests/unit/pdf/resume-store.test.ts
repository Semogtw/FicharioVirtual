import { describe, expect, it } from 'vitest';
import { MAX_LOCAL_PDF_BYTES } from '../../../src/lib/pdf/limits';
import {
	deleteStoredPdfImport,
	listStoredPdfImports,
	parseStoredPdfImport,
	saveStoredPdfImport,
	type PdfResumeStore,
	type StoredPdfImportRecord
} from '../../../src/lib/pdf/resume-store';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const resumeKey = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-08-04T18:00:00.000Z';

function reportedSizePdf(size: number) {
	const file = new File(['pdf'], 'large.pdf', { type: 'application/pdf', lastModified: 1 });
	Object.defineProperty(file, 'size', { value: size });
	return file;
}

function record(overrides: Partial<StoredPdfImportRecord> = {}): StoredPdfImportRecord {
	return {
		version: 1,
		id: 'local-pdf-1',
		userId,
		sessionId,
		resumeKey,
		file: new File(['pdf'], 'notes.pdf', { type: 'application/pdf', lastModified: 1 }),
		notebookId: null,
		consentGranted: true,
		status: 'queued',
		inspected: false,
		uploaded: false,
		published: false,
		error: null,
		updatedAt: timestamp,
		...overrides
	};
}

class MemoryStore implements PdfResumeStore {
	readonly records = new Map<string, unknown>();

	async put(value: StoredPdfImportRecord) {
		this.records.set(value.id, value);
	}

	async list() {
		return [...this.records.values()];
	}

	async delete(id: string) {
		this.records.delete(id);
	}
}

describe('parseStoredPdfImport', () => {
	it('accepts exact PDF records and freezes metadata', () => {
		const result = parseStoredPdfImport(record());

		expect(result.file).toBeInstanceOf(File);
		expect(result.resumeKey).toBe(resumeKey);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('rejects resumable PDFs above the 20 MiB ceiling', () => {
		expect(() =>
			parseStoredPdfImport(record({ file: reportedSizePdf(MAX_LOCAL_PDF_BYTES + 1) }))
		).toThrow('Invalid stored PDF import');
		expect(
			parseStoredPdfImport(record({ file: reportedSizePdf(MAX_LOCAL_PDF_BYTES) })).file.size
		).toBe(MAX_LOCAL_PDF_BYTES);
	});

	it('rejects unsupported versions, unsafe files, extra keys and malformed ownership', () => {
		expect(() => parseStoredPdfImport({ ...record(), version: 2 })).toThrow(
			'Invalid stored PDF import'
		);
		expect(() =>
			parseStoredPdfImport({
				...record(),
				file: new File(['image'], 'notes.png', { type: 'image/png' })
			})
		).toThrow('Invalid stored PDF import');
		expect(() => parseStoredPdfImport({ ...record(), extra: true })).toThrow(
			'Invalid stored PDF import'
		);
		expect(() => parseStoredPdfImport({ ...record(), userId: 'bad' })).toThrow(
			'Invalid stored PDF import'
		);
		expect(() => parseStoredPdfImport(record({ uploaded: true, inspected: false }))).toThrow(
			'Invalid stored PDF import'
		);
		expect(() => parseStoredPdfImport(record({ published: true, uploaded: false }))).toThrow(
			'Invalid stored PDF import'
		);
	});
});

describe('PDF resume store operations', () => {
	it('filters by owner and returns the oldest resumable item first', async () => {
		const store = new MemoryStore();
		store.records.set('newer', record({ id: 'newer', updatedAt: '2026-08-04T19:00:00.000Z' }));
		store.records.set(
			'other',
			record({ id: 'other', userId: otherUserId, updatedAt: '2026-08-04T17:00:00.000Z' })
		);
		store.records.set('older', record({ id: 'older', updatedAt: '2026-08-04T16:00:00.000Z' }));

		const result = await listStoredPdfImports(userId, store);

		expect(result.map((item) => item.id)).toEqual(['older', 'newer']);
	});

	it('persists and deletes validated records', async () => {
		const store = new MemoryStore();
		await saveStoredPdfImport(record(), store);
		expect(store.records.has('local-pdf-1')).toBe(true);

		await deleteStoredPdfImport('local-pdf-1', store);
		expect(store.records.size).toBe(0);
	});
});
