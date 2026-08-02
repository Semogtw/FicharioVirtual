import { describe, expect, it } from 'vitest';
import { calculateSha256 } from '../../../src/lib/import/hash';

describe('calculateSha256', () => {
	it('returns a lowercase hexadecimal digest', async () => {
		const digest = await calculateSha256(new TextEncoder().encode('abc'));

		expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});

	it('accepts blobs without mutating their bytes', async () => {
		const blob = new Blob(['fichario']);
		const before = await blob.text();

		await expect(calculateSha256(blob)).resolves.toMatch(/^[0-9a-f]{64}$/);
		expect(await blob.text()).toBe(before);
	});
});
