import { getSupabaseClient } from '$lib/services/supabase';
import type { PdfImportPagePlan } from './import-plan';
import {
	stageDrivePdfReferencePageDescriptors,
	type DrivePdfReferencePageDescriptor
} from './drive-reference-page-staging';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEGIN_RPC = 'begin_drive_pdf_reference_descriptor_attempt';
const RENEW_RPC = 'renew_drive_pdf_reference_descriptor_attempt';
const STAGE_BATCH_RPC = 'stage_drive_pdf_reference_descriptor_batch';
const FINALIZE_RPC = 'finalize_drive_pdf_reference_descriptor_attempt';
const ABANDON_RPC = 'abandon_drive_pdf_reference_descriptor_attempt';
const LEASE_RENEW_SAFETY_MS = 2 * 60_000;
const MAX_EXPECTED_PAGES = 10_000;

type DescriptorRpcClient = Readonly<{
	rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}>;

type DrivePdfReferenceDescriptorFinalizeInput = Readonly<{
	pages: readonly PdfImportPagePlan[];
	promptVersion?: number;
	batchSize?: number;
	signal?: AbortSignal;
	onBatch?: (current: number, total: number, stagedPages: number) => void;
}>;

export interface DrivePdfReferenceDescriptorAttemptDependencies {
	createAttemptId(): string;
	begin(input: { documentId: string; attemptId: string; expectedPageCount: number }): Promise<void>;
	stageBatch(input: {
		documentId: string;
		attemptId: string;
		descriptors: readonly DrivePdfReferencePageDescriptor[];
	}): Promise<void>;
	finalize(input: {
		documentId: string;
		attemptId: string;
		promptVersion: number;
	}): Promise<unknown>;
	abandon(input: { documentId: string; attemptId: string }): Promise<void>;
}

export interface DrivePdfReferenceDescriptorLease {
	readonly attemptId: string;
	renew(): Promise<void>;
	renewIfNeeded(): Promise<void>;
	stageAndFinalize(input: DrivePdfReferenceDescriptorFinalizeInput): Promise<unknown>;
	abandon(): Promise<boolean>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function parseTimestamp(value: unknown) {
	if (typeof value !== 'string' || value.length < 20 || value.length > 64) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function parseLeaseResponse(
	value: unknown,
	expected: { documentId: string; attemptId: string; expectedPageCount: number }
) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid Drive PDF descriptor attempt response');
	}
	const record = value as Record<string, unknown>;
	if (
		!exactKeys(record, ['documentId', 'attemptId', 'expectedPageCount', 'expiresAt']) ||
		record.documentId !== expected.documentId ||
		record.attemptId !== expected.attemptId ||
		record.expectedPageCount !== expected.expectedPageCount
	) {
		throw new Error('Invalid Drive PDF descriptor attempt response');
	}
	const expiresAt = parseTimestamp(record.expiresAt);
	if (expiresAt === null) throw new Error('Invalid Drive PDF descriptor attempt response');
	return expiresAt;
}

function parseStageResponse(
	value: unknown,
	expected: { documentId: string; attemptId: string; acceptedCount: number }
) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid Drive PDF descriptor batch response');
	}
	const record = value as Record<string, unknown>;
	if (
		!exactKeys(record, ['documentId', 'attemptId', 'acceptedCount', 'expiresAt']) ||
		record.documentId !== expected.documentId ||
		record.attemptId !== expected.attemptId ||
		record.acceptedCount !== expected.acceptedCount
	) {
		throw new Error('Invalid Drive PDF descriptor batch response');
	}
	const expiresAt = parseTimestamp(record.expiresAt);
	if (expiresAt === null) throw new Error('Invalid Drive PDF descriptor batch response');
	return expiresAt;
}

function validatePromptVersion(value: number | undefined) {
	const promptVersion = value ?? 1;
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	return promptVersion;
}

function abortError() {
	return new DOMException('Drive PDF descriptor attempt was cancelled', 'AbortError');
}

