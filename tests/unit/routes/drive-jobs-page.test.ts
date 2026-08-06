import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const path = 'src/routes/drive/jobs/+page.svelte';

describe('Drive jobs page', () => {
	it('loads public job receipts and runs one bounded worker batch', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).toContain('listDriveJobs');
		expect(source).toContain('runPendingDriveJobs');
		expect(source).toContain("label={running ? 'Executando fila…' : 'Executar mudanças locais'}");
		expect(source).toContain('Mudanças locais');
		expect(source).toContain('Tentativa');
		expect(source).toContain('Próxima tentativa');
	});

	it('does not render payloads, leases or credential material', () => {
		const source = readFileSync(path, 'utf8');

		expect(source).not.toContain('payload');
		expect(source).not.toContain('leaseOwner');
		expect(source).not.toContain('leaseExpiresAt');
		expect(source).not.toContain('accessToken');
		expect(source).not.toContain('refreshToken');
		expect(source).not.toContain('localStorage');
	});
});
