import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync('src/routes/documents/[id]/+page.svelte', 'utf8');
const viewer = readFileSync('src/lib/components/DocumentMediaViewer.svelte', 'utf8');
const detailService = readFileSync('src/lib/services/document-detail.ts', 'utf8');

describe('document original reference rendering', () => {
	it('keeps Drive originals explicit while the viewer renders pages continuously', () => {
		expect(route).toContain("detail.originalReference.provider === 'google_drive'");
		expect(route).toContain('Abrir no Google Drive');
		expect(route).toContain('pages={detail.pages}');
		expect(route).toContain('focusPageNumber={selectedPageNumber}');
		expect(route).toContain('aria-label="Documento completo"');
		expect(route).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })");
		expect(route).not.toContain('<img src={detail.originalReference.url}');
		expect(viewer).toContain("detail.originalReference.provider === 'supabase'");
		expect(viewer).toContain('openDrivePdfRangeDocument');
		expect(viewer).toContain('downloadBrowserDriveFile');
		expect(viewer).toContain('{#each renderedPages as rendered (rendered.page.id)}');
		expect(viewer).toContain('src={rendered.url}');
		expect(viewer).not.toContain('<img src={detail.originalReference.url}');
	});

	it('loads only nearby original media while preserving the continuous viewer', () => {
		expect(viewer).toContain('pages: readonly DocumentPageSummary[]');
		expect(viewer).toContain('IntersectionObserver');
		expect(viewer).toContain("rootMargin: '900px 0px'");
		expect(viewer).toContain('requestFocusWindow');
		expect(viewer).toContain('loadDocumentPage(detail.id, pageNumber)');
		expect(viewer).toContain('content-visibility: auto');
		expect(viewer).toContain('id={`document-page-${rendered.page.pageNumber}`}');
		expect(detailService).toContain(".select('id,page_number,status,updated_at')");
		expect(detailService).toContain('prefetchDocumentPages');
		expect(route).not.toContain('loadDocumentPage(');
		expect(route).not.toContain('CorrectionEditor');
	});

	it('renders a missing original state without creating links or media with a null URL', () => {
		expect(route).toContain("detail.originalReference.provider !== 'missing'");
		expect(viewer).toContain("detail.originalReference.provider === 'missing'");
		expect(viewer).toContain('O original não está disponível.');
		expect(route).not.toContain('<a href={detail.originalUrl}');
		expect(viewer).not.toContain('<a href={detail.originalUrl}');
		expect(viewer).not.toContain('<img src={detail.originalUrl}');
	});
});
