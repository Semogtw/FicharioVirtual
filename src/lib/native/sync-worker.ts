import {
	readNativeDocumentBlob,
	resolveNativeDocument,
	type NativeDocument
} from '$lib/native/local-document-store';
import {
	cancelNativeSyncJob,
	claimNativeSyncJobs,
	completeNativeSyncJob,
	failNativeSyncJob,
	type NativeSyncJob
} from '$lib/native/sync-queue';
import { isNativeRuntime } from '$lib/platform/native-bridge';

const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_RETRY_MS = 24 * 60 * 60 * 1000;

export type NativeUploadPayload = Readonly<{
	version: 1;
	kind: 'upload_original';
	documentId: string;
	ownerId: string;
	originalFilename: string;
	title: string;
	notebookId: string | null;
	promptVersion: number;
	mimeType: string;
	sizeBytes: number;
	sha256: string;
	relativePath: string;
	remoteDocumentId: string | null;
	driveFileId: string | null;
}>;

export type NativePublishedDocument = Readonly<{
	remoteDocumentId: string | null;
	driveFileId: string | null;
}>;

export type NativeSyncWorkerDependencies = Readonly<{
	claimJobs(limit?: number): Promise<readonly NativeSyncJob[] | null>;
	resolveDocument(documentId: string): Promise<NativeDocument | null>;
	readDocument(document: NativeDocument): Promise<Blob>;
	publish(file: File, payload: NativeUploadPayload): Promise<NativePublishedDocument>;
	markRemoteSynced(input: {
		documentId: string;
		remoteDocumentId: string | null;
		driveFileId: string | null;
	}): Promise<void>;
	completeJob(id: number): Promise<void>;
	failJob(input: { id: number; error: string; retryAfterMs: number }): Promise<void>;
	cancelJob(input: { id: number; error: string }): Promise<void>;
}>;

export type NativeSyncWorkerResult = Readonly<{
	claimed: number;
	completed: number;
	retried: number;
	cancelled: number;
}>;

export class NativeSyncPermanentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NativeSyncPermanentError';
	}
}

export class NativeSyncDuplicateError extends Error {
	readonly remoteDocumentId: string;

	constructor(remoteDocumentId: string) {
		super('O documento já existe remotamente; o catálogo local será reconciliado.');
		this.name = 'NativeSyncDuplicateError';
		this.remoteDocumentId = remoteDocumentId;
	}
}

function invalid(message: string): never {
	throw new NativeSyncPermanentError(message);
}

function stringValue(value: unknown, label: string, maximum = 512) {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
		invalid(`Payload de sincronização inválido: ${label}`);
	}
	return value;
}

function nullableStringValue(value: unknown, label: string, maximum = 512) {
	if (value !== null && typeof value !== 'string') {
		invalid(`Payload de sincronização inválido: ${label}`);
	}
	if (typeof value === 'string' && value.length > maximum) {
		invalid(`Payload de sincronização inválido: ${label}`);
	}
	return value as string | null;
}

export function parseNativeUploadPayload(
	value: string | null,
	expectedDocumentId: string,
	document: NativeDocument
): NativeUploadPayload {
	if (value === null) invalid('Payload de sincronização ausente');
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		invalid('Payload de sincronização não é JSON válido');
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		invalid('Payload de sincronização inválido');
	}
	const row = parsed as Record<string, unknown>;
	if (row.version !== 1 || row.kind !== 'upload_original') {
		invalid('Tipo de sincronização não suportado');
	}
	const documentId = stringValue(row.documentId, 'documentId');
	const ownerId = stringValue(row.ownerId, 'ownerId');
	const originalFilename = stringValue(row.originalFilename, 'originalFilename', 240);
	const title = stringValue(row.title ?? originalFilename, 'title', 240);
	const notebookId = nullableStringValue(row.notebookId ?? null, 'notebookId', 128);
	const promptVersion = row.promptVersion ?? 1;
	const mimeType = stringValue(row.mimeType, 'mimeType', 120);
	const relativePath = stringValue(row.relativePath, 'relativePath', 1_024);
	const sizeBytes = row.sizeBytes;
	const sha256 = stringValue(row.sha256, 'sha256', 64);
	if (
		documentId !== expectedDocumentId ||
		documentId !== document.documentId ||
		ownerId !== document.ownerId ||
		title.length === 0 ||
		mimeType !== document.mimeType ||
		sizeBytes !== document.sizeBytes ||
		!Number.isSafeInteger(sizeBytes) ||
		!Number.isSafeInteger(promptVersion) ||
		(promptVersion as number) < 1 ||
		(promptVersion as number) > 10_000 ||
		!SHA256.test(sha256) ||
		sha256 !== document.sha256
	) {
		invalid('Payload de sincronização não corresponde ao documento local');
	}
	return Object.freeze({
		version: 1,
		kind: 'upload_original',
		documentId,
		ownerId,
		originalFilename,
		title,
		notebookId,
		promptVersion: promptVersion as number,
		mimeType,
		sizeBytes,
		sha256,
		relativePath,
		remoteDocumentId: nullableStringValue(row.remoteDocumentId, 'remoteDocumentId'),
		driveFileId: nullableStringValue(row.driveFileId, 'driveFileId')
	});
}

function retryDelay(attempts: number) {
	const exponent = Math.min(Math.max(attempts - 1, 0), 14);
	return Math.min(MAX_RETRY_MS, 1_000 * 2 ** exponent);
}

function errorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.trim().slice(0, 2_000) || 'Falha desconhecida na sincronização local';
}

async function runWorker(
	dependencies: NativeSyncWorkerDependencies,
	limit: number
): Promise<NativeSyncWorkerResult | null> {
	const jobs = await dependencies.claimJobs(limit);
	if (jobs === null) return null;
	let completed = 0;
	let retried = 0;
	let cancelled = 0;
	for (const job of jobs) {
		try {
			const document = await dependencies.resolveDocument(job.documentId);
			if (document === null) invalid('Documento local não encontrado');
			if (job.operation !== 'upload') invalid(`Operação nativa não suportada: ${job.operation}`);
			const payload = parseNativeUploadPayload(job.payloadJson, job.documentId, document);
			if (document.localState !== 'present') invalid('O original local não está disponível');
			const blob = await dependencies.readDocument(document);
			if (blob.size !== document.sizeBytes) {
				invalid('O original local tem tamanho diferente do catálogo');
			}
			const file = new File([blob], payload.originalFilename, {
				type: payload.mimeType,
				lastModified: Date.now()
			});
			const published = await dependencies.publish(file, payload);
			await dependencies.markRemoteSynced({
				documentId: payload.documentId,
				remoteDocumentId: published.remoteDocumentId,
				driveFileId: published.driveFileId
			});
			await dependencies.completeJob(job.id);
			completed += 1;
		} catch (error) {
			const message = errorMessage(error);
			if (error instanceof NativeSyncDuplicateError) {
				try {
					await dependencies.markRemoteSynced({
						documentId: job.documentId,
						remoteDocumentId: error.remoteDocumentId,
						driveFileId: null
					});
					await dependencies.completeJob(job.id);
					completed += 1;
				} catch (reconciliationError) {
					await dependencies.failJob({
						id: job.id,
						error: errorMessage(reconciliationError),
						retryAfterMs: retryDelay(job.attempts)
					});
					retried += 1;
				}
			} else if (error instanceof NativeSyncPermanentError) {
				await dependencies.cancelJob({ id: job.id, error: message });
				cancelled += 1;
			} else {
				await dependencies.failJob({
					id: job.id,
					error: message,
					retryAfterMs: retryDelay(job.attempts)
				});
				retried += 1;
			}
		}
	}
	return Object.freeze({ claimed: jobs.length, completed, retried, cancelled });
}

const defaultDependencies: NativeSyncWorkerDependencies = {
	claimJobs: (limit) => claimNativeSyncJobs({ limit }),
	resolveDocument: resolveNativeDocument,
	readDocument: readNativeDocumentBlob,
	publish: publishNativeDocument,
	markRemoteSynced: async (input) => {
		const { markNativeDocumentRemoteSynced } = await import('$lib/native/local-document-store');
		await markNativeDocumentRemoteSynced(input);
	},
	completeJob: async (id) => {
		await completeNativeSyncJob(id);
	},
	failJob: async (input) => {
		await failNativeSyncJob(input);
	},
	cancelJob: async (input) => {
		await cancelNativeSyncJob(input);
	}
};

async function publishNativeDocument(file: File, payload: NativeUploadPayload) {
	try {
		if (payload.mimeType === 'application/pdf') {
			const { uploadPdfToDrive } = await import('$lib/pdf/drive-upload');
			const result = await uploadPdfToDrive(file, {
				nativeDocumentId: payload.documentId,
				title: payload.title,
				notebookId: payload.notebookId,
				promptVersion: payload.promptVersion
			});
			return {
				remoteDocumentId: result.documentId,
				driveFileId: result.driveFileId ?? null
			};
		}
		if (/^image\/(jpeg|png|webp)$/i.test(payload.mimeType)) {
			const [{ prepareImage }, { uploadPreparedImage }] = await Promise.all([
				import('$lib/import/image-client'),
				import('$lib/import/upload')
			]);
			const prepared = await prepareImage(file, 'standard');
			const result = await uploadPreparedImage({
				prepared,
				title: payload.title,
				notebookId: payload.notebookId,
				promptVersion: payload.promptVersion,
				nativeDocumentId: payload.documentId
			});
			return {
				remoteDocumentId: result.documentId,
				driveFileId: result.storagePath.startsWith('drive:')
					? result.storagePath.slice('drive:'.length)
					: null
			};
		}
		invalid(`Tipo de arquivo não suportado: ${payload.mimeType}`);
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === 'DuplicatePdfError' || error.name === 'DuplicateImageError')
		) {
			const remoteDocumentId = (error as Error & { documentId?: unknown }).documentId;
			if (typeof remoteDocumentId === 'string' && remoteDocumentId.length > 0) {
				throw new NativeSyncDuplicateError(remoteDocumentId);
			}
		}
		throw error;
	}
}

let activeRun: Promise<NativeSyncWorkerResult | null> | null = null;

export function runNativeSyncWorker(
	options: {
		dependencies?: NativeSyncWorkerDependencies;
		limit?: number;
	} = {}
): Promise<NativeSyncWorkerResult | null> {
	if (!options.dependencies && !isNativeRuntime()) return Promise.resolve(null);
	if (activeRun) return activeRun;
	const dependencies = options.dependencies ?? defaultDependencies;
	const limit = Number.isSafeInteger(options.limit)
		? Math.min(Math.max(options.limit ?? 2, 1), 20)
		: 2;
	activeRun = runWorker(dependencies, limit).finally(() => {
		activeRun = null;
	});
	return activeRun;
}
