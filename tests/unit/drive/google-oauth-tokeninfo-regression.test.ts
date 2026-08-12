import { describe, expect, it } from 'vitest';
import { parseGoogleIdentity } from '../../../supabase/functions/_shared/google-oauth';

const clientId = '123456789012-example.apps.googleusercontent.com';
const nonce = 'nonce_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const nowSeconds = 1_786_000_000;

function tokenInfo(overrides: Record<string, unknown> = {}) {
	return {
		iss: 'https://accounts.google.com',
		azp: clientId,
		aud: clientId,
		sub: 'google-user-subject-123456789',
		email: 'arthur@example.test',
		email_verified: 'true',
		iat: String(nowSeconds - 30),
		exp: String(nowSeconds + 3600),
		nonce,
		access_type: 'offline',
		scope: 'openid email https://www.googleapis.com/auth/drive.file',
		alg: 'RS256',
		kid: 'google-signing-key-id',
		typ: 'JWT',
		at_hash: 'google-access-token-hash',
		hd: 'example.test',
		...overrides
	};
}

describe('Google tokeninfo regression', () => {
	it('accepts standard tokeninfo metadata while validating the security-critical claims', () => {
		expect(parseGoogleIdentity(tokenInfo(), { clientId, nonce, nowSeconds })).toEqual({
			subject: 'google-user-subject-123456789',
			email: 'arthur@example.test',
			expiresAt: nowSeconds + 3600
		});
	});

	it('rejects a mismatched authorized-party claim when Google provides azp', () => {
		expect(() =>
			parseGoogleIdentity(tokenInfo({ azp: '123456789012-other.apps.googleusercontent.com' }), {
				clientId,
				nonce,
				nowSeconds
			})
		).toThrow('Invalid Google identity response');
	});
});
