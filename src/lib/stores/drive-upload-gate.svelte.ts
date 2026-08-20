import {
	beginDriveConnection,
	isDriveOAuthConfigured,
	loadDriveConnection
} from '$lib/services/drive';

export const driveUploadGate = $state({
	visible: false,
	checking: false,
	connecting: false,
	configured: isDriveOAuthConfigured(),
	error: null as string | null
});

type Waiter = {
	resolve: () => void;
	reject: (error: DOMException) => void;
	signal: AbortSignal | null;
	onAbort: (() => void) | null;
};

const waiters = new Set<Waiter>();
let connectionCheck: Promise<boolean> | null = null;
let oauthWindow: Window | null = null;
let oauthAttempt = 0;

function cancelledUpload() {
	return new DOMException('', 'AbortError');
}

function delay(milliseconds: number) {
	return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function detachAbort(waiter: Waiter) {
	if (waiter.signal && waiter.onAbort) {
		waiter.signal.removeEventListener('abort', waiter.onAbort);
	}
	waiter.signal = null;
	waiter.onAbort = null;
}

function settleWaiter(waiter: Waiter, outcome: 'resolve' | 'reject') {
	if (!waiters.delete(waiter)) return;
	detachAbort(waiter);
	if (outcome === 'resolve') waiter.resolve();
	else waiter.reject(cancelledUpload());
}

function closeGateIfIdle() {
	if (waiters.size > 0) return;
	driveUploadGate.visible = false;
	driveUploadGate.connecting = false;
	driveUploadGate.error = null;
	if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
	oauthWindow = null;
	oauthAttempt += 1;
}

async function checkConnection() {
	if (connectionCheck) return connectionCheck;
	connectionCheck = (async () => {
		driveUploadGate.checking = true;
		try {
			const connection = await loadDriveConnection();
			return connection?.status === 'connected' || connection?.status === 'syncing';
		} catch {
			driveUploadGate.error = 'Não foi possível verificar o Google Drive agora.';
			return false;
		} finally {
			driveUploadGate.checking = false;
			connectionCheck = null;
		}
	})();
	return connectionCheck;
}

function resolveWaiters() {
	for (const waiter of [...waiters]) settleWaiter(waiter, 'resolve');
	driveUploadGate.visible = false;
	driveUploadGate.connecting = false;
	driveUploadGate.error = null;
}

function rejectWaiters() {
	for (const waiter of [...waiters]) settleWaiter(waiter, 'reject');
	driveUploadGate.visible = false;
	driveUploadGate.connecting = false;
	driveUploadGate.error = null;
}

async function finishAuthorization(attempt: number, popup: Window) {
	for (let index = 0; index < 1_200 && attempt === oauthAttempt; index += 1) {
		if (popup.closed) {
			if (await checkConnection()) {
				resolveWaiters();
				return;
			}
			driveUploadGate.connecting = false;
			driveUploadGate.error = 'A conexão não foi concluída. Tente novamente.';
			return;
		}

		try {
			const current = new URL(popup.location.href);
			if (current.origin === window.location.origin) {
				const result = current.searchParams.get('drive');
				if (result === 'authorized') {
					for (let retry = 0; retry < 5; retry += 1) {
						if (await checkConnection()) {
							popup.close();
							resolveWaiters();
							return;
						}
						await delay(250 * (retry + 1));
					}
					popup.close();
					driveUploadGate.connecting = false;
					driveUploadGate.error =
						'A conta foi autorizada, mas a conexão ainda não ficou pronta. Tente novamente.';
					return;
				}
				if (result === 'cancelled' || result === 'error') {
					popup.close();
					driveUploadGate.connecting = false;
					driveUploadGate.error =
						result === 'cancelled'
							? 'A conexão foi cancelada. Você pode tentar novamente.'
							: 'Não foi possível concluir a conexão com o Google Drive.';
					return;
				}
			}
		} catch {
			// The popup is on accounts.google.com until OAuth returns to this app.
		}

		await delay(250);
	}

	if (attempt === oauthAttempt) {
		driveUploadGate.connecting = false;
		driveUploadGate.error = 'A conexão demorou demais. Tente novamente.';
	}
}

export async function requireDriveForUpload(signal?: AbortSignal): Promise<void> {
	if (typeof window === 'undefined') return;
	if (signal?.aborted) throw cancelledUpload();
	if (await checkConnection()) return;
	if (signal?.aborted) throw cancelledUpload();

	driveUploadGate.visible = true;
	if (!driveUploadGate.configured) {
		driveUploadGate.error = 'O Google Drive está temporariamente indisponível.';
	}

	return new Promise<void>((resolve, reject) => {
		const waiter: Waiter = { resolve, reject, signal: signal ?? null, onAbort: null };
		if (signal) {
			waiter.onAbort = () => {
				settleWaiter(waiter, 'reject');
				closeGateIfIdle();
			};
			signal.addEventListener('abort', waiter.onAbort, { once: true });
		}
		waiters.add(waiter);
		if (signal?.aborted) waiter.onAbort?.();
	});
}

export async function connectDriveForUpload(): Promise<void> {
	if (
		!driveUploadGate.visible ||
		driveUploadGate.connecting ||
		driveUploadGate.checking ||
		!driveUploadGate.configured
	) {
		return;
	}

	driveUploadGate.connecting = true;
	driveUploadGate.error = null;
	const attempt = ++oauthAttempt;
	const popup = window.open(
		'about:blank',
		'fichario-drive-oauth',
		'popup=yes,width=560,height=720,resizable=yes,scrollbars=yes'
	);
	if (!popup) {
		driveUploadGate.connecting = false;
		driveUploadGate.error = 'Permita a janela de login do Google e tente novamente.';
		return;
	}
	oauthWindow = popup;

	try {
		const authorizationUrl = await beginDriveConnection();
		if (attempt !== oauthAttempt || popup.closed) return;
		popup.location.replace(authorizationUrl);
		await finishAuthorization(attempt, popup);
	} catch {
		if (!popup.closed) popup.close();
		if (attempt === oauthAttempt) {
			driveUploadGate.connecting = false;
			driveUploadGate.error = 'Não foi possível abrir o login do Google Drive. Tente novamente.';
		}
	} finally {
		if (oauthWindow === popup) oauthWindow = null;
	}
}

export function cancelDriveUpload(): void {
	oauthAttempt += 1;
	if (oauthWindow && !oauthWindow.closed) oauthWindow.close();
	oauthWindow = null;
	rejectWaiters();
}
