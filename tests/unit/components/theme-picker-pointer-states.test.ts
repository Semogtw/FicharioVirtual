import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/ThemePicker.svelte', 'utf8');

describe('theme picker pointer states', () => {
	it('limits hover elevation to devices with a precise hover-capable pointer', () => {
		const mediaIndex = source.indexOf('@media (hover: hover) and (pointer: fine)');
		const hoverIndex = source.indexOf('button:hover');

		expect(mediaIndex).toBeGreaterThanOrEqual(0);
		expect(hoverIndex).toBeGreaterThan(mediaIndex);
	});
});
