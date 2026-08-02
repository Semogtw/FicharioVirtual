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
