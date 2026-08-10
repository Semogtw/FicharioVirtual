import { describe, expect, it } from 'vitest';
import { parseImageWorkerResponse } from '../../../src/lib/import/image-client';

const id = 'image-task-1';

function preprocessing(overrides: Record<string, unknown> = {}) {
	return {
		profile: 'ocr_clean_v1',
		version: 1,
		autoCropApplied: false,
		retainedAreaPermille: 1000,
		deskewMilliDegrees: 0,
		illuminationNormalized: false,
		contrastEnhanced: false,
		fallbackToStandard: false,
		sourceWidth: 1600,
		sourceHeight: 1200,
		preparedWidth: 1200,
		preparedHeight: 900,
		...overrides
	};
}

function success(overrides: Record<string, unknown> = {}) {
	return {
		type: 'success',
		id,
		image: new Blob(['image'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
		width: 1200,
		height: 900,
		format: 'image/webp',
		preprocessing: preprocessing(),
		...overrides
	};
}

describe('parseImageWorkerResponse', () => {
	it('accepts an exact successful worker response', () => {
		const input = success();
		const result = parseImageWorkerResponse(input, id, 2560);

		expect(result).toEqual(input);
		expect(Object.isFrozen(result)).toBe(true);
		if (result.type === 'success') expect(Object.isFrozen(result.preprocessing)).toBe(true);
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
		success({ height: 3000 }),
		success({ format: 'image/jpeg' }),
		success({ image: new Blob([], { type: 'image/webp' }) }),
		success({ thumbnail: new Blob(['thumb'], { type: 'image/png' }) }),
		success({ preprocessing: preprocessing({ profile: 'unknown' }) }),
		success({ preprocessing: preprocessing({ deskewMilliDegrees: 5000 }) }),
		success({ preprocessing: preprocessing({ retainedAreaPermille: 0 }) }),
		success({ preprocessing: preprocessing({ preparedWidth: 1199 }) }),
		success({ preprocessing: { ...preprocessing(), extra: true } }),
		success({ extra: true })
	])('rejects malformed worker response %#', (value) => {
		expect(() => parseImageWorkerResponse(value, id, 2560)).toThrow(
			'Invalid image worker response'
		);
	});
});
