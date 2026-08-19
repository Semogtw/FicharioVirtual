import { describe, expect, it } from 'vitest';
import {
	parseProviderPolicy,
	parseProviderProfile,
	providerPolicyFor
} from '../../../supabase/functions/_shared/provider-profile';

describe('provider profile parsing', () => {
	it('accepts only explicit owner/public values', () => {
		expect(parseProviderProfile('owner')).toBe('owner');
		expect(parseProviderProfile('public')).toBe('public');
		expect(parseProviderProfile('OWNER')).toBeNull();
		expect(parseProviderProfile('admin')).toBeNull();
		expect(parseProviderProfile(null)).toBeNull();
		expect(parseProviderProfile({ profile: 'owner' })).toBeNull();
	});
});

describe('provider routing policy', () => {
	it('preserves Gemini and desktop OCR only for owner accounts', () => {
		expect(providerPolicyFor('owner')).toEqual({
			profile: 'owner',
			ocrRoute: 'owner_gemini',
			geminiAllowed: true,
			desktopOcrAllowed: true
		});
	});

	it('routes public accounts to Azure and denies private resources', () => {
		expect(providerPolicyFor('public')).toEqual({
			profile: 'public',
			ocrRoute: 'public_azure',
			geminiAllowed: false,
			desktopOcrAllowed: false
		});
	});

	it('fails closed for missing or unexpected database values', () => {
		expect(parseProviderPolicy(undefined)).toBeNull();
		expect(parseProviderPolicy('trusted')).toBeNull();
	});
});
