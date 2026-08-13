import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viewer = readFileSync('src/lib/components/DocumentMediaViewer.svelte', 'utf8');
const correctionEditor = readFileSync('src/lib/components/CorrectionEditor.svelte', 'utf8');
const searchPage = readFileSync('src/routes/search/+page.svelte', 'utf8');
const tokens = readFileSync('src/lib/design/tokens.css', 'utf8');
const verifier = readFileSync('supabase/functions/_shared/gemini-coverage-verifier.ts', 'utf8');

describe('document-first semantic search UX', () => {
	it('opens the matching original page with media highlighting', () => {
		expect(searchPage).toContain('highlight=${encodeURIComponent(query.trim())}');
		expect(viewer).toContain('WordGeometryOverlay');
	});

	it('keeps OCR transcription as a collapsed auxiliary tool', () => {
		expect(correctionEditor).toContain('<details class="transcript-tool">');
		expect(correctionEditor).toContain('Ferramenta auxiliar para pesquisa e indexação');
		expect(correctionEditor).toContain(':global(.reader)');
	});

	it('hides transcript excerpts from the result cards', () => {
		expect(tokens).toContain(".results[aria-labelledby='results-title'] > ol > li > a > p");
		expect(tokens).toContain('display: none');
	});

	it('keeps structured output in the optional verifier', () => {
		expect(verifier).toContain("responseMimeType: 'application/json'");
		expect(verifier).toContain('responseSchema');
	});
});
