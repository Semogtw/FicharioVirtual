import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/20260814113500_adaptive_visual_embeddings.sql',
	'utf8'
);
const dispatch = readFileSync(
	'supabase/migrations/20260814114500_visual_embedding_dispatch.sql',
	'utf8'
);
const enqueue = readFileSync(
	'supabase/functions/_shared/visual-embedding-enqueue.ts',
	'utf8'
);
const processOcr = readFileSync('supabase/functions/process-ocr/index.ts', 'utf8');
const backgroundOcr = readFileSync('supabase/functions/ocr-queue-worker/index.ts', 'utf8');
const desktopOcr = readFileSync('supabase/functions/desktop-ocr-worker/index.ts', 'utf8');
const worker = readFileSync('supabase/functions/semantic-visual-worker/index.ts', 'utf8');
const indexer = readFileSync('supabase/functions/_shared/background-visual-indexer.ts', 'utf8');
const search = readFileSync('supabase/functions/semantic-search/index.ts', 'utf8');
const renderer = readFileSync('src/lib/pdf/renderer.ts', 'utf8');
const imageWorker = readFileSync('src/lib/import/image-worker.ts', 'utf8');

describe('adaptive visual semantic implementation contract', () => {
	it('stores one page-level visual vector separately from textual chunks', () => {
		expect(migration).toContain('create table public.page_visual_embeddings');
		expect(migration).toContain('embedding extensions.vector(768) not null');
		expect(migration).toContain('unique (user_id, page_id, model)');
		expect(migration).toContain('page_visual_embeddings_hnsw_idx');
		expect(migration).not.toContain('alter table public.page_semantic_chunks add');
	});

	it('routes post-OCR enrichment only after durable OCR completion', () => {
		expect(enqueue).toContain('decideVisualEmbedding');
		expect(enqueue).toContain('queue_page_visual_embedding_job');
		expect(enqueue).toContain('queue_page_visual_embedding_job_as_user');
		for (const source of [processOcr, backgroundOcr, desktopOcr]) {
			expect(source).toContain('enqueueVisualEmbeddingAfterOcr');
		}
		expect(processOcr.indexOf('complete_ocr_job_with_geometry')).toBeLessThan(
			processOcr.indexOf('enqueueVisualEmbeddingAfterOcr({')
		);
		expect(backgroundOcr.indexOf("'complete_geometry'")).toBeLessThan(
			backgroundOcr.indexOf('enqueueVisualEmbeddingAfterOcr({')
		);
		expect(desktopOcr.indexOf('complete_desktop_ocr_job_with_geometry')).toBeLessThan(
			desktopOcr.indexOf('enqueueVisualEmbeddingAfterOcr({')
		);
	});

	it('uses image-only Gemini embeddings in a low-priority independently authenticated worker', () => {
		expect(worker).toContain("request.headers.get('X-Fichario-Worker-Key')");
		expect(indexer).toContain('requestGeminiVisualEmbeddings');
		expect(indexer).toContain('inputs: prepared.map');
		expect(indexer).not.toContain('ocr_raw_text');
		expect(indexer).not.toContain('corrected_text');
		expect(dispatch).toContain("'*/5 * * * *'");
	});

	it('prepares new OCR media as JPEG while preserving originals elsewhere', () => {
		expect(renderer).toContain("toBlob(canvas, 'image/jpeg'");
		expect(renderer).not.toContain("toBlob(canvas, 'image/webp'");
		expect(imageWorker).toContain("convertToBlob({ type: 'image/jpeg'");
		expect(imageWorker).not.toContain("convertToBlob({ type: 'image/webp'");
	});

	it('supports shadow visual retrieval and an explicit active three-channel mode', () => {
		expect(search).toContain("Deno.env.get('SEMANTIC_VISUAL_MODE') ?? 'shadow'");
		expect(search).toContain("supabase.rpc('search_pages_visual_semantic'");
		expect(search).toContain("visualMode === 'active' ? visual : []");
		expect(search).toContain("matchMode: 'visual'");
		expect(search).toContain("excerpt: ''");
		expect(search).toContain("mode: visualMode === 'active' ? 'multimodal' : 'hybrid'");
	});

	it('keeps quota/provider failures degradable and visual jobs idempotent', () => {
		expect(migration).toContain('unique (user_id, page_id, model)');
		expect(migration).toContain(
			"status in ('queued', 'processing', 'retryable', 'blocked_quota', 'ready', 'failed')"
		);
		expect(migration).toContain("j.status = 'processing' and j.claimed_at < now() - interval '5 minutes'");
		expect(indexer).toContain('target_source_hash: job.sourceHash');
		expect(indexer).toContain('error.status === 429');
		expect(indexer).toContain("status: 'blocked_quota'");
	});
});
