#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const activeFiles = [
	'.env.example',
	'src/lib/env/private.ts',
	'src/lib/services/ocr.ts',
	'src/lib/services/ocr-resume.ts',
	'src/lib/pdf/ocr-batching.ts',
	'src/lib/pdf/upload.ts',
	'supabase/functions/process-ocr/index.ts'
];

const forbidden = [
	'OCR_DAILY_HARD_LIMIT',
	'daily_hard_limit',
	'quota_exhausted_by_app',
	'pages_remaining_today'
];

const requiredByFile = new Map([
	[
		'supabase/functions/process-ocr/index.ts',
		[
			'requestGeminiOcrBatch',
			'OCR_BATCH_MAX_PAGES',
			'OCR_BATCH_MAX_BYTES',
			/supabase\.rpc\(\s*['"]register_ocr_batch['"]/u,
			/supabase\.rpc\(\s*['"]record_ocr_batch_call['"]/u
		]
	],
	['src/lib/pdf/upload.ts', ['runPdfOcrBatches', 'MAX_DERIVED_PAGE_BYTES', 'processOcrBatch']],
	['src/lib/services/ocr-resume.ts', ['runPdfOcrBatches', 'processOcrBatch']],
	['.env.example', ['OCR_BATCH_MAX_PAGES', 'OCR_BATCH_MAX_BYTES', 'OCR_REQUEST_TIMEOUT_MS']]
]);

const failures = [];
for (const file of activeFiles) {
	const source = await readFile(file, 'utf8');
	for (const token of forbidden) {
		if (source.includes(token)) failures.push(`${file}: forbidden token ${token}`);
	}
	for (const requirement of requiredByFile.get(file) ?? []) {
		const present =
			requirement instanceof RegExp ? requirement.test(source) : source.includes(requirement);
		if (!present) failures.push(`${file}: missing required token ${requirement}`);
	}
}

const migration = await readFile(
	'supabase/migrations/202608060014_provider_only_ocr_batches.sql',
	'utf8'
);
for (const token of [
	'drop function if exists public.claim_ocr_job(uuid, text, timestamptz, integer)',
	'create table public.ocr_batches',
	'create or replace function public.claim_ocr_job(',
	'create or replace function public.register_ocr_batch(',
	'create or replace function public.record_ocr_batch_call('
]) {
	if (!migration.includes(token)) failures.push(`provider-only migration: missing ${token}`);
}
if (migration.includes('daily_hard_limit')) {
	failures.push('provider-only migration must not use daily_hard_limit');
}

const historicalQuotaMigration = await readFile(
	'supabase/migrations/202608020024_quota_before_attempt.sql',
	'utf8'
);
if (!historicalQuotaMigration.includes('daily_hard_limit')) {
	failures.push(
		'historical quota migration changed unexpectedly; supersede it instead of rewriting history'
	);
}

if (failures.length > 0) {
	console.error('Provider-only OCR source gate failed:');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log('Provider-only OCR source gate passed.');
}
