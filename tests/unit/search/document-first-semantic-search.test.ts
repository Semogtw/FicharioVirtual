import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viewer = readFileSync('src/lib/components/DocumentMediaViewer.svelte', 'utf8');
const correctionEditor = readFileSync('src/lib/components/CorrectionEditor.svelte', 'utf8');
const searchPage = readFileSync('src/routes/search/+page.svelte', 'utf8');
const searchCard = readFileSync('src/lib/components/SearchDocumentCard.svelte', 'utf8');
const coverageEdge = readFileSync('supabase/functions/semantic-coverage/index.ts', 'utf8');

describe('document-first semantic search UX', () => {
	it('deduplicates page matches into one visible result per document', () => {
		expect(searchPage).toContain('appendUniqueDocumentResults');
		expect(searchPage).toContain('{#each results as result (result.documentId)}');
		expect(searchPage).toContain('documentos</span>');
		expect(searchPage).not.toContain('{#each results as result (result.pageId)}');
	});

	it('renders the matching original page instead of transcription snippets or filename-first cards', () => {
		expect(searchPage).toContain('<SearchDocumentCard {result} query={query.trim()} />');
		expect(searchPage).not.toContain('highlightSnippet');
		expect(searchPage).not.toContain('result.excerpt');
		expect(searchCard).toContain('<DocumentMediaViewer');
		expect(searchCard).toContain('pages={[previewPage]}');
		expect(searchCard).not.toContain('<strong>{result.documentTitle}</strong>');
		expect(viewer).toContain('WordGeometryOverlay');
	});

	it('shows the literal occurrence count when the searched term is present in the document', () => {
		expect(searchCard).toContain('countDocumentQueryOccurrences');
		expect(searchCard).toContain('occurrenceCount > 0');
		expect(searchCard).toContain('1 ocorrência');
		expect(searchCard).toContain('ocorrências');
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
