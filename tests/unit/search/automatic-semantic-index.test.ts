import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/202608131210_background_semantic_index.sql',
	'utf8'
);
const cronMigration = readFileSync(
	'supabase/migrations/202608131215_background_semantic_cron.sql',
	'utf8'
);
const worker = readFileSync('supabase/functions/semantic-index-worker/index.ts', 'utf8');
const indexer = readFileSync(
	'supabase/functions/_shared/background-semantic-indexer.ts',
	'utf8'
);
const config = readFileSync('supabase/config.toml', 'utf8');

describe('automatic semantic indexing', () => {
	it('keeps the background dispatcher service-role only', () => {
		expect(migration).toContain('list_background_semantic_users');
		expect(migration).toContain('background_semantic_as_user');
		expect(migration).toContain('from public, anon, authenticated');
		expect(migration).toContain('to service_role');
	});

	it('uses the dedicated embedding model rather than either OCR model', () => {
		expect(indexer).toContain('SEMANTIC_EMBEDDING_MODEL');
		expect(indexer).toContain("taskType: 'RETRIEVAL_DOCUMENT'");
		expect(indexer).not.toContain('OCR_MODEL_PRIMARY');
		expect(indexer).not.toContain('OCR_MODEL_FALLBACK');
	});

	it('indexes stale page text without requiring a browser search or coverage request', () => {
		expect(cronMigration).toContain("'fichario-background-semantic-index'");
		expect(cronMigration).toContain("'* * * * *'");
		expect(cronMigration).toContain("'/functions/v1/semantic-index-worker'");
		expect(worker).toContain('indexBackgroundSemanticPass');
		expect(worker).toContain('EdgeRuntime.waitUntil');
		expect(config).toMatch(/\[functions\.semantic-index-worker\]\s+verify_jwt = false/);
	});
});
