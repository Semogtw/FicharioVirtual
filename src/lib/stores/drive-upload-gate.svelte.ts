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
	for (const waiter of [...waiters]) waiter.resolve();
	waiters.clear();
	driveUploadGate.visible = false;
	driveUploadGate.connecting = false;
	driveUploadGate.error = null;
}

function rejectWaiters() {
	for (const waiter of [...waiters]) waiter.reject(cancelledUpload());
	waiters.clear();
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

export async function requireDriveForUpload(): Promise<void> {
	if (typeof window === 'undefined') return;
	if (await checkConnection()) return;

	driveUploadGate.visible = true;
	if (!driveUploadGate.configured) {
		driveUploadGate.error = 'O Google Drive está temporariamente indisponível.';
	}

	return new Promise<void>((resolve, reject) => {
		waiters.add({ resolve, reject });
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
