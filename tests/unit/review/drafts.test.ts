import { describe, expect, it } from 'vitest';
import {
	correctionDraftKey,
	parseCorrectionDraft,
	serializeCorrectionDraft
} from '../../../src/lib/review/drafts';

const pageId = '11111111-1111-4111-8111-111111111111';

describe('correction drafts', () => {
	it('uses a page-scoped key without document text', () => {
		expect(correctionDraftKey(pageId)).toBe(`fichario:correction-draft:v1:${pageId}`);
	});

	it('round-trips a bounded versioned draft', () => {
		const serialized = serializeCorrectionDraft({
			pageId,
			text: 'Texto corrigido\ncom duas linhas.',
			updatedAt: '2026-08-02T03:00:00.000Z'
		});

		expect(parseCorrectionDraft(serialized, pageId)).toEqual({
			pageId,
			text: 'Texto corrigido\ncom duas linhas.',
			updatedAt: '2026-08-02T03:00:00.000Z'
		});
	});

	it('rejects another page, malformed JSON and oversized text', () => {
		expect(parseCorrectionDraft('{', pageId)).toBeNull();
		expect(
			parseCorrectionDraft(
				serializeCorrectionDraft({
					pageId,
					text: 'texto',
					updatedAt: '2026-08-02T03:00:00.000Z'
				}),
				'22222222-2222-4222-8222-222222222222'
			)
		).toBeNull();
		expect(() =>
			serializeCorrectionDraft({ pageId, text: 'x'.repeat(1_000_001), updatedAt: new Date().toISOString() })
		).toThrow('Invalid correction draft');
	});
});
