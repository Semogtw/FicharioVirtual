import { describe, expect, it } from 'vitest';
import {
	correctionDraftKey,
	parseCorrectionDraft,
	serializeCorrectionDraft
} from '../../../src/lib/review/drafts';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pageId = '11111111-1111-4111-8111-111111111111';

describe('correction drafts', () => {
	it('uses a user- and page-scoped v2 key without document text', () => {
		expect(correctionDraftKey(userId, pageId)).toBe(
			`fichario:correction-draft:v2:${userId}:${pageId}`
		);
	});

	it('round-trips a bounded versioned draft for its owner only', () => {
		const serialized = serializeCorrectionDraft(userId, {
			pageId,
			text: 'Texto corrigido\ncom duas linhas.',
			updatedAt: '2026-08-02T03:00:00.000Z'
		});

		expect(JSON.parse(serialized)).toEqual(expect.objectContaining({ version: 2, userId, pageId }));
		expect(parseCorrectionDraft(serialized, userId, pageId)).toEqual({
			pageId,
			text: 'Texto corrigido\ncom duas linhas.',
			updatedAt: '2026-08-02T03:00:00.000Z'
		});
		expect(parseCorrectionDraft(serialized, otherUserId, pageId)).toBeNull();
	});

	it('rejects legacy, cross-page, malformed and oversized records', () => {
		expect(parseCorrectionDraft('{', userId, pageId)).toBeNull();
		expect(
			parseCorrectionDraft(
				serializeCorrectionDraft(userId, {
					pageId,
					text: 'texto',
					updatedAt: '2026-08-02T03:00:00.000Z'
				}),
				userId,
				'22222222-2222-4222-8222-222222222222'
			)
		).toBeNull();
		expect(
			parseCorrectionDraft(
				JSON.stringify({
					version: 1,
					userId,
					pageId,
					text: 'legado',
					updatedAt: '2026-08-02T03:00:00.000Z'
				}),
				userId,
				pageId
			)
		).toBeNull();
		expect(
			parseCorrectionDraft(
				JSON.stringify({
					version: 2,
					pageId,
					text: 'sem proprietário',
					updatedAt: '2026-08-02T03:00:00.000Z'
				}),
				userId,
				pageId
			)
		).toBeNull();
		expect(() =>
			serializeCorrectionDraft(userId, {
				pageId,
				text: 'x'.repeat(1_000_001),
				updatedAt: new Date().toISOString()
			})
		).toThrow('Invalid correction draft');
		expect(() =>
			serializeCorrectionDraft(userId, {
				pageId,
				text: 'texto',
				updatedAt: '2026-02-30T00:00:00.000Z'
			})
		).toThrow('Invalid correction draft');
		expect(
			parseCorrectionDraft(
				JSON.stringify({
					version: 2,
					userId,
					pageId,
					text: 'texto',
					updatedAt: '2026-02-30T00:00:00.000Z'
				}),
				userId,
				pageId
			)
		).toBeNull();
	});
});
