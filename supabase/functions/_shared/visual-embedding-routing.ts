import type { OcrContentClass } from './ocr-batch-contract.ts';

export const VISUAL_EMBEDDING_ROUTING_VERSION = 'visual-v1' as const;

export type VisualEmbeddingReason =
	| 'native_text'
	| 'clean_textual_page'
	| 'handwriting'
	| 'degraded_scan'
	| 'mixed_content'
	| 'table_layout'
	| 'math'
	| 'ocr_review'
	| 'ocr_warning'
	| 'sparse_content'
	| 'near_blank'
	| 'unknown_conservative';

export type VisualEmbeddingDecision = Readonly<{
	eligible: boolean;
	reason: VisualEmbeddingReason;
	routingVersion: typeof VISUAL_EMBEDDING_ROUTING_VERSION;
}>;

export type VisualEmbeddingRoutingInput = Readonly<{
	hasNativeText: boolean;
	contentClass: OcrContentClass;
	warningCount: number;
	needsReview: boolean;
	effectiveTextLength: number;
	wordBoxCount: number;
}>;

const NATIVE_TEXT_SUFFICIENT_CHARS = 80;
const SPARSE_USEFUL_TEXT_CHARS = 24;
const SPARSE_USEFUL_WORD_BOXES = 4;

function decision(eligible: boolean, reason: VisualEmbeddingReason): VisualEmbeddingDecision {
	return Object.freeze({ eligible, reason, routingVersion: VISUAL_EMBEDDING_ROUTING_VERSION });
}

function validate(input: VisualEmbeddingRoutingInput) {
	if (
		typeof input.hasNativeText !== 'boolean' ||
		typeof input.needsReview !== 'boolean' ||
		!Number.isInteger(input.warningCount) ||
		input.warningCount < 0 ||
		input.warningCount > 256 ||
		!Number.isInteger(input.effectiveTextLength) ||
		input.effectiveTextLength < 0 ||
		input.effectiveTextLength > 1_000_000 ||
		!Number.isInteger(input.wordBoxCount) ||
		input.wordBoxCount < 0 ||
		input.wordBoxCount > 100_000
	) {
		throw new TypeError('Invalid visual embedding routing input');
	}
}

export function decideVisualEmbedding(input: VisualEmbeddingRoutingInput): VisualEmbeddingDecision {
	validate(input);
	if (input.hasNativeText && input.effectiveTextLength >= NATIVE_TEXT_SUFFICIENT_CHARS) {
		return decision(false, 'native_text');
	}

	if (input.contentClass === 'sparse') {
		const useful =
			input.effectiveTextLength >= SPARSE_USEFUL_TEXT_CHARS ||
			input.wordBoxCount >= SPARSE_USEFUL_WORD_BOXES ||
			input.warningCount > 0 ||
			input.needsReview;
		if (!useful) return decision(false, 'near_blank');
		return decision(true, 'sparse_content');
	}

	if (input.contentClass === 'book_clean' && input.warningCount === 0 && !input.needsReview) {
		return decision(false, 'clean_textual_page');
	}

	switch (input.contentClass) {
		case 'handwriting':
			return decision(true, 'handwriting');
		case 'scan_degraded':
			return decision(true, 'degraded_scan');
		case 'mixed':
			return decision(true, 'mixed_content');
		case 'table_layout':
			return decision(true, 'table_layout');
		case 'math':
			return decision(true, 'math');
		default:
			break;
	}

	if (input.needsReview) return decision(true, 'ocr_review');
	if (input.warningCount > 0) return decision(true, 'ocr_warning');
	return decision(false, 'unknown_conservative');
}

export function visualEmbeddingMimeTypeFromPath(path: string | null) {
	if (!path) return null;
	const normalized = path.toLowerCase();
	if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg' as const;
	if (normalized.endsWith('.png')) return 'image/png' as const;
	return null;
}
