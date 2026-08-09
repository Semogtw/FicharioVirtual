const RAW_CREDENTIAL_BYTES = 32;
const RAW_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const AUTHORIZATION_PREFIX = 'FicharioWorker ';

function encodeBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
	if (!RAW_CREDENTIAL_PATTERN.test(value)) return null;
	const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		return null;
	}
	if (binary.length !== RAW_CREDENTIAL_BYTES) return null;
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return encodeBase64Url(bytes) === value ? bytes : null;
}

function hex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function digestSha256(bytes: Uint8Array): Promise<ArrayBuffer> {
	const input = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(input).set(bytes);
	return crypto.subtle.digest('SHA-256', input);
}

export function parseDesktopWorkerAuthorization(value: string | null): string | null {
	if (!value?.startsWith(AUTHORIZATION_PREFIX)) return null;
	const credential = value.slice(AUTHORIZATION_PREFIX.length);
	return decodeBase64Url(credential) ? credential : null;
}

export async function hashDesktopWorkerCredential(credential: string): Promise<string | null> {
	const bytes = decodeBase64Url(credential);
	if (!bytes) return null;
	return hex(await digestSha256(bytes));
}

export async function generateDesktopWorkerCredential(): Promise<
	Readonly<{
		credential: string;
		digestHex: string;
	}>
> {
	const bytes = crypto.getRandomValues(new Uint8Array(RAW_CREDENTIAL_BYTES));
	const credential = encodeBase64Url(bytes);
	const digestHex = hex(await digestSha256(bytes));
	bytes.fill(0);
	return Object.freeze({ credential, digestHex });
}
