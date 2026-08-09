import { describe, expect, it, vi } from 'vitest';
import { acquireDrivePdfReferenceDescriptorLease } from '../../../src/lib/pdf/drive-reference-descriptor-attempt';
import type { PdfImportPagePlan } from '../../../src/lib/pdf/import-plan';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const start = Date.parse('2026-08-08T12:00:00.000Z');

function page(): PdfImportPagePlan {
	return Object.freeze({
		id: '11111111-1111-4111-8111-111111111111',
		pageNumber: 1,
		nativeText: 'Texto',
		needsOcr: false,
		temporaryImagePath: null,
		jobId: null
	});
}

function client(now: () => number) {
	return {
		rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
			const expiresAt = new Date(now() + 15 * 60_000).toISOString();
			switch (name) {
				case 'begin_drive_pdf_reference_descriptor_attempt':
				case 'renew_drive_pdf_reference_descriptor_attempt':
					return {
						data: {
							documentId,
							attemptId,
							expectedPageCount: 1,
							expiresAt
						},
						error: null
					};
				case 'stage_drive_pdf_reference_descriptor_batch':
					return {
						data: {
							documentId,
							attemptId,
							acceptedCount: (args.descriptors as unknown[]).length,
							expiresAt
						},
						error: null
					};
				case 'finalize_drive_pdf_reference_descriptor_attempt':
					return {
						data: {
							documentId,
							pageCount: 1,
							ocrPageCount: 0,
							reviewPageCount: 0,
							status: 'ready'
						},
						error: null
					};
				case 'abandon_drive_pdf_reference_descriptor_attempt':
					return { data: true, error: null };
				default:
					throw new Error(`unexpected RPC ${name}`);
			}
		})
	};
}

describe('renewable Drive PDF descriptor lease', () => {
	it('acquires a lease and renews it only when it enters the safety window', async () => {
		let currentTime = start;
		const rpcClient = client(() => currentTime);
		const lease = await acquireDrivePdfReferenceDescriptorLease({
			documentId,
			expectedPageCount: 1,
			client: rpcClient,
			createAttemptId: () => attemptId,
			now: () => currentTime
		});

		expect(lease.attemptId).toBe(attemptId);
		expect(rpcClient.rpc).toHaveBeenCalledTimes(1);
		await lease.renewIfNeeded();
		expect(rpcClient.rpc).toHaveBeenCalledTimes(1);

		currentTime += 14 * 60_000;
		await lease.renewIfNeeded();
		expect(rpcClient.rpc).toHaveBeenLastCalledWith('renew_drive_pdf_reference_descriptor_attempt', {
			target_document_id: documentId,
			target_attempt_id: attemptId
		});
	});

	it('stages through the leased batch RPC and finalizes the same attempt', async () => {
		let currentTime = start;
		const rpcClient = client(() => currentTime);
		const lease = await acquireDrivePdfReferenceDescriptorLease({
			documentId,
			expectedPageCount: 1,
			client: rpcClient,
			createAttemptId: () => attemptId,
			now: () => currentTime
		});

		await expect(
			lease.stageAndFinalize({ pages: [page()], promptVersion: 3 })
		).resolves.toMatchObject({ documentId, pageCount: 1, status: 'ready' });
		expect(rpcClient.rpc).toHaveBeenCalledWith(
			'stage_drive_pdf_reference_descriptor_batch',
			expect.objectContaining({
				target_document_id: documentId,
				target_attempt_id: attemptId
			})
		);
		expect(rpcClient.rpc).toHaveBeenCalledWith('finalize_drive_pdf_reference_descriptor_attempt', {
			target_document_id: documentId,
			target_attempt_id: attemptId,
			prompt_version: 3
		});
	});

	it('returns the server ownership result when abandoning', async () => {
		const currentTime = start;
		const rpcClient = client(() => currentTime);
		const lease = await acquireDrivePdfReferenceDescriptorLease({
			documentId,
			expectedPageCount: 1,
			client: rpcClient,
			createAttemptId: () => attemptId,
			now: () => currentTime
		});

		await expect(lease.abandon()).resolves.toBe(true);
		expect(rpcClient.rpc).toHaveBeenLastCalledWith(
			'abandon_drive_pdf_reference_descriptor_attempt',
			{
				target_document_id: documentId,
				target_attempt_id: attemptId
			}
		);
	});
});
