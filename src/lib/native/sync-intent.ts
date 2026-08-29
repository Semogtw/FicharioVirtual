import { invokeNative, isNativeRuntime } from '$lib/platform/native-bridge';

function request(
	documentId: string,
	context: {
		title?: string | null;
		notebookId?: string | null;
		promptVersion?: number;
	} = {}
) {
	const value: {
		documentId: string;
		title?: string | null;
		notebookId?: string | null;
		promptVersion?: number;
	} = { documentId };
	if (Object.keys(context).length > 0) {
		value.title = context.title ?? null;
		value.notebookId = context.notebookId ?? null;
		value.promptVersion = context.promptVersion ?? 1;
	}
	return { request: value } as const;
}

export async function ensureNativeUploadIntent(
	documentId: string,
	context: {
		title?: string | null;
		notebookId?: string | null;
		promptVersion?: number;
	} = {}
): Promise<boolean> {
	if (!isNativeRuntime()) return false;
	const hasContext = Object.keys(context).length > 0;
	const title = context.title?.trim() || null;
	if (title && title.length > 240) throw new TypeError('Invalid native upload title');
	const notebookId = context.notebookId?.trim() || null;
	if (notebookId && notebookId.length > 128) throw new TypeError('Invalid native notebook id');
	const promptVersion = context.promptVersion ?? 1;
	if (!Number.isSafeInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid native OCR prompt version');
	}
	return await invokeNative<boolean>(
		'ensure_native_upload_intent',
		request(documentId, hasContext ? { title, notebookId, promptVersion } : {})
	);
}

export async function cancelNativeUploadIntent(documentId: string): Promise<boolean> {
	if (!isNativeRuntime()) return false;
	return await invokeNative<boolean>('cancel_native_upload_intent', {
		request: { documentId }
	});
}
