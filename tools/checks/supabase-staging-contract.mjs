/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
	throw new Error(`Supabase staging contract failed: ${message}`);
}

/**
 * @typedef {{ user_id?: unknown; is_active?: unknown }} AppUserRow
 */

/**
 * @param {{ userId: unknown; authorized: unknown; appUser: AppUserRow | null }} input
 */
export function assertAuthorizedAccount({ userId, authorized, appUser }) {
	if (typeof userId !== 'string' || userId === '') fail('authorized account has no user id');
	if (authorized !== true) fail('authorized account is not active in the allowlist');
	if (!appUser || typeof appUser !== 'object')
		fail('authorized account cannot read its app_users row');
	if (appUser.user_id !== userId) fail('app_users row does not match the authenticated user');
	if (appUser.is_active !== true) fail('authorized account app_users row is not active');
}

/**
 * @param {{ userId: unknown; authorized: unknown; appUser: AppUserRow | null }} input
 */
export function assertUnauthorizedAccount({ userId, authorized, appUser }) {
	if (typeof userId !== 'string' || userId === '') fail('second account has no user id');
	if (authorized !== false) fail('second account unexpectedly passed the active allowlist');
	if (appUser !== null && appUser.is_active === true) {
		fail('second account unexpectedly has an active allowlist row');
	}
}

/**
 * @typedef {{ id?: unknown; user_id?: unknown }} ProbeRow
 */

/**
 * @param {{
 *   probeId: string;
 *   ownerUserId: string;
 *   ownerRows: ProbeRow[];
 *   outsiderRows: ProbeRow[];
 * }} input
 */
export function assertProbeIsolation({ probeId, ownerUserId, ownerRows, outsiderRows }) {
	if (!Array.isArray(ownerRows) || ownerRows.length !== 1) {
		fail('authorized account did not read exactly one probe notebook');
	}
	const ownerRow = ownerRows[0];
	if (ownerRow?.id !== probeId || ownerRow.user_id !== ownerUserId) {
		fail('probe notebook is not bound to the authorized account');
	}
	if (!Array.isArray(outsiderRows)) fail('second account probe result is invalid');
	if (outsiderRows.length !== 0) fail('second account could read the authorized probe notebook');
}

/**
 * @typedef {{ name?: unknown; metadata?: unknown }} StorageListRow
 */

/**
 * @param {{ fileName: string; ownerRows: StorageListRow[]; outsiderRows: StorageListRow[] }} input
 */
export function assertStorageListIsolation({ fileName, ownerRows, outsiderRows }) {
	if (!Array.isArray(ownerRows) || ownerRows.length !== 1) {
		fail('authorized account did not list exactly one Storage probe object');
	}
	if (ownerRows[0]?.name !== fileName) {
		fail('authorized Storage listing did not return the exact probe filename');
	}
	if (!Array.isArray(outsiderRows)) fail('second account Storage listing is invalid');
	if (outsiderRows.length !== 0) fail('second account could list the authorized Storage probe');
}

/**
 * @param {{ expected: Uint8Array; actual: Uint8Array }} input
 */
export function assertProbeBytes({ expected, actual }) {
	if (!(expected instanceof Uint8Array) || !(actual instanceof Uint8Array)) {
		fail('Storage probe bytes must be Uint8Array values');
	}
	if (expected.byteLength !== actual.byteLength) {
		fail(
			`Storage probe bytes have different lengths: ${expected.byteLength} != ${actual.byteLength}`
		);
	}
	for (let index = 0; index < expected.byteLength; index += 1) {
		if (expected[index] !== actual[index]) {
			fail(`Storage probe bytes differ at offset ${index}`);
		}
	}
}

/**
 * @param {{ label: string; data: unknown; error: unknown }} input
 */
export function assertDeniedStorageOperation({ label, data, error }) {
	if (error == null || data != null) {
		fail(`second account ${label} unexpectedly succeeded`);
	}
}

/**
 * @param {{ signedUrl: unknown; supabaseUrl: string; objectPath: string }} input
 */
export function assertSignedStorageUrl({ signedUrl, supabaseUrl, objectPath }) {
	if (typeof signedUrl !== 'string' || signedUrl === '') fail('signed Storage URL is missing');

	let signed;
	let base;
	try {
		signed = new URL(signedUrl);
		base = new URL(supabaseUrl);
	} catch {
		fail('signed Storage URL or Supabase URL is invalid');
	}

	if (signed.protocol !== 'https:') fail('signed Storage URL must use HTTPS');
	if (signed.username || signed.password) fail('signed Storage URL must not contain credentials');
	if (signed.origin !== base.origin) fail('signed Storage URL does not use the Supabase origin');

	const expectedPath = `/storage/v1/object/sign/documents/${objectPath}`;
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(signed.pathname);
	} catch {
		fail('signed Storage URL path is not valid percent-encoding');
	}
	if (decodedPath !== expectedPath) fail('signed URL does not target the exact Storage object');
	if (!signed.searchParams.get('token')) fail('signed Storage URL has no token');
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Error}
 */
function normalizeFailure(value, label) {
	return value instanceof Error ? value : new Error(`${label}: ${String(value)}`);
}

/**
 * @param {{
 *   operationError: unknown;
 *   cleanupResults: Array<PromiseSettledResult<unknown>>;
 * }} input
 * @returns {Error | null}
 */
export function resolveStagingFailure({ operationError, cleanupResults }) {
	const failures = [];
	if (operationError != null) {
		failures.push(normalizeFailure(operationError, 'staging verification failed'));
	}
	for (const result of cleanupResults) {
		if (result.status === 'rejected') {
			failures.push(normalizeFailure(result.reason, 'staging cleanup failed'));
		}
	}
	if (failures.length === 0) return null;
	if (failures.length === 1) return failures[0];
	return new AggregateError(
		failures,
		operationError == null
			? 'Supabase staging cleanup failed'
			: 'Supabase staging verification and cleanup failed'
	);
}
