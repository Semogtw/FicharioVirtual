import { getSupabaseClient } from '$lib/services/supabase';
import type { PdfImportPagePlan } from './import-plan';
import {
	stageDrivePdfReferencePageDescriptors,
	type DrivePdfReferencePageDescriptor
} from './drive-reference-page-staging';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEGIN_RPC = 'begin_drive_pdf_reference_descriptor_attempt';
const STAGE_BATCH_RPC = 'stage_drive_pdf_reference_page_batch';
const FINALIZE_RPC = 'finalize_staged_drive_pdf_reference_import';
const ABANDON_RPC = 'abandon_drive_pdf_reference_descriptor_attempt';

type DescriptorRpcClient = Readonly<{
	rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}>;

export interface DrivePdfReferenceDescriptorAttemptDependencies {
	createAttemptId(): string;
	begin(input: {
		documentId: string;
		attemptId: string;
		expectedPageCount: number;
	}): Promise<void>;
	stageBatch(input: {
		documentId: string;
		attemptId: string;
		descriptors: readonly DrivePdfReferencePageDescriptor[];
	}): Promise<void>;
	finalize(input: { documentId: string; attemptId: string; promptVersion: number }): Promise<unknown>;
	abandon(input: { documentId: string; attemptId: string }): Promise<void>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(record).sort();
	const sorted = [...expected].sort();
	return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function normalizedTimestamp(value: unknown) {
	if (typeof value !== 'string' || value.length < 20 || value.length > 64) return null;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseLeaseResponse(
	value: unknown,
	expected: { documentId: string; attemptId: string; expectedPageCount?: number; acceptedCount?: number }
) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid Drive PDF descriptor attempt response');
	}
	const record = value as Record<string, unknown>;
	const expectedKeys =
		expected.expectedPageCount === undefined
			? ['documentId', 'attemptId', 'acceptedCount', 'expiresAt']
			: ['documentId', 'attemptId', 'expectedPageCount', 'expiresAt'];
	if (
		!exactKeys(record, expectedKeys) ||
		record.documentId !== expected.documentId ||
		record.attemptId !== expected.attemptId ||
		normalizedTimestamp(record.expiresAt) === null
	) {
		throw new Error('Invalid Drive PDF descriptor attempt response');
	}
	if (
		expected.expectedPageCount !== undefined &&
		record.expectedPageCount !== expected.expectedPageCount
	) {
		throw new Error('Invalid Drive PDF descriptor attempt response');
	}
	if (expected.acceptedCount !== undefined && record.acceptedCount !== expected.acceptedCount) {
		throw new Error('Invalid Drive PDF descriptor attempt response');
	}
}

function createDefaultDependencies(
	client: DescriptorRpcClient
): DrivePdfReferenceDescriptorAttemptDependencies {
	return {
		createAttemptId: () => crypto.randomUUID(),
		async begin(input) {
			const { data, error } = await client.rpc(BEGIN_RPC, {
				target_document_id: input.documentId,
				target_attempt_id: input.attemptId,
				expected_page_count: input.expectedPageCount
			});
			if (error) throw error;
			parseLeaseResponse(data, input);
		},
		async stageBatch(input) {
			const { data, error } = await client.rpc(STAGE_BATCH_RPC, {
				target_document_id: input.documentId,
				target_attempt_id: input.attemptId,
				page_descriptors: input.descriptors
			});
			if (error) throw error;
			parseLeaseResponse(data, {
				documentId: input.documentId,
				attemptId: input.attemptId,
				acceptedCount: input.descriptors.length
			});
		},
		async finalize(input) {
			const { data, error } = await client.rpc(FINALIZE_RPC, {
				target_document_id: input.documentId,
				target_attempt_id: input.attemptId,
				prompt_version: input.promptVersion
			});
			if (error) throw error;
			return data;
		},
		async abandon(input) {
			const { data, error } = await client.rpc(ABANDON_RPC, {
				target_document_id: input.documentId,
				target_attempt_id: input.attemptId
			});
			if (error) throw error;
			if (typeof data !== 'boolean') throw new Error('Invalid Drive PDF descriptor abandon response');
		}
	};
}

function abortError() {
	return new DOMException('Drive PDF descriptor attempt was cancelled', 'AbortError');
}

export async function stageAndFinalizeDrivePdfReferenceDescriptors({
	documentId,
	pages,
	promptVersion = 1,
	batchSize,
	signal,
	onBatch,
	client = getSupabaseClient() as unknown as DescriptorRpcClient,
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
	if (!Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) {
		throw new TypeError('Invalid OCR prompt version');
	}
	if (signal?.aborted) throw abortError();

	const runtime = dependencies ?? createDefaultDependencies(client);
	const attemptId = runtime.createAttemptId();
	if (!UUID.test(attemptId)) throw new TypeError('Invalid Drive PDF descriptor attempt id');
	let leased = false;

	try {
		await runtime.begin({ documentId, attemptId, expectedPageCount: pages.length });
		leased = true;
		if (signal?.aborted) throw abortError();

		await stageDrivePdfReferencePageDescriptors({
			documentId,
			pages,
			batchSize,
			signal,
			onBatch,
			stageBatch: ({ descriptors }) =>
				runtime.stageBatch({ documentId, attemptId, descriptors })
		});
		if (signal?.aborted) throw abortError();

		return await runtime.finalize({ documentId, attemptId, promptVersion });
	} catch (error) {
		if (leased) await runtime.abandon({ documentId, attemptId }).catch(() => undefined);
		throw error;
	}
}
