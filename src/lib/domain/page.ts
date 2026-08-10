import { parseWordGeometry, type WordGeometry } from '$lib/ocr/word-geometry';
import type { ExtractionSource, Json, ProcessingStatus } from '$lib/types/database';

export type PageWarning = {
	code: string;
	message: string;
};

export type PageTextSources = {
	correctedText: string | null;
	nativeText: string | null;
	ocrRawText: string | null;
};

export type PageDetail = PageTextSources & {
	id: string;
	pageNumber: number;
	text: string;
	extractionSource: ExtractionSource | null;
	wordGeometry: readonly WordGeometry[];
	warnings: readonly PageWarning[];
	status: ProcessingStatus;
	wasManuallyReviewed: boolean;
	updatedAt: string;
};

export type PageRecord = {
	id: string;
	page_number: number;
	native_text: string | null;
	ocr_raw_text: string | null;
	corrected_text: string | null;
	extraction_source: ExtractionSource | null;
	ocr_word_geometry?: Json;
	warnings: Json;
	status: ProcessingStatus;
	was_manually_reviewed: boolean;
	updated_at: string;
};

export function effectivePageText(sources: PageTextSources): string {
	if (sources.correctedText !== null && sources.correctedText.trim().length > 0) {
		return sources.correctedText;
	}
	return sources.nativeText ?? sources.ocrRawText ?? '';
}

function safeWarnings(value: Json): readonly PageWarning[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return Object.freeze(
		value.flatMap((candidate) => {
			if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
				return [];
			const code = candidate.code;
			const message = candidate.message;
			if (
				typeof code !== 'string' ||
				!/^[a-z][a-z0-9_]{1,63}$/.test(code) ||
				typeof message !== 'string' ||
				message.trim().length === 0 ||
				message.length > 300
			) {
				return [];
			}
			return [Object.freeze({ code, message: message.trim() })];
		})
	);
}

export function mapPageRecord(record: PageRecord): PageDetail {
	const sources: PageTextSources = {
		correctedText: record.corrected_text,
		nativeText: record.native_text,
		ocrRawText: record.ocr_raw_text
	};
	return Object.freeze({
		id: record.id,
		pageNumber: record.page_number,
		...sources,
		text: effectivePageText(sources),
		extractionSource: record.extraction_source,
		wordGeometry: parseWordGeometry(record.ocr_word_geometry ?? []),
		warnings: safeWarnings(record.warnings),
		status: record.status,
		wasManuallyReviewed: record.was_manually_reviewed,
		updatedAt: record.updated_at
	});
}
