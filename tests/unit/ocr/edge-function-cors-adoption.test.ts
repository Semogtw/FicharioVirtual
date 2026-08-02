import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../../', import.meta.url);

function read(path: string) {
	return readFileSync(new URL(path, repositoryRoot), 'utf8');
}

describe('Edge Function CORS adoption', () => {
	for (const path of [
		'supabase/functions/process-ocr/index.ts',
		'supabase/functions/delete-document/index.ts'
	]) {
		it(`${path} uses the shared fail-closed origin policy`, () => {
			const source = read(path);

			expect(source).toContain("from '../_shared/cors.ts'");
			expect(source).toContain('parseAppOrigin');
			expect(source).toContain('corsHeaders');
			expect(source).not.toContain("'Access-Control-Allow-Origin': '*'");
			expect(source).not.toContain('?? \"*\"');
			expect(source).not.toContain("?? '*'");
		});
	}
});
