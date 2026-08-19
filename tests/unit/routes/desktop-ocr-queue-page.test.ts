import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/routes/settings/computers/queue/+page.svelte', 'utf8');
const settingsLayout = readFileSync('src/routes/settings/+layout.svelte', 'utf8');

describe('desktop OCR queue page contract', () => {
	it('loads the bounded queue service with stale-request protection', () => {
		expect(page).toContain('listDesktopOcrJobs');
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
		expect(page).toContain('aguardar outro computador');
		expect(page).toContain('href={`/documents/${job.documentId}/`}');
	});

	it('lets the owner return only waiting or expired desktop work to Gemini', () => {
		expect(page).toContain('returnDesktopOcrJobToGemini');
		expect(page).toContain("job.status === 'waiting_desktop'");
		expect(page).toContain("job.status === 'processing' && job.leaseExpired");
		expect(page).toContain("'Usar leitura automática'");
		expect(page).toContain('movingPageId !== null');
	});

	it('makes the queue a first-class settings destination without double-active tabs', () => {
		expect(settingsLayout).toContain('href="/settings/computers/queue/"');
		expect(settingsLayout).toContain('Fila de leitura');
		expect(settingsLayout).toContain("page.url.pathname === '/settings/computers/'");
		expect(settingsLayout).toContain("page.url.pathname.startsWith('/settings/computers/queue')");
	});
});
