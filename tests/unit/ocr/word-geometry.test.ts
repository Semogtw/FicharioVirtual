import { describe, expect, it } from 'vitest';
import {
	geometryPercent,
	matchingWordGeometry,
	parseWordGeometry
} from '../../../src/lib/ocr/word-geometry';

describe('OCR word geometry', () => {
	it('parses normalized persisted boxes', () => {
		expect(parseWordGeometry([['fotossintcse', 1200, 2400, 3500, 2900]])).toEqual([
			{ text: 'fotossintcse', left: 1200, top: 2400, right: 3500, bottom: 2900 }
		]);
	});

	it('rejects the whole persisted geometry when one box is malformed', () => {
		expect(
			parseWordGeometry([
				['válida', 100, 100, 200, 200],
				['inválida', 9000, 100, 10001, 200]
			])
		).toEqual([]);
	});

	it('selects an OCR typo box with the same fuzzy rules used by textual search markers', () => {
		const geometry = parseWordGeometry([
			['A', 200, 200, 300, 350],
			['fotossintcse', 400, 200, 1800, 350],
			['transforma', 1900, 200, 3000, 350]
		]);

		expect(matchingWordGeometry(geometry, 'fotossíntese')).toEqual([
			{ text: 'fotossintcse', left: 400, top: 200, right: 1800, bottom: 350 }
		]);
	});

	it('does not fuzzy-select short unrelated boxes', () => {
		const geometry = parseWordGeometry([['DNA', 100, 100, 300, 200]]);
		expect(matchingWordGeometry(geometry, 'DNB')).toEqual([]);
	});

	it('converts the normalized grid to CSS percentages', () => {
		expect(geometryPercent(1250)).toBe('12.5%');
		expect(geometryPercent(10000)).toBe('100%');
	});
});
