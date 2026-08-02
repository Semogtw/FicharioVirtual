import type { PageWarning } from '$lib/domain/page';
import type { DocumentKind, Json, ProcessingStatus } from '$lib/types/database';
import { getSupabaseClient } from './supabase';

export type ReviewItem = {
	pageId: string;
	documentId: string;
	documentTitle: string;
	documentKind: DocumentKind;
	pageNumber: number;
	pageStatus: ProcessingStatus;
	excerpt: string;
	warnings: readonly PageWarning[];
	updatedAt: string;
};

type ReviewRow = {
	page_id: string;
	document_id: string;
	document_title: string;
	document_kind: DocumentKind;
	page_number: number;
	page_status: ProcessingStatus;
	excerpt: string;
	warnings: Json;
	updated_at: string;
};

export type ReviewClientLike = {
	rpc(
		name: 'list_review_pages',
		args: { result_limit: number; result_offset: number }
	): Promise<{ data: unknown; error: unknown }>;
};

export type ReviewOptions = {
	limit?: number;
	offset?: number;
};

export class ReviewServiceError extends Error {
	constructor() {
		super('Não foi possível carregar a fila de revisão.');
		this.name = 'ReviewServiceError';
	}
}

function warnings(value: Json): readonly PageWarning[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return Object.freeze(
		value.flatMap((candidate) => {
			if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate))
				return [];
			if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return [];
			return [Object.freeze({ code: candidate.code, message: candidate.message })];
		})
	);
}

function defaultClient(): ReviewClientLike {
	return getSupabaseClient() as unknown as ReviewClientLike;
}

export async function listReviewItems(
	options: ReviewOptions = {},
	client?: ReviewClientLike
): Promise<readonly ReviewItem[]> {
	const limit = options.limit ?? 50;
	const offset = options.offset ?? 0;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new TypeError('Invalid review limit');
	}
	if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
		throw new TypeError('Invalid review offset');
	}
	const gateway = client ?? defaultClient();
	const { data, error } = await gateway.rpc('list_review_pages', {
		result_limit: limit,
		result_offset: offset
	});
	if (error || !Array.isArray(data)) throw new ReviewServiceError();
	return Object.freeze(
		(data as ReviewRow[]).map((row) =>
			Object.freeze({
				pageId: row.page_id,
				documentId: row.document_id,
				documentTitle: row.document_title,
				documentKind: row.document_kind,
				pageNumber: row.page_number,
				pageStatus: row.page_status,
				excerpt: row.excerpt,
				warnings: warnings(row.warnings),
				updatedAt: row.updated_at
			})
		)
	);
}
