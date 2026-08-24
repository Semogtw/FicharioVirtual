import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	'supabase/migrations/20260824090000_public_azure_ocr_route.sql',
	'utf8'
);
const publicFunction = readFileSync('supabase/functions/process-public-ocr/index.ts', 'utf8');
const runner = readFileSync('supabase/functions/_shared/public-ocr-runner.ts', 'utf8');
const router = readFileSync('supabase/functions/process-ocr/index.ts', 'utf8');
const config = readFileSync('supabase/config.toml', 'utf8');

describe('public Azure OCR route', () => {
	it('claims only active public jobs through the dedicated Azure RPC', () => {
		expect(migration).toContain('create or replace function public.claim_public_azure_ocr_job(');
		expect(migration).toContain("app_user.provider_profile = 'public'");
		expect(migration).toContain("target_model is distinct from 'read-v3.2'");
		expect(migration).toContain(
			"current_job.job_route is distinct from 'gemini'::public.ocr_route"
		);
		expect(migration).toContain("provider = 'azure_vision'");
		expect(migration).toMatch(
			/grant execute on function public\.claim_public_azure_ocr_job\(uuid, text, timestamptz\)[\s\S]*to authenticated/
		);
	});

	it('authenticates and derives public routing before touching Azure or OCR jobs', () => {
		expect(publicFunction).toContain('resolveCurrentProviderPolicy');
		expect(publicFunction).toContain("policy.profile !== 'public'");
		expect(runner).toContain('createAzureOcrProvider');
		expect(runner).toContain('claim_public_azure_ocr_job');
		expect(runner).toContain('complete_ocr_job_with_geometry');
		expect(runner).not.toContain('GEMINI_API_KEY');
		expect(runner).not.toContain('requestGeminiOcrBatch');
		expect(publicFunction).not.toContain('GEMINI_API_KEY');
	});

	it('routes public sessions transparently from the existing OCR entry point', () => {
		expect(router).toContain('resolveCurrentProviderPolicy');
		expect(router).toContain('runPublicOcr');
		expect(router).toContain("providerPolicy.profile === 'public'");
	});

	it('keeps the public function behind JWT verification', () => {
		expect(config).toMatch(/\[functions\.process-public-ocr\]\s+verify_jwt\s*=\s*true/);
	});
});
