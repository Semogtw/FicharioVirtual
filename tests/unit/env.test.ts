import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from '../../src/lib/env/public';

const valid = {
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890'
};

describe('public environment', () => {
	it('accepts the required public Supabase settings without Drive configured', () => {
		expect(parsePublicEnv(valid)).toEqual({ ...valid, PUBLIC_GOOGLE_CLIENT_ID: null });
	});

	it('accepts an optional public Google OAuth client identifier', () => {
		expect(
			parsePublicEnv({
				...valid,
				PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com'
			})
		).toEqual({
			...valid,
			PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com'
		});
	});

	it('rejects malformed or incomplete settings', () => {
		expect(() => parsePublicEnv({ ...valid, PUBLIC_SUPABASE_URL: 'not-a-url' })).toThrow(
			'Invalid public environment'
		);
		expect(() => parsePublicEnv({ PUBLIC_SUPABASE_URL: valid.PUBLIC_SUPABASE_URL })).toThrow(
			'Invalid public environment'
		);
		expect(() =>
			parsePublicEnv({ ...valid, PUBLIC_GOOGLE_CLIENT_ID: 'not a google client id' })
		).toThrow('Invalid public environment');
	});
});
