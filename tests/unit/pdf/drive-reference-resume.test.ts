import { describe, expect, it, vi } from 'vitest';
import { listDrivePdfReferences } from '../../../src/lib/pdf/drive-reference-resume';

const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const driveFileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz_123456';

function client(data: unknown, error: unknown = null) {
	return {
		rpc: vi.fn().mockResolvedValue({ data, error })
	} as never;
}

describe('listDrivePdfReferences', () => {
	it('returns frozen resumable metadata without credentials or file bytes', async () => {
		const input = [
			{
				documentId,
				driveFileId,
				sourceSizeBytes: 70 * 1024 * 1024,
				status: 'pending_inspection',
				title: 'PDF preservado',
				sourceModifiedAt: '2026-08-05T12:00:00.000Z',
				updatedAt: '2026-08-07T18:00:00.000Z'
			}
		];
		const value = await listDrivePdfReferences(client(input));

		expect(value).toEqual(input);
		expect(Object.isFrozen(value)).toBe(true);
		expect(Object.isFrozen(value[0])).toBe(true);
		expect(Object.keys(value[0] ?? {}).sort()).toEqual(
			[
				'documentId',
				'driveFileId',
				'sourceSizeBytes',
				'status',
				'title',
				'sourceModifiedAt',
				'updatedAt'
			].sort()
		);
		expect(JSON.stringify(value)).not.toMatch(
			/accessToken|refreshToken|blob|fileData|fileContents/i
		);
	});

	it('rejects malformed or widened server responses', async () => {
		await expect(
			listDrivePdfReferences(
				client([
					{
						documentId,
						driveFileId,
						sourceSizeBytes: 70 * 1024 * 1024,
						status: 'pending_inspection',
						title: 'PDF preservado',
						sourceModifiedAt: '2026-08-05T12:00:00.000Z',
						updatedAt: '2026-08-07T18:00:00.000Z',
						accessToken: 'must-not-pass'
					}
				])
			)
		).rejects.toThrow('Invalid Drive PDF reference list');
	});

	it('maps RPC failures to a stable resume error', async () => {
		await expect(listDrivePdfReferences(client(null, new Error('network')))).rejects.toThrow(
			'Não foi possível carregar os PDFs grandes pendentes.'
		);
	});
});
