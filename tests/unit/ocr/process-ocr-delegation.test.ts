import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../supabase/functions/process-ocr/index.ts', import.meta.url),
	'utf8'
);

describe('process-ocr provider delegation', () => {
	it('delegates one validated multi-page request to the shared Gemini client', () => {
		expect(source).toContain('requestGeminiOcrBatch');
		expect(source).toContain('parseOcrClaimResult');
		expect(source).toContain('planOcrFailure');
		expect(source).toContain("supabase.rpc('register_ocr_batch'");
		expect(source).toContain("supabase.rpc('record_ocr_batch_call'");
	});

	it('keeps both the legacy one-page body and the new exact batch body', () => {
		expect(source).toContain("hasExactKeys(record, ['pageId'])");
		expect(source).toContain("hasExactKeys(record, ['pageIds'])");
		expect(source).toContain("hasExactKeys(record, ['batchId', 'pageIds'])");
		expect(source).toContain('new Set(record.pageIds).size !== record.pageIds.length');
	});

	it('does not duplicate provider transport, prompt schema or payload parsing', () => {
		expect(source).not.toContain('generativelanguage.googleapis.com');
		expect(source).not.toContain('const responseSchema');
		expect(source).not.toContain('function base64');
		expect(source).not.toContain('parseOcrPayload');
		expect(source).not.toContain('fetchImpl');
	});

	it('does not read or send an application-created daily OCR limit', () => {
		expect(source).not.toContain('OCR_DAILY_HARD_LIMIT');
		expect(source).not.toContain('daily_hard_limit');
		expect(source).not.toContain('dailyLimit');
		expect(source).toContain('OCR_BATCH_MAX_PAGES');
		expect(source).toContain('OCR_BATCH_MAX_BYTES');
	});

	it('persists valid pages independently and requests a split only for affected identities', () => {
		expect(source).toContain('for (const pageResult of outcome.pages)');
		expect(source).toContain("'complete_ocr_job'");
		expect(source).toContain('outcome.missingPageIds');
		expect(source).toContain('outcome.duplicatePageIds');
		expect(source).toContain("code: 'ocr_batch_split_required'");
		expect(source).toContain('splitRequiredPageIds.push(pageId)');
	});

	it('cleans temporary images only after a page is already or newly complete', () => {
		expect(source).toContain('await cleanupTemporaryImage(page.id, page.temporary_image_path)');
		expect(source).toContain(
			'await cleanupTemporaryImage(pageResult.pageId, claimed.page.temporary_image_path)'
		);
		expect(source).not.toContain('await cleanupTemporaryImage(sourcePath)');
	});

	it('delegates provider failures to the shared finite retry planner', () => {
		expect(source).toContain("from '../_shared/ocr-failure.ts'");
		expect(source).toContain('planOcrFailure');
		expect(source).not.toContain('classifyGeminiFailure');
		expect(source).not.toContain('geminiFailureResponse');
	});
});
