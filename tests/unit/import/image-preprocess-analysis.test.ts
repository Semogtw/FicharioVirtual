import { describe, expect, it } from 'vitest';
import { analyzeDocumentLuma } from '../../../src/lib/import/image-preprocess-analysis';

function plane(width: number, height: number, fill = 245) {
	return { width, height, pixels: new Uint8Array(width * height).fill(fill) };
}

function darkPixel(target: ReturnType<typeof plane>, x: number, y: number, value = 35) {
	if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
	target.pixels[y * target.width + x] = value;
}

function horizontalText(target: ReturnType<typeof plane>, skewDegrees = 0) {
	const slope = Math.tan((skewDegrees * Math.PI) / 180);
	for (let line = 0; line < 8; line += 1) {
		const baseY = 32 + line * 24;
		for (let x = 26; x < target.width - 26; x += 1) {
			const y = Math.round(baseY + slope * (x - target.width / 2));
			for (let thickness = 0; thickness < 3; thickness += 1) {
				darkPixel(target, x, y + thickness);
			}
		}
	}
}

describe('analyzeDocumentLuma', () => {
	it('keeps a flat clean page unchanged', () => {
		const result = analyzeDocumentLuma(plane(128, 128));
		expect(result).toEqual(
			expect.objectContaining({
				autoCropApplied: false,
				deskewMilliDegrees: 0,
				contrastEnhanced: false,
				illuminationNormalized: false,
				retainedAreaPermille: 1000
			})
		);
	});

	it('crops only clear blank margins around text', () => {
		const page = plane(256, 256);
		horizontalText(page);
		const result = analyzeDocumentLuma(page);
		expect(result.autoCropApplied).toBe(true);
		expect(result.cropLeft).toBeGreaterThan(0);
		expect(result.cropTop).toBeGreaterThan(0);
		expect(result.cropRight).toBeLessThan(256);
		expect(result.cropBottom).toBeLessThan(256);
		expect(result.retainedAreaPermille).toBeGreaterThanOrEqual(580);
	});

	it('detects a confident small skew without allowing large rotations', () => {
		const page = plane(256, 256);
		horizontalText(page, 2);
		const result = analyzeDocumentLuma(page);
		expect(result.deskewMilliDegrees).toBeLessThanOrEqual(-1000);
		expect(result.deskewMilliDegrees).toBeGreaterThanOrEqual(-4000);
	});

	it('marks uneven bright-page illumination for normalization', () => {
		const page = plane(256, 256, 235);
		for (let y = 0; y < page.height; y += 1) {
			for (let x = 0; x < page.width / 2; x += 1) {
				page.pixels[y * page.width + x] = 180;
			}
		}
		horizontalText(page);
		const result = analyzeDocumentLuma(page);
		expect(result.illuminationNormalized).toBe(true);
	});

	it('rejects malformed luminance planes', () => {
		expect(() => analyzeDocumentLuma({ width: 16, height: 16, pixels: new Uint8Array(3) })).toThrow(
			'Invalid document luminance plane'
		);
	});
});
