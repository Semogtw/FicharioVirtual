import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DocumentOcrSummary = Readonly<{
	total: number;
	completed: number;
	needsReview: number;
	pending: number;
	failed: number;
}>;

type OcrSummaryRpcClient = {
	rpc(
		name: 'get_document_ocr_summary',
		args: { target_document_id: string }
	): PromiseLike<{ data: unknown; error: unknown }>;
};

function parseCount(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseDocumentOcrSummary(data: unknown): DocumentOcrSummary {
	if (!Array.isArray(data) || data.length !== 1) throw new TypeError('Invalid OCR summary');
	const row = data[0];
	if (row === null || typeof row !== 'object' || Array.isArray(row)) {
		throw new TypeError('Invalid OCR summary');
	}
	const record = row as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (
		keys.length !== 5 ||
		keys[0] !== 'completed' ||
		keys[1] !== 'failed' ||
		keys[2] !== 'needs_review' ||
		keys[3] !== 'pending' ||
		keys[4] !== 'total'
	) {
		throw new TypeError('Invalid OCR summary');
	}
	const total = parseCount(record.total);
	const completed = parseCount(record.completed);
	const needsReview = parseCount(record.needs_review);
	const pending = parseCount(record.pending);
	const failed = parseCount(record.failed);
	if (
		total === null ||
		completed === null ||
		needsReview === null ||
		pending === null ||
		failed === null ||
		completed + needsReview + pending + failed !== total
	) {
		throw new TypeError('Invalid OCR summary');
	}
	return Object.freeze({ total, completed, needsReview, pending, failed });
}

export async function getDocumentOcrSummary(
	documentId: string,
	client: SupabaseClient<Database> = getSupabaseClient()
): Promise<DocumentOcrSummary> {
	if (!UUID.test(documentId)) throw new TypeError('Invalid document identifier');
	const rpcClient = client as unknown as OcrSummaryRpcClient;
	const { data, error } = await rpcClient.rpc('get_document_ocr_summary', {
		target_document_id: documentId
	});
	if (error) throw new Error('Não foi possível atualizar o estado da leitura.');
	try {
		return parseDocumentOcrSummary(data);
	} catch {
		throw new Error('Não foi possível atualizar o estado da leitura.');
	}
}
