import { describe, expect, it } from 'vitest';
import {
	generateDesktopWorkerCredential,
	hashDesktopWorkerCredential,
	parseDesktopWorkerAuthorization
} from '../../../supabase/functions/_shared/desktop-worker-auth';

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

describe('desktop worker credential boundary', () => {
	it('generates a canonical 256-bit credential and the matching SHA-256 digest', async () => {
		const generated = await generateDesktopWorkerCredential();
		expect(generated.credential).toMatch(BASE64URL_43);
		expect(generated.digestHex).toMatch(SHA256_HEX);
		await expect(hashDesktopWorkerCredential(generated.credential)).resolves.toBe(
			generated.digestHex
		);
	});

	it('uses an explicit worker authorization scheme rather than browser Bearer JWT semantics', async () => {
		const generated = await generateDesktopWorkerCredential();
		expect(parseDesktopWorkerAuthorization(`FicharioWorker ${generated.credential}`)).toBe(
			generated.credential
		);
		expect(parseDesktopWorkerAuthorization(`Bearer ${generated.credential}`)).toBeNull();
		expect(parseDesktopWorkerAuthorization(generated.credential)).toBeNull();
	});

	it('rejects whitespace, padding, truncation, and appended material instead of normalizing secrets', async () => {
		const generated = await generateDesktopWorkerCredential();
		for (const invalid of [
			` ${generated.credential}`,
			`${generated.credential} `,
			`${generated.credential}=`,
			generated.credential.slice(0, -1),
			`${generated.credential}A`
		]) {
			expect(parseDesktopWorkerAuthorization(`FicharioWorker ${invalid}`)).toBeNull();
			await expect(hashDesktopWorkerCredential(invalid)).resolves.toBeNull();
		}
	});

	it('rejects a non-canonical final base64url symbol even when a decoder could ignore padding bits', async () => {
		const canonicalZeros = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
		const nonCanonicalZeros = `${canonicalZeros.slice(0, -1)}B`;
		expect(canonicalZeros).toHaveLength(43);
		await expect(hashDesktopWorkerCredential(canonicalZeros)).resolves.toMatch(SHA256_HEX);
		await expect(hashDesktopWorkerCredential(nonCanonicalZeros)).resolves.toBeNull();
		expect(parseDesktopWorkerAuthorization(`FicharioWorker ${nonCanonicalZeros}`)).toBeNull();
	});

	it('produces independent credentials across pair attempts', async () => {
		const first = await generateDesktopWorkerCredential();
		const second = await generateDesktopWorkerCredential();
		expect(second.credential).not.toBe(first.credential);
		expect(second.digestHex).not.toBe(first.digestHex);
	});
});