export async function acquireDrivePdfReferenceDescriptorLease({
	documentId,
	expectedPageCount,
	client = getSupabaseClient() as unknown as DescriptorRpcClient,
	createAttemptId = () => crypto.randomUUID(),
	now = () => Date.now()
}: {
	documentId: string;
	expectedPageCount: number;
	client?: DescriptorRpcClient;
	createAttemptId?: () => string;
	now?: () => number;
}): Promise<DrivePdfReferenceDescriptorLease> {
	if (!UUID.test(documentId)) throw new TypeError('Invalid Drive PDF reference document id');
	if (
		!Number.isSafeInteger(expectedPageCount) ||
		expectedPageCount < 1 ||
		expectedPageCount > MAX_EXPECTED_PAGES
	) {
		throw new TypeError('Invalid Drive PDF descriptor page count');
	}

	const attemptId = createAttemptId();
	if (!UUID.test(attemptId)) throw new TypeError('Invalid Drive PDF descriptor attempt id');

	const { data: beginData, error: beginError } = await client.rpc(BEGIN_RPC, {
		target_document_id: documentId,
		target_attempt_id: attemptId,
		expected_page_count: expectedPageCount
	});
	if (beginError) throw beginError;
	let expiresAt = parseLeaseResponse(beginData, { documentId, attemptId, expectedPageCount });

	const renew = async () => {
		const { data, error } = await client.rpc(RENEW_RPC, {
			target_document_id: documentId,
			target_attempt_id: attemptId
		});
		if (error) throw error;
		expiresAt = parseLeaseResponse(data, { documentId, attemptId, expectedPageCount });
	};

	const renewIfNeeded = async () => {
		if (expiresAt - now() <= LEASE_RENEW_SAFETY_MS) await renew();
	};

	const lease: DrivePdfReferenceDescriptorLease = Object.freeze({
		attemptId,
		renew,
		renewIfNeeded,
		async stageAndFinalize({
			pages,
			promptVersion: requestedPromptVersion,
			batchSize,
			signal,
			onBatch
		}: DrivePdfReferenceDescriptorFinalizeInput) {
			const promptVersion = validatePromptVersion(requestedPromptVersion);
			if (pages.length !== expectedPageCount) {
				throw new TypeError('Invalid Drive PDF descriptor page count');
			}
			if (signal?.aborted) throw abortError();

			await stageDrivePdfReferencePageDescriptors({
				documentId,
				pages,
				batchSize,
				signal,
				onBatch,
				stageBatch: async ({ descriptors }) => {
					await renewIfNeeded();
					const { data, error } = await client.rpc(STAGE_BATCH_RPC, {
						target_document_id: documentId,
						target_attempt_id: attemptId,
						descriptors
					});
					if (error) throw error;
					expiresAt = parseStageResponse(data, {
						documentId,
						attemptId,
						acceptedCount: descriptors.length
					});
				}
			});
			if (signal?.aborted) throw abortError();
			await renewIfNeeded();

			const { data, error } = await client.rpc(FINALIZE_RPC, {
				target_document_id: documentId,
				target_attempt_id: attemptId,
				prompt_version: promptVersion
			});
			if (error) throw error;
			return data;
		},
		async abandon() {
			const { data, error } = await client.rpc(ABANDON_RPC, {
				target_document_id: documentId,
				target_attempt_id: attemptId
			});
			if (error) throw error;
			if (typeof data !== 'boolean') {
				throw new Error('Invalid Drive PDF descriptor abandon response');
			}
			return data;
		}
	});

	return lease;
}

async function stageAndFinalizeWithDependencies({
	documentId,
	pages,
	promptVersion,
	batchSize,
	signal,
	onBatch,
	dependencies
}: {
	documentId: string;
	pages: readonly PdfImportPagePlan[];
	promptVersion: number;
	batchSize?: number;
	signal?: AbortSignal;
	onBatch?: (current: number, total: number, stagedPages: number) => void;
	dependencies: DrivePdfReferenceDescriptorAttemptDependencies;
}) {
	const attemptId = dependencies.createAttemptId();
	if (!UUID.test(attemptId)) throw new TypeError('Invalid Drive PDF descriptor attempt id');
	let leased = false;

	try {
		await dependencies.begin({ documentId, attemptId, expectedPageCount: pages.length });
		leased = true;
		if (signal?.aborted) throw abortError();

		await stageDrivePdfReferencePageDescriptors({
			documentId,
			pages,
			batchSize,
			signal,
			onBatch,
			stageBatch: ({ descriptors }) =>
				dependencies.stageBatch({ documentId, attemptId, descriptors })
		});
		if (signal?.aborted) throw abortError();

		return await dependencies.finalize({ documentId, attemptId, promptVersion });
	} catch (error) {
		if (leased) await dependencies.abandon({ documentId, attemptId }).catch(() => undefined);
		throw error;
	}
}

export async function stageAndFinalizeDrivePdfReferenceDescriptors({
	documentId,
	pages,
	promptVersion: requestedPromptVersion,
	batchSize,
	signal,
	onBatch,
	client,
	dependencies
}: {
	documentId: string;
	pages: readonly PdfImportPagePlan[];
	promptVersion?: number;
	batchSize?: number;
	signal?: AbortSignal;
	onBatch?: (current: number, total: number, stagedPages: number) => void;
	client?: DescriptorRpcClient;
	dependencies?: DrivePdfReferenceDescriptorAttemptDependencies;
}): Promise<unknown> {
	if (!UUID.test(documentId)) throw new TypeError('Invalid Drive PDF reference document id');
	const promptVersion = validatePromptVersion(requestedPromptVersion);
	if (signal?.aborted) throw abortError();

	if (dependencies) {
		return stageAndFinalizeWithDependencies({
			documentId,
			pages,
			promptVersion,
			batchSize,
			signal,
			onBatch,
			dependencies
		});
	}

	const rpcClient = client ?? (getSupabaseClient() as unknown as DescriptorRpcClient);
	const lease = await acquireDrivePdfReferenceDescriptorLease({
		documentId,
		expectedPageCount: pages.length,
		client: rpcClient
	});
	try {
		return await lease.stageAndFinalize({ pages, promptVersion, batchSize, signal, onBatch });
	} catch (error) {
		await lease.abandon().catch(() => undefined);
		throw error;
	}
}
