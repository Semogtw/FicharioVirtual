import { describe, expect, it } from 'vitest';
import { safelyWipeBytes } from '../../../src/lib/pdf/safe-wipe';

describe('safelyWipeBytes', () => {
	it('clears a normal byte array', () => {
		const bytes = new Uint8Array([1, 2, 3, 255]);
		safelyWipeBytes(bytes);
		expect([...bytes]).toEqual([0, 0, 0, 0]);
	});

	it('does not throw when a WASM-like consumer detached the backing buffer', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		structuredClone(bytes.buffer, { transfer: [bytes.buffer] });

		expect(bytes.byteLength).toBe(0);
		expect(() => safelyWipeBytes(bytes)).not.toThrow();
	});

	it('accepts an absent buffer', () => {
		expect(() => safelyWipeBytes(null)).not.toThrow();
	});
});
