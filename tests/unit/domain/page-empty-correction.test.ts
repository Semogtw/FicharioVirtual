import { expect, it } from 'vitest';
import { effectivePageText } from '../../../src/lib/domain/page';

it('treats an empty correction as absent and preserves the source text', () => {
	expect(
		effectivePageText({ correctedText: '', nativeText: 'Texto nativo', ocrRawText: 'Texto OCR' })
	).toBe('Texto nativo');
});
