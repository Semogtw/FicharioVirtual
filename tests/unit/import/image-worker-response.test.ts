import { describe, expect, it } from 'vitest';
import { parseImageWorkerResponse } from '../../../src/lib/import/image-client';

const id = 'image-task-1';

function success(overrides: Record<string, unknown> = {}) {
	return {
		type: 'success',
		id,
		image: new Blob(['image'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
		width: 1200,
		height: 900,
		format: 'image/webp',
		...overrides
	};
}

describe('parseImageWorkerResponse', () => {
	it('accepts an exact successful worker response', () => {
		const input = success();
		const result = parseImageWorkerResponse(input, id, 2560);

		expect(result).toEqual(input);
		expect(Object.isFrozen(result)).toBe(true);
	});

	it('accepts exact documented worker failures', () => {
		expect(
			parseImageWorkerResponse({ type: 'failure', id, code: 'decode_failed' }, id, 2560)
		).toEqual({ type: 'failure', id, code: 'decode_failed' });
	});

	it.each([
		null,
		{},
		{ type: 'failure', id: 'other', code: 'decode_failed' },
		{ type: 'failure', id, code: 'unknown' },
		{ type: 'failure', id, code: 'decode_failed', extra: true },
		success({ id: 'other' }),
		success({ width: 0 }),
		success({ height: 2561 }),
		success({ format: 'image/jpeg' }),
		success({ image: new Blob([], { type: 'image/webp' }) }),
		success({ thumbnail: new Blob(['thumb'], { type: 'image/png' }) }),
		success({ extra: true })
	])('rejects malformed worker response %#', (value) => {
		expect(() => parseImageWorkerResponse(value, id, 2560)).toThrow(
			'Invalid image worker response'
		);
	});
});
