import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/routes/settings/computers/queue/+page.svelte', 'utf8');
const settingsLayout = readFileSync('src/routes/settings/+layout.svelte', 'utf8');

describe('desktop OCR queue page contract', () => {
	it('loads the bounded queue service with stale-request protection', () => {
		expect(page).toContain("listDesktopOcrJobs");
		expect(page).toContain('const requests = new RequestVersion()');
		expect(page).toContain('requests.isCurrent(version)');
		expect(page).toContain('onDestroy');
	});

	it('shows only safe operational metadata and no private lease/source material', () => {
		expect(page).toContain('job.documentTitle');
		expect(page).toContain('job.pageNumber');
		expect(page).toContain('job.deviceLabel');
		expect(page).toContain('job.leaseExpiresAt');
		expect(page).toContain('job.lastErrorCode');
		expect(page).not.toContain('job.leaseId');
		expect(page).not.toContain('signedUrl');
		expect(page).not.toContain('ocrRawText');
		expect(page).not.toContain('credential');
	});

	it('surfaces expired lease recovery and links back to the owning document', () => {
		expect(page).toContain('job.leaseExpired');
		expect(page).toContain('próximo claim de um dispositivo ativo recuperará');
		expect(page).toContain('href={`/documents/${job.documentId}/`}');
	});

	it('makes the queue a first-class settings destination without double-active tabs', () => {
		expect(settingsLayout).toContain('href="/settings/computers/queue/"');
		expect(settingsLayout).toContain('Fila OCR');
		expect(settingsLayout).toContain("page.url.pathname === '/settings/computers/'");
		expect(settingsLayout).toContain(
			"page.url.pathname.startsWith('/settings/computers/queue')"
		);
	});
});
