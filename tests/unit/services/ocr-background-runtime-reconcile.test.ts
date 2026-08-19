import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../src/lib/services/ocr-background-runtime.ts', import.meta.url),
	'utf8'
);

describe('background OCR completion reconciliation', () => {
	it('re-reads the page after the synchronous worker kick', () => {
		expect(source).toContain("import { getSupabaseClient } from './supabase';");
		expect(source).toMatch(
			/client\s*\.from\('pages'\)\s*\.select\('status'\)\s*\.eq\('id', pageId\)\s*\.maybeSingle\(\)/
		);
		expect(source).toMatch(
			/await kick\(options\.signal\);\s*const completed = await readCompletedPageState\(pageId\);\s*if \(options\.signal\?\.aborted\) throw abortError\(\);\s*if \(completed\) return completed;/
		);
	});

	it('maps terminal page states to the foreground completion contract', () => {
		expect(source).toContain("if (data.status === 'ready')");
		expect(source).toContain("state: 'complete' as const, needsReview: false");
		expect(source).toContain("if (data.status === 'needs_review')");
		expect(source).toContain("state: 'complete' as const, needsReview: true");
	});

	it('keeps retry_later as the fallback when the page is genuinely pending', () => {
		expect(source).toContain("return Object.freeze({ state: 'retry_later' as const });");
	});
});
