import { describe, expect, it, vi } from 'vitest';
import type { PreparedImage } from '../../../src/lib/import/image-types';
import { DuplicateImageError } from '../../../src/lib/import/upload';
import {
	CoveragePhotoImportError,
	extractTopicsFromPhotoWithDependencies,
	type CoveragePhotoImportDependencies,
	type CoveragePhotoSourcePage
} from '../../../src/lib/services/coverage-photo-import';
import { OcrProcessingError, type OcrRunResult } from '../../../src/lib/services/ocr';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const JOB_ID = '33333333-3333-4333-8333-333333333333';

function sourcePage(overrides: Partial<CoveragePhotoSourcePage> = {}): CoveragePhotoSourcePage {
	return Object.freeze({
		id: PAGE_ID,
		pageNumber: 1,
		text: '1. Temperatura\n2. Calor específico',
		warningCount: 0,
		status: 'ready',
		...overrides
	});
}

function prepared(file: File): PreparedImage {
	const image = new Blob(['prepared'], { type: 'image/jpeg' });
	const thumbnail = new Blob(['thumb'], { type: 'image/jpeg' });
	return {
		original: file,
		image,
		thumbnail,
		width: 1200,
		height: 1600,
		format: 'image/jpeg',
		preprocessing: {
			profile: 'ocr_clean_v1',
			version: 1,
			autoCropApplied: true,
			retainedAreaPermille: 900,
			deskewMilliDegrees: 0,
			illuminationNormalized: true,
			contrastEnhanced: true,
			fallbackToStandard: false,
			sourceWidth: 1200,
			sourceHeight: 1600,
			preparedWidth: 1200,
			preparedHeight: 1600
		},
		originalName: file.name,
		originalBytes: file.size,
		preparedBytes: image.size + thumbnail.size
	};
}

function dependencies(
	file: File,
	overrides: Partial<CoveragePhotoImportDependencies> = {}
): CoveragePhotoImportDependencies {
	return {
		prepare: vi.fn(async () => prepared(file)),
		upload: vi.fn(async () => ({
			documentId: DOCUMENT_ID,
			pageId: PAGE_ID,
			ocrJobId: JOB_ID,
			sha256: 'a'.repeat(64),
			storagePath: 'temporary',
			thumbnailPath: 'temporary-thumbnail'
		})),
		process: vi.fn(
			async (): Promise<OcrRunResult> => ({
				state: 'complete',
				needsReview: false
			})
		),
		loadPage: vi.fn(async () => sourcePage()),
		loadFirstPage: vi.fn(async () => sourcePage()),
		deleteTemporaryDocument: vi.fn(async () => undefined),
		...overrides
	};
}

describe('coverage photo topic import', () => {
	it('uses the OCR pipeline and removes the temporary document after extraction', async () => {
		const file = new File(['photo'], 'ementa.jpg', { type: 'image/jpeg' });
		const deps = dependencies(file);
		const stages: string[] = [];

		const result = await extractTopicsFromPhotoWithDependencies(file, deps, {
			onStage: (stage) => stages.push(stage)
		});

		expect(result.topics.map((topic) => topic.text)).toEqual(['Temperatura', 'Calor específico']);
		expect(result.reusedExistingDocument).toBe(false);
		expect(result.cleanupWarning).toBe(false);
		expect(deps.deleteTemporaryDocument).toHaveBeenCalledWith(DOCUMENT_ID);
		expect(stages).toEqual(['preparing', 'uploading', 'reading', 'extracting', 'cleaning_up']);
	});

	it('reuses a duplicate document without deleting the user original', async () => {
		const file = new File(['photo'], 'ementa.jpg', { type: 'image/jpeg' });
		const deps = dependencies(file, {
			upload: vi.fn(async () => {
				throw new DuplicateImageError(DOCUMENT_ID);
			}),
			process: vi.fn(
				async (): Promise<OcrRunResult> => ({ state: 'complete', needsReview: false })
			)
		});

		const result = await extractTopicsFromPhotoWithDependencies(file, deps);

		expect(result.reusedExistingDocument).toBe(true);
		expect(deps.loadFirstPage).toHaveBeenCalledWith(DOCUMENT_ID);
		expect(deps.deleteTemporaryDocument).not.toHaveBeenCalled();
	});

	it('returns a cleanup warning without discarding successfully extracted topics', async () => {
		const file = new File(['photo'], 'ementa.jpg', { type: 'image/jpeg' });
		const deps = dependencies(file, {
			deleteTemporaryDocument: vi.fn(async () => {
				throw new Error('cleanup failed');
			})
		});

		const result = await extractTopicsFromPhotoWithDependencies(file, deps);
		expect(result.cleanupWarning).toBe(true);
		expect(result.topics).toHaveLength(2);
	});

	it('cleans up temporary data when OCR remains pending', async () => {
		const file = new File(['photo'], 'ementa.jpg', { type: 'image/jpeg' });
		const deps = dependencies(file, {
			process: vi.fn(async (): Promise<OcrRunResult> => ({ state: 'retry_later' }))
		});

		await expect(extractTopicsFromPhotoWithDependencies(file, deps)).rejects.toMatchObject({
			name: 'CoveragePhotoImportError',
			code: 'ocr_pending'
		} satisfies Partial<CoveragePhotoImportError>);
		expect(deps.deleteTemporaryDocument).toHaveBeenCalledWith(DOCUMENT_ID);
	});

	it('keeps the provider quota message when it arrives as an OCR processing error', async () => {
		const file = new File(['photo'], 'ementa.jpg', { type: 'image/jpeg' });
		const deps = dependencies(file, {
			process: vi.fn(async () => {
				throw new OcrProcessingError('gemini_daily_quota', false, 'Cota do provedor atingida.');
			})
		});

		await expect(extractTopicsFromPhotoWithDependencies(file, deps)).rejects.toMatchObject({
			name: 'CoveragePhotoImportError',
			code: 'quota_exhausted',
			message: 'Cota do provedor atingida.'
		} satisfies Partial<CoveragePhotoImportError>);
	});
});
