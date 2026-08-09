import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const limits = readFileSync('src/lib/pdf/limits.ts', 'utf8');
const worker = readFileSync('src/lib/pdf/inspector-worker.ts', 'utf8');
const resumeStore = readFileSync('src/lib/pdf/resume-store.ts', 'utf8');
const config = readFileSync('supabase/config.toml', 'utf8');

describe('local PDF resource ceiling', () => {
	it('rejects files above the same 20 MiB limit enforced by Supabase storage', () => {
		expect(limits).toContain('MAX_LOCAL_PDF_BYTES = 20 * 1024 * 1024');
		expect(config).toContain('file_size_limit = "20MiB"');
		expect(worker).toContain('request.file.size > MAX_LOCAL_PDF_BYTES');
		expect(resumeStore).toContain('file.size > MAX_LOCAL_PDF_BYTES');
		expect(worker.indexOf('request.file.size > MAX_LOCAL_PDF_BYTES')).toBeLessThan(
			worker.indexOf('request.file.arrayBuffer()')
		);
	});
});
