import { describe, expect, it, vi } from 'vitest';
import {
	NotebookBannerError,
	notebookBannerObjectPath,
	parseBannerPosition,
	validateNotebookBannerFile
} from '../../../src/lib/services/notebook-banners';

const userId = '11111111-1111-4111-8111-111111111111';
const notebookId = '22222222-2222-4222-8222-222222222222';

describe('notebook banner validation', () => {
	it('accepts supported images and positions', () => {
		expect(() => validateNotebookBannerFile({ type: 'image/webp', size: 1_024 })).not.toThrow();
		expect(parseBannerPosition(0)).toBe(0);
		expect(parseBannerPosition(50)).toBe(50);
		expect(parseBannerPosition(100)).toBe(100);
	});

	it('rejects unsupported or oversized banner files', () => {
		expect(() => validateNotebookBannerFile({ type: 'image/svg+xml', size: 1_024 })).toThrow(
			NotebookBannerError
		);
		expect(() =>
			validateNotebookBannerFile({ type: 'image/jpeg', size: 12 * 1024 * 1024 + 1 })
		).toThrow('O banner deve ter no máximo 12 MB antes da otimização.');
	});

	it('rejects invalid focal positions', () => {
		for (const value of [-1, 101, 10.5, Number.NaN]) {
			expect(() => parseBannerPosition(value)).toThrow('Invalid banner position');
		}
	});

	it('builds a user-owned notebook banner path', () => {
		vi.stubGlobal('crypto', { randomUUID: () => '33333333-3333-4333-8333-333333333333' });
		expect(notebookBannerObjectPath(userId, notebookId, 'image/webp')).toBe(
			`${userId}/notebook-banners/${notebookId}/33333333-3333-4333-8333-333333333333.webp`
		);
		vi.unstubAllGlobals();
	});
});
