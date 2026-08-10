import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edge = readFileSync('supabase/functions/semantic-coverage/index.ts', 'utf8');
const verifier = readFileSync(
	'supabase/functions/_shared/gemini-coverage-verifier.ts',
	'utf8'
);

describe('semantic coverage Edge Function source contracts', () => {
	it('indexes only complete page chunk sets within the per-run budget', () => {
		expect(edge).toContain('const chunks = chunkSemanticText(page.source_text);');
		expect(edge).toContain(
		'if (flattened.length + chunks.length > MAX_INDEX_CHUNKS_PER_RUN) break;'
	);
		expect(edge).not.toContain(
		'if (flattened.length >= MAX_INDEX_CHUNKS_PER_RUN) break;\n\t\t\tflattened.push'
	);
	});

	it('returns complete index metadata when query embeddings fall back to lexical search', () => {
		expect(edge).toContain(
		'const stats = await indexStats(supabase, embeddingModel, parsed.notebookId);'
	);
		expect(edge).toContain('index: stats ? { ...stats, indexedThisRun: 0 } : null');
	});

	it('keeps semantic provider telemetry wired into document and query embedding calls', () => {
		expect(edge).toContain("from '../_shared/semantic-provider-telemetry.ts'");
		expect(edge).toContain("operation: 'document_embedding'");
		expect(edge).toContain("operation: 'query_embedding'");
	});

	it('bounds Gemini verifier output tokens', () => {
		expect(verifier).toContain('maxOutputTokens: 2_048');
	});
});
