/// <reference lib="webworker" />

import initPdfInspector, { processPdf } from '@firecrawl/pdf-inspector-wasm';
import {
	routePdfProcessResult,
	type PdfInspectorProcessResult,
	type PdfWorkerFailure,
	type PdfWorkerRequest
} from './types';

const worker = self as DedicatedWorkerGlobalScope;
let initialization: Promise<void> | null = null;

function initialize() {
	initialization ??= initPdfInspector().then(() => undefined);
	return initialization;
}

function failureCode(error: unknown): PdfWorkerFailure['code'] {
	const message = error instanceof Error ? error.message : String(error);
	if (/password|encrypted|decrypt/i.test(message)) return 'encrypted_pdf';
	if (/pdf|header|xref|trailer|document/i.test(message)) return 'invalid_pdf';
	return 'inspection_failed';
}

worker.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
	const request = event.data;
	if (request?.type !== 'inspect' || typeof request.id !== 'string') return;

	if (request.file.type !== 'application/pdf' || request.file.size < 1) {
		worker.postMessage({
			type: 'failure',
			id: request.id,
			code: 'invalid_pdf'
		} satisfies PdfWorkerFailure);
		return;
	}

	let bytes: Uint8Array | null = null;
	try {
		await initialize();
		bytes = new Uint8Array(await request.file.arrayBuffer());
		const raw = processPdf(bytes, {
			profile: 'compact',
			includePageMarkers: true,
			includeImages: false
		}) as PdfInspectorProcessResult;
		worker.postMessage({
			type: 'success',
			id: request.id,
			inspection: routePdfProcessResult(raw)
		});
	} catch (error) {
		worker.postMessage({
			type: 'failure',
			id: request.id,
			code: failureCode(error)
		} satisfies PdfWorkerFailure);
	} finally {
		bytes?.fill(0);
	}
};

export {};
