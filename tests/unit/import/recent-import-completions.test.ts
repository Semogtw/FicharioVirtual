import { describe, expect, it } from 'vitest';
import { RecentImportCompletions } from '../../../src/lib/import/recent-import-completions';

describe('RecentImportCompletions', () => {
	it('retains a completion until it is explicitly forgotten', () => {
		const completions = new RecentImportCompletions();

		completions.remember('image-1');

		expect(completions.has('image-1')).toBe(true);
		completions.forget('image-1');
		expect(completions.has('image-1')).toBe(false);
	});

	it('expires old entries while refreshing repeated completions', () => {
		let now = 1_000;
		const completions = new RecentImportCompletions({ ttlMs: 100, now: () => now });
		completions.remember('image-1');
		now = 1_050;
		completions.remember('image-1');
		now = 1_120;

		expect(completions.has('image-1')).toBe(true);
		now = 1_150;
		expect(completions.has('image-1')).toBe(false);
	});

	it('evicts the oldest entries when the bounded cache is full', () => {
		const completions = new RecentImportCompletions({ maxEntries: 2 });
		completions.remember('image-1');
		completions.remember('image-2');
		completions.remember('image-3');

		expect(completions.has('image-1')).toBe(false);
		expect(completions.has('image-2')).toBe(true);
		expect(completions.has('image-3')).toBe(true);
	});

	it('rejects invalid cache bounds', () => {
		expect(() => new RecentImportCompletions({ ttlMs: 0 })).toThrow(TypeError);
		expect(() => new RecentImportCompletions({ maxEntries: 0 })).toThrow(TypeError);
	});
});
