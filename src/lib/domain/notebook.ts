export interface NotebookSummary {
	id: string;
	name: string;
	description: string | null;
	coverStyle: string;
	bannerPath: string | null;
	bannerPositionX: number;
	bannerPositionY: number;
	documentCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface NotebookRecord {
	id: string;
	name: string;
	description: string | null;
	cover_style: string;
	banner_path: string | null;
	banner_position_x: number;
	banner_position_y: number;
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
		bannerPath: record.banner_path,
		bannerPositionX: record.banner_position_x,
		bannerPositionY: record.banner_position_y,
		documentCount: record.document_count,
		createdAt: record.created_at,
		updatedAt: record.updated_at
	});
}
