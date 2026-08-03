import { z } from 'zod';
import type { PageWarning } from '$lib/domain/page';
import type { DocumentKind, ProcessingStatus } from '$lib/types/database';
import { isIsoTimestamp } from '$lib/validation/iso-timestamp';
import { getSupabaseClient } from './supabase';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const warningSchema = z
	.object({
		code: z.string().trim().min(1).max(100),
		message: z.string().trim().min(1).max(500)
	})
	.strict();
const reviewRowSchema = z
	.object({
		page_id: z.string().regex(UUID),
		document_id: z.string().regex(UUID),
		document_title: z.string().trim().min(1).max(240),
		document_kind: z.enum(['image', 'pdf']),
		page_number: z.number().int().min(1).max(10_000),
		page_status: z.enum([
			'pending',
			'processing',
			'ready',
			'retryable',
			'blocked_quota',
			'needs_review',
			'failed'
		]),
		excerpt: z.string().max(2_000),
		warnings: z.array(warningSchema).max(100),
		updated_at: z.string().refine(isIsoTimestamp)
	})
	.strict();
const reviewRowsSchema = z.array(reviewRowSchema).max(100);

type ReviewRow = z.infer<typeof reviewRowSchema>;

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

function mapRow(row: ReviewRow): ReviewItem {
	return Object.freeze({
		pageId: row.page_id,
		documentId: row.document_id,
		documentTitle: row.document_title,
		documentKind: row.document_kind,
		pageNumber: row.page_number,
		pageStatus: row.page_status,
		excerpt: row.excerpt,
		warnings: Object.freeze(row.warnings.map((warning) => Object.freeze({ ...warning }))),
		updatedAt: row.updated_at
	});
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
	try {
		const gateway = client ?? defaultClient();
		const { data, error } = await gateway.rpc('list_review_pages', {
			result_limit: limit,
			result_offset: offset
		});
		if (error) throw new ReviewServiceError();
		const rows = reviewRowsSchema.parse(data);
		return Object.freeze(rows.map(mapRow));
	} catch {
		throw new ReviewServiceError();
	}
}
