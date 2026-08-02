export interface NotebookSummary {
	id: string;
	name: string;
	description: string | null;
	coverStyle: string;
	documentCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface NotebookRecord {
	id: string;
	name: string;
	description: string | null;
	cover_style: string;
	document_count: number;
	created_at: string;
	updated_at: string;
}

export interface NewNotebookInput {
	name: string;
	description?: string | null;
	coverStyle?: string;
}

export interface UpdateNotebookInput {
	name?: string;
	description?: string | null;
	coverStyle?: string;
}

export function mapNotebookRecord(record: NotebookRecord): NotebookSummary {
	return Object.freeze({
		id: record.id,
		name: record.name,
		description: record.description,
		coverStyle: record.cover_style,
		documentCount: record.document_count,
		createdAt: record.created_at,
		updatedAt: record.updated_at
	});
}
