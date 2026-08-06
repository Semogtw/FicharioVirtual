import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from '../../src/lib/env/public';

const valid = {
	PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example_key_1234567890'
};

describe('public environment', () => {
	it('accepts required Supabase settings with optional Drive features disabled', () => {
		expect(parsePublicEnv(valid)).toEqual({
		...valid,
		PUBLIC_GOOGLE_CLIENT_ID: null,
		PUBLIC_GOOGLE_PICKER_API_KEY: null,
		PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: null
	});
	});

	it('accepts optional Google OAuth and Picker public identifiers', () => {
		expect(
			parsePublicEnv({
				...valid,
				PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com',
				PUBLIC_GOOGLE_PICKER_API_KEY: 'AIzaSyExamplePublicPickerKey_1234567890',
				PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: '123456789012'
			})
		).toEqual({
			...valid,
			PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com',
			PUBLIC_GOOGLE_PICKER_API_KEY: 'AIzaSyExamplePublicPickerKey_1234567890',
			PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: '123456789012'
		});
	});

	it('rejects malformed or partially configured Picker settings', () => {
		expect(() => parsePublicEnv({ ...valid, PUBLIC_SUPABASE_URL: 'not-a-url' })).toThrow(
			'Invalid public environment'
		);
		expect(() => parsePublicEnv({ PUBLIC_SUPABASE_URL: valid.PUBLIC_SUPABASE_URL })).toThrow(
			'Invalid public environment'
		);
		expect(() =>
			parsePublicEnv({ ...valid, PUBLIC_GOOGLE_CLIENT_ID: 'not a google client id' })
		).toThrow('Invalid public environment');
		expect(() =>
			parsePublicEnv({
				...valid,
				PUBLIC_GOOGLE_PICKER_API_KEY: 'AIzaSyExamplePublicPickerKey_1234567890'
			})
		).toThrow('Invalid public environment');
		expect(() =>
			parsePublicEnv({
				...valid,
				PUBLIC_GOOGLE_CLIENT_ID: '123456789012-example.apps.googleusercontent.com',
				PUBLIC_GOOGLE_PICKER_API_KEY: 'bad key',
				PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER: '123'
			})
		).toThrow('Invalid public environment');
	});
});
