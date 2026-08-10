import { describe, expect, it } from 'vitest';
import { pdfTextItemsToWordGeometry } from '../../../src/lib/pdf/text-geometry';

const viewport = {
	width: 1000,
	height: 1000,
	convertToViewportPoint(x: number, y: number): [number, number] {
		return [x, 1000 - y];
	}
};

describe('native PDF word geometry', () => {
	it('splits a selectable text item into normalized word boxes', () => {
		const geometry = pdfTextItemsToWordGeometry(
			[
				{
					str: 'Energia solar',
					width: 400,
					height: 20,
					transform: [10, 0, 0, 10, 100, 800]
				}
			],
			viewport
		);

		expect(geometry.map((box) => box.text)).toEqual(['Energia', 'solar']);
		expect(geometry[0]).toMatchObject({ left: 1000, top: 1800, bottom: 2000 });
		expect(geometry[1]?.right).toBe(5000);
		expect(geometry[0]!.right).toBeLessThan(geometry[1]!.left);
	});

	it('keeps rotated text inside the normalized page grid', () => {
		const geometry = pdfTextItemsToWordGeometry(
			[
				{
					str: 'Vertical',
					width: 200,
					height: 24,
					transform: [0, 10, -10, 0, 300, 200]
				}
			],
			viewport
		);

		expect(geometry).toHaveLength(1);
		expect(geometry[0]?.text).toBe('Vertical');
		expect(geometry[0]!.left).toBeGreaterThanOrEqual(0);
		expect(geometry[0]!.top).toBeGreaterThanOrEqual(0);
		expect(geometry[0]!.right).toBeLessThanOrEqual(10_000);
		expect(geometry[0]!.bottom).toBeLessThanOrEqual(10_000);
	});

	it('ignores marked-content sentinels and malformed text items', () => {
		expect(
			pdfTextItemsToWordGeometry(
				[
					{ type: 'beginMarkedContent', id: 'x' },
					{ str: '', width: 10, height: 10, transform: [1, 0, 0, 1, 0, 0] },
					{ str: 'válido', width: 100, height: 10, transform: [1, 0, 0, 1, 10, 10] }
				],
				viewport
			).map((box) => box.text)
		).toEqual(['válido']);
	});
});
