import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../supabase/functions/delete-document/index.ts', import.meta.url),
	'utf8'
);

describe('delete-document replay contract', () => {
	it('treats an already absent authorized document as a successful idempotent deletion', () => {
		expect(source).toContain('if (!document) return respond(204);');
		expect(source).not.toContain("'document_not_found'");
	});
});
