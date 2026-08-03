import { exportFilename, parseExportManifest, type ExportManifest } from '$lib/export/manifest';
import { getSupabaseClient } from './supabase';

export type ExportClientLike = {
	rpc(name: 'export_portable_manifest'): Promise<{ data: unknown; error: unknown }>;
};

export class ExportServiceError extends Error {
	constructor() {
		super('Não foi possível gerar a exportação agora.');
		this.name = 'ExportServiceError';
	}
}

function defaultClient(): ExportClientLike {
	return getSupabaseClient() as unknown as ExportClientLike;
}

export async function createPortableExport(
	client: ExportClientLike = defaultClient()
): Promise<ExportManifest> {
	try {
		const { data, error } = await client.rpc('export_portable_manifest');
		if (error || data === null) throw new ExportServiceError();
		return parseExportManifest(data);
	} catch {
		throw new ExportServiceError();
	}
}

export function serializePortableExport(manifest: ExportManifest): string {
	return `${JSON.stringify(parseExportManifest(manifest), null, 2)}\n`;
}

export function downloadPortableExport(manifest: ExportManifest) {
	const content = serializePortableExport(manifest);
	const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = exportFilename(manifest.exportedAt);
		anchor.rel = 'noopener';
		anchor.click();
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
}
