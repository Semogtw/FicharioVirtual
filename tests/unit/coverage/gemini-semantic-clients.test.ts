import { describe, expect, it, vi } from 'vitest';
import {
	embeddingVectorText,
	requestGeminiEmbeddings
} from '../../../supabase/functions/_shared/gemini-embedding-client';

function vector(dimensions: number, first = 3, second = 4) {
	const values = Array.from({ length: dimensions }, () => 0);
	values[0] = first;
	values[1] = second;
	return values;
}

describe('Gemini semantic clients', () => {
	it('uses instruction text instead of taskType for Gemini Embedding 2', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ embeddings: [{ values: vector(768) }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const [result] = await requestGeminiEmbeddings({
			apiKey: 'test-key',
			model: 'gemini-embedding-2',
			inputs: [{ text: 'ΔU = Q - W', title: 'Termodinâmica — página 1' }],
			taskType: 'RETRIEVAL_DOCUMENT',
			outputDimensionality: 768,
			fetchImpl
		});
		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as {
			requests: Array<{
				content: { parts: Array<{ text: string }> };
				embedContentConfig: Record<string, unknown>;
			}>;
		};
		expect(body.requests[0]?.content.parts[0]?.text).toContain('recuperação semântica');
		expect(body.requests[0]?.content.parts[0]?.text).toContain('Termodinâmica — página 1');
		expect(body.requests[0]?.embedContentConfig).toEqual({
			outputDimensionality: 768,
			autoTruncate: true
		});
		expect(result?.[0]).toBeCloseTo(0.6);
		expect(result?.[1]).toBeCloseTo(0.8);
	});

	it('uses retrieval task configuration for older compatible embedding models', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ embeddings: [{ values: vector(768, 1, 0) }] }), {
				status: 200
			})
		);
		await requestGeminiEmbeddings({
			apiKey: 'test-key',
			model: 'gemini-embedding-001',
			inputs: [{ text: 'calor específico' }],
			taskType: 'RETRIEVAL_QUERY',
			outputDimensionality: 768,
			fetchImpl
		});
		const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as {
			requests: Array<{ embedContentConfig: Record<string, unknown> }>;
		};
		expect(body.requests[0]?.embedContentConfig.taskType).toBe('RETRIEVAL_QUERY');
	});

	it('serializes normalized vectors for pgvector without JSON ambiguity', () => {
		expect(embeddingVectorText([0.25, -0.5])).toBe('[0.250000000000,-0.500000000000]');
	});
});
