import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viewer = readFileSync('src/lib/components/DocumentMediaViewer.svelte', 'utf8');
const correctionEditor = readFileSync('src/lib/components/CorrectionEditor.svelte', 'utf8');
const searchPage = readFileSync('src/routes/search/+page.svelte', 'utf8');
const searchCard = readFileSync('src/lib/components/SearchDocumentCard.svelte', 'utf8');
const searchEdge = readFileSync('supabase/functions/semantic-search/index.ts', 'utf8');
const searchMigration = readFileSync(
	'supabase/migrations/202608160610_document_first_search_performance.sql',
	'utf8'
);
const coverageEdge = readFileSync('supabase/functions/semantic-coverage/index.ts', 'utf8');

describe('document-first semantic search UX', () => {
	it('deduplicates in the backend and keeps a defensive client boundary before keyed rendering', () => {
		expect(searchMigration).toContain('create or replace function public.search_documents(');
		expect(searchMigration).toContain('partition by ranked_pages.document_id');
		expect(searchMigration).toContain(
			'create or replace function public.search_documents_semantic('
		);
		expect(searchMigration).toContain(
			'create or replace function public.search_documents_visual_semantic('
		);
		expect(searchEdge).toContain("supabase.rpc('search_documents'");
		expect(searchEdge).toContain("supabase.rpc('search_documents_semantic'");
		expect(searchEdge).toContain("supabase.rpc('search_documents_visual_semantic'");
		expect(searchPage).toContain('appendUniqueDocumentResults');
		expect(searchPage).toContain('offset: requestOffset');
		expect(searchPage).toContain('nextOffset = requestOffset + response.results.length');
		expect(searchPage).not.toContain('maxRawBatchesPerPage');
		expect(searchPage).not.toContain('rawBatchSize');
		expect(searchPage).toContain('{#each results as result (result.documentId)}');
		expect(searchPage).toContain('documentos</span>');
	});

	it('renders the matching original page instead of transcription snippets or filename-first cards', () => {
		expect(searchPage).toContain('<SearchDocumentCard {result} query={query.trim()} />');
		expect(searchPage).not.toContain('highlightSnippet');
		expect(searchPage).not.toContain('result.excerpt');
		expect(searchCard).toContain('<DocumentMediaViewer');
		expect(searchCard).toContain('pages={previewPages}');
		expect(searchCard).toContain('loadDocumentPage(result.documentId, result.pageNumber)');
		expect(searchCard).not.toContain('<strong>{result.documentTitle}</strong>');
		expect(viewer).toContain('WordGeometryOverlay');
	});

	it('counts literal occurrences only on the matching page without loading the whole document text', () => {
		expect(searchCard).toContain('countExactQueryOccurrences');
		expect(searchCard).toContain('occurrenceCount > 0');
		expect(searchCard).toContain('1 ocorrência nesta página');
		expect(searchCard).toContain('ocorrências nesta página');
		expect(searchCard).not.toContain('countDocumentQueryOccurrences');
	});

	it('keeps OCR transcription as a collapsed auxiliary tool', () => {
		expect(correctionEditor).toContain('<details class="transcript-tool">');
		expect(correctionEditor).toContain('Ferramenta auxiliar para pesquisa e indexação');
		expect(correctionEditor).toContain(':global(.reader)');
	});

	it('does not add a second generative verifier after semantic retrieval', () => {
		expect(coverageEdge).not.toContain('requestGeminiCoverageVerification');
		expect(coverageEdge).not.toContain('COVERAGE_VERIFY_MODEL');
	});
});
