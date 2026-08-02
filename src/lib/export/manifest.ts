import { z } from 'zod';

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const warning = z
	.object({ code: z.string().min(1).max(64), message: z.string().min(1).max(300) })
	.strict();
const page = z
	.object({
		id: z.string().min(1),
		pageNumber: z.number().int().positive(),
		nativeText: z.string().nullable(),
		ocrRawText: z.string().nullable(),
		correctedText: z.string().nullable(),
		effectiveText: z.string(),
		extractionSource: z.enum(['native_pdf', 'ocr', 'manual']).nullable(),
		warnings: z.array(warning),
		status: z.enum([
			'uploading',
			'pending',
			'processing',
			'ready',
			'partially_ready',
			'needs_review',
			'retryable',
			'blocked_quota',
			'failed'
		]),
		wasManuallyReviewed: z.boolean(),
		updatedAt: timestamp
	})
	.strict();
const notebook = z
	.object({
		id: z.string().min(1),
		name: z.string().min(1),
		description: z.string().nullable(),
		coverStyle: z.string().min(1),
		createdAt: timestamp,
		updatedAt: timestamp
	})
	.strict();
const document = z
	.object({
		id: z.string().min(1),
		title: z.string().min(1),
		kind: z.enum(['image', 'pdf']),
		status: z.enum([
			'uploading',
			'pending',
			'processing',
			'ready',
			'partially_ready',
			'needs_review',
			'failed'
		]),
		originalFilename: z.string().min(1),
		sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
		notebookId: z.string().nullable(),
		createdAt: timestamp,
		updatedAt: timestamp,
		tags: z.array(z.string().min(1).max(120)),
		pages: z.array(page)
	})
	.strict();
const exportManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		exportedAt: timestamp,
		notebooks: z.array(notebook),
		documents: z.array(document)
	})
	.strict();

export type ExportManifest = z.infer<typeof exportManifestSchema>;

export function parseExportManifest(value: unknown): ExportManifest {
	const result = exportManifestSchema.safeParse(value);
	if (!result.success) throw new TypeError('Invalid export manifest');
	return Object.freeze(result.data);
}

export function exportFilename(exportedAt: string) {
	const date = new Date(exportedAt);
	if (Number.isNaN(date.getTime())) throw new TypeError('Invalid export timestamp');
	const stable = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
	return `fichario-${stable}.json`;
}
