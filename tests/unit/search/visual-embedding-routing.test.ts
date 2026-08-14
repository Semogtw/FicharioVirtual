import { describe, expect, it } from 'vitest';
import { decideVisualEmbedding } from '../../../supabase/functions/_shared/visual-embedding-routing';

const base = {
	hasNativeText: false,
	contentClass: 'unknown' as const,
	warningCount: 0,
	needsReview: false,
	effectiveTextLength: 120,
	wordBoxCount: 20
};

describe('visual embedding routing', () => {
	it('keeps good native text and clean book pages textual', () => {
		expect(decideVisualEmbedding({ ...base, hasNativeText: true })).toMatchObject({
			eligible: false,
			reason: 'native_text',
			routingVersion: 'visual-v1'
		});
		expect(decideVisualEmbedding({ ...base, contentClass: 'book_clean' })).toMatchObject({
			eligible: false,
			reason: 'clean_textual_page'
		});
	});

	it.each([
		['handwriting', 'handwriting'],
		['scan_degraded', 'degraded_scan'],
		['mixed', 'mixed_content'],
		['table_layout', 'table_layout'],
		['math', 'math']
	] as const)('routes %s visually', (contentClass, reason) => {
		expect(decideVisualEmbedding({ ...base, contentClass })).toMatchObject({
			eligible: true,
			reason
		});
	});

	it('uses review and warning signals without an extra classifier', () => {
		expect(decideVisualEmbedding({ ...base, needsReview: true })).toMatchObject({
			eligible: true,
			reason: 'ocr_review'
		});
		expect(decideVisualEmbedding({ ...base, warningCount: 1 })).toMatchObject({
			eligible: true,
			reason: 'ocr_warning'
		});
	});

	it('does not spend quota on near-blank sparse pages', () => {
		expect(
			decideVisualEmbedding({
				...base,
				contentClass: 'sparse',
				effectiveTextLength: 2,
				wordBoxCount: 1
			})
		).toMatchObject({ eligible: false, reason: 'near_blank' });
		expect(
			decideVisualEmbedding({
				...base,
				contentClass: 'sparse',
				effectiveTextLength: 28,
				wordBoxCount: 2
			})
		).toMatchObject({ eligible: true, reason: 'sparse_content' });
	});

	it('stays conservative for unknown clean pages', () => {
		expect(decideVisualEmbedding(base)).toMatchObject({
			eligible: false,
			reason: 'unknown_conservative'
		});
	});
});
