import { describe, expect, it } from 'vitest';
import { PdfInspectionClient, type PdfWorkerLike } from '../../../src/lib/pdf/inspector-client';
import type { PdfWorkerRequest, PdfWorkerResponse } from '../../../src/lib/pdf/types';

class FakePdfWorker implements PdfWorkerLike {
	onmessage: ((event: MessageEvent<PdfWorkerResponse>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	request: PdfWorkerRequest | null = null;
	terminated = false;

	postMessage(request: PdfWorkerRequest) {
		this.request = request;
	}

	terminate() {
		this.terminated = true;
	}

	succeed() {
		if (!this.request) throw new Error('Worker was not started');
		this.onmessage?.({
			data: {
				type: 'success',
				id: this.request.id,
				inspection: {
					type: 'TextBased',
					pageCount: 1,
					nativePages: [{ pageNumber: 1, text: 'Texto' }],
					pagesNeedingOcr: [],
					ocrReasonsByPage: [],
					markdown: 'Texto',
					title: null,
					confidence: 1,
					processingTimeMs: 1,
					layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
					hasEncodingIssues: false
				}
			}
		} as unknown as MessageEvent<PdfWorkerResponse>);
	}
}

function pdf(name: string) {
	return new File(['pdf'], name, { type: 'application/pdf' });
}

function reportedSizePdf(name: string, size: number) {
	const file = pdf(name);
	Object.defineProperty(file, 'size', { value: size });
	return file;
}

describe('PdfInspectionClient', () => {
	it('does not enforce the obsolete 20 MiB logical PDF ceiling', async () => {
		const workers: FakePdfWorker[] = [];
		const client = new PdfInspectionClient(() => {
			const worker = new FakePdfWorker();
			workers.push(worker);
			return worker;
		});
		const file = reportedSizePdf('large.pdf', 21 * 1024 * 1024);

		const inspection = client.inspect(file);
		expect(workers[0]?.request?.file).toBe(file);
		workers[0]?.succeed();
		await expect(inspection).resolves.toEqual(expect.objectContaining({ pageCount: 1 }));
	});

	it('releases the worker slot when posting the inspection request throws', async () => {
		const workers: FakePdfWorker[] = [];
		let call = 0;
		const client = new PdfInspectionClient(() => {
			call += 1;
			const worker = new FakePdfWorker();
			if (call === 1) {
				worker.postMessage = () => {
					throw new Error('structured clone failed');
				};
			}
			workers.push(worker);
			return worker;
		}, 1);

		await expect(client.inspect(pdf('broken.pdf'))).rejects.toEqual(
			expect.objectContaining({ name: 'PdfInspectionError', code: 'inspection_failed' })
		);
		expect(workers[0]?.terminated).toBe(true);

		const next = client.inspect(pdf('next.pdf'));
		expect(workers).toHaveLength(2);
		workers[1]?.succeed();
		await expect(next).resolves.toEqual(expect.objectContaining({ pageCount: 1 }));
	});
});
