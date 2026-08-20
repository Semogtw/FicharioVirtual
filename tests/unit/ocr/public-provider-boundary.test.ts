import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const queueKick = readFileSync('supabase/functions/ocr-queue-kick/index.ts', 'utf8');
const migration = readFileSync(
	'supabase/migrations/20260820032000_public_ocr_provider_boundary.sql',
	'utf8'
);

describe('public OCR provider boundary', () => {
	it('fails closed before a public account can claim work for the Gemini runtime', () => {
		expect(migration).toContain('create or replace function public.claim_ocr_job(');
		expect(migration).toContain("app_user.provider_profile = 'owner'");
		expect(migration).toContain("return jsonb_build_object('state', 'not_authorized')");
	});

	it('does not let public accounts kick the Gemini background worker', () => {
		expect(queueKick).toContain('resolveCurrentProviderPolicy');
		expect(queueKick).toContain('ocr_background_route_forbidden');
	});

	it('filters public accounts out of Gemini candidate queries and permits Azure history', () => {
		expect(migration.match(/provider_profile = 'owner'/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
		expect(migration).toContain("provider in ('gemini', 'local', 'azure_vision')");
	});
});
