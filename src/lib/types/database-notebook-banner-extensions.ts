import type { Database } from './database';

type NotebookBannerColumns = {
	banner_path: string | null;
	banner_position_x: number;
	banner_position_y: number;
};

type NotebookTable = Database['public']['Tables']['notebooks'];

type NotebookBannerTable = {
	Row: NotebookTable['Row'] & NotebookBannerColumns;
	Insert: NotebookTable['Insert'] & Partial<NotebookBannerColumns>;
	Update: NotebookTable['Update'] & Partial<NotebookBannerColumns>;
	Relationships: NotebookTable['Relationships'];
};

/**
 * Temporary schema bridge for the notebook banner migration.
 *
 * Consolidate this into the generated Database type the next time the linked
 * Supabase schema is used to regenerate `database.ts`.
 */
export type DatabaseWithNotebookBanners = Omit<Database, 'public'> & {
	public: Omit<Database['public'], 'Tables'> & {
		Tables: Omit<Database['public']['Tables'], 'notebooks'> & {
			notebooks: NotebookBannerTable;
		};
	};
};
