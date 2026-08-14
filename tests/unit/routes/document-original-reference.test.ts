import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync('src/routes/documents/[id]/+page.svelte', 'utf8');
const viewer = readFileSync('src/lib/components/DocumentMediaViewer.svelte', 'utf8');

describe('document original reference rendering', () => {
	it('keeps Drive originals as explicit references while delegating continuous media rendering to the viewer', () => {
		expect(route).toContain("detail.originalReference.provider === 'google_drive'");
		expect(route).toContain('Abrir no Google Drive');
		expect(route).toContain(
			'<DocumentMediaViewer {detail} pages={detail.pages} query={highlightedQuery} />'
		);
		expect(route).toContain('aria-label="Documento completo"');
		expect(route).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })");
		expect(route).not.toContain('<img src={detail.originalReference.url}');
		expect(viewer).toContain("detail.originalReference.provider === 'supabase'");
		expect(viewer).toContain('openDrivePdfRangeDocument');
		expect(viewer).toContain('downloadBrowserDriveFile');
		expect(viewer).toContain('renderDrivePdf');
		expect(viewer).toContain('{#each renderedPages as rendered (rendered.page.id)}');
		expect(viewer).toContain('src={rendered.url}');
		expect(viewer).not.toContain('<img src={detail.originalReference.url}');
	});

	it('renders every PDF page in one continuous viewer instead of replacing the visible page', () => {
		expect(viewer).toContain('pages: readonly PageDetail[]');
		expect(viewer).toContain("class:document-pages={detail.kind === 'pdf'}");
		expect(viewer).toContain('id={`document-page-${rendered.page.pageNumber}`}');
		expect(viewer).toContain('renderPdfDocumentPages');
		expect(route).not.toContain('page={selectedPage} query={highlightedQuery}');
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
