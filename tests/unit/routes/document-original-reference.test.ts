import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/documents/[id]/+page.svelte', 'utf8');

describe('document original reference rendering', () => {
	it('renders Drive originals as an explicit reference instead of embedding the web URL as media', () => {
		expect(source).toContain("detail.originalReference.provider === 'google_drive'");
		expect(source).toContain('Abrir no Google Drive');
		expect(source).toContain("detail.originalReference.provider === 'supabase'");
		expect(source).toContain('<img src={detail.originalReference.url}');
		expect(source).toContain('src={`${detail.originalReference.url}#page=');
		expect(source).not.toMatch(
			/<img src=\{detail\.originalUrl\}[\s\S]*originalReference\.provider === 'google_drive'/
		);
	});

	it('renders a missing original state without creating links or media with a null URL', () => {
		expect(source).toContain("detail.originalReference.provider === 'missing'");
		expect(source).toContain('O original não está disponível.');
		expect(source).not.toContain('<a href={detail.originalUrl}');
		expect(source).not.toContain('<img src={detail.originalUrl}');
	});
});
