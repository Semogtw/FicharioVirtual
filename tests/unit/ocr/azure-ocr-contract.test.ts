import { describe, expect, it } from 'vitest';
import { parseAzureReadOperation } from '../../../supabase/functions/_shared/azure-ocr-contract';

const page = {
	pageId: '11111111-1111-4111-8111-111111111111',
	pageNumber: 3
};

function successPayload() {
	return {
		status: 'succeeded',
		analyzeResult: {
			version: '3.2.0',
			readResults: [
				{
					page: 1,
					width: 1000,
					height: 2000,
					appearance: { styles: [{ name: 'handwriting', confidence: 0.9 }] },
					lines: [
						{
							text: 'Olá mundo',
							words: [
								{
									text: 'Olá',
									boundingBox: [100, 200, 300, 200, 300, 300, 100, 300],
									confidence: 0.99
								},
								{
									text: 'mundo',
									boundingBox: [320, 200, 600, 200, 600, 300, 320, 300],
									confidence: 0.7
								}
							]
						}
					]
				}
			]
		}
	};
}

describe('Azure Read operation parser', () => {
	it('normalizes a successful page into the internal OCR contract', () => {
		const result = parseAzureReadOperation(successPayload(), page, 0.8);

		expect(result).not.toBeNull();
		expect(result?.state).toBe('succeeded');
		expect(result?.modelVersion).toBe('3.2.0');
		expect(result?.page).toEqual({
			pageId: page.pageId,
			pageNumber: 3,
			text: 'Olá mundo',
			warnings: [
				{
					code: 'uncertain_text',
					message: 'A leitura contém palavras com baixa confiança.'
				}
			],
			needsReview: true,
			contentClass: 'handwriting',
			wordGeometry: [
				['Olá', 1000, 1000, 3000, 1500],
				['mundo', 3200, 1000, 6000, 1500]
			]
		});
	});

	it('does not invent low-confidence warnings until a threshold is configured', () => {
		const result = parseAzureReadOperation(successPayload(), page);
		expect(result?.page?.warnings).toEqual([]);
		expect(result?.page?.needsReview).toBe(false);
	});

	it('maps provider pending states without accepting a result body', () => {
		expect(parseAzureReadOperation({ status: 'notStarted' }, page)).toEqual({
			state: 'running',
			page: null,
			modelVersion: null
		});
		expect(parseAzureReadOperation({ status: 'running' }, page)).toEqual({
			state: 'running',
			page: null,
			modelVersion: null
		});
	});

	it('maps provider failure without leaking provider details', () => {
		expect(
			parseAzureReadOperation(
				{ status: 'failed', error: { message: 'provider secret-ish diagnostics' } },
				page
			)
		).toEqual({ state: 'failed', page: null, modelVersion: null });
	});

	it('fails closed on multiple readResults, invalid geometry and unknown status', () => {
		const multiple = successPayload();
		multiple.analyzeResult.readResults.push(multiple.analyzeResult.readResults[0]);
		expect(parseAzureReadOperation(multiple, page)).toBeNull();

		const badGeometry = successPayload();
		badGeometry.analyzeResult.readResults[0].lines[0].words[0].boundingBox = [
			-1, 0, 1, 0, 1, 1, 0, 1
		];
		expect(parseAzureReadOperation(badGeometry, page)).toBeNull();
		expect(parseAzureReadOperation({ status: 'mystery' }, page)).toBeNull();
	});

	it('marks an empty successful page for review', () => {
		const payload = successPayload();
		payload.analyzeResult.readResults[0].lines = [];
		const result = parseAzureReadOperation(payload, page);
		expect(result?.page?.text).toBe('');
		expect(result?.page?.warnings).toEqual([
			{ code: 'empty_page', message: 'Nenhum texto legível foi detectado.' }
		]);
		expect(result?.page?.needsReview).toBe(true);
	});
});
