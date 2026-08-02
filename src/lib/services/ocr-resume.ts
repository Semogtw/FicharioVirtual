import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { processPageOcr, type OcrRunResult } from './ocr';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingOcrPage = { id: string; pageNumber: number };
export interface OcrResumeGateway {
	recoverStaleJobs(): Promise<void>;
	listPendingPages(documentId: string): Promise<readonly PendingOcrPage[]>;
}
export type OcrResumeSummary = {
	completed: number;
	needsReview: number;
	pending: number;
	failed: number;
};
type OcrProcessor = (pageId: string) => Promise<OcrRunResult>;

function validId(value: string) {
	if (!UUID.test(value)) throw new TypeError('Invalid document identifier');
	return value;
}

export async function resumeDocumentOcrWithGateway(
	documentId: string,
	gateway: OcrResumeGateway,
	processor: OcrProcessor = processPageOcr
): Promise<OcrResumeSummary> {
	const validDocumentId = validId(documentId);
	await gateway.recoverStaleJobs();
	const pages = [...(await gateway.listPendingPages(validDocumentId))];
	let cursor = 0;
	let completed = 0;
	let needsReview = 0;
	let pending = 0;
	let failed = 0;

	async function consume() {
		while (cursor < pages.length) {
			const page = pages[cursor++];
			if (!page) return;
			try {
				const result = await processor(page.id);
				if (result.state === 'complete') {
					if (result.needsReview) needsReview += 1;
					else completed += 1;
				} else if (result.state === 'already_complete') completed += 1;
				else pending += 1;
			} catch {
				failed += 1;
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(2, pages.length) }, () => consume()));
	return Object.freeze({ completed, needsReview, pending, failed });
}

class SupabaseGateway implements OcrResumeGateway {
	constructor(private readonly client: SupabaseClient<Database>) {}

	async recoverStaleJobs() {
		type RecoveryClient = {
			rpc(
				name: 'recover_stale_ocr_jobs'
			): Promise<{ data: number | null; error: unknown }>;
		};
		const { error } = await (this.client as unknown as RecoveryClient).rpc(
			'recover_stale_ocr_jobs'
		);
		if (error) throw new Error('Não foi possível recuperar leituras interrompidas.');
	}

	async listPendingPages(documentId: string) {
		const { data, error } = await this.client
			.from('pages')
			.select('id,page_number')
			.eq('document_id', validId(documentId))
			.in('status', ['pending', 'retryable', 'blocked_quota'])
			.order('page_number', { ascending: true });
		if (error || !Array.isArray(data)) {
			throw new Error('Não foi possível localizar as páginas pendentes.');
		}
		return Object.freeze(
			data.map((page) => Object.freeze({ id: page.id, pageNumber: page.page_number }))
		);
	}
}

export function resumeDocumentOcr(
	documentId: string,
	client: SupabaseClient<Database> = getSupabaseClient()
) {
	return resumeDocumentOcrWithGateway(documentId, new SupabaseGateway(client));
}
