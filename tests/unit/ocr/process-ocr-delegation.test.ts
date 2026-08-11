import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	new URL('../../../supabase/functions/process-ocr/index.ts', import.meta.url),
	'utf8'
);
const rpc = (name: string) => new RegExp(`supabase\\.rpc\\(\\s*['"]${name}['"]`);

describe('process-ocr provider delegation', () => {
	it('delegates one validated multi-page request to the shared Gemini client', () => {
		expect(source).toContain('requestGeminiOcrBatch');
		expect(source).toContain('parseOcrClaimResult');
		expect(source).toContain('planOcrFailure');
		expect(source).toContain(".from('ocr_batches')");
		expect(source).toContain("code: 'ocr_batch_manifest_mismatch'");
		expect(source).toMatch(rpc('finish_ocr_batch'));
	});

	it('accepts only the launch batch request bodies', () => {
		expect(source).not.toContain("hasExactKeys(record, ['pageId'])");
		expect(source).toContain("hasExactKeys(record, ['pageIds'])");
		expect(source).toContain("hasExactKeys(record, ['batchId', 'pageIds'])");
		expect(source).toContain('new Set(record.pageIds).size !== record.pageIds.length');
		expect(source).not.toContain('parsedRequest.legacy');
	});

	it('returns only the aggregate launch response contract', () => {
		expect(source).toContain('aggregateBody({');
		expect(source).not.toContain('const warningCounts = new Map<string, number>();');
		expect(source).not.toContain('warningCounts.set(');
		expect(source).not.toContain('warningCount:');
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

	it('paces provider calls globally and uses the secondary model only after provider 429', () => {
		expect(source).toContain("admin.rpc('reserve_ocr_provider_rate_slot'");
		expect(source).toContain("envInteger('OCR_MODEL_PRIMARY_RPM', DEFAULT_GEMINI_OCR_RPM");
		expect(source).toContain("envInteger('OCR_MODEL_FALLBACK_RPM', DEFAULT_GEMINI_OCR_RPM");
		expect(source).toContain('shouldFallbackGeminiOcr(attempt.error)');
		expect(source).toContain('attemptProvider(fallbackModel, fallbackRpm)');
		expect(source).toContain("activeRouteReason = 'fallback_gemini_rate_limit'");
		expect(source).toContain("code =\n\t\t\t\terror.reason === 'local_queue_full'");
	});

	it('keeps aggregate inline bytes inside the Gemini request-size safety envelope', () => {
		expect(source).toContain('const MAX_INLINE_IMAGE_BYTES = 14 * 1024 * 1024;');
		expect(source).toContain('const ABSOLUTE_MAX_BATCH_BYTES = 14 * 1024 * 1024;');
		expect(source).not.toContain('const ABSOLUTE_MAX_BATCH_BYTES = 48 * 1024 * 1024;');
	});

	it('persists valid pages independently and requests a split only for affected identities', () => {
		expect(source).toContain('for (const result of outcome.pages)');
		expect(source).toMatch(rpc('complete_ocr_job_with_geometry'));
		expect(source).toContain('geometry_payload: result.wordGeometry');
		expect(source).toContain('outcome.missingPageIds');
		expect(source).toContain('outcome.duplicatePageIds');
		expect(source).toContain("code: 'ocr_batch_response_incomplete'");
		expect(source).toContain('splitRequiredPageIds.push(pageId)');
	});

	it('cleans temporary images only after a page is already or newly complete', () => {
		expect(source).toContain('await cleanupTemporaryImage(page.id, page.temporary_image_path)');
		expect(source).toContain(
			'await cleanupTemporaryImage(result.pageId, claimed.page.temporary_image_path)'
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
