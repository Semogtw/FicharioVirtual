import type { Database } from './database';

type NotebookExtendedColumns = {
	parent_notebook_id: string | null;
	banner_path: string | null;
	banner_position_x: number;
	banner_position_y: number;
};

type NotebookTable = Database['public']['Tables']['notebooks'];

type NotebookExtendedTable = {
	Row: NotebookTable['Row'] & NotebookExtendedColumns;
	Insert: NotebookTable['Insert'] & Partial<NotebookExtendedColumns>;
	Update: NotebookTable['Update'] & Partial<NotebookExtendedColumns>;
	Relationships: NotebookTable['Relationships'];
};

/**
 * Temporary schema bridge for notebook hierarchy/banner migrations.
 *
 * Consolidate this into the generated Database type the next time the linked
 * Supabase schema is used to regenerate `database.ts`.
 */
export type DatabaseWithNotebookBanners = Omit<Database, 'public'> & {
	public: Omit<Database['public'], 'Tables'> & {
		Tables: Omit<Database['public']['Tables'], 'notebooks'> & {
			notebooks: NotebookExtendedTable;
		};
	};
};
